import { buildCancel, buildPlace, type BuiltPlace } from "./eip712.js";
import { createLiveGateway, createPaperGateway, type Gateway } from "./gateway.js";
import { HaltController, sleepUntil } from "./halt.js";
import { createLogger, type Logger } from "./log.js";
import { sampleRange } from "./jitter.js";
import { assertCanStart, networkFor, willBroadcast } from "./networks.js";
import { mapPool } from "./pool.js";
import { nextCronTime } from "./schedule.js";
import { SpendCaps } from "./spendcaps.js";
import { planMakerCycle } from "./strategies/plan.js";
import { writeStatus, type DeskStatus, type OpenDigest } from "./state.js";
import { parseDecimal } from "./decimal.js";
import type { CyclePlan, DeskConfig, ResolvedWallet } from "./types.js";
import { keyMaterial, resolveWallets } from "./wallets.js";

export interface RunSummary {
  mode: DeskConfig["mode"];
  strategy: string;
  broadcast: boolean;
  cycles: number;
  placed: number;
  cancelled: number;
  rejected: number;
  failed: number;
  skipped: number;
  halted: boolean;
  logs: string[];
}

export interface RunDeps {
  now: () => number;
  rng: () => number;
  sleep: (ms: number, halt: HaltController) => Promise<void>;
  gateway?: Gateway;
  log?: Logger;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  halt?: HaltController;
}

export class AlreadyHaltedError extends Error {
  constructor(reason: string) {
    super(`急停文件已存在（${reason}）。确认可以继续后删除该文件，再重新运行。`);
    this.name = "AlreadyHaltedError";
  }
}

export async function runDesk(config: DeskConfig, deps: Partial<RunDeps> = {}): Promise<RunSummary> {
  const env = deps.env ?? process.env;
  assertCanStart(config.mode, env);
  const broadcast = willBroadcast(config.mode, env);
  const halt = deps.halt ?? new HaltController(config.haltFile);
  if (halt.isHalted()) throw new AlreadyHaltedError(halt.why());

  const wallets = resolveWallets(config.wallets, { loadKeys: broadcast, env });
  const log = deps.log ?? createLogger({ secrets: keyMaterial(wallets) });
  const now = deps.now ?? Date.now;
  const rng = deps.rng ?? Math.random;
  const sleep = deps.sleep ?? sleepUntil;
  const network = networkFor(config.mode, config.gatewayUrl);
  const gateway = deps.gateway ?? (broadcast ? createLiveGateway(network, log, deps.fetchImpl) : createPaperGateway(log));
  const caps = new SpendCaps(config.caps, now);

  if (config.mode === "paper" && env.NADO_LIVE === "1") {
    log.warn("已设置 NADO_LIVE=1，但当前是 paper，不会签名，也不会广播。");
  }
  if (config.mode === "mainnet" && Number(config.caps.maxNotionalPerOrder) > 150) {
    log.warn(`主网单笔上限 ${config.caps.maxNotionalPerOrder} 高于建议值 150 USDT0。`);
  }
  if (config.mode === "mainnet" && config.caps.maxWalletsConcurrent > 1) {
    log.warn(`主网同时钱包数 ${config.caps.maxWalletsConcurrent} 高于建议值 1。`);
  }
  if (config.strategyName === "scheduled-place-cancel") {
    log.warn("scheduled-place-cancel 只在自己的账户上挂出再撤销，不会安排钱包互成交。多钱包刷量可能违反场地条款。");
  }

  const counts = { cycles: 0, placed: 0, cancelled: 0, rejected: 0, failed: 0, skipped: 0 };
  const open: OpenDigest[] = [];
  let lastAction: string | undefined;
  let lastError: string | undefined;
  const startedMs = now();

  const snapshot = (): DeskStatus => ({
    version: 1,
    mode: config.mode,
    strategy: config.strategyName,
    chainId: network.chainId,
    broadcast,
    pid: process.pid,
    startedAt: new Date(startedMs).toISOString(),
    updatedAt: new Date(now()).toISOString(),
    halted: halt.isHalted(),
    haltReason: halt.isHalted() ? halt.why() : undefined,
    ...counts,
    hourNotional: caps.used(),
    openDigests: [...open],
    lastAction,
    lastError,
  });
  const persist = () => {
    try {
      writeStatus(config.stateFile, snapshot());
    } catch (error) {
      log.warn(`状态文件写入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  log.info(
    `启动 ${config.strategyName} · ${network.label} · chainId ${network.chainId} · ${broadcast ? "将广播" : "不广播"} · 钱包 ${wallets.length} · 并发 ${config.caps.maxWalletsConcurrent}`,
  );
  persist();

  const schedule = config.strategy.schedule;
  const max = schedule.mode === "once" ? 1 : schedule.maxOccurrences;
  let fires = 0;

  while (!halt.isHalted()) {
    if (schedule.mode === "cron") {
      const target = nextCronTime(schedule.cron ?? "", now());
      const wait = Math.max(0, target - now());
      log.info(`cron 下一次 ${new Date(target).toISOString()}，等待 ${wait} ms`);
      await sleep(wait, halt);
      if (halt.isHalted()) break;
    }
    fires += 1;
    counts.cycles += 1;
    lastAction = `cycle ${fires}`;
    await runCycle();
    persist();
    if (max !== undefined && fires >= max) break;
    if (schedule.mode === "every") {
      const extra = schedule.jitterMs ? sampleRange(schedule.jitterMs, rng) : 0;
      await sleep((schedule.everyMs ?? 0) + extra, halt);
    }
    if (schedule.mode === "once") break;
  }

  if (halt.isHalted()) log.warn(`已急停：${halt.why()}。停止后续提交。`);
  log.info(
    `完成：轮次 ${counts.cycles}，挂出 ${counts.placed}，撤销 ${counts.cancelled}，拒绝 ${counts.rejected}，失败 ${counts.failed}，跳过 ${counts.skipped}`,
  );
  persist();
  return { mode: config.mode, strategy: config.strategyName, broadcast, halted: halt.isHalted(), logs: log.lines, ...counts };

  async function runCycle(): Promise<void> {
    const market = config.markets[config.strategy.market];
    if (!market) {
      counts.failed += 1;
      lastError = `配置里没有市场 ${config.strategy.market}`;
      log.error(lastError);
      return;
    }
    const reference = await resolveReference(market.productId);
    const runnable: { wallet: ResolvedWallet; plan: CyclePlan }[] = [];
    for (const wallet of wallets) {
      if (halt.isHalted()) break;
      const outcome = planMakerCycle({
        params: config.strategy,
        market,
        walletId: wallet.id,
        reference,
        rng,
      });
      if (!outcome.ok) {
        counts.rejected += 1;
        lastAction = `拒绝 ${wallet.id}：${outcome.reason}`;
        log.warn(`${wallet.id} ${outcome.reason}`);
        continue;
      }
      const decision = caps.charge(outcome.plan.notional);
      if (!decision.allowed) {
        counts.rejected += 1;
        lastAction = `拒绝 ${wallet.id}：${decision.reason}`;
        log.warn(`${wallet.id} ${decision.reason}`);
        continue;
      }
      runnable.push({ wallet, plan: outcome.plan });
      log.info(
        `${wallet.id} 名义 ${outcome.plan.notional} USDT0 · ${outcome.plan.side} ${outcome.plan.size} ${market.symbol} @ ${outcome.plan.price} · 停留 ${outcome.plan.dwellMs} ms`,
      );
    }

    await mapPool(runnable, config.caps.maxWalletsConcurrent, async ({ wallet, plan }) => {
      if (halt.isHalted()) {
        counts.skipped += 1;
        log.warn(`${wallet.id} 急停已生效，跳过这笔提交（额度已计入本窗口）`);
        return;
      }
      const expirationSec = BigInt(Math.floor(now() / 1000) + plan.ttlSec);
      let built: BuiltPlace;
      try {
        built = buildPlace({
          owner: wallet.address,
          subaccountName: config.subaccountName,
          productId: plan.market.productId,
          chainId: network.chainId,
          price: plan.price,
          amountX18: plan.side === "buy" ? parseDecimal(plan.size) : -parseDecimal(plan.size),
          expirationSec,
          spot: plan.market.kind === "spot",
        });
      } catch (error) {
        counts.failed += 1;
        lastError = error instanceof Error ? error.message : String(error);
        log.error(`${wallet.id} 构造委托失败：${lastError}`);
        return;
      }
      let digest: `0x${string}` | undefined;
      try {
        const receipt = await gateway.place(wallet, built, halt.signal);
        digest = receipt.digest;
        counts.placed += 1;
        open.push({
          walletId: wallet.id,
          market: plan.market.symbol,
          side: plan.side,
          price: plan.price,
          size: plan.size,
          digest,
        });
        lastAction = `place ${digest}`;
      } catch (error) {
        counts.failed += 1;
        lastError = error instanceof Error ? error.message : String(error);
        log.error(`${wallet.id} 挂单失败：${lastError}`);
        return;
      }
      await sleep(plan.dwellMs, halt);
      try {
        const cancel = buildCancel({
          owner: wallet.address,
          subaccountName: config.subaccountName,
          productId: plan.market.productId,
          chainId: network.chainId,
          endpoint: network.endpoint,
          digests: [digest],
        });
        const receipt = await gateway.cancel(wallet, cancel, AbortSignal.timeout(20_000));
        counts.cancelled += 1;
        const idx = open.findIndex((item) => item.digest === digest);
        if (idx >= 0) open.splice(idx, 1);
        lastAction = `cancel ${receipt.cancelled.join(",") || digest}`;
      } catch (error) {
        counts.failed += 1;
        lastError = error instanceof Error ? error.message : String(error);
        log.error(`${wallet.id} 撤单失败，委托可能仍在簿上 digest=${digest}：${lastError}`);
      }
    });
  }

  async function resolveReference(productId: number): Promise<string | undefined> {
    const price = config.strategy.price;
    const fallback = price.reference;
    if (price.mode === "offset-bps" && price.fetchMark && config.mode !== "paper") {
      try {
        const mark = await gateway.mark(productId, AbortSignal.timeout(8_000));
        if (mark) {
          log.info(`使用行情中间价 ${mark} 作为参考`);
          return mark;
        }
      } catch (error) {
        log.warn(`行情查询失败，改用参考价 ${fallback ?? "无"}：${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (config.mode === "paper" && price.fetchMark) {
      log.info("paper 不拉取行情，使用配置里的参考价");
    }
    return fallback;
  }
}
