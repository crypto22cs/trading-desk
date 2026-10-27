import { CHAIN_ENV_TO_CHAIN, NADO_DEPLOYMENTS, type ChainEnv } from "@nadohq/client";
import type { Caps, MarketSpec, Mode } from "./types.js";

export interface NetworkProfile {
  mode: Mode;
  chainEnv: ChainEnv;
  chainId: number;
  /** 订单走网关，不是链上交易。取消委托的 EIP-712 域用 endpoint。 */
  endpoint: `0x${string}`;
  gatewayUrl: string;
  rpcUrl: string;
  label: string;
}

const TESTNET_ENDPOINT = NADO_DEPLOYMENTS.inkTestnet.endpoint;
const MAINNET_ENDPOINT = NADO_DEPLOYMENTS.inkMainnet.endpoint;

/**
 * paper 也按 Ink 测试网的 chainId 构造 EIP-712，这样演练计划和测试网实盘是同一套域。
 * paper 不签名、不广播。
 */
export function networkFor(mode: Mode, gatewayOverride?: string): NetworkProfile {
  if (mode === "mainnet") {
    return {
      mode,
      chainEnv: "inkMainnet",
      chainId: CHAIN_ENV_TO_CHAIN.inkMainnet.id,
      endpoint: MAINNET_ENDPOINT,
      gatewayUrl: gatewayOverride ?? "https://gateway.prod.nado.xyz/v1",
      rpcUrl: "https://rpc-gel.inkonchain.com",
      label: "Ink 主网",
    };
  }
  return {
    mode,
    chainEnv: "inkTestnet",
    chainId: CHAIN_ENV_TO_CHAIN.inkTestnet.id,
    endpoint: TESTNET_ENDPOINT,
    gatewayUrl: gatewayOverride ?? "https://gateway.test.nado.xyz/v1",
    rpcUrl: "https://rpc-gel-sepolia.inkonchain.com",
    label: mode === "paper" ? "纸面演练（EIP-712 使用 Ink 测试网 chainId，不广播）" : "Ink 测试网",
  };
}

export function defaultCaps(mode: Mode): Caps {
  if (mode === "mainnet") {
    return {
      maxNotionalPerOrder: "150",
      maxNotionalPerHour: "1000",
      windowMs: 3_600_000,
      maxWalletsConcurrent: 1,
    };
  }
  if (mode === "testnet") {
    return {
      maxNotionalPerOrder: "1000000",
      maxNotionalPerHour: "5000000",
      windowMs: 3_600_000,
      maxWalletsConcurrent: 8,
    };
  }
  return {
    maxNotionalPerOrder: "1000",
    maxNotionalPerHour: "5000",
    windowMs: 3_600_000,
    maxWalletsConcurrent: 4,
  };
}

/** 2026-10-27 从公开 symbols 核对过的市场。INK-USDT0 当时不在列表里。 */
export function defaultMarkets(): Record<string, MarketSpec> {
  return {
    "BTC-PERP": {
      symbol: "BTC-PERP",
      productId: 2,
      kind: "perp",
      priceTick: "1",
      sizeStep: "0.00005",
      minNotional: "100",
      enabled: true,
    },
    "ETH-PERP": {
      symbol: "ETH-PERP",
      productId: 4,
      kind: "perp",
      priceTick: "0.01",
      sizeStep: "0.001",
      minNotional: "100",
      enabled: true,
    },
    "INK-USDT0": {
      symbol: "INK-USDT0",
      productId: 0,
      kind: "spot",
      priceTick: "0.0001",
      sizeStep: "1",
      minNotional: "100",
      enabled: false,
    },
  };
}

export function assertCanStart(mode: Mode, env: NodeJS.ProcessEnv): void {
  if (mode !== "mainnet") return;
  if (env.NADO_LIVE !== "1" || env.NADO_CONFIRM_MAINNET !== "YES") {
    throw new Error(
      "拒绝启动主网。需要同时设置 NADO_LIVE=1 和 NADO_CONFIRM_MAINNET=YES。请先在测试网完成 resting-maker。",
    );
  }
}

export function willBroadcast(mode: Mode, env: NodeJS.ProcessEnv): boolean {
  if (mode === "paper") return false;
  return env.NADO_LIVE === "1";
}
