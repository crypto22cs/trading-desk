import type { Hex } from "viem";
import { buildCancel, buildPlace, cancelBody, placeBody, signBuilt, type BuiltCancel, type BuiltPlace } from "./eip712.js";
import type { Logger } from "./log.js";
import { formatDecimal } from "./decimal.js";
import type { NetworkProfile } from "./networks.js";
import type { ResolvedWallet } from "./types.js";

export interface PlaceReceipt {
  digest: Hex;
  broadcast: boolean;
}

export interface CancelReceipt {
  cancelled: string[];
  broadcast: boolean;
}

export interface Gateway {
  place(wallet: ResolvedWallet, built: BuiltPlace, signal: AbortSignal): Promise<PlaceReceipt>;
  cancel(wallet: ResolvedWallet, built: BuiltCancel, signal: AbortSignal): Promise<CancelReceipt>;
  /** 返回中间价的人类可读字符串。没有行情时返回 null。 */
  mark(productId: number, signal: AbortSignal): Promise<string | null>;
}

export function createPaperGateway(log: Logger): Gateway {
  return {
    async place(_wallet, built) {
      log.info(formatPlan(built, false));
      log.info("未广播");
      return { digest: built.digest, broadcast: false };
    },
    async cancel(_wallet, built) {
      log.info(formatCancel(built, false));
      log.info("未广播");
      return { cancelled: [...built.message.digests], broadcast: false };
    },
    async mark() {
      return null;
    },
  };
}

export function createLiveGateway(network: NetworkProfile, log: Logger, fetchImpl: typeof fetch = fetch): Gateway {
  return {
    async place(wallet, built, signal) {
      if (!wallet.privateKey) throw new Error(`钱包 ${wallet.id} 没有可用于签名的私钥`);
      const signature = await signBuilt(wallet.privateKey, built);
      log.info(formatPlan(built, true));
      const body = placeBody(built, signature);
      const result = await postExecute(network.gatewayUrl, body, signal, fetchImpl);
      const digest = readDigest(result) ?? built.digest;
      log.info(`已广播 place_order digest=${digest}`);
      return { digest, broadcast: true };
    },
    async cancel(wallet, built, signal) {
      if (!wallet.privateKey) throw new Error(`钱包 ${wallet.id} 没有可用于签名的私钥`);
      const signature = await signBuilt(wallet.privateKey, built);
      log.info(formatCancel(built, true));
      const body = cancelBody(built, signature);
      const result = await postExecute(network.gatewayUrl, body, signal, fetchImpl);
      const cancelled = readCancelled(result, built.message.digests);
      log.info(`已广播 cancel_orders 撤销 ${cancelled.length} 笔`);
      return { cancelled, broadcast: true };
    },
    async mark(productId, signal) {
      const response = await fetchImpl(`${network.gatewayUrl}/query`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ type: "market_price", product_id: productId }),
        signal,
      });
      const payload = (await response.json()) as {
        status?: string;
        data?: { bid_x18?: string; ask_x18?: string };
      };
      if (!response.ok || payload.status !== "success" || !payload.data?.bid_x18 || !payload.data.ask_x18) {
        throw new Error(`行情查询失败 HTTP ${response.status}`);
      }
      const bid = BigInt(payload.data.bid_x18);
      const ask = BigInt(payload.data.ask_x18);
      return formatDecimal((bid + ask) / 2n);
    },
  };
}

export function formatPlan(built: BuiltPlace, broadcast: boolean): string {
  const amount = BigInt(built.message.amount);
  const side = amount >= 0n ? "buy" : "sell";
  return [
    `${broadcast ? "实盘" : "计划"} place_order ${side} productId=${built.productId}`,
    `priceX18=${built.message.priceX18} amount=${built.message.amount} appendix=${built.message.appendix}`,
    `EIP-712 ${built.primaryType} chainId=${String(built.domain.chainId)} verifyingContract=${String(built.domain.verifyingContract)}`,
    `sender=${built.message.sender}`,
    `expiration=${built.message.expiration} nonce=${built.message.nonce}`,
    `digest=${built.digest}`,
    `domain=${JSON.stringify(built.domain)}`,
  ].join(" ");
}

export function formatCancel(built: BuiltCancel, broadcast: boolean): string {
  return [
    `${broadcast ? "实盘" : "计划"} cancel_orders productIds=${built.message.productIds.join(",")}`,
    `digests=${built.message.digests.join(",")}`,
    `EIP-712 ${built.primaryType} chainId=${String(built.domain.chainId)} verifyingContract=${String(built.domain.verifyingContract)}`,
    `sender=${built.message.sender} nonce=${built.message.nonce}`,
  ].join(" ");
}

async function postExecute(gatewayUrl: string, body: unknown, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${gatewayUrl}/execute`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let payload: { status?: string; error?: string; error_code?: number; data?: unknown };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error(`网关返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 180)}`);
  }
  if (!response.ok || payload.status === "failure") {
    throw new Error(`网关拒绝（HTTP ${response.status}，code ${payload.error_code ?? "-"}）：${payload.error ?? text.slice(0, 180)}`);
  }
  return payload;
}

function readDigest(payload: unknown): Hex | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: { digest?: string } }).data;
  return data?.digest && data.digest.startsWith("0x") ? (data.digest as Hex) : null;
}

function readCancelled(payload: unknown, fallback: readonly string[]): string[] {
  if (!payload || typeof payload !== "object") return [...fallback];
  const rows = (payload as { data?: { cancelled_orders?: { digest?: string }[] } }).data?.cancelled_orders;
  if (!rows) return [...fallback];
  return rows.map((row) => row.digest).filter((digest): digest is string => Boolean(digest));
}

function jsonHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "accept-encoding": "gzip, deflate, br",
    "user-agent": "nado-auto-desk/0.1",
  };
}
