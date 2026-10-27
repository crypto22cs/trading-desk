import { getOrderNonce } from "@nadohq/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { buildCancel, buildPlace } from "../src/eip712.js";
import { createLiveGateway } from "../src/gateway.js";
import { createLogger } from "../src/log.js";
import { networkFor } from "../src/networks.js";

const owner = "0x1111111111111111111111111111111111111111" as const;
const nonce = getOrderNonce(1_700_000_000_000, 7);

describe("EIP-712", () => {
  it("post-only 买单的附录、价格和 chainId 与 SDK 一致", () => {
    const built = buildPlace({
      owner,
      subaccountName: "default",
      productId: 2,
      chainId: 763373,
      price: "76000",
      amountX18: 1_500_000_000_000_000n,
      expirationSec: 2_000_000_000n,
      nonce,
      spot: false,
    });
    expect(built.primaryType).toBe("Order");
    expect(built.message.appendix).toBe("1537");
    expect(built.message.amount).toBe("1500000000000000");
    expect(built.message.priceX18).toBe("76000000000000000000000");
    expect(built.domain.chainId).toBe(763373);
    expect(built.domain.verifyingContract).toBe("0x0000000000000000000000000000000000000002");
    expect(built.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(built.spotLeverage).toBeNull();
  });

  it("卖单数量为负，撤单域使用测试网 endpoint", () => {
    const place = buildPlace({
      owner,
      subaccountName: "default",
      productId: 2,
      chainId: 763373,
      price: "88000",
      amountX18: -2_000_000_000_000_000n,
      expirationSec: 2_000_000_000n,
      nonce,
      spot: false,
    });
    expect(place.message.amount.startsWith("-")).toBe(true);
    const network = networkFor("testnet");
    const cancel = buildCancel({
      owner,
      subaccountName: "default",
      productId: 2,
      chainId: network.chainId,
      endpoint: network.endpoint,
      digests: [place.digest],
      nonce: getOrderNonce(1_700_000_000_000, 8),
    });
    expect(cancel.primaryType).toBe("Cancellation");
    expect(cancel.domain.verifyingContract?.toLowerCase()).toBe("0x698d87105274292b5673367dec81874ce3633ac2");
    expect(cancel.message.digests).toEqual([place.digest]);
  });

  it("实盘网关签名后提交，请求体不含私钥", async () => {
    const key = generatePrivateKey();
    const wallet = { id: "t", address: privateKeyToAccount(key).address, privateKey: key };
    const built = buildPlace({
      owner: wallet.address,
      subaccountName: "default",
      productId: 2,
      chainId: 763373,
      price: "76000",
      amountX18: 1_500_000_000_000_000n,
      expirationSec: 2_000_000_000n,
      nonce,
      spot: false,
    });
    let posted = "";
    const gateway = createLiveGateway(networkFor("testnet"), createLogger({ silent: true, secrets: [key] }), async (url, init) => {
      expect(String(url)).toContain("/execute");
      posted = String(init?.body);
      return new Response(JSON.stringify({ status: "success", data: { digest: built.digest } }), { status: 200 });
    });
    const receipt = await gateway.place(wallet, built, AbortSignal.timeout(1_000));
    expect(receipt.broadcast).toBe(true);
    expect(receipt.digest).toBe(built.digest);
    const body = JSON.parse(posted) as { place_order: { order: { appendix: string }; signature: string } };
    expect(body.place_order.order.appendix).toBe("1537");
    expect(body.place_order.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    expect(posted.includes(key)).toBe(false);
    expect(posted.includes(key.slice(2))).toBe(false);
  });
});
