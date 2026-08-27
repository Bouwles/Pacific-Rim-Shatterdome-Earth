import type { QualityLevel } from "../data/quality";
import { budgetFor, type PerfBudget } from "../data/perfBudgets";

/**
 * Where a frame's time went, and which frames went wrong.
 *
 * Three instruments, all cheap enough to leave on:
 *
 * **Named scopes.** A caller brackets work with begin/end and the profiler
 * accumulates milliseconds per scope per frame. Scopes are names, not a
 * hierarchy, because "terrain 4 ms, combat 2 ms, effects 1 ms" answers the
 * question a long frame asks and a flame graph belongs in the browser's own
 * profiler.
 *
 * **Long-frame capture.** The acceptance says it plainly: an average is not
 * the truth. Any frame past the budget's long-frame threshold is recorded
 * with its scope breakdown into a bounded ring, newest kept, so the report
 * carries the worst moments rather than the mean of them.
 *
 * **Counters.** Pools and systems register a read function once, and the
 * report reads them all at capture time: live particles, pool occupancy,
 * allocation counts. Reading at capture rather than pushing per frame keeps
 * the steady-state cost of a counter at zero.
 *
 * Time is injected. Tests hand it a fake clock and the browser hands it
 * performance.now, so every decision here is deterministic under test.
 */

/** Long-frame captures kept. Oldest dropped first. */
export const MAX_LONG_FRAMES = 32;
/** Frames folded into the rolling report window. */
export const REPORT_WINDOW_FRAMES = 240;

export interface LongFrameCapture {
  /** Frame duration, milliseconds. */
  readonly ms: number;
  /** Monotonic frame index, so spacing between spikes is visible. */
  readonly frame: number;
  /** Scope name to milliseconds, for the frames that had scopes. */
  readonly scopes: Readonly<Record<string, number>>;
}

export interface FrameStats {
  readonly frames: number;
  readonly averageMs: number;
  readonly worstMs: number;
  /** 95th percentile over the window, which spikes cannot hide behind. */
  readonly p95Ms: number;
  readonly longFrames: number;
}

export class Profiler {
  private readonly now: () => number;
  private longFrameMs: number;

  private frameIndex = 0;
  private frameStartAt: number | null = null;
  private scopeStack: { name: string; startedAt: number }[] = [];
  private frameScopes = new Map<string, number>();
  private readonly durations: number[] = [];
  private longCaptures: LongFrameCapture[] = [];
  private longCount = 0;
  private readonly counters = new Map<string, () => number>();

  constructor(options: { readonly now?: () => number; readonly longFrameMs?: number } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.longFrameMs = options.longFrameMs ?? 50;
  }

  /** The threshold follows the active budget when quality changes. */
  setLongFrameThreshold(ms: number): void {
    this.longFrameMs = ms;
  }

  beginFrame(): void {
    this.frameStartAt = this.now();
    this.frameScopes = new Map();
    this.scopeStack = [];
  }

  /** Brackets one piece of work. Nesting is allowed; overlap is not needed. */
  begin(name: string): void {
    this.scopeStack.push({ name, startedAt: this.now() });
  }

  end(): void {
    const top = this.scopeStack.pop();
    if (!top) return;
    const spent = this.now() - top.startedAt;
    this.frameScopes.set(top.name, (this.frameScopes.get(top.name) ?? 0) + spent);
  }

  /** Runs one piece of work inside a scope, whatever it throws. */
  measure<T>(name: string, work: () => T): T {
    this.begin(name);
    try {
      return work();
    } finally {
      this.end();
    }
  }

  endFrame(): void {
    if (this.frameStartAt === null) return;
    const ms = this.now() - this.frameStartAt;
    this.frameStartAt = null;
    this.frameIndex += 1;

    this.durations.push(ms);
    if (this.durations.length > REPORT_WINDOW_FRAMES) this.durations.shift();

    if (ms >= this.longFrameMs) {
      this.longCount += 1;
      const scopes: Record<string, number> = {};
      for (const [name, spent] of this.frameScopes) scopes[name] = Math.round(spent * 100) / 100;
      this.longCaptures.push({ ms: Math.round(ms * 100) / 100, frame: this.frameIndex, scopes });
      if (this.longCaptures.length > MAX_LONG_FRAMES) this.longCaptures.shift();
    }
  }

  /**
   * Registers a counter the report reads at capture time.
   *
   * Registering the same name replaces the reader, so a rebuilt view does not
   * leave a stale closure reading a disposed pool.
   */
  addCounter(name: string, read: () => number): void {
    this.counters.set(name, read);
  }

  removeCounter(name: string): void {
    this.counters.delete(name);
  }

  /** Every counter, read now. A reader that throws reports -1 rather than killing the report. */
  readCounters(): Readonly<Record<string, number>> {
    const values: Record<string, number> = {};
    for (const [name, read] of this.counters) {
      try {
        values[name] = read();
      } catch {
        values[name] = -1;
      }
    }
    return values;
  }

  frameStats(): FrameStats {
    if (this.durations.length === 0) {
      return { frames: 0, averageMs: 0, worstMs: 0, p95Ms: 0, longFrames: this.longCount };
    }
    const sorted = [...this.durations].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    return {
      frames: this.durations.length,
      averageMs: Math.round((sum / sorted.length) * 100) / 100,
      worstMs: Math.round(sorted[sorted.length - 1]! * 100) / 100,
      p95Ms: Math.round(p95 * 100) / 100,
      longFrames: this.longCount,
    };
  }

  longFrames(): readonly LongFrameCapture[] {
    return this.longCaptures;
  }

  /** Clears the window and the captures, for the start of a stress run. */
  reset(): void {
    this.durations.length = 0;
    this.longCaptures = [];
    this.longCount = 0;
    this.frameIndex = 0;
  }
}

/** Everything a stress run writes down. The exportable artefact. */
export interface PerfReport {
  readonly kind: "shatterdome.perf-report";
  readonly reportVersion: 1;
  readonly appVersion: string;
  readonly browser: string;
  readonly gpu: string;
  readonly preset: QualityLevel;
  readonly sceneId: string;
  readonly seed: number;
  /** Epoch milliseconds, supplied by the caller so this stays clock-free. */
  readonly at: number;
  readonly budget: PerfBudget;
  readonly frames: FrameStats;
  readonly longFrames: readonly LongFrameCapture[];
  readonly counters: Readonly<Record<string, number>>;
  /** Budget lines that were exceeded, in words. Empty is the passing case. */
  readonly breaches: readonly string[];
}

/** Builds the report and judges it against the budget it ran under. */
export function buildReport(options: {
  readonly profiler: Profiler;
  readonly preset: QualityLevel;
  readonly sceneId: string;
  readonly seed: number;
  readonly appVersion: string;
  readonly browser: string;
  readonly gpu: string;
  readonly at: number;
}): PerfReport {
  const budget = budgetFor(options.preset);
  const frames = options.profiler.frameStats();
  const counters = options.profiler.readCounters();
  const breaches: string[] = [];

  if (frames.p95Ms > budget.frameMs * 1.25) {
    breaches.push(`p95 frame ${frames.p95Ms} ms against a budget of ${budget.frameMs} ms`);
  }
  if (frames.longFrames > 0) {
    breaches.push(`${frames.longFrames} frames past the ${budget.longFrameMs} ms long-frame line`);
  }
  const counterBudgets: readonly [string, number][] = [
    ["drawCalls", budget.maxDrawCalls],
    ["triangles", budget.maxTriangles],
    ["textures", budget.maxTextures],
    ["activeBodies", budget.maxActiveBodies],
    ["particles", budget.maxParticles],
    ["debris", budget.maxDebris],
    ["audioVoices", budget.maxAudioVoices],
  ];
  for (const [name, ceiling] of counterBudgets) {
    const value = counters[name];
    if (value !== undefined && value > ceiling) {
      breaches.push(`${name} at ${value} against a ceiling of ${ceiling}`);
    }
  }

  return {
    kind: "shatterdome.perf-report",
    reportVersion: 1,
    appVersion: options.appVersion,
    browser: options.browser,
    gpu: options.gpu,
    preset: options.preset,
    sceneId: options.sceneId,
    seed: options.seed,
    at: options.at,
    budget,
    frames,
    longFrames: options.profiler.longFrames(),
    counters,
    breaches,
  };
}
