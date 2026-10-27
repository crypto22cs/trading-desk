/** 十进制字符串与 1e18 定点。避免用浮点保存价格和数量。 */

const BODY = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

export function parseDecimal(value: string | number, scale = 18): bigint {
  const raw = typeof value === "number" ? decimalFromNumber(value) : value.trim();
  if (raw.startsWith("+")) return parseDecimal(raw.slice(1), scale);
  const neg = raw.startsWith("-");
  const body = neg ? raw.slice(1) : raw;
  if (!BODY.test(body)) throw new Error(`无法解析数字「${value}」`);
  const parts = body.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  if (frac.length > scale) throw new Error(`「${value}」小数位超过 ${scale}`);
  const bi = BigInt(whole) * 10n ** BigInt(scale) + BigInt(frac.padEnd(scale, "0") || "0");
  return neg ? -bi : bi;
}

export function formatDecimal(value: bigint, scale = 18): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(scale);
  const frac = (abs % base).toString().padStart(scale, "0").replace(/0+$/, "");
  const text = frac.length > 0 ? `${abs / base}.${frac}` : (abs / base).toString();
  return neg ? `-${text}` : text;
}

/** 把普通数字收成十进制字符串，去掉 toString 的科学计数法。 */
export function decimalFromNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`非法数字 ${value}`);
  const neg = value < 0;
  const text = Math.abs(value).toFixed(12).replace(/\.?0+$/, "");
  return neg ? `-${text}` : text === "" ? "0" : text;
}

export function cmpDecimal(a: bigint, b: bigint): number {
  return a === b ? 0 : a > b ? 1 : -1;
}
