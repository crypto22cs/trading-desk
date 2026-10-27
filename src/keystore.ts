import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface SealedKeyFile {
  v: 1;
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  address: `0x${string}`;
}

const N = 16384;
const R = 8;
const P = 1;

export function assertPrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("私钥必须是 0x 加 64 位十六进制，且不能写在命令行参数里");
  }
  return trimmed as `0x${string}`;
}

export function sealPrivateKey(privateKey: string, passphrase: string): SealedKeyFile {
  if (passphrase.length < 8) throw new Error("加密口令至少 8 个字符，通过环境变量 NADO_KEY_PASSPHRASE 提供");
  const key = assertPrivateKey(privateKey);
  const address = getAddress(privateKeyToAccount(key).address);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const derived = scryptSync(passphrase, salt, 32, { N, r: R, p: P });
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    kdf: "scrypt",
    n: N,
    r: R,
    p: P,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    address,
  };
}

export function openPrivateKey(file: SealedKeyFile, passphrase: string): `0x${string}` {
  if (file.v !== 1 || file.kdf !== "scrypt") throw new Error("无法识别的密钥文件");
  if (!passphrase) throw new Error("缺少 NADO_KEY_PASSPHRASE");
  const derived = scryptSync(passphrase, Buffer.from(file.salt, "hex"), 32, { N: file.n, r: file.r, p: file.p });
  const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(file.iv, "hex"));
  decipher.setAuthTag(Buffer.from(file.tag, "hex"));
  let text: string;
  try {
    text = Buffer.concat([decipher.update(Buffer.from(file.ciphertext, "hex")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("密钥文件无法解密，请检查 NADO_KEY_PASSPHRASE");
  }
  const key = assertPrivateKey(text);
  const address = getAddress(privateKeyToAccount(key).address);
  if (getAddress(file.address) !== address) throw new Error("密钥文件里的地址与私钥不一致");
  return key;
}
