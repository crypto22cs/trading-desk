/**
 * resting-maker：挂一笔 post-only 限价单，等待，再按 digest 撤销。
 * 用于确认签名和网关通路。价格偏离参考价，避免主动成交。
 */
export const RESTING_MAKER = "resting-maker";
