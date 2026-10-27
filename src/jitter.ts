import type { Range } from "./types.js";

export function isRange(value: unknown): value is Range {
  return typeof value === "object" && value !== null && "min" in value && "max" in value;
}

/**
 * 在 [min, max] 内取样。有 step 时从 min 起按步长对齐，并夹在区间内。
 * rng 返回 [0, 1)。
 */
export function sampleRange(range: Range, rng: () => number): number {
  const { min, max } = range;
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("区间端点必须是有限数字");
  if (max < min) throw new Error(`区间 max(${max}) 小于 min(${min})`);
  const unit = rng();
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new Error("随机源必须返回 [0, 1) 的数");
  if (max === min) return min;
  const step = range.step;
  if (step === undefined) return min + unit * (max - min);
  if (!Number.isFinite(step) || step <= 0) throw new Error("step 必须为正数");
  const steps = Math.floor((max - min) / step + 1e-9);
  const index = Math.min(steps, Math.floor(unit * (steps + 1)));
  const value = min + index * step;
  return value > max ? max : value;
}

export function sampleDwell(dwell: number | Range, rng: () => number): number {
  const raw = typeof dwell === "number" ? dwell : sampleRange(dwell, rng);
  if (!Number.isFinite(raw) || raw < 0) throw new Error("等待时间不能为负");
  return Math.round(raw);
}

/** 可重复的测试用随机源。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
