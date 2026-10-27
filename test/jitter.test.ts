import { describe, expect, it } from "vitest";
import { mulberry32, sampleDwell, sampleRange } from "../src/jitter.js";

describe("sampleRange", () => {
  it("把样本限制在区间内，并按步长对齐", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const value = sampleRange({ min: 0.0015, max: 0.002, step: 0.00005 }, rng);
      expect(value).toBeGreaterThanOrEqual(0.0015 - 1e-12);
      expect(value).toBeLessThanOrEqual(0.002 + 1e-12);
      const steps = Math.round((value - 0.0015) / 0.00005);
      expect(Math.abs(value - (0.0015 + steps * 0.00005))).toBeLessThan(1e-10);
    }
  });

  it("端点重合时原样返回", () => {
    expect(sampleRange({ min: 4, max: 4 }, () => 0.9)).toBe(4);
  });

  it("拒绝反转的区间和越界随机数", () => {
    expect(() => sampleRange({ min: 2, max: 1 }, () => 0.2)).toThrow(/max/);
    expect(() => sampleRange({ min: 0, max: 1 }, () => 1)).toThrow(/随机源/);
  });

  it("等待时间取整且不为负", () => {
    expect(sampleDwell(12.4, () => 0)).toBe(12);
    expect(sampleDwell({ min: 10, max: 10 }, () => 0.1)).toBe(10);
    expect(() => sampleDwell(-1, () => 0)).toThrow(/不能为负/);
  });
});
