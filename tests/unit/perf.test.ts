import { describe, expect, it } from "vitest";
import { PERF_BUDGETS, budgetFor, validatePerfBudgets } from "../../src/data/perfBudgets";
import { QUALITY_LEVELS } from "../../src/data/quality";
import { MAX_LONG_FRAMES, Profiler, buildReport } from "../../src/perf/profiler";
import {
  AdaptiveQuality,
  COOLDOWN_FRAMES,
  DOWN_AFTER_FRAMES,
  UP_AFTER_FRAMES,
} from "../../src/perf/adaptiveQuality";
import { LeakTracker, diffInventories } from "../../src/perf/leakTracker";

/** A profiler on a hand-cranked clock. */
function cranked(longFrameMs = 50) {
  let at = 0;
  const profiler = new Profiler({ now: () => at, longFrameMs });
  return { profiler, tick: (ms: number) => (at += ms) };
}

describe("the budget contract", () => {
  it("holds its own ladder and agrees with the quality presets", () => {
    expect(validatePerfBudgets()).toEqual([]);
  });

  it("states hardware for every level", () => {
    for (const level of QUALITY_LEVELS) {
      expect(PERF_BUDGETS[level].hardware.length).toBeGreaterThan(12);
    }
  });

  it("gives Low a gentler frame target and a looser long-frame line", () => {
    expect(budgetFor("low").frameMs).toBeGreaterThan(budgetFor("high").frameMs);
    expect(budgetFor("low").longFrameMs).toBeGreaterThanOrEqual(budgetFor("high").longFrameMs);
  });
});

describe("the profiler", () => {
  it("accumulates named scopes within a frame", () => {
    const { profiler, tick } = cranked();
    profiler.beginFrame();
    profiler.begin("terrain");
    tick(4);
    profiler.end();
    profiler.begin("combat");
    tick(2);
    profiler.end();
    profiler.begin("terrain");
    tick(3);
    profiler.end();
    tick(60);
    profiler.endFrame();
    const capture = profiler.longFrames()[0]!;
    expect(capture.scopes["terrain"]).toBe(7);
    expect(capture.scopes["combat"]).toBe(2);
  });

  it("captures long frames with their breakdown and drops the oldest", () => {
    const { profiler, tick } = cranked(50);
    for (let index = 0; index < MAX_LONG_FRAMES + 10; index += 1) {
      profiler.beginFrame();
      tick(60);
      profiler.endFrame();
    }
    expect(profiler.longFrames()).toHaveLength(MAX_LONG_FRAMES);
    expect(profiler.frameStats().longFrames).toBe(MAX_LONG_FRAMES + 10);
  });

  it("does not let a smooth average hide the spikes", () => {
    const { profiler, tick } = cranked(50);
    for (let index = 0; index < 100; index += 1) {
      profiler.beginFrame();
      tick(index % 20 === 0 ? 80 : 8);
      profiler.endFrame();
    }
    const stats = profiler.frameStats();
    expect(stats.averageMs).toBeLessThan(16);
    expect(stats.worstMs).toBe(80);
    expect(stats.longFrames).toBe(5);
  });

  it("reads counters at capture time and survives a reader that throws", () => {
    const { profiler } = cranked();
    profiler.addCounter("particles", () => 42);
    profiler.addCounter("broken", () => {
      throw new Error("gone");
    });
    expect(profiler.readCounters()).toEqual({ particles: 42, broken: -1 });
  });

  it("replaces a counter rather than stacking readers", () => {
    const { profiler } = cranked();
    profiler.addCounter("meshes", () => 1);
    profiler.addCounter("meshes", () => 2);
    expect(profiler.readCounters()["meshes"]).toBe(2);
  });

  it("measure closes its scope even when the work throws", () => {
    const { profiler, tick } = cranked();
    profiler.beginFrame();
    expect(() =>
      profiler.measure("risky", () => {
        tick(3);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    tick(60);
    profiler.endFrame();
    expect(profiler.longFrames()[0]!.scopes["risky"]).toBe(3);
  });
});

describe("the report", () => {
  function report(overrides: { readonly frameMs?: number; readonly counters?: Record<string, number> } = {}) {
    const { profiler, tick } = cranked(50);
    for (let index = 0; index < 30; index += 1) {
      profiler.beginFrame();
      tick(overrides.frameMs ?? 8);
      profiler.endFrame();
    }
    for (const [name, value] of Object.entries(overrides.counters ?? {})) {
      profiler.addCounter(name, () => value);
    }
    return buildReport({
      profiler,
      preset: "high",
      sceneId: "stress.four-combatants",
      seed: 20260913,
      appVersion: "0.3.0",
      browser: "test",
      gpu: "test-gpu",
      at: 1_700_000_000_000,
    });
  }

  it("carries version, browser, GPU, preset and scene seed", () => {
    const built = report();
    expect(built.kind).toBe("shatterdome.perf-report");
    expect(built.appVersion).toBe("0.3.0");
    expect(built.browser).toBe("test");
    expect(built.gpu).toBe("test-gpu");
    expect(built.preset).toBe("high");
    expect(built.seed).toBe(20260913);
  });

  it("passes a comfortable run with no breaches", () => {
    expect(report().breaches).toEqual([]);
  });

  it("names a frame budget breach in words", () => {
    const built = report({ frameMs: 40 });
    expect(built.breaches.join(" ")).toMatch(/p95 frame/);
  });

  it("names a counter over its ceiling", () => {
    const built = report({ counters: { drawCalls: 5_000 } });
    expect(built.breaches.join(" ")).toMatch(/drawCalls at 5000/);
  });

  it("serialises to JSON and back without loss", () => {
    const built = report({ frameMs: 60 });
    expect(JSON.parse(JSON.stringify(built))).toEqual(built);
  });
});

describe("adaptive quality", () => {
  it("does nothing while disabled, whatever the frames say", () => {
    const adaptive = new AdaptiveQuality("high", false);
    for (let index = 0; index < 1_000; index += 1) {
      expect(adaptive.frame(100).kind).toBe("hold");
    }
  });

  it("ignores a lone spike", () => {
    const adaptive = new AdaptiveQuality("high", true);
    adaptive.frame(120);
    for (let index = 0; index < 200; index += 1) {
      expect(adaptive.frame(8).kind).toBe("hold");
    }
  });

  it("steps down one level after sustained pressure, with the reason attached", () => {
    const adaptive = new AdaptiveQuality("high", true);
    let change: string | null = null;
    for (let index = 0; index < DOWN_AFTER_FRAMES + 5; index += 1) {
      const decision = adaptive.frame(30);
      if (decision.kind === "change") {
        change = decision.to;
        expect(decision.reason).toMatch(/Stepped down to medium/);
        break;
      }
    }
    expect(change).toBe("medium");
  });

  it("holds through the cooldown so the change's own cost is not judged", () => {
    const adaptive = new AdaptiveQuality("high", true);
    for (let index = 0; index < DOWN_AFTER_FRAMES; index += 1) adaptive.frame(30);
    for (let index = 0; index < COOLDOWN_FRAMES; index += 1) {
      expect(adaptive.frame(200).kind).toBe("hold");
    }
  });

  it("recovers only after a long stable window, and only one step", () => {
    const adaptive = new AdaptiveQuality("medium", true);
    let changes = 0;
    for (let index = 0; index < UP_AFTER_FRAMES - 1; index += 1) {
      if (adaptive.frame(5).kind === "change") changes += 1;
    }
    expect(changes).toBe(0);
    const decision = adaptive.frame(5);
    expect(decision.kind).toBe("change");
    if (decision.kind === "change") expect(decision.to).toBe("high");
  });

  it("treats an adequate frame as neither pressure nor headroom", () => {
    const adaptive = new AdaptiveQuality("high", true);
    for (let index = 0; index < UP_AFTER_FRAMES * 2; index += 1) {
      // Just inside budget, but not comfortable: never steps up.
      expect(adaptive.frame(15).kind).toBe("hold");
    }
  });

  it("never steps below Low or above Cinematic", () => {
    const low = new AdaptiveQuality("low", true);
    for (let index = 0; index < DOWN_AFTER_FRAMES * 3; index += 1) {
      expect(low.frame(100).kind).toBe("hold");
    }
    const cinematic = new AdaptiveQuality("cinematic", true);
    for (let index = 0; index < UP_AFTER_FRAMES * 2; index += 1) {
      expect(cinematic.frame(2).kind).toBe("hold");
    }
  });

  it("hands control to the player and stops", () => {
    const adaptive = new AdaptiveQuality("high", true);
    adaptive.setManual("low");
    expect(adaptive.view().enabled).toBe(false);
    expect(adaptive.view().level).toBe("low");
    for (let index = 0; index < DOWN_AFTER_FRAMES * 2; index += 1) {
      expect(adaptive.frame(200).kind).toBe("hold");
    }
  });
});

describe("the leak tracker", () => {
  it("calls growth a leak and shrinkage fine", () => {
    const diff = diffInventories({ meshes: 10, textures: 5 }, { meshes: 12, textures: 3 });
    expect(diff.clean).toBe(false);
    expect(diff.grown).toEqual({ meshes: 2 });
    expect(diff.summary).toContain("meshes +2");
  });

  it("reports clean when nothing grew", () => {
    expect(diffInventories({ meshes: 10 }, { meshes: 10 }).clean).toBe(true);
  });

  it("counts a resource that appeared from nowhere", () => {
    const diff = diffInventories({}, { workers: 1 });
    expect(diff.grown).toEqual({ workers: 1 });
  });

  it("audits cycles against a fixed baseline", () => {
    let meshes = 100;
    const tracker = new LeakTracker(() => ({ meshes }));
    tracker.setBaseline();
    meshes = 108;
    expect(tracker.audit().clean).toBe(false);
    meshes = 100;
    expect(tracker.audit().clean).toBe(true);
    expect(tracker.view().cycles).toBe(2);
  });
});
