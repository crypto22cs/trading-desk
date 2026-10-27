import type { ScheduleSpec } from "./types.js";

interface CronField {
  values: Set<number>;
  /** 字面量星号。星号加步长不算全通配，日和星期的「或」规则要用这个区分。 */
  star: boolean;
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron 需要 5 段，收到 ${fields.length} 段：「${expr}」`);
  const dow = parseField(fields[4]!, 0, 7);
  if (dow.values.has(7)) {
    dow.values.add(0);
    dow.values.delete(7);
  }
  return {
    minute: parseField(fields[0]!, 0, 59),
    hour: parseField(fields[1]!, 0, 23),
    dom: parseField(fields[2]!, 1, 31),
    month: parseField(fields[3]!, 1, 12),
    dow,
  };
}

/**
 * 严格晚于 after 的下一次 UTC 触发点（毫秒）。
 * 日和星期都不是星号时，满足任意一个即匹配。
 */
export function nextCronTime(expr: string, after: number): number {
  const cron = parseCron(expr);
  const both = !cron.dom.star && !cron.dow.star;
  let cursor = Math.floor(after / 60_000) * 60_000 + 60_000;
  const limit = 366 * 24 * 60 * 9;
  for (let i = 0; i < limit; i++) {
    const date = new Date(cursor);
    const dom = date.getUTCDate();
    const dow = date.getUTCDay();
    const dayOk = both
      ? cron.dom.values.has(dom) || cron.dow.values.has(dow)
      : cron.dom.values.has(dom) && cron.dow.values.has(dow);
    if (
      cron.minute.values.has(date.getUTCMinutes()) &&
      cron.hour.values.has(date.getUTCHours()) &&
      cron.month.values.has(date.getUTCMonth() + 1) &&
      dayOk
    ) {
      return cursor;
    }
    cursor += 60_000;
  }
  throw new Error(`cron「${expr}」在约 9 年内没有匹配时间`);
}

export function assertSchedule(schedule: ScheduleSpec): void {
  if (schedule.mode === "once") return;
  if (schedule.mode === "every") {
    if (!schedule.everyMs || schedule.everyMs < 0) throw new Error("every 调度需要非负的 everyMs");
    return;
  }
  if (schedule.mode === "cron") {
    if (!schedule.cron) throw new Error("cron 调度需要表达式");
    parseCron(schedule.cron);
    return;
  }
  throw new Error(`未知调度模式`);
}

function parseField(spec: string, min: number, max: number): CronField {
  const star = spec === "*";
  const values = new Set<number>();
  for (const part of spec.split(",")) {
    if (part === "") throw new Error(`cron 字段有空段：「${spec}」`);
    const slash = part.indexOf("/");
    const rangePart = slash >= 0 ? part.slice(0, slash) : part;
    const stepText = slash >= 0 ? part.slice(slash + 1) : "";
    if (slash >= 0 && !/^\d+$/.test(stepText)) throw new Error(`cron 步长无效：「${part}」`);
    const step = stepText === "" ? 1 : Number(stepText);
    if (step < 1) throw new Error(`cron 步长无效：「${part}」`);
    let lo = min;
    let hi = max;
    if (rangePart !== "*" && rangePart !== "") {
      const match = /^(\d+)(?:-(\d+))?$/.exec(rangePart);
      if (!match) throw new Error(`cron 字段无效：「${part}」`);
      lo = Number(match[1]);
      hi = match[2] !== undefined ? Number(match[2]) : slash >= 0 ? max : lo;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron「${part}」超出 ${min}–${max}`);
    for (let value = lo; value <= hi; value += step) values.add(value);
  }
  if (values.size === 0) throw new Error(`cron 字段为空：「${spec}」`);
  return { values, star };
}
