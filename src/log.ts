export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  readonly lines: string[];
}

/** 日志里如果意外出现私钥或助记词，用固定占位替换。短口令不在此列，调用方不要把口令写进日志。 */
export function redact(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length < 16) continue;
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function createLogger(opts?: { silent?: boolean; secrets?: readonly string[] }): Logger {
  const lines: string[] = [];
  const secrets = opts?.secrets ?? [];
  const write = (level: "info" | "warn" | "error", message: string) => {
    const line = redact(message, secrets);
    lines.push(line);
    if (opts?.silent) return;
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  };
  return {
    lines,
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
