import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * 急停：内存标志或磁盘文件任一存在即停止新的提交。
 * `halt` 命令只写文件；正在跑的进程在每次提交前和等待切片里读取它。
 */
export class HaltController {
  private memory = false;
  private reason = "";
  private readonly controller = new AbortController();

  constructor(readonly file: string) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  isHalted(): boolean {
    if (this.memory) return true;
    if (existsSync(this.file)) {
      this.memory = true;
      this.reason = this.reason || readReason(this.file);
      this.stopSignals();
      return true;
    }
    return false;
  }

  /** 本进程触发急停，并留下文件让 status / 下次启动能看见。 */
  trip(reason: string): void {
    this.memory = true;
    this.reason = reason;
    this.stopSignals();
    writeHaltFile(this.file, reason);
  }

  private stopSignals(): void {
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  why(): string {
    if (!this.reason && existsSync(this.file)) this.reason = readReason(this.file);
    return this.reason || "halt";
  }
}

export function writeHaltFile(file: string, reason: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const body = `reason: ${reason.replace(/\r?\n/g, " ")}\nat: ${new Date().toISOString()}\n`;
  writeFileSync(file, body, { mode: 0o600 });
}

export function clearHaltFile(file: string): boolean {
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

export function readReason(file: string): string {
  try {
    const text = readFileSync(file, "utf8");
    const match = /^reason:\s*(.*)$/m.exec(text);
    return match?.[1]?.trim() || "halt file";
  } catch {
    return "halt file";
  }
}

/** 可被急停打断的等待。halted 后立刻返回，方便随后撤销已挂出的订单。 */
export async function sleepUntil(ms: number, halt: HaltController, sliceMs = 200): Promise<void> {
  if (ms <= 0) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (halt.isHalted()) return;
    const left = end - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(sliceMs, Math.max(0, left))));
  }
}
