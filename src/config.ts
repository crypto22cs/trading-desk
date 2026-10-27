import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { decimalFromNumber } from "./decimal.js";
import { defaultCaps, defaultMarkets } from "./networks.js";
import { repoRoot } from "./paths.js";
import { assertSchedule } from "./schedule.js";
import { assertStrategyName } from "./strategies/scheduled-place-cancel.js";
import type { Caps, DeskConfig, MarketSpec, Mode, PriceSpec, Range, ScheduleSpec, StrategyParams, WalletSpec } from "./types.js";

export interface LoadOptions {
  cwd?: string;
  root?: string;
  configPath?: string;
  strategyName?: string;
  mode?: string;
  haltFile?: string;
  stateFile?: string;
}

export function loadDeskConfig(options: LoadOptions = {}): DeskConfig {
  const cwd = options.cwd ?? process.cwd();
  const root = options.root ?? repoRoot();
  const configPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : path.join(root, "config", "paper.yaml");
  const file = readYaml(configPath);
  const mode = parseMode(options.mode ?? file.mode ?? "paper");
  const strategyName = assertStrategyName(String(options.strategyName ?? file.strategyName ?? "resting-maker"));
  const strategyPath = path.join(root, "strategies", `${strategyName}.yaml`);
  const strategyFile = readYaml(strategyPath);
  const strategy = parseStrategy(mergeRecords(strategyFile, asRecord(file.strategy ?? {}, "strategy")));
  assertSchedule(strategy.schedule);
  if (strategy.ttlSec < 30) throw new Error("ttlSec 至少 30 秒，给撤单留出时间");

  const caps = parseCaps(file.caps, defaultCaps(mode));
  const config: DeskConfig = {
    mode,
    subaccountName: file.subaccountName === undefined ? "default" : asString(file.subaccountName, "subaccountName"),
    wallets: parseWallets(file.wallets),
    markets: parseMarkets(file.markets),
    caps,
    haltFile: path.resolve(cwd, options.haltFile ?? asString(file.haltFile ?? ".nado/HALT", "haltFile")),
    stateFile: path.resolve(cwd, options.stateFile ?? asString(file.stateFile ?? ".nado/status.json", "stateFile")),
    strategyName,
    strategy,
    gatewayUrl: file.gatewayUrl === undefined ? undefined : asString(file.gatewayUrl, "gatewayUrl"),
  };
  const market = config.markets[strategy.market];
  if (!market) throw new Error(`策略市场 ${strategy.market} 不在 markets 里`);
  if (!market.enabled) throw new Error(`策略市场 ${strategy.market} 未启用`);
  return config;
}

export function readYaml(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`读不到配置 ${file}`);
  }
  const parsed = file.endsWith(".json") ? JSON.parse(text) : parse(text);
  return asRecord(parsed, file);
}

function parseStrategy(raw: Record<string, unknown>): StrategyParams {
  const dwellSource = raw.dwellMs ?? raw.restMs;
  if (dwellSource === undefined) throw new Error("策略需要 dwellMs（挂单后等待的毫秒数）");
  const price = parsePrice(raw.price);
  return {
    market: asString(raw.market, "market"),
    side: parseSide(raw.side),
    size: parseRange(raw.size, "size"),
    price,
    dwellMs: typeof dwellSource === "number" ? asNonNegative(dwellSource, "dwellMs") : parseRange(dwellSource, "dwellMs"),
    ttlSec: asInt(raw.ttlSec, "ttlSec"),
    schedule: parseSchedule(raw.schedule),
  };
}

function parseSchedule(value: unknown): ScheduleSpec {
  const raw = asRecord(value, "schedule");
  const mode = asString(raw.mode, "schedule.mode");
  if (mode !== "once" && mode !== "every" && mode !== "cron") throw new Error("schedule.mode 只能是 once、every 或 cron");
  const schedule: ScheduleSpec = { mode };
  if (raw.everyMs !== undefined) schedule.everyMs = asNonNegative(asNumber(raw.everyMs, "everyMs"), "everyMs");
  if (raw.jitterMs !== undefined) schedule.jitterMs = parseRange(raw.jitterMs, "jitterMs");
  if (raw.cron !== undefined) schedule.cron = asString(raw.cron, "cron");
  if (raw.maxOccurrences !== undefined) schedule.maxOccurrences = asInt(raw.maxOccurrences, "maxOccurrences");
  return schedule;
}

function parsePrice(value: unknown): PriceSpec {
  const raw = asRecord(value, "price");
  const mode = asString(raw.mode, "price.mode");
  const fetchMark = raw.fetchMark === undefined ? false : asBool(raw.fetchMark, "fetchMark");
  const reference = raw.reference === undefined ? undefined : asDecimal(raw.reference, "price.reference");
  if (mode === "absolute") {
    const spec: PriceSpec = { mode, absolute: parseRange(raw.absolute, "price.absolute"), fetchMark };
    if (reference !== undefined) spec.reference = reference;
    return spec;
  }
  if (mode === "offset-bps") {
    if (!reference) throw new Error("offset-bps 需要 price.reference");
    return { mode, reference, offsetBps: parseRange(raw.offsetBps, "price.offsetBps"), fetchMark };
  }
  throw new Error("price.mode 只能是 absolute 或 offset-bps");
}

function parseSide(value: unknown): StrategyParams["side"] {
  const side = asString(value ?? "buy", "side");
  if (side !== "buy" && side !== "sell" && side !== "random") throw new Error("side 只能是 buy、sell 或 random");
  return side;
}

function parseWallets(value: unknown): WalletSpec[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("wallets 至少要有一项");
  return value.map((item, index) => {
    const raw = asRecord(item, `wallets[${index}]`);
    const spec: WalletSpec = { id: asString(raw.id, `wallets[${index}].id`) };
    if (raw.address !== undefined) spec.address = asString(raw.address, "address");
    if (raw.keyEnv !== undefined) spec.keyEnv = asString(raw.keyEnv, "keyEnv");
    if (raw.mnemonicEnv !== undefined) spec.mnemonicEnv = asString(raw.mnemonicEnv, "mnemonicEnv");
    if (raw.path !== undefined) spec.path = asString(raw.path, "path");
    if (raw.keyFile !== undefined) spec.keyFile = asString(raw.keyFile, "keyFile");
    return spec;
  });
}

function parseMarkets(value: unknown): Record<string, MarketSpec> {
  const markets = defaultMarkets();
  if (value === undefined) return markets;
  const raw = asRecord(value, "markets");
  for (const [symbol, item] of Object.entries(raw)) {
    const row = asRecord(item, `markets.${symbol}`);
    const prev = markets[symbol];
    const kind = row.kind === undefined ? prev?.kind : asString(row.kind, "kind");
    if (kind !== "perp" && kind !== "spot") throw new Error(`${symbol} 的 kind 只能是 perp 或 spot`);
    markets[symbol] = {
      symbol,
      productId: row.productId === undefined ? (prev?.productId ?? bad(`${symbol} 缺少 productId`)) : asInt(row.productId, "productId"),
      kind,
      priceTick: asDecimal(row.priceTick ?? prev?.priceTick, `${symbol}.priceTick`),
      sizeStep: asDecimal(row.sizeStep ?? prev?.sizeStep, `${symbol}.sizeStep`),
      minNotional: asDecimal(row.minNotional ?? prev?.minNotional, `${symbol}.minNotional`),
      enabled: row.enabled === undefined ? (prev?.enabled ?? false) : asBool(row.enabled, "enabled"),
    };
  }
  return markets;
}

function parseCaps(value: unknown, defaults: Caps): Caps {
  if (value === undefined) return defaults;
  const raw = asRecord(value, "caps");
  return {
    maxNotionalPerOrder: asDecimal(raw.maxNotionalPerOrder ?? defaults.maxNotionalPerOrder, "maxNotionalPerOrder"),
    maxNotionalPerHour: asDecimal(raw.maxNotionalPerHour ?? defaults.maxNotionalPerHour, "maxNotionalPerHour"),
    windowMs: raw.windowMs === undefined ? defaults.windowMs : asInt(raw.windowMs, "windowMs"),
    maxWalletsConcurrent:
      raw.maxWalletsConcurrent === undefined ? defaults.maxWalletsConcurrent : asInt(raw.maxWalletsConcurrent, "maxWalletsConcurrent"),
  };
}

function parseRange(value: unknown, label: string): Range {
  const raw = asRecord(value, label);
  const range: Range = { min: asNumber(raw.min, `${label}.min`), max: asNumber(raw.max, `${label}.max`) };
  if (raw.step !== undefined) range.step = asNumber(raw.step, `${label}.step`);
  if (range.max < range.min) throw new Error(`${label} 的 max 小于 min`);
  if (range.step !== undefined && range.step <= 0) throw new Error(`${label} 的 step 必须为正`);
  return range;
}

function parseMode(value: unknown): Mode {
  const mode = asString(value, "mode");
  if (mode !== "paper" && mode !== "testnet" && mode !== "mainnet") {
    throw new Error("mode 只能是 paper、testnet 或 mainnet");
  }
  return mode;
}

function mergeRecords(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...overlay };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是映射`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

function asBool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value === "string" && value.trim() !== "") {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) throw new Error(`${label} 不是数字`);
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 不是数字`);
  return value;
}

function asInt(value: unknown, label: string): number {
  const number = asNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} 必须是整数`);
  return number;
}

function asNonNegative(value: number, label: string): number {
  if (value < 0) throw new Error(`${label} 不能为负`);
  return value;
}

function asDecimal(value: unknown, label: string): string {
  if (typeof value === "number") return decimalFromNumber(value);
  return asString(value, label);
}

function bad(message: string): never {
  throw new Error(message);
}
