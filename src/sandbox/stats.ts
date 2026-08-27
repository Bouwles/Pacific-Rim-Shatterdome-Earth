import { browserStorage, memoryStorage, type PresentationStorage } from "../ui/presentationStore";
import { activeRules, isFairRun, type SandboxRules } from "./rules";

/**
 * What the sandbox remembers, which is nothing the campaign can see.
 *
 * A sandbox run produces a record: which scenario, how long it took, what was
 * destroyed, whether it was won. Those records live here, in their own store,
 * and there is deliberately no function anywhere that turns one into funding,
 * research data, salvage, standing, a crew's experience or a prestige rank.
 *
 * That is the point of the milestone. A player can spend an afternoon killing
 * category fives with invulnerability on and come back to a campaign that has
 * not moved an inch, because the two have no shared ledger to move it with.
 *
 * Runs also record whether the rules were on. A time set with infinite
 * ammunition is a different thing from a time set without it, and a record that
 * did not say so would be worth nothing.
 */

export const SANDBOX_STATS_KEY = "shatterdome.sandbox.stats.v1";
/** How many runs are kept. Oldest dropped first; this is a scoreboard, not an archive. */
export const MAX_RUNS = 100;

export type StatsStorage = PresentationStorage;

export function statsStorage(): StatsStorage | null {
  return browserStorage();
}

export function memoryStatsStorage(): StatsStorage {
  return memoryStorage();
}

export interface SandboxRun {
  readonly scenarioId: string;
  readonly scenarioName: string;
  /** Epoch milliseconds, passed in rather than read, so this stays clock-free. */
  readonly at: number;
  readonly outcome: "won" | "lost" | "abandoned";
  readonly seconds: number;
  readonly creaturesDown: number;
  readonly damageDealt: number;
  readonly blocksLevelled: number;
  /** Which rules were on. Empty means it was a straight fight. */
  readonly rulesUsed: readonly string[];
  /** True only when nothing that changes the fight was switched on. */
  readonly fair: boolean;
}

/** Builds a record from a finished run. The only way one is made. */
export function recordRun(options: {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly at: number;
  readonly outcome: SandboxRun["outcome"];
  readonly seconds: number;
  readonly creaturesDown: number;
  readonly damageDealt: number;
  readonly blocksLevelled: number;
  readonly rules: SandboxRules;
}): SandboxRun {
  return {
    scenarioId: options.scenarioId,
    scenarioName: options.scenarioName,
    at: options.at,
    outcome: options.outcome,
    seconds: Math.max(0, Math.round(options.seconds * 10) / 10),
    creaturesDown: Math.max(0, Math.round(options.creaturesDown)),
    damageDealt: Math.max(0, Math.round(options.damageDealt)),
    blocksLevelled: Math.max(0, Math.round(options.blocksLevelled)),
    rulesUsed: activeRules(options.rules),
    fair: isFairRun(options.rules),
  };
}

export function loadRuns(storage: StatsStorage | null): readonly SandboxRun[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(SANDBOX_STATS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRunShaped);
  } catch {
    return [];
  }
}

export function appendRun(
  storage: StatsStorage | null,
  run: SandboxRun,
): { readonly ok: boolean; readonly runs: readonly SandboxRun[] } {
  const runs = [...loadRuns(storage), run].slice(-MAX_RUNS);
  if (!storage) return { ok: false, runs };
  try {
    storage.setItem(SANDBOX_STATS_KEY, JSON.stringify(runs));
    return { ok: true, runs };
  } catch {
    return { ok: false, runs };
  }
}

export function clearRuns(storage: StatsStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(SANDBOX_STATS_KEY);
  } catch {
    // Failing to forget a scoreboard is not worth reporting.
  }
}

export interface SandboxSummary {
  readonly runs: number;
  readonly wins: number;
  readonly fairRuns: number;
  readonly creaturesDown: number;
  /** Best time on a fair run, or null when none has been set. */
  readonly bestFairSeconds: number | null;
  /** In words, for the panel. */
  readonly note: string;
}

/**
 * The scoreboard.
 *
 * Best times count only fair runs, which is why the record carries the flag: a
 * board that ranked an invulnerable run against a straight one would be a board
 * nobody would bother reading twice.
 */
export function summarise(runs: readonly SandboxRun[]): SandboxSummary {
  const wins = runs.filter((run) => run.outcome === "won");
  const fair = wins.filter((run) => run.fair);
  const best = fair.length > 0 ? Math.min(...fair.map((run) => run.seconds)) : null;
  return {
    runs: runs.length,
    wins: wins.length,
    fairRuns: runs.filter((run) => run.fair).length,
    creaturesDown: runs.reduce((sum, run) => sum + run.creaturesDown, 0),
    bestFairSeconds: best,
    note:
      runs.length === 0
        ? "No sandbox runs yet."
        : best === null
          ? `${runs.length} run${runs.length === 1 ? "" : "s"}, none of them a straight fight yet.`
          : `${runs.length} runs, best straight fight ${best.toFixed(1)}s.`,
  };
}

function isRunShaped(value: unknown): value is SandboxRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Partial<SandboxRun>;
  return (
    typeof run.scenarioId === "string" &&
    typeof run.scenarioName === "string" &&
    typeof run.at === "number" &&
    typeof run.seconds === "number" &&
    Array.isArray(run.rulesUsed)
  );
}
