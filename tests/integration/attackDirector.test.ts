import { describe, expect, it } from "vitest";
import {
  comparePolicies,
  runDirectorScenario,
  DIRECTOR_SCENARIO_SEED,
} from "../../src/debug/directorScenario";
import { AttackDirector } from "../../src/world/director";
import { createDefaultRegionRegistry } from "../../src/data/regions";
import { SaveService } from "../../src/saves/saveService";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SimulationKernel } from "../../src/simulation/kernel";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION, validateRootSave } from "../../src/saves/schema";

const regions = createDefaultRegionRegistry();

describe("the same seed and the same decisions", () => {
  it("produce the same alert sequence", () => {
    const first = runDirectorScenario({ policy: "ignore-all" });
    const second = runDirectorScenario({ policy: "ignore-all" });
    expect(first.digest).toBe(second.digest);
    expect(first.alerts.map((alert) => `${alert.tick}:${alert.regionId}`)).toEqual(
      second.alerts.map((alert) => `${alert.tick}:${alert.regionId}`),
    );
    expect(first.alerts.length).toBeGreaterThan(3);
  });

  it("and different decisions produce a different war", () => {
    const { defended, ignored } = comparePolicies();
    expect(defended.digest).not.toBe(ignored.digest);
    // Turning up for the fights keeps the lid on; ignoring them does not.
    expect(defended.escalation).toBeLessThan(ignored.escalation);
  });

  it("and a different seed produces a different one again", () => {
    const a = runDirectorScenario({ seed: DIRECTOR_SCENARIO_SEED });
    const b = runDirectorScenario({ seed: DIRECTOR_SCENARIO_SEED + 1 });
    expect(a.digest).not.toBe(b.digest);
  });
});

describe("simultaneous crises", () => {
  it("runs two at once without either becoming a combat scene", () => {
    const result = runDirectorScenario({ crisisFrequency: 1.5, policy: "ignore-all" });
    expect(result.peakSimultaneous).toBeGreaterThanOrEqual(2);
    // The director is strategic state and nothing else: no arena, no view, no
    // scene of any kind is created by any of this.
    for (const resolution of result.resolutions) {
      expect(Object.keys(resolution).sort()).toEqual([
        "escalationDelta",
        "held",
        "incidentId",
        "integrityLost",
        "kind",
        "ledger",
        "regionId",
        "reward",
        "summary",
      ]);
    }
  });

  it("gives every overlapping incident its own forecast and travel time", () => {
    const director = new AttackDirector({ regions, seed: 5, crisisFrequency: 1.5 });
    for (let tick = 0; tick <= 400_000; tick += 600) director.advance(tick, 600);
    const active = director.incidents().filter((incident) => incident.status !== "resolved");
    expect(active.length).toBeGreaterThan(0);
    for (const incident of active) {
      const forecast = director.forecast(incident, incident.createdTick, 2_400);
      expect(forecast.regionName.length).toBeGreaterThan(0);
      expect(forecast.ticksToArrival).toBeGreaterThan(0);
      expect(typeof forecast.reachable).toBe("boolean");
      expect(forecast.composition.length).toBeGreaterThan(0);
      // The forecast of doing nothing is a full explanation, not a verdict.
      expect(forecast.ignoredForecast.ledger.length).toBeGreaterThan(3);
    }
  });
});

describe("nobody is punished with nonstop alerts", () => {
  it("leaves long quiet stretches even at the highest frequency", () => {
    const result = runDirectorScenario({ crisisFrequency: 2, policy: "defend-all" });
    expect(result.longestQuietTicks).toBeGreaterThan(10_000);
  });

  it("never hits the same region twice in a row", () => {
    const result = runDirectorScenario({ ticks: 600_000 });
    expect(result.alerts.length).toBeGreaterThan(5);
    expect(result.backToBackRepeats).toBe(0);
  });

  it("spreads attacks across the map rather than camping one city", () => {
    const result = runDirectorScenario({ ticks: 600_000 });
    expect(new Set(result.regionsHit).size).toBeGreaterThan(2);
  });
});

describe("every resolution explains itself", () => {
  it("says what changed and why for rewards, damage and escalation", () => {
    const result = runDirectorScenario({ policy: "ignore-all" });
    expect(result.resolutions.length).toBeGreaterThan(0);
    for (const resolution of result.resolutions) {
      const labels = resolution.ledger.map((line) => line.label);
      expect(labels).toContain("Kaiju strength");
      expect(labels).toContain("Regional defences");
      expect(labels).toContain("City integrity");
      expect(labels).toContain("Escalation");
      for (const line of resolution.ledger) expect(line.reason.length).toBeGreaterThan(0);
    }
  });

  it("pays for a win and charges for a loss, both with reasons", () => {
    const defended = runDirectorScenario({ policy: "defend-all", playerStrength: 400 });
    const ignored = runDirectorScenario({ policy: "ignore-all" });
    const paid = defended.resolutions.filter((entry) => entry.reward > 0);
    const lost = ignored.resolutions.filter((entry) => !entry.held);
    expect(paid.length).toBeGreaterThan(0);
    expect(lost.length).toBeGreaterThan(0);
    for (const entry of lost) expect(entry.integrityLost).toBeGreaterThan(0);
  });
});

describe("the war survives a save", () => {
  it("round-trips through a real save file", async () => {
    const director = new AttackDirector({ regions, seed: 77, crisisFrequency: 1.25 });
    for (let tick = 0; tick <= 300_000; tick += 600) director.advance(tick, 600);
    const before = director.snapshot();
    expect(before.incidents.length).toBeGreaterThan(0);

    const repository = new MemorySaveRepository();
    const service = new SaveService({ repository, appVersion: "0.5.0", now: () => 1 });
    const kernel = new SimulationKernel({ seed: 20260825 });
    await service.save("slot.a", kernel, { name: "Mid war", director: before });
    const loaded = await service.load("slot.a");
    expect(validateRootSave(loaded.document)).toEqual([]);

    const restored = new AttackDirector({ regions, seed: 77 });
    restored.restore(loaded.document.director);
    expect(restored.escalation).toBeCloseTo(director.escalation, 3);
    expect(restored.crisisFrequency).toBeCloseTo(1.25, 5);
    expect(restored.incidents().length).toBe(director.incidents().length);
    expect(restored.snapshot().recentRegionIds).toEqual(before.recentRegionIds);
  });

  it("migrates a version 7 save into a war that has not started", () => {
    const legacy = {
      schemaVersion: 7,
      savedAt: 1,
      metadata: {
        name: "Before the director",
        worldSeed: 7,
        playTimeMs: 0,
        lastPlayedAt: 0,
        simTick: 0,
        appVersion: "0.4.0",
        thumbnail: null,
      },
      sim: { schemaVersion: 1, seed: 7, tick: 0, entities: [] },
      world: { marker: "kept" },
      shatterdome: { marker: "kept" },
      roster: { machines: [] },
    };
    const result = migrateSave(legacy);
    expect(result.applied).toEqual(["7"]);
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(result.document.director.incidents).toEqual([]);
    expect(result.document.director.escalation).toBeGreaterThan(0);
    const world = result.document.world as unknown as Record<string, unknown>;
    expect(world["marker"]).toBe("kept");
  });
});
