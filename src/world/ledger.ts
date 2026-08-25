import { RESOURCE_KINDS, TISSUE_CLASSES, type ResourceKind, type TissueClass } from "./resources";

/**
 * Every balance-affecting change, and why.
 *
 * The rule: nothing moves a resource without writing a line here. That is what
 * makes an economy inspectable rather than a set of numbers that drift, and it
 * is what lets a test assert that the balance equals the sum of its history.
 *
 * It is also the anti-exploit mechanism. Anything paid against a reference, a
 * mission id, a contract id, a delivery, is refused a second time, so a save
 * reload, an abort and retry, or a disconnected co-op client rejoining cannot
 * pay the same reward twice.
 *
 * Pure data. No clock, no RNG, no scene, no DOM. Days arrive as numbers.
 */

export const LEDGER_SCHEMA_VERSION = 1;

/** Where a line came from. A table, so a new source is a row rather than a case. */
export const LEDGER_SOURCES = [
  "government-contract",
  "defence-reward",
  "salvage-rights",
  "exploration-find",
  "manufacturer-deal",
  "facility-income",
  "research-conversion",
  "machine-purchase",
  "construction",
  "repair",
  "upkeep",
  "module",
  "refund",
  "adjustment",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export interface LedgerEntry {
  /** In-game day it happened. */
  readonly day: number;
  readonly source: LedgerSource;
  readonly resource: ResourceKind;
  /** Tissue only. Which class moved. */
  readonly tissueClass?: TissueClass;
  /** Positive for income, negative for spending. Never zero. */
  readonly amount: number;
  /** Balance after this line, so a ledger reads without recomputing. */
  readonly balanceAfter: number;
  /** One sentence a person can read. */
  readonly reason: string;
  /**
   * What this was paid against, when it is something that must pay once.
   *
   * A mission, a contract, a delivery. Null for anything that legitimately
   * recurs, like daily upkeep.
   */
  readonly reference: string | null;
}

/** Income and spending over a window, broken down by where it came from. */
export interface LedgerSummary {
  readonly days: number;
  readonly income: number;
  readonly expense: number;
  readonly net: number;
  /** Per source, most significant first. */
  readonly bySource: readonly { readonly source: LedgerSource; readonly amount: number }[];
}

export interface LedgerSnapshot {
  readonly schemaVersion: number;
  readonly entries: readonly LedgerEntry[];
  readonly settled: readonly string[];
}

/** How many lines are kept. Long enough to read a campaign, bounded for a save. */
export const MAX_LEDGER_ENTRIES = 400;

export class Ledger {
  private readonly entries: LedgerEntry[] = [];
  /** References already paid, so nothing pays twice. */
  private readonly settled = new Set<string>();

  all(): readonly LedgerEntry[] {
    return [...this.entries];
  }

  /** Whether this reference has already been paid. */
  hasSettled(reference: string): boolean {
    return this.settled.has(reference);
  }

  /**
   * Claims a reference before paying against it.
   *
   * Returns false when it has already been used, which is the whole guard: a
   * caller that checks this before crediting cannot pay a mission twice however
   * many times the result is handed back to it.
   */
  claim(reference: string): boolean {
    if (this.settled.has(reference)) return false;
    this.settled.add(reference);
    // Bounded like the entries, so a long campaign cannot grow the save without
    // limit. Far more references than any run holds open at once.
    if (this.settled.size > MAX_LEDGER_ENTRIES * 2) {
      const oldest = this.settled.values().next().value;
      if (oldest !== undefined) this.settled.delete(oldest);
    }
    return true;
  }

  /** Writes a line. Zero-amount lines are dropped: nothing happened. */
  record(entry: Omit<LedgerEntry, "balanceAfter">, balanceAfter: number): LedgerEntry | null {
    if (!Number.isFinite(entry.amount) || entry.amount === 0) return null;
    const line: LedgerEntry = { ...entry, balanceAfter };
    this.entries.push(line);
    while (this.entries.length > MAX_LEDGER_ENTRIES) this.entries.shift();
    return line;
  }

  /** The most recent lines, newest first, for a panel. */
  recent(count = 12): readonly LedgerEntry[] {
    return [...this.entries].reverse().slice(0, count);
  }

  /** Everything that touched one resource. */
  forResource(resource: ResourceKind): readonly LedgerEntry[] {
    return this.entries.filter((entry) => entry.resource === resource);
  }

  /**
   * What happened over the last so many days, broken down.
   *
   * This is the answer to "where is the money going", which is the question an
   * economy has to be able to answer if its decisions are going to be real.
   */
  summarise(resource: ResourceKind, sinceDay: number, untilDay: number): LedgerSummary {
    const window = this.entries.filter(
      (entry) => entry.resource === resource && entry.day >= sinceDay && entry.day <= untilDay,
    );
    let income = 0;
    let expense = 0;
    const bySource = new Map<LedgerSource, number>();
    for (const entry of window) {
      if (entry.amount > 0) income += entry.amount;
      else expense += entry.amount;
      bySource.set(entry.source, (bySource.get(entry.source) ?? 0) + entry.amount);
    }
    return {
      days: Math.max(1, untilDay - sinceDay + 1),
      income,
      expense,
      net: income + expense,
      bySource: [...bySource.entries()]
        .map(([source, amount]) => ({ source, amount }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    };
  }

  /**
   * What the next stretch looks like if nothing changes.
   *
   * Straight-line from what actually happened rather than a promise: a forecast
   * that invents optimism is worse than none.
   */
  forecast(resource: ResourceKind, sinceDay: number, untilDay: number, aheadDays: number): number {
    const summary = this.summarise(resource, sinceDay, untilDay);
    return (summary.net / summary.days) * Math.max(0, aheadDays);
  }

  snapshot(): LedgerSnapshot {
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      entries: this.entries.map((entry) => ({ ...entry })),
      settled: [...this.settled],
    };
  }

  restore(snapshot: LedgerSnapshot): void {
    this.entries.length = 0;
    this.settled.clear();
    for (const entry of snapshot.entries ?? []) {
      if (!RESOURCE_KINDS.includes(entry.resource)) continue;
      if (!LEDGER_SOURCES.includes(entry.source)) continue;
      if (!Number.isFinite(entry.amount) || entry.amount === 0) continue;
      this.entries.push({ ...entry });
    }
    // The settled list is the part that must survive: it is what stops a
    // reloaded save paying a mission it already paid.
    for (const reference of snapshot.settled ?? []) this.settled.add(reference);
  }
}

export function emptyLedgerSnapshot(): LedgerSnapshot {
  return { schemaVersion: LEDGER_SCHEMA_VERSION, entries: [], settled: [] };
}

export function validateLedgerSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["ledger snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  if (record["schemaVersion"] !== LEDGER_SCHEMA_VERSION) {
    return [`ledger snapshot version ${String(record["schemaVersion"])} is not ${LEDGER_SCHEMA_VERSION}`];
  }
  if (!Array.isArray(record["entries"])) return ["ledger.entries must be an array"];
  if (!Array.isArray(record["settled"])) return ["ledger.settled must be an array"];

  const errors: string[] = [];
  for (const entry of record["entries"] as unknown[]) {
    const line = entry as Record<string, unknown>;
    if (!RESOURCE_KINDS.includes(line["resource"] as ResourceKind)) {
      errors.push(`unknown resource "${String(line["resource"])}" in the ledger`);
    }
    if (!LEDGER_SOURCES.includes(line["source"] as LedgerSource)) {
      errors.push(`unknown ledger source "${String(line["source"])}"`);
    }
    if (typeof line["amount"] !== "number" || !Number.isFinite(line["amount"])) {
      errors.push("every ledger line needs a finite amount");
    }
    const tissueClass = line["tissueClass"];
    if (tissueClass !== undefined && !TISSUE_CLASSES.includes(tissueClass as TissueClass)) {
      errors.push(`unknown tissue class "${String(tissueClass)}"`);
    }
  }
  return errors;
}
