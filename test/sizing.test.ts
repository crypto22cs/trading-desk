import { describe, expect, it } from "vitest";
import { defaultMarkets } from "../src/networks.js";
import { alignOrder, offsetPrice, outsideOracleBand } from "../src/sizing.js";

const btc = defaultMarkets()["BTC-PERP"]!;

describe("alignOrder", () => {
  it("价格四舍五入到跳动，数量向下对齐，买单数量为正", () => {
    const order = alignOrder({ price: "76000.4", size: "0.00157", side: "buy", market: btc });
    expect(order.price).toBe("76000");
    expect(order.size).toBe("0.00155");
    expect(order.signedAmountX18).toBe(1550000000000000n);
    expect(order.notional).toBe("117.8");
  });

  it("卖单数量为负", () => {
    const order = alignOrder({ price: "88000", size: "0.002", side: "sell", market: btc });
    expect(order.signedAmountX18).toBe(-2000000000000000n);
  });

  it("低于最小名义时直接拒绝，不把数量加大", () => {
    expect(() => alignOrder({ price: "1000", size: "0.01", side: "buy", market: btc })).toThrow(/最小名义/);
  });

  it("偏离参考价后买单更低、卖单更高，并识别预言机带宽", () => {
    expect(offsetPrice("80000", "buy", 1000)).toBe("72000");
    expect(offsetPrice("80000", "sell", 1000)).toBe("88000");
    expect(outsideOracleBand("70000", "80000")).toBe(false);
    expect(outsideOracleBand("60000", "80000")).toBe(true);
    expect(outsideOracleBand("96000", "80000")).toBe(false);
    expect(outsideOracleBand("97000", "80000")).toBe(true);
  });
});
