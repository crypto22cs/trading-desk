import { describe, expect, it } from "vitest";
import { nextCronTime, parseCron } from "../src/schedule.js";

describe("cron", () => {
  it("计算下一次 UTC 触发", () => {
    const midnight = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(nextCronTime("0 0 * * *", midnight)).toBe(Date.UTC(2026, 0, 2, 0, 0, 0));
    expect(nextCronTime("*/15 * * * *", Date.UTC(2026, 0, 1, 10, 0, 30))).toBe(Date.UTC(2026, 0, 1, 10, 15, 0));
  });

  it("把星期 7 当成星期日", () => {
    const parsed = parseCron("0 0 * * 7");
    expect(parsed.dow.values.has(0)).toBe(true);
    expect(parsed.dow.values.has(7)).toBe(false);
  });

  it("拒绝非法表达式", () => {
    expect(() => parseCron("* * *")).toThrow(/5 段/);
    expect(() => parseCron("60 * * * *")).toThrow(/超出/);
  });
});
