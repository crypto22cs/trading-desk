/**
 * scheduled-place-cancel：按调度重复「挂 post-only → 等待 → 撤销」。
 * 这是操作者自己账户上的受控活动，不是对敲，也不会安排钱包之间互相成交。
 * 多钱包制造成交量可能违反交易场地服务条款。默认只跑一轮，直到你改配置。
 */
export const SCHEDULED_PLACE_CANCEL = "scheduled-place-cancel";

export const STRATEGY_NAMES = ["resting-maker", "scheduled-place-cancel"] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];

export function assertStrategyName(name: string): StrategyName {
  if (name === "resting-maker" || name === "scheduled-place-cancel") return name;
  throw new Error(`未知策略「${name}」。可选：${STRATEGY_NAMES.join("、")}`);
}
