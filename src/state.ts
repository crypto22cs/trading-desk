import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Mode } from "./types.js";

export interface OpenDigest {
  walletId: string;
  market: string;
  side: string;
  price: string;
  size: string;
  digest: string;
}

export interface DeskStatus {
  version: 1;
  mode: Mode;
  strategy: string;
  chainId: number;
  broadcast: boolean;
  pid: number;
  startedAt: string;
  updatedAt: string;
  halted: boolean;
  haltReason?: string;
  cycles: number;
  placed: number;
  cancelled: number;
  rejected: number;
  failed: number;
  skipped: number;
  hourNotional: string;
  openDigests: OpenDigest[];
  lastAction?: string;
  lastError?: string;
}

export function writeStatus(file: string, status: DeskStatus): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function readStatus(file: string): DeskStatus | null {
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as DeskStatus;
  if (parsed.version !== 1) throw new Error(`无法识别的状态文件版本：${String(parsed.version)}`);
  return parsed;
}
