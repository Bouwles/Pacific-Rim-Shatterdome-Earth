import { describe, expect, it } from "vitest";
import {
  MAX_SCENARIOS,
  SANDBOX_STORAGE_KEY,
  checkCompatibility,
  deleteScenario,
  exportScenario,
  importScenario,
  loadLibrary,
  memorySandboxStorage,
  saveScenario,
  type SandboxEntry,
} from "../../src/sandbox/library";
import { SANDBOX_SCHEMA_VERSION, defaultScenario } from "../../src/sandbox/scenario";
import { defaultRules } from "../../src/sandbox/rules";
import {
  MAX_RUNS,
  SANDBOX_STATS_KEY,
  appendRun,
  clearRuns,
  loadRuns,
  memoryStatsStorage,
  recordRun,
  summarise,
} from "../../src/sandbox/stats";
import { checkRuleIsolation, runSandbox } from "../../src/debug/sandboxScenario";
import { PRESENTATION_STORAGE_KEY } from "../../src/ui/presentationStore";
import { MIXER_STORAGE_KEY } from "../../src/audio/mixerStore";

function entry(overrides: Partial<SandboxEntry> = {}): SandboxEntry {
  return {
    scenario: defaultScenario({ id: "sandbox.one", name: "First scenario" }),
    rules: defaultRules(),
    savedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("the scenario library", () => {
  it("saves, reloads and deletes a scenario", () => {
    const storage = memorySandboxStorage();
    expect(saveScenario(storage, entry()).ok).toBe(true);
    expect(loadLibrary(storage).entries).toHaveLength(1);
    expect(loadLibrary(storage).entries[0]?.scenario.name).toBe("First scenario");
    expect(deleteScenario(storage, "sandbox.one").ok).toBe(true);
    expect(loadLibrary(storage).entries).toHaveLength(0);
  });

  it("replaces a scenario rather than piling up near-copies", () => {
    const storage = memorySandboxStorage();
    saveScenario(storage, entry());
    saveScenario(
      storage,
      entry({ scenario: defaultScenario({ id: "sandbox.one", name: "First scenario, edited" }) }),
    );
    const entries = loadLibrary(storage).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.scenario.name).toBe("First scenario, edited");
  });

  it("refuses to save a scenario that will not run, and says why", () => {
    const storage = memorySandboxStorage();
    const broken = entry({ scenario: defaultScenario({ id: "sandbox.bad", regionId: "atlantis" }) });
    const result = saveScenario(storage, broken);
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/no region called/);
    expect(loadLibrary(storage).entries).toHaveLength(0);
  });

  it("refuses a new scenario once the library is full, rather than dropping one", () => {
    const storage = memorySandboxStorage();
    for (let index = 0; index < MAX_SCENARIOS; index += 1) {
      saveScenario(storage, entry({ scenario: defaultScenario({ id: `sandbox.${index}` }) }));
    }
    const result = saveScenario(storage, entry({ scenario: defaultScenario({ id: "sandbox.extra" }) }));
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/Delete one to make room/);
    expect(loadLibrary(storage).entries).toHaveLength(MAX_SCENARIOS);
  });

  it("says so rather than throwing when the browser will not store", () => {
    expect(saveScenario(null, entry()).ok).toBe(false);
    expect(loadLibrary(null).entries).toEqual([]);
    expect(loadLibrary(null).note).toMatch(/not storing site data/);
  });

  it("leaves an unreadable library alone rather than overwriting it", () => {
    const storage = memorySandboxStorage();
    storage.setItem(SANDBOX_STORAGE_KEY, "{not json");
    const load = loadLibrary(storage);
    expect(load.entries).toEqual([]);
    expect(load.note).toMatch(/left alone rather than overwritten/);
    expect(storage.getItem(SANDBOX_STORAGE_KEY)).toBe("{not json");
  });
});

describe("exporting and importing", () => {
  it("round trips through a file", () => {
    const text = exportScenario(entry());
    const result = importScenario(text);
    expect(result.compatibility.verdict).toBe("ok");
    expect(result.entry?.scenario.name).toBe("First scenario");
  });

  it("refuses something that is not a scenario file", () => {
    const result = importScenario(JSON.stringify({ hello: "world" }));
    expect(result.entry).toBeNull();
    expect(result.compatibility.reasons.join(" ")).toMatch(/not a scenario file/);
  });

  it("refuses text that is not readable at all", () => {
    const result = importScenario("not json");
    expect(result.entry).toBeNull();
    expect(result.compatibility.verdict).toBe("malformed");
  });

  it("marks a file from another version rather than half-loading it", () => {
    const text = exportScenario(
      entry({ scenario: { ...defaultScenario(), schemaVersion: SANDBOX_SCHEMA_VERSION + 1 } }),
    );
    const result = importScenario(text);
    expect(result.compatibility.verdict).toBe("different-version");
    expect(result.compatibility.openable).toBe(false);
    expect(result.compatibility.reasons.join(" ")).toMatch(/different version of the game/);
  });

  it("marks a file naming content this build does not have, and offers to open it", () => {
    const text = exportScenario(
      entry({
        scenario: defaultScenario({
          waves: [{ combatants: [{ kaijuId: "kaiju.from-a-mod", mutationIds: [] }], delaySeconds: 0 }],
        }),
      }),
    );
    const result = importScenario(text);
    expect(result.compatibility.verdict).toBe("unknown-content");
    // Openable so somebody can swap the missing piece out, rather than a dead end.
    expect(result.compatibility.openable).toBe(true);
    expect(result.compatibility.reasons.join(" ")).toMatch(/content this copy of the game does not have/);
  });

  it("separates a version problem from a content problem", () => {
    expect(checkCompatibility(entry()).verdict).toBe("ok");
    expect(
      checkCompatibility(entry({ scenario: defaultScenario({ objective: "objective.escort" }) })).verdict,
    ).toBe("malformed");
  });
});

describe("sandbox statistics", () => {
  const run = recordRun({
    scenarioId: "sandbox.one",
    scenarioName: "First scenario",
    at: 1_700_000_000_000,
    outcome: "won",
    seconds: 42.55,
    creaturesDown: 1,
    damageDealt: 900,
    blocksLevelled: 3,
    rules: defaultRules(),
  });

  it("records a run with what it was played under", () => {
    expect(run.fair).toBe(true);
    expect(run.rulesUsed).toEqual([]);
    expect(run.seconds).toBe(42.6);
  });

  it("marks a run played with the cheats on", () => {
    const cheated = recordRun({
      scenarioId: "sandbox.one",
      scenarioName: "First scenario",
      at: 1,
      outcome: "won",
      seconds: 3,
      creaturesDown: 1,
      damageDealt: 10,
      blocksLevelled: 0,
      rules: { ...defaultRules(), noDamageTaken: true },
    });
    expect(cheated.fair).toBe(false);
    expect(cheated.rulesUsed).toContain("Invulnerable machines");
  });

  it("ranks best times on straight fights only", () => {
    const cheated = { ...run, seconds: 1, fair: false, rulesUsed: ["Invulnerable machines"] };
    const summary = summarise([run, cheated]);
    expect(summary.runs).toBe(2);
    expect(summary.bestFairSeconds).toBe(42.6);
    expect(summary.note).toMatch(/best straight fight/);
  });

  it("keeps a bounded scoreboard rather than an unbounded archive", () => {
    const storage = memoryStatsStorage();
    for (let index = 0; index < MAX_RUNS + 20; index += 1) {
      appendRun(storage, { ...run, at: index });
    }
    expect(loadRuns(storage)).toHaveLength(MAX_RUNS);
  });

  it("forgets everything on request", () => {
    const storage = memoryStatsStorage();
    appendRun(storage, run);
    clearRuns(storage);
    expect(loadRuns(storage)).toEqual([]);
  });
});

describe("the separation from a campaign", () => {
  it("stores sandbox data somewhere no campaign save reaches", () => {
    // Four different keys, none of which is the save store. A sandbox run and a
    // campaign have no shared ledger to move anything through.
    const keys = [SANDBOX_STORAGE_KEY, SANDBOX_STATS_KEY, PRESENTATION_STORAGE_KEY, MIXER_STORAGE_KEY];
    expect(new Set(keys).size).toBe(keys.length);
    expect(SANDBOX_STORAGE_KEY).not.toBe(SANDBOX_STATS_KEY);
  });

  it("exposes nothing that turns a sandbox run into campaign progress", async () => {
    const stats = await import("../../src/sandbox/stats");
    const library = await import("../../src/sandbox/library");
    const names = [...Object.keys(stats), ...Object.keys(library)].join(" ").toLowerCase();
    // Nothing here awards, credits, pays or unlocks. If one of these ever
    // appears, the separation has been broken and this says so.
    for (const forbidden of ["award", "credit", "payout", "unlock", "prestige", "research"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("leaves the next run exactly where the last one left it", () => {
    const report = checkRuleIsolation();
    expect(report.isolated).toBe(true);
    expect(report.before.digest).toBe(report.after.digest);
    expect(report.before.damageTakenByMachine).toBe(report.after.damageTakenByMachine);
  });

  it("actually changed the fight while the cheats were on, so the check means something", () => {
    const report = checkRuleIsolation();
    expect(report.rulesDidSomething).toBe(true);
    expect(report.cheated.damageTakenByMachine).toBe(0);
    expect(report.before.damageTakenByMachine).toBeGreaterThan(0);
  });

  it("refuses to run an impossible scenario rather than building half a scene", () => {
    expect(() => runSandbox(defaultScenario({ regionId: "atlantis" }))).toThrow(/will not run/);
  });

  it("is deterministic: the same scenario and rules give the same run", () => {
    expect(runSandbox()).toEqual(runSandbox());
  });
});
