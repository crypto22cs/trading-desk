export type Mode = "paper" | "testnet" | "mainnet";
export type Side = "buy" | "sell";

export interface Range {
  min: number;
  max: number;
  step?: number;
}

export interface MarketSpec {
  symbol: string;
  productId: number;
  kind: "perp" | "spot";
  /** 人类可读价格的最小跳动，例如 BTC-PERP 为 "1"。 */
  priceTick: string;
  /** 数量步长，人类可读，例如 "0.00005"。 */
  sizeStep: string;
  /** 最小名义价值，计价资产 USDT0。 */
  minNotional: string;
  enabled: boolean;
}

export interface WalletSpec {
  id: string;
  /** paper 或不广播时使用的地址。实盘以私钥推导出的地址为准。 */
  address?: string;
  /** 环境变量名，值是 0x 私钥。不要把私钥本身写进配置。 */
  keyEnv?: string;
  mnemonicEnv?: string;
  /** BIP-44 路径，例如 m/44'/60'/0'/0/0 */
  path?: string;
  /** 由 seal 生成的加密私钥文件，相对路径相对于进程工作目录。 */
  keyFile?: string;
}

export interface Caps {
  /** 单笔名义上限，USDT0 十进制字符串。 */
  maxNotionalPerOrder: string;
  /** 滑动窗口内名义上限。 */
  maxNotionalPerHour: string;
  windowMs: number;
  /** 同时执行的钱包数。 */
  maxWalletsConcurrent: number;
}

export interface AbsolutePrice {
  mode: "absolute";
  /** 可选参考价，用来做预言机 80%–120% 带宽检查。 */
  reference?: string;
  absolute: Range;
  fetchMark?: boolean;
}

export interface OffsetPrice {
  mode: "offset-bps";
  /** 纸面或行情失败时的参考价。 */
  reference: string;
  /** 偏离参考价的基点。买单向下，卖单向上，使委托停留在盘口外侧。 */
  offsetBps: Range;
  fetchMark?: boolean;
}

export type PriceSpec = AbsolutePrice | OffsetPrice;

export interface ScheduleSpec {
  mode: "once" | "every" | "cron";
  everyMs?: number;
  /** 两次触发之间额外等待的毫秒范围。 */
  jitterMs?: Range;
  /** 五段 UTC cron。到点才触发，不会在启动时立刻打一枪。 */
  cron?: string;
  /** 最多触发多少轮。缺省表示一直跑到急停。once 固定为一轮。 */
  maxOccurrences?: number;
}

export interface StrategyParams {
  market: string;
  side: Side | "random";
  size: Range;
  price: PriceSpec;
  /** 挂出后等待多久再撤，毫秒。数字或范围。 */
  dwellMs: number | Range;
  ttlSec: number;
  schedule: ScheduleSpec;
}

export interface DeskConfig {
  mode: Mode;
  subaccountName: string;
  wallets: WalletSpec[];
  markets: Record<string, MarketSpec>;
  caps: Caps;
  haltFile: string;
  stateFile: string;
  strategyName: string;
  strategy: StrategyParams;
  /** 覆盖默认 gateway。测试可指向本地桩。 */
  gatewayUrl?: string;
}

export interface CyclePlan {
  walletId: string;
  market: MarketSpec;
  side: Side;
  price: string;
  size: string;
  notional: string;
  dwellMs: number;
  ttlSec: number;
  referenceUsed?: string;
}

export interface ResolvedWallet {
  id: string;
  address: `0x${string}`;
  /** 只有确实要广播时才存在。 */
  privateKey?: `0x${string}`;
}
