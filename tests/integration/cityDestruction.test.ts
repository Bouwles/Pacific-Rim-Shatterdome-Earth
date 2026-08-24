import { describe, expect, it } from "vitest";
import {
  buildScenarioLayout,
  runDebrisStress,
  runDestructionScenario,
} from "../../src/debug/destructionScenario";
import { RegionDestruction } from "../../src/world/destruction";
import { WorldState } from "../../src/world/worldState";
import { createDefaultRegionRegistry } from "../../src/data/regions";
import { createClimateRegistry } from "../../src/data/climates";
import { SaveService } from "../../src/saves/saveService";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SimulationKernel } from "../../src/simulation/kernel";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION, validateRootSave } from "../../src/saves/schema";

const climates = createClimateRegistry();

function makeWorld(): WorldState {
  return new WorldState({
    regions: createDefaultRegionRegistry(),
    seed: 20260824,
    climateProfileFor: (climate) => climates.getOrThrow(climate),
  });
}

describe("a battle changes the district it happens in", () => {
  it("levels part of the city and reports it, rather than leaving it whole", () => {
    const result = runDestructionScenario();
    expect(result.before.summary).toMatch(/whole/);
    expect(result.groupsHit).toBeGreaterThan(0);
    expect(result.structuresDowned).toBeGreaterThan(0);
    expect(result.afterFight.groupsDamaged).toBeGreaterThan(0);
    expect(result.afterFight.groupsRuined).toBeGreaterThan(0);
    expect(result.afterFight.safety).toBeLessThan(result.before.safety);
    expect(result.afterFight.summary).toMatch(/blocks damaged/);
  });

  it("leaves most of the city standing: damage is local, not global", () => {
    const result = runDestructionScenario();
    expect(result.groupsHit).toBeLessThan(result.layout.destructionGroups.length);
    expect(result.afterFight.integrity).toBeGreaterThan(0.2);
  });

  it("repeats exactly on the same seed and differs on another", () => {
    expect(runDestructionScenario().digest).toBe(runDestructionScenario().digest);
    expect(runDestructionScenario({ seed: 99 }).digest).not.toBe(runDestructionScenario().digest);
  });
});

describe("time, not a reset", () => {
  it("puts fires out and pulls people out over days", () => {
    const result = runDestructionScenario();
    expect(result.afterRecovery.firesBurning).toBeLessThan(result.afterFight.firesBurning);
    expect(result.afterRecovery.trappedThousands).toBeLessThan(result.afterFight.trappedThousands);
    // Recovering is not repairing: the buildings are still down.
    expect(result.afterRecovery.groupsRuined).toBeGreaterThan(0);
  });

  it("clears a block before it rebuilds it, in stages", () => {
    const layout = buildScenarioLayout();
    const destruction = new RegionDestruction({ layout, seed: 7 });
    const group = layout.destructionGroups[0]!;
    destruction.applyImpact(group.centreEast, group.centreNorth, 320, 9_000_000);
    destruction.advanceSeconds(30);
    expect(destruction.stateOf(group.id)).toBe("ruined");

    destruction.advanceHours(200);
    destruction.startProject(group.id);
    expect(destruction.stateOf(group.id)).toBe("ruined");

    // Enough work to finish clearing but not to finish rebuilding.
    const quote = destruction.quoteProject(group.id)!;
    destruction.progressProjects(quote.hours * 0.4, { funding: 1_000_000_000 });
    expect(destruction.stateOf(group.id)).toBe("rebuilding");
    expect(destruction.group(group.id)!.integrity).toBeLessThan(1);

    let guard = 0;
    while (destruction.activeProjects().length > 0 && guard < 500) {
      destruction.progressProjects(quote.hours * 0.2, { funding: 1_000_000_000 });
      guard += 1;
    }
    expect(destruction.stateOf(group.id)).toBe("intact");
  });
});

describe("debris under stress", () => {
  it("never exceeds the pool ceiling, however much comes down", () => {
    const stress = runDebrisStress(48);
    expect(stress.debrisPeakLive).toBeLessThanOrEqual(48);
    expect(stress.debrisCapacity).toBe(48);
    // The shortfall is reported rather than quietly allocated for.
    expect(stress.debrisRefused).toBeGreaterThan(0);
  });

  it("comes back to nothing once the rubble has expired", () => {
    const stress = runDebrisStress(64);
    expect(stress.debrisLiveAtEnd).toBe(0);
  });

  it("holds the ceiling at every preset size", () => {
    for (const capacity of [40, 96, 200]) {
      const stress = runDebrisStress(capacity);
      expect(stress.debrisPeakLive).toBeLessThanOrEqual(capacity);
    }
  });
});

describe("damage that survives leaving and reloading", () => {
  it("writes a summary onto the region record and reads it back", async () => {
    const layout = buildScenarioLayout();
    const destruction = new RegionDestruction({ layout, seed: 20260824 });
    const group = layout.destructionGroups[0]!;
    destruction.applyImpact(group.centreEast, group.centreNorth, 400, 9_000_000);
    destruction.advanceSeconds(30);

    const world = makeWorld();
    world.setRegionDamage("hong-kong", destruction.snapshot(), destruction.report(), 5_000);
    const record = world.recordFor("hong-kong");
    expect(record!.integrity).toBeLessThan(1);
    expect(record!.damage.groups.length).toBeGreaterThan(0);

    const repository = new MemorySaveRepository();
    const service = new SaveService({ repository, appVersion: "0.4.0", now: () => 1 });
    const kernel = new SimulationKernel({ seed: 20260824 });
    await service.save("slot.a", kernel, { name: "Levelled", world: world.serialize() });
    const loaded = await service.load("slot.a");
    expect(validateRootSave(loaded.document)).toEqual([]);

    const reloaded = makeWorld();
    reloaded.restore(loaded.document.world);
    const back = reloaded.recordFor("hong-kong");
    expect(back!.damage.groups.length).toBe(record!.damage.groups.length);
    expect(back!.integrity).toBeCloseTo(record!.integrity, 5);

    // And the detailed city can be rebuilt from the summary alone.
    const rebuilt = new RegionDestruction({ layout, seed: 20260824 });
    rebuilt.restore(back!.damage);
    expect(rebuilt.report().groupsDamaged).toBe(destruction.report().groupsDamaged);
  });

  it("saves a summary rather than a scene: a levelled city is a few kilobytes", () => {
    const result = runDestructionScenario({ impacts: 30, energy: 400_000 });
    expect(result.snapshotBytes).toBeLessThan(60_000);
    expect(result.afterFight.groupsRuined).toBeGreaterThan(5);
  });

  it("migrates a version 6 save into an undamaged world", () => {
    const legacy = {
      schemaVersion: 6,
      savedAt: 1,
      metadata: {
        name: "Before destruction",
        worldSeed: 7,
        playTimeMs: 0,
        lastPlayedAt: 0,
        simTick: 0,
        appVersion: "0.3.0",
        thumbnail: null,
      },
      sim: { schemaVersion: 1, seed: 7, tick: 0, entities: [] },
      world: { schemaVersion: 3, marker: "kept", regions: [{ regionId: "hong-kong", integrity: 1 }] },
      shatterdome: { marker: "kept" },
      roster: { machines: [] },
    };
    const result = migrateSave(legacy);
    expect(result.applied).toEqual(["6"]);
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    const world = result.document.world as unknown as Record<string, unknown>;
    expect(world["marker"]).toBe("kept");
    const regions = world["regions"] as Record<string, unknown>[];
    const damage = regions[0]?.["damage"] as Record<string, unknown>;
    expect(damage["regionId"]).toBe("hong-kong");
    expect(damage["groups"]).toEqual([]);
    expect(damage["projects"]).toEqual([]);
  });
});
