import { describe, expect, it } from "vitest";
import { SpendCaps } from "../src/spendcaps.js";
import type { Caps } from "../src/types.js";

const caps: Caps = {
  maxNotionalPerOrder: "10",
  maxNotionalPerHour: "15",
  windowMs: 1_000,
  maxWalletsConcurrent: 2,
};

describe("SpendCaps", () => {
  it("拒绝超过单笔上限的委托，且不记入窗口", () => {
    let now = 0;
    const book = new SpendCaps(caps, () => now);
    const decision = book.charge("10.01");
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("PER_OP_CAP");
    expect(book.used()).toBe("0");
    now = 10;
    expect(book.charge("10").allowed).toBe(true);
    expect(book.used()).toBe("10");
  });

  it("滑动窗口累加，过窗后可以再次计入", () => {
    let now = 0;
    const book = new SpendCaps(caps, () => now);
    expect(book.charge("10").allowed).toBe(true);
    const blocked = book.charge("6");
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe("PER_HOUR_CAP");
    expect(book.used()).toBe("10");
    now = 1_000;
    expect(book.charge("6").allowed).toBe(true);
    expect(book.used()).toBe("6");
  });

  it("拒绝非正名义", () => {
    const book = new SpendCaps(caps, () => 0);
    expect(book.charge("0").code).toBe("PER_OP_CAP");
  });
});
