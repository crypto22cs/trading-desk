#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadDeskConfig } from "./config.js";
import { AlreadyHaltedError, runDesk } from "./engine.js";
import { loadEnvFile } from "./env.js";
import { HaltController, readReason, writeHaltFile } from "./halt.js";
import { sealPrivateKey } from "./keystore.js";
import { createLogger } from "./log.js";
import { repoRoot } from "./paths.js";
import { readStatus } from "./state.js";

const HELP = `nado-auto-desk — Ink 上 Nado 的挂撤工具

用法
  nado-auto-desk run [--config 文件] [--strategy 名称] [--mode paper|testnet|mainnet]
  nado-auto-desk status [--config 文件]
  nado-auto-desk halt [--reason 文字] [--config 文件]
  nado-auto-desk seal --out 文件

策略
  resting-maker            挂一笔 post-only，等待，再撤。适合冒烟。
  scheduled-place-cancel   按间隔或 cron 重复挂撤。默认只跑一轮。

常用
  pnpm run dry -- --strategy resting-maker
  pnpm nado run --mode testnet --strategy resting-maker --config config/testnet.example.yaml

paper 不需要私钥。testnet 只有 NADO_LIVE=1 才广播。mainnet 还要 NADO_CONFIRM_MAINNET=YES。
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  loadEnvFile(path.join(process.cwd(), ".env"));
  loadEnvFile(path.join(repoRoot(), ".env"));
  const { values } = parseArgs({
    args: stripPnpmSeparator(rest),
    options: {
      config: { type: "string" },
      strategy: { type: "string" },
      mode: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean", default: false },
      reason: { type: "string" },
      "halt-file": { type: "string" },
      "state-file": { type: "string" },
    },
    strict: true,
  });

  if (command === "run") {
    await runCommand(values);
    return;
  }
  if (command === "status") {
    statusCommand(values);
    return;
  }
  if (command === "halt") {
    haltCommand(values);
    return;
  }
  if (command === "seal") {
    await sealCommand(values);
    return;
  }
  throw new Error(`未知命令「${command}」。运行 nado-auto-desk help 查看用法。`);
}

async function runCommand(values: Args): Promise<void> {
  const config = loadDeskConfig({
    configPath: values.config,
    strategyName: values.strategy,
    mode: values.mode,
    haltFile: values["halt-file"],
    stateFile: values["state-file"],
  });
  const halt = new HaltController(config.haltFile);
  let signals = 0;
  const onSignal = (name: string) => {
    signals += 1;
    halt.trip(name);
    process.stderr.write(`收到 ${name}，停止后续提交。已挂出的单仍会尝试撤销。再按一次将立即退出。\n`);
    if (signals >= 2) process.exit(130);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  try {
    const summary = await runDesk(config, { halt });
    if (summary.failed > 0 || (summary.placed === 0 && summary.rejected > 0)) process.exitCode = 1;
  } catch (error) {
    if (error instanceof AlreadyHaltedError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

function statusCommand(values: Args): void {
  const config = tryConfig(values);
  const stateFile = config?.stateFile ?? path.resolve(process.cwd(), values["state-file"] ?? ".nado/status.json");
  const haltFile = config?.haltFile ?? path.resolve(process.cwd(), values["halt-file"] ?? ".nado/HALT");
  const status = readStatus(stateFile);
  const halted = new HaltController(haltFile).isHalted();
  if (!status) {
    process.stdout.write(`尚无运行记录。急停${halted ? "已拉下" : "未拉下"}。\n`);
    return;
  }
  const line = [
    status.strategy,
    status.mode,
    status.broadcast ? "广播" : "不广播",
    `轮次 ${status.cycles}`,
    `挂出 ${status.placed}`,
    `撤销 ${status.cancelled}`,
    `拒绝 ${status.rejected}`,
    `失败 ${status.failed}`,
    halted ? `急停：${readReason(haltFile)}` : "运行中或已结束",
  ].join(" · ");
  process.stdout.write(`${line}\n`);
  process.stdout.write(`${JSON.stringify({ ...status, halted }, null, 2)}\n`);
}

function haltCommand(values: Args): void {
  const config = tryConfig(values);
  const haltFile = config?.haltFile ?? path.resolve(process.cwd(), values["halt-file"] ?? ".nado/HALT");
  const reason = values.reason ?? "operator";
  writeHaltFile(haltFile, reason);
  const log = createLogger();
  log.info(`已写入急停文件 ${haltFile}`);
  log.info("正在运行的进程会在下一次提交前停下来。已挂出的订单仍会尝试撤销。");
}

async function sealCommand(values: Args): Promise<void> {
  if (!values.out) throw new Error("seal 需要 --out 指向一个新文件");
  const passphrase = process.env.NADO_KEY_PASSPHRASE ?? "";
  const raw = await readKeyMaterial();
  const sealed = sealPrivateKey(raw, passphrase);
  const dest = path.resolve(process.cwd(), values.out);
  if (!values.force && existsSync(dest)) {
    throw new Error(`文件已存在：${dest}。确认覆盖请加 --force`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(sealed, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`已加密写入 ${dest}\n地址 ${sealed.address}\n配置里写 keyFile，口令放在 NADO_KEY_PASSPHRASE。不要提交这个文件。\n`);
}

async function readKeyMaterial(): Promise<string> {
  if (process.env.NADO_KEY_TO_SEAL) return process.env.NADO_KEY_TO_SEAL;
  if (process.stdin.isTTY) {
    throw new Error("请设置 NADO_KEY_TO_SEAL，或从 stdin 传入私钥。不要把私钥放在命令行参数里。");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function tryConfig(values: Args) {
  try {
    return loadDeskConfig({
      configPath: values.config,
      strategyName: values.strategy,
      mode: values.mode,
      haltFile: values["halt-file"],
      stateFile: values["state-file"],
    });
  } catch {
    return null;
  }
}

/** pnpm 会把 `pnpm run dry -- --strategy …` 里的 `--` 原样传进来。去掉它，后面的选项仍然生效。 */
function stripPnpmSeparator(args: string[]): string[] {
  const index = args.indexOf("--");
  if (index < 0) return args;
  return [...args.slice(0, index), ...args.slice(index + 1)];
}

type Args = {
  config?: string;
  strategy?: string;
  mode?: string;
  out?: string;
  force?: boolean;
  reason?: string;
  "halt-file"?: string;
  "state-file"?: string;
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
