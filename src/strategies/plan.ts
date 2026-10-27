import { decimalFromNumber } from "../decimal.js";
import { sampleDwell, sampleRange } from "../jitter.js";
import { alignOrder, offsetPrice, outsideOracleBand } from "../sizing.js";
import type { CyclePlan, MarketSpec, PriceSpec, Side, StrategyParams } from "../types.js";

export type PlanOutcome = { ok: true; plan: CyclePlan } | { ok: false; reason: string };

/** 两个策略共用的挂单计划：post-only 限价，价格离开参考价，数量按步长向下对齐。 */
export function planMakerCycle(input: {
  params: StrategyParams;
  market: MarketSpec;
  walletId: string;
  reference?: string;
  rng: () => number;
}): PlanOutcome {
  const params = input.params;
  if (!input.market.enabled) {
    return { ok: false, reason: `${input.market.symbol} 未启用。请先在配置里核对 productId 再把 enabled 设为 true。` };
  }
  if (!Number.isInteger(input.market.productId) || input.market.productId < 1) {
    return { ok: false, reason: `${input.market.symbol} 的 productId 无效` };
  }
  const side = pickSide(params.side, input.rng);
  let rawPrice: string;
  try {
    rawPrice = priceFor(params.price, side, input.reference, input.rng);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const reference = input.reference ?? (params.price.mode === "offset-bps" ? params.price.reference : params.price.reference);
  if (reference && outsideOracleBand(rawPrice, reference)) {
    return {
      ok: false,
      reason: `价格 ${rawPrice} 落在参考价 ${reference} 的 80%–120% 之外，本地拒绝，避免触发预言机带宽错误`,
    };
  }
  const rawSize = decimalFromNumber(sampleRange(params.size, input.rng));
  let aligned;
  try {
    aligned = alignOrder({
      price: rawPrice,
      size: rawSize,
      side,
      market: input.market,
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (reference && outsideOracleBand(aligned.price, reference)) {
    return { ok: false, reason: `对齐后的价格 ${aligned.price} 超出参考价带宽` };
  }
  return {
    ok: true,
    plan: {
      walletId: input.walletId,
      market: input.market,
      side,
      price: aligned.price,
      size: aligned.size,
      notional: aligned.notional,
      dwellMs: sampleDwell(params.dwellMs, input.rng),
      ttlSec: params.ttlSec,
      referenceUsed: reference,
    },
  };
}

function pickSide(side: StrategyParams["side"], rng: () => number): Side {
  if (side === "random") return rng() < 0.5 ? "buy" : "sell";
  return side;
}

function priceFor(spec: PriceSpec, side: Side, reference: string | undefined, rng: () => number): string {
  if (spec.mode === "absolute") {
    return decimalFromNumber(sampleRange(spec.absolute, rng));
  }
  const ref = reference ?? spec.reference;
  if (!ref) throw new Error("offset-bps 需要参考价");
  const bps = sampleRange(spec.offsetBps, rng);
  if (bps > 1_900) throw new Error(`offsetBps ${bps} 超过 1900，会落到预言机带宽外面`);
  return offsetPrice(ref, side, bps);
}
