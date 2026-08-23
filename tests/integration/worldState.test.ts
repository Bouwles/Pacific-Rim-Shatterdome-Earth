import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultRegionRegistry, TELEPORT_TEST_REGION_IDS } from "../../src/data/regions";
import { createClimateRegistry } from "../../src/data/climates";
import { geo, localToGeo, surfaceDistanceMeters } from "../../src/world/coordinates";
import { parseSectorId, sectorIdAt } from "../../src/world/cubeSphere";
import {
  ACTIVE_BUBBLE_RADIUS_METERS,
  WorldState,
  validateWorldSnapshot,
  type WorldSnapshot,
} from "../../src/world/worldState";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";

let world: WorldState;

beforeEach(() => {
  world = makeWorld();
});

const climates = createClimateRegistry();

/** World state needs a seed and a climate resolver as of Milestone 06. */
function makeWorld(): WorldState {
  return new WorldState({
    regions: createDefaultRegionRegistry(),
    seed: 20260822,
    climateProfileFor: (climate) => climates.getOrThrow(climate),
  });
}

describe("world state basics", () => {
  it("starts at the home Shatterdome with that region active", () => {
    expect(world.activeRegionId).toBe("hong-kong");
    expect(world.playerPosition.latitudeDeg).toBeCloseTo(22.3193, 4);
    expect(parseSectorId(world.activeSectorId)).toBeTruthy();
  });

  it("carries a strategic record for every region on the planet", () => {
    const registry = createDefaultRegionRegistry();
    expect(world.regionCount).toBe(registry.all().length);
    for (const record of world.records()) {
      expect(record.integrity).toBe(1);
      expect(record.safetyRating).toBe(1);
    }
  });

  it("rejects a move to an impossible position rather than clamping silently", () => {
    expect(() => world.moveTo(geo(Number.NaN, 0))).toThrow(/latitudeDeg/);
    expect(() => world.moveTo(geo(0, 400))).toThrow(/longitudeDeg/);
  });
});

describe("teleporting between the named test locations", () => {
  it("recovers the right region and climate at each one", () => {
    const expected: Record<string, string> = {
      "hong-kong": "subtropical",
      sydney: "temperate",
      tokyo: "temperate",
      anchorage: "subarctic",
      manila: "tropical",
    };

    for (const regionId of TELEPORT_TEST_REGION_IDS) {
      const position = world.teleportTo(regionId);
      const definition = world.definitionFor(regionId);

      expect(world.activeRegionId, `active region after teleport to ${regionId}`).toBe(regionId);
      expect(definition?.climate, `${regionId} climate`).toBe(expected[regionId]);
      expect(surfaceDistanceMeters(position, definition!.centre)).toBeLessThan(1);
    }
  });

  it("puts each named location in its own distinct sector", () => {
    const sectors = new Map<string, string>();
    for (const regionId of TELEPORT_TEST_REGION_IDS) {
      world.teleportTo(regionId);
      sectors.set(regionId, world.activeSectorId);
    }
    // Five cities scattered across the Pacific must not collapse into one cell.
    expect(new Set(sectors.values()).size).toBe(TELEPORT_TEST_REGION_IDS.length);
  });

  it("reports a sector change when the teleport crosses a boundary", () => {
    world.teleportTo("hong-kong");
    const before = world.activeSectorId;
    const changed = world.moveTo(world.definitionFor("anchorage")!.centre);

    expect(changed).toBe(true);
    expect(world.activeSectorId).not.toBe(before);
    expect(world.activeSectorId).toBe(sectorIdAt(world.playerPosition));
  });

  it("refuses an unknown region and lists what does exist", () => {
    expect(() => world.teleportTo("atlantis")).toThrow(/Unknown region "atlantis"/);
    expect(() => world.teleportTo("atlantis")).toThrow(/hong-kong/);
  });
});

describe("active bubble versus strategic records", () => {
  it("keeps exactly one region active and every other one strategic", () => {
    for (const regionId of TELEPORT_TEST_REGION_IDS) {
      world.teleportTo(regionId);

      expect(world.activeRegions().map((r) => r.regionId)).toEqual([regionId]);
      for (const record of world.records()) {
        const expectedTier = record.regionId === regionId ? "active" : "strategic";
        expect(record.tier, `${record.regionId} while at ${regionId}`).toBe(expectedTier);
      }
    }
  });

  it("leaves no region active out in open ocean", () => {
    // Mid-Atlantic, far from anything in the registry.
    world.moveTo(geo(0, -30));
    expect(world.activeRegionId).toBeNull();
    expect(world.activeRegions()).toEqual([]);
  });

  it("drops a city back to strategic once the player leaves its reach", () => {
    world.teleportTo("tokyo");
    const tokyo = world.definitionFor("tokyo")!;

    // Offset in metres on the scaled globe rather than in real-world degrees:
    // at 1/50 scale a couple of hundred real kilometres is still inside the city.
    const away = localToGeo(tokyo.centre, { east: tokyo.radiusMeters * 2, north: 0, up: 0 });
    world.moveTo(away);

    expect(world.activeRegionId).not.toBe("tokyo");
    expect(world.tierOf("tokyo")).toBe("strategic");
  });

  it("keeps region footprints from overlapping, so the active region is never ambiguous", () => {
    const regions = createDefaultRegionRegistry().all();
    // The same reach the active-region test uses, bubble floor included.
    const reach = (radiusMeters: number): number => Math.max(radiusMeters, ACTIVE_BUBBLE_RADIUS_METERS);
    const overlaps: string[] = [];

    for (let i = 0; i < regions.length; i += 1) {
      for (let j = i + 1; j < regions.length; j += 1) {
        const a = regions[i]!;
        const b = regions[j]!;
        const gap = surfaceDistanceMeters(a.centre, b.centre);
        if (gap < reach(a.radiusMeters) + reach(b.radiusMeters)) overlaps.push(`${a.id}/${b.id}`);
      }
    }
    // Shrinking the globe pulls cities together; this guards the scale choice.
    // Tokyo and Vladivostok are the tightest pair at 21 km apart.
    expect(overlaps).toEqual([]);
  });

  it("tracks strategic damage without needing the region to be active", () => {
    const damaged = world.applyRegionDamage("sydney", 0.4, 120);

    expect(damaged.integrity).toBeCloseTo(0.6, 6);
    expect(damaged.safetyRating).toBeCloseTo(0.8, 6);
    expect(world.tierOf("sydney")).toBe("strategic");
  });

  it("clamps damage rather than letting integrity run negative", () => {
    world.applyRegionDamage("manila", 5, 10);
    expect(world.recordFor("manila")?.integrity).toBe(0);
    expect(world.recordFor("manila")?.safetyRating).toBe(0);
  });

  it("refuses damage to a region that does not exist", () => {
    expect(() => world.applyRegionDamage("atlantis", 0.1, 1)).toThrow(/Unknown region/);
  });
});

describe("world snapshots", () => {
  it("round-trips through serialize and restore", () => {
    world.teleportTo("sydney", 90);
    world.applyRegionDamage("tokyo", 0.25, 90);
    const snapshot = JSON.parse(JSON.stringify(world.serialize())) as WorldSnapshot;

    const restored = makeWorld();
    restored.restore(snapshot);

    expect(restored.serialize()).toEqual(snapshot);
    expect(restored.activeRegionId).toBe("sydney");
    expect(restored.recordFor("tokyo")?.integrity).toBeCloseTo(0.75, 6);
  });

  it("gains regions added since the save was written rather than losing them", () => {
    const snapshot = world.serialize();
    const trimmed: WorldSnapshot = {
      ...snapshot,
      regions: snapshot.regions.filter((record) => record.regionId !== "lima"),
    };

    const restored = makeWorld();
    restored.restore(trimmed);

    expect(restored.recordFor("lima")).toBeDefined();
    expect(restored.recordFor("lima")?.integrity).toBe(1);
  });

  it("refuses a snapshot from an unsupported version", () => {
    const snapshot = { ...world.serialize(), schemaVersion: 99 };
    expect(() => world.restore(snapshot)).toThrow(/migration is required/);
  });

  it("refuses a snapshot naming an unknown region or a bad sector", () => {
    const known = new Set(
      createDefaultRegionRegistry()
        .all()
        .map((r) => r.id),
    );
    const base = world.serialize();

    expect(validateWorldSnapshot({ ...base, activeRegionId: "atlantis" }, known).join(" ")).toMatch(
      /not a known region/,
    );
    expect(validateWorldSnapshot({ ...base, activeSectorId: "bogus" }, known).join(" ")).toMatch(
      /Malformed sector id/,
    );
  });

  it("refuses a snapshot claiming two active regions at once", () => {
    const known = new Set(
      createDefaultRegionRegistry()
        .all()
        .map((r) => r.id),
    );
    const base = world.serialize();
    const twoActive: WorldSnapshot = {
      ...base,
      regions: base.regions.map((record, index) =>
        index < 2 ? { ...record, tier: "active" as const } : record,
      ),
    };

    // The whole point of the tiering rule is that this cannot happen.
    expect(validateWorldSnapshot(twoActive, known).join(" ")).toMatch(/only one region may be active/);
  });
});

describe("world state through the save system", () => {
  it("survives a full save and load cycle", async () => {
    const repository = new MemorySaveRepository();
    const service = new SaveService({ repository });
    const kernel = new SimulationKernel({ seed: 4242 });

    world.teleportTo("anchorage", 30);
    world.applyRegionDamage("manila", 0.5, 30);

    await service.save("slot.a", kernel, { name: "World test", world: world.serialize() });
    const loaded = await service.load("slot.a");

    const restored = makeWorld();
    restored.restore(loaded.document.world);

    expect(restored.playerPosition.latitudeDeg).toBeCloseTo(61.2181, 4);
    expect(restored.activeRegionId).toBe("anchorage");
    expect(restored.recordFor("manila")?.integrity).toBeCloseTo(0.5, 6);
    expect(restored.activeSectorId).toBe(world.activeSectorId);
  });

  it("places a migrated version 1 save at the documented start", async () => {
    const repository = new MemorySaveRepository();
    const service = new SaveService({ repository });

    // A version 1 save predates world coordinates entirely.
    const legacy = {
      schemaVersion: 1,
      savedAt: 1_700_000_000_000,
      metadata: {
        name: "Pre-world save",
        worldSeed: 20260819,
        playTimeMs: 60_000,
        lastPlayedAt: 1_700_000_000_000,
        simTick: 600,
        appVersion: "0.3.0",
        thumbnail: null,
      },
      sim: {
        schemaVersion: 1,
        seed: 20260819,
        tick: 600,
        entities: { schemaVersion: 1, nextId: 1, entities: [] },
      },
    };

    const result = await service.importInto("slot.legacy", JSON.stringify(legacy));

    expect(result.migratedFrom).toBe(1);
    expect(result.document.world.activeRegionId).toBe("hong-kong");
    expect(result.document.world.playerPosition.latitudeDeg).toBeCloseTo(22.3193, 4);
    // The simulation it already had must come through untouched.
    expect(result.document.sim.tick).toBe(600);

    const restored = makeWorld();
    restored.restore(result.document.world);
    expect(restored.regionCount).toBe(createDefaultRegionRegistry().all().length);
  });
});
