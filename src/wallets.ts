import { readFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { openPrivateKey, type SealedKeyFile } from "./keystore.js";
import type { ResolvedWallet, WalletSpec } from "./types.js";

export interface WalletLoadOptions {
  /** 为 true 时才读取私钥。paper 必须保持 false。 */
  loadKeys: boolean;
  env: NodeJS.ProcessEnv;
  /** 解密 keyFile。缺省读 env.NADO_KEY_PASSPHRASE。 */
  passphrase?: string;
}

/**
 * 解析钱包。私钥只在 loadKeys 时从环境变量或加密文件进入内存，配置里只保存变量名或文件路径。
 */
export function resolveWallets(specs: readonly WalletSpec[], opts: WalletLoadOptions): ResolvedWallet[] {
  if (specs.length === 0) throw new Error("至少配置一个钱包");
  const ids = new Set<string>();
  return specs.map((spec) => {
    if (!spec.id || spec.id.includes(" ")) throw new Error("钱包 id 不能为空，也不能含空格");
    if (ids.has(spec.id)) throw new Error(`钱包 id 重复：${spec.id}`);
    ids.add(spec.id);
    if (!opts.loadKeys) {
      if (!spec.address) throw new Error(`钱包 ${spec.id} 在不广播时需要 address。paper 不会读取私钥。`);
      return { id: spec.id, address: checksum(spec.address) };
    }
    const privateKey = loadKey(spec, opts);
    const address = getAddress(privateKeyToAccount(privateKey).address);
    if (spec.address && checksum(spec.address) !== address) {
      throw new Error(`钱包 ${spec.id} 的 address 与私钥推导出的地址不一致`);
    }
    return { id: spec.id, address, privateKey };
  });
}

export function keyMaterial(wallets: readonly ResolvedWallet[]): string[] {
  return wallets.flatMap((wallet) => (wallet.privateKey ? [wallet.privateKey] : []));
}

function loadKey(spec: WalletSpec, opts: WalletLoadOptions): Hex {
  const sources = [spec.keyEnv, spec.mnemonicEnv, spec.keyFile].filter(Boolean);
  if (sources.length !== 1) {
    throw new Error(`钱包 ${spec.id} 实盘时必须且只能设置 keyEnv、mnemonicEnv 或 keyFile 其中一项`);
  }
  if (spec.keyEnv) {
    const value = opts.env[spec.keyEnv];
    if (!value) throw new Error(`环境变量 ${spec.keyEnv} 未设置（钱包 ${spec.id}）`);
    return assertKey(value);
  }
  if (spec.mnemonicEnv) {
    const mnemonic = opts.env[spec.mnemonicEnv];
    if (!mnemonic) throw new Error(`环境变量 ${spec.mnemonicEnv} 未设置（钱包 ${spec.id}）`);
    const derivation = spec.path ?? "m/44'/60'/0'/0/0";
    if (!derivation.startsWith("m/")) throw new Error(`钱包 ${spec.id} 的 HD 路径必须以 m/ 开头`);
    return hexKey(mnemonicToAccount(mnemonic.trim(), { path: derivation as `m/44'/60'/${string}` }));
  }
  const file = spec.keyFile;
  if (!file) throw new Error(`钱包 ${spec.id} 缺少密钥来源`);
  const passphrase = opts.passphrase ?? opts.env.NADO_KEY_PASSPHRASE ?? "";
  const parsed = JSON.parse(readFileSync(file, "utf8")) as SealedKeyFile;
  return openPrivateKey(parsed, passphrase);
}

function hexKey(account: ReturnType<typeof mnemonicToAccount>): Hex {
  const key = account.getHdKey().privateKey;
  if (!key) throw new Error("助记词没有导出私钥");
  const hex = Buffer.from(key).toString("hex");
  return assertKey(`0x${hex}`);
}

function assertKey(value: string): Hex {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) throw new Error("私钥格式无效");
  return trimmed as Hex;
}

function checksum(address: string): Hex {
  return getAddress(address);
}
