import { formatDecimal, parseDecimal } from "./decimal.js";
import type { Caps } from "./types.js";

export interface SpendDecision {
  allowed: boolean;
  code?: "PER_OP_CAP" | "PER_HOUR_CAP";
  reason?: string;
}

interface Entry {
  ts: number;
  notionalX18: bigint;
}

/**
 * 按「尝试」计费：通过检查后立刻记入窗口，即使随后提交失败也不退回。
 * 这样重试和并发不会把同一小时的额度花穿。
 */
export class SpendCaps {
  private entries: Entry[] = [];

  constructor(
    private readonly caps: Caps,
    private readonly now: () => number = Date.now,
  ) {
    if (parseDecimal(caps.maxNotionalPerOrder) <= 0n) throw new Error("单笔名义上限必须为正");
    if (parseDecimal(caps.maxNotionalPerHour) <= 0n) throw new Error("每小时名义上限必须为正");
    if (!Number.isFinite(caps.windowMs) || caps.windowMs < 1_000) throw new Error("花费窗口至少 1000 毫秒");
    if (!Number.isInteger(caps.maxWalletsConcurrent) || caps.maxWalletsConcurrent < 1) {
      throw new Error("同时执行的钱包数至少为 1");
    }
  }

  charge(notional: string): SpendDecision {
    const amount = parseDecimal(notional);
    if (amount <= 0n) {
      return { allowed: false, code: "PER_OP_CAP", reason: "名义价值必须为正" };
    }
    const perOp = parseDecimal(this.caps.maxNotionalPerOrder);
    if (amount > perOp) {
      return {
        allowed: false,
        code: "PER_OP_CAP",
        reason: `单笔名义 ${formatDecimal(amount)} 超过上限 ${this.caps.maxNotionalPerOrder} USDT0`,
      };
    }
    const now = this.now();
    this.entries = this.entries.filter((entry) => now - entry.ts < this.caps.windowMs);
    const used = this.entries.reduce((sum, entry) => sum + entry.notionalX18, 0n);
    const perHour = parseDecimal(this.caps.maxNotionalPerHour);
    if (used + amount > perHour) {
      return {
        allowed: false,
        code: "PER_HOUR_CAP",
        reason: `本窗口已用 ${formatDecimal(used)}，加上 ${formatDecimal(amount)} 将超过 ${this.caps.maxNotionalPerHour} USDT0`,
      };
    }
    this.entries.push({ ts: now, notionalX18: amount });
    return { allowed: true };
  }

  /** 当前窗口内已计入的名义，十进制字符串。 */
  used(): string {
    const now = this.now();
    const total = this.entries
      .filter((entry) => now - entry.ts < this.caps.windowMs)
      .reduce((sum, entry) => sum + entry.notionalX18, 0n);
    return formatDecimal(total);
  }
}
