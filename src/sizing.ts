import { formatDecimal, parseDecimal } from "./decimal.js";
import type { MarketSpec, Side } from "./types.js";

const X18 = 10n ** 18n;

export interface AlignedOrder {
  price: string;
  size: string;
  priceX18: bigint;
  sizeX18: bigint;
  signedAmountX18: bigint;
  notionalX18: bigint;
  notional: string;
}

export function alignOrder(input: {
  price: string;
  size: string;
  side: Side;
  market: MarketSpec;
}): AlignedOrder {
  const tick = parseDecimal(input.market.priceTick);
  const step = parseDecimal(input.market.sizeStep);
  const minNotional = parseDecimal(input.market.minNotional);
  if (tick <= 0n || step <= 0n) throw new Error(`${input.market.symbol} 的价格跳动或数量步长无效`);

  const priceX18 = roundToStep(parseDecimal(input.price), tick, "nearest");
  const sizeX18 = roundToStep(parseDecimal(input.size), step, "down");
  if (priceX18 <= 0n) {
    throw new Error(`价格对齐到跳动后为 0（${input.market.symbol}）`);
  }
  if (sizeX18 <= 0n) {
    throw new Error(`数量向下对齐到步长后为 0（${input.market.symbol}，步长 ${input.market.sizeStep}）`);
  }
  const notionalX18 = (priceX18 * sizeX18) / X18;
  if (notionalX18 < minNotional) {
    throw new Error(
      `名义价值 ${formatDecimal(notionalX18)} USDT0 低于 ${input.market.symbol} 最小名义 ${input.market.minNotional}。` +
        `本工具不会悄悄把数量加大。请提高 size，或把价格放到能通过最小名义的位置。`,
    );
  }
  const signedAmountX18 = input.side === "buy" ? sizeX18 : -sizeX18;
  return {
    price: formatDecimal(priceX18),
    size: formatDecimal(sizeX18),
    priceX18,
    sizeX18,
    signedAmountX18,
    notionalX18,
    notional: formatDecimal(notionalX18),
  };
}

/** 买单低于参考价，卖单高于参考价，避免主动吃单。bps 为整数基点。 */
export function offsetPrice(reference: string, side: Side, offsetBps: number): string {
  if (!Number.isFinite(offsetBps) || offsetBps < 0) throw new Error("偏离基点不能为负");
  const ref = parseDecimal(reference);
  if (ref <= 0n) throw new Error("参考价必须为正");
  const bps = BigInt(Math.round(offsetBps));
  const delta = (ref * bps) / 10_000n;
  const next = side === "buy" ? ref - delta : ref + delta;
  if (next <= 0n) throw new Error("偏离后价格不为正，请减小 offsetBps");
  return formatDecimal(next);
}

/**
 * Nado 预言机大约拒绝参考价 ±20% 以外的委托。
 * 有参考价时在本地先拒绝，避免把注定失败的单送出去。
 */
export function outsideOracleBand(price: string, reference: string): boolean {
  const px = parseDecimal(price);
  const ref = parseDecimal(reference);
  if (ref <= 0n) return false;
  const lo = (ref * 80n) / 100n;
  const hi = (ref * 120n) / 100n;
  return px < lo || px > hi;
}

export function roundToStep(value: bigint, step: bigint, mode: "nearest" | "down"): bigint {
  if (step <= 0n) throw new Error("步长必须为正");
  if (value <= 0n) return 0n;
  if (mode === "down") return (value / step) * step;
  return ((value + step / 2n) / step) * step;
}
