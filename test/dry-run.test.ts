import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatePrivateKey, mnemonicToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { loadDeskConfig } from "../src/config.js";
import { AlreadyHaltedError, runDesk } from "../src/engine.js";
import { createPaperGateway, type Gateway } from "../src/gateway.js";
import { HaltController, writeHaltFile } from "../src/halt.js";
import { sealPrivateKey, openPrivateKey } from "../src/keystore.js";
import { createLogger } from "../src/log.js";
import { mulberry32 } from "../src/jitter.js";
import { assertCanStart, willBroadcast } from "../src/networks.js";
import { resolveWallets } from "../src/wallets.js";
import type { DeskConfig } from "../src/types.js";

function fakeDigest(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}

function paperConfig(strategy = "resting-maker"): { config: DeskConfig; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "nado-dry-"));
  const config = loadDeskConfig({
    cwd: dir,
    strategyName: strategy,
    mode: "paper",
    haltFile: path.join(dir, "HALT"),
    stateFile: path.join(dir, "status.json"),
  });
  return { config, dir };
}

describe("dry-run", () => {
  it("resting-maker 在没有私钥、没有网络时打出挂单和撤单计划", async () => {
    const { config } = paperConfig();
    const fetchImpl = () => {
      throw new Error("paper 不应访问网络");
    };
    const log = createLogger({ silent: true });
    const summary = await runDesk(config, {
      log,
      rng: mulberry32(1),
      now: () => Date.UTC(2026, 9, 27, 12, 0, 0),
      fetchImpl,
      gateway: createPaperGateway(log),
    });
    expect(summary.broadcast).toBe(false);
    expect(summary.placed).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.rejected).toBe(0);
    expect(summary.failed).toBe(0);
    const text = summary.logs.join("\n");
    expect(text).toContain("BTC-PERP");
    expect(text).toContain("place_order");
    expect(text).toContain("cancel_orders");
    expect(text).toContain("appendix=1537");
    expect(text).toContain("chainId=763373");
    expect(text).toContain("未广播");
    expect(text).not.toContain("已广播");
  });

  it("即使 NADO_LIVE=1，paper 也不广播", async () => {
    const { config } = paperConfig();
    const summary = await runDesk(config, {
      env: { NADO_LIVE: "1" },
      log: createLogger({ silent: true }),
      rng: mulberry32(2),
      sleep: async () => {},
    });
    expect(summary.broadcast).toBe(false);
    expect(willBroadcast("paper", { NADO_LIVE: "1" })).toBe(false);
    expect(willBroadcast("testnet", {})).toBe(false);
    expect(willBroadcast("testnet", { NADO_LIVE: "1" })).toBe(true);
  });

  it("超过单笔上限时不提交", async () => {
    const { config } = paperConfig();
    config.caps = { ...config.caps, maxNotionalPerOrder: "1" };
    let places = 0;
    const gateway: Gateway = {
      async place() {
        places += 1;
        return { digest: fakeDigest("11"), broadcast: false };
      },
      async cancel() {
        return { cancelled: [], broadcast: false };
      },
      async mark() {
        return null;
      },
    };
    const summary = await runDesk(config, { gateway, log: createLogger({ silent: true }), rng: mulberry32(3) });
    expect(places).toBe(0);
    expect(summary.placed).toBe(0);
    expect(summary.rejected).toBe(1);
  });

  it("已有急停文件时拒绝启动", async () => {
    const { config, dir } = paperConfig();
    writeHaltFile(path.join(dir, "HALT"), "先停着");
    await expect(runDesk(config, { log: createLogger({ silent: true }) })).rejects.toBeInstanceOf(AlreadyHaltedError);
  });

  it("停留期间急停仍会撤销已经挂出的委托", async () => {
    const { config } = paperConfig();
    config.strategy = { ...config.strategy, dwellMs: 5_000 };
    const halt = new HaltController(config.haltFile);
    const calls: string[] = [];
    const gateway: Gateway = {
      async place() {
        calls.push("place");
        return { digest: fakeDigest("22"), broadcast: false };
      },
      async cancel() {
        calls.push("cancel");
        return { cancelled: [fakeDigest("22")], broadcast: false };
      },
      async mark() {
        return null;
      },
    };
    const summary = await runDesk(config, {
      gateway,
      halt,
      log: createLogger({ silent: true }),
      rng: mulberry32(4),
      sleep: async (_ms, controller) => {
        controller.trip("停留中");
      },
    });
    expect(calls).toEqual(["place", "cancel"]);
    expect(summary.halted).toBe(true);
    expect(summary.cancelled).toBe(1);
  });

  it("同时执行的钱包数不会超过上限", async () => {
    const { config } = paperConfig();
    config.caps = { ...config.caps, maxWalletsConcurrent: 1 };
    config.wallets = [
      { id: "a", address: "0x1111111111111111111111111111111111111111" },
      { id: "b", address: "0x2222222222222222222222222222222222222222" },
      { id: "c", address: "0x3333333333333333333333333333333333333333" },
    ];
    let current = 0;
    let max = 0;
    const gateway: Gateway = {
      async place() {
        current += 1;
        max = Math.max(max, current);
        await new Promise((resolve) => setTimeout(resolve, 20));
        current -= 1;
        return { digest: fakeDigest("33"), broadcast: false };
      },
      async cancel() {
        return { cancelled: [], broadcast: false };
      },
      async mark() {
        return null;
      },
    };
    const summary = await runDesk(config, { gateway, log: createLogger({ silent: true }), rng: mulberry32(5) });
    expect(max).toBe(1);
    expect(summary.placed).toBe(3);
  });

  it("scheduled-place-cancel 模板默认只跑一轮", async () => {
    const { config } = paperConfig("scheduled-place-cancel");
    expect(config.strategy.schedule.mode).toBe("every");
    expect(config.strategy.schedule.maxOccurrences).toBe(1);
    const waits: number[] = [];
    const summary = await runDesk(config, {
      log: createLogger({ silent: true }),
      rng: mulberry32(6),
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(summary.cycles).toBe(1);
    expect(waits.every((ms) => ms === 0)).toBe(true);
    expect(summary.logs.join("\n")).toContain("场地条款");
  });

  it("主网没有确认标志时不能启动", () => {
    expect(() => assertCanStart("mainnet", {})).toThrow(/主网/);
    expect(() => assertCanStart("mainnet", { NADO_LIVE: "1" })).toThrow(/主网/);
    expect(() => assertCanStart("mainnet", { NADO_LIVE: "1", NADO_CONFIRM_MAINNET: "YES" })).not.toThrow();
    expect(() => assertCanStart("testnet", {})).not.toThrow();
  });

  it("加密私钥可以解回，日志会抹掉长密钥", () => {
    const key = generatePrivateKey();
    const sealed = sealPrivateKey(key, "test-passphrase");
    expect(openPrivateKey(sealed, "test-passphrase")).toBe(key);
    expect(() => openPrivateKey(sealed, "other-passphrase")).toThrow(/解密/);
    const log = createLogger({ silent: true, secrets: [key] });
    log.info(`泄露检查 ${key}`);
    expect(log.lines[0]).not.toContain(key.slice(2));
  });

  it("HD 路径导出公开测试助记词的第一号地址", () => {
    const mnemonic = "test test test test test test test test test test test junk";
    const wallets = resolveWallets([{ id: "hd", mnemonicEnv: "NADO_MNEMONIC", path: "m/44'/60'/0'/0/0" }], {
      loadKeys: true,
      env: { NADO_MNEMONIC: mnemonic },
    });
    expect(wallets[0]?.address).toBe(mnemonicToAccount(mnemonic).address);
    expect(wallets[0]?.privateKey).toBeDefined();
  });
});
