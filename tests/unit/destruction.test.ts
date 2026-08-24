import { describe, expect, it } from "vitest";
import {
  BUILDING_ARCHETYPES,
  BUILDING_STATES,
  archetypeForDistrict,
  blocksRoutes,
  createBuildingRegistry,
  isDown,
  standingState,
  structureFor,
  validateBuildingArchetype,
} from "../../src/data/buildings";
import {
  DEBRIS_LIFETIME_SECONDS,
  DebrisPool,
  MAX_CHUNKS_PER_COLLAPSE,
  debrisStream,
} from "../../src/world/debris";
import { RegionDestruction, emptyDamageSnapshot, validateDamageSnapshot } from "../../src/world/destruction";
import { buildScenarioLayout } from "../../src/debug/destructionScenario";

const buildings = createBuildingRegistry();
const layout = buildScenarioLayout();

function city(): RegionDestruction {
  return new RegionDestruction({ layout, seed: 4242 });
}

function firstGroup() {
  const group = layout.destructionGroups[0];
  if (!group) throw new Error("The scenario layout has no destruction groups");
  return group;
}

describe("building archetypes", () => {
  it("ships archetypes that all validate", () => {
    for (const archetype of BUILDING_ARCHETYPES) {
      expect(validateBuildingArchetype(archetype), archetype.id).toEqual([]);
    }
  });

  it("covers the whole lifecycle of a building", () => {
    expect(BUILDING_STATES).toEqual([
      "intact",
      "damaged",
      "breached",
      "collapsing",
      "ruined",
      "cleared",
      "rebuilding",
    ]);
  });

  it("refuses an archetype that claims chunks without being fractured", () => {
    const base = buildings.getOrThrow("building.tenement-stack");
    expect(validateBuildingArchetype({ ...base, fractureChunks: 6 }).join(" ")).toMatch(
      /only a fractured archetype may declare chunks/,
    );
    expect(validateBuildingArchetype({ ...base, fractured: true, fractureChunks: 2 }).join(" ")).toMatch(
      /at least four authored chunks/,
    );
  });

  it("refuses an archetype that is cheaper to rebuild than to clear", () => {
    const base = buildings.getOrThrow("building.harbour-tower");
    expect(validateBuildingArchetype({ ...base, rebuildHours: 10 }).join(" ")).toMatch(
      /rebuildHours must exceed clearHours/,
    );
  });

  it("picks an archetype by district rather than by a switch", () => {
    expect(archetypeForDistrict(buildings, "slums").id).toBe("building.tenement-stack");
    expect(archetypeForDistrict(buildings, "docks").id).toBe("building.dock-warehouse");
    // Anything unlisted falls back to the archetype that takes any district.
    expect(archetypeForDistrict(buildings, "hillside").districts).toContain("hillside");
  });

  it("scales structure with height", () => {
    const tower = buildings.getOrThrow("building.harbour-tower");
    expect(structureFor(tower, 200)).toBeGreaterThan(structureFor(tower, 40));
  });

  it("names the standing states from integrity and nothing else", () => {
    expect(standingState(1)).toBe("intact");
    expect(standingState(0.7)).toBe("damaged");
    expect(standingState(0.3)).toBe("breached");
    expect(standingState(0)).toBe("collapsing");
    expect(isDown("ruined")).toBe(true);
    expect(isDown("damaged")).toBe(false);
    expect(blocksRoutes("ruined")).toBe(true);
    expect(blocksRoutes("cleared")).toBe(false);
  });
});

describe("the debris pool", () => {
  it("never grows past its ceiling, however hard it is pushed", () => {
    const pool = new DebrisPool(16);
    const result = pool.spawn({
      east: 0,
      north: 0,
      up: 50,
      groupId: "g",
      count: 200,
      spreadMeters: 40,
      sizeMeters: 4,
      rng: debrisStream(1, "g"),
    });
    expect(result.spawned).toBe(16);
    expect(result.refused).toBe(184);
    expect(pool.live).toBe(16);
    expect(pool.active().length).toBe(16);
  });

  it("freezes what has settled and stops integrating it", () => {
    const pool = new DebrisPool(8);
    pool.spawn({
      east: 0,
      north: 0,
      up: 30,
      groupId: "g",
      count: 8,
      spreadMeters: 20,
      sizeMeters: 3,
      rng: debrisStream(2, "g"),
    });
    expect(pool.simulating).toBe(8);
    for (let step = 0; step < 60 * 12; step += 1) pool.advance(1 / 60, () => 0);
    expect(pool.frozen).toBe(pool.live);
    expect(pool.simulating).toBe(0);
    // Frozen chunks are still there to look at; they simply cost nothing.
    expect(pool.live).toBeGreaterThan(0);
  });

  it("recycles the oldest settled chunk rather than refusing a fresh collapse", () => {
    const pool = new DebrisPool(4);
    pool.spawn({
      east: 0,
      north: 0,
      up: 20,
      groupId: "old",
      count: 4,
      spreadMeters: 10,
      sizeMeters: 2,
      rng: debrisStream(3, "old"),
    });
    for (let step = 0; step < 60 * 8; step += 1) pool.advance(1 / 60, () => 0);
    expect(pool.frozen).toBe(4);

    const fresh = pool.spawn({
      east: 100,
      north: 100,
      up: 20,
      groupId: "new",
      count: 2,
      spreadMeters: 10,
      sizeMeters: 2,
      rng: debrisStream(4, "new"),
    });
    expect(fresh.spawned).toBe(2);
    expect(fresh.recycled).toBe(2);
    expect(pool.live).toBe(4);
  });

  it("expires everything, so a bad launch cannot leak a slot", () => {
    const pool = new DebrisPool(6);
    pool.spawn({
      east: 0,
      north: 0,
      up: 4_000,
      groupId: "g",
      count: 6,
      spreadMeters: 10,
      sizeMeters: 2,
      rng: debrisStream(5, "g"),
    });
    // Thrown so high nothing lands, and still nothing survives its lifetime.
    const steps = Math.ceil((DEBRIS_LIFETIME_SECONDS + 1) * 60);
    for (let step = 0; step < steps; step += 1) pool.advance(1 / 60, () => 0);
    expect(pool.live).toBe(0);
  });

  it("takes its rubble away when a block is cleared", () => {
    const pool = new DebrisPool(10);
    pool.spawn({
      east: 0,
      north: 0,
      up: 10,
      groupId: "a",
      count: 5,
      spreadMeters: 5,
      sizeMeters: 2,
      rng: debrisStream(6, "a"),
    });
    pool.spawn({
      east: 0,
      north: 0,
      up: 10,
      groupId: "b",
      count: 5,
      spreadMeters: 5,
      sizeMeters: 2,
      rng: debrisStream(7, "b"),
    });
    expect(pool.clearGroup("a")).toBe(5);
    expect(pool.live).toBe(5);
  });

  it("throws the same rubble from the same seed", () => {
    const positions = (seed: number): number[] => {
      const pool = new DebrisPool(6);
      pool.spawn({
        east: 0,
        north: 0,
        up: 10,
        groupId: "g",
        count: 6,
        spreadMeters: 30,
        sizeMeters: 3,
        rng: debrisStream(seed, "g"),
      });
      return pool.active().map((chunk) => Math.round(chunk.east * 1000));
    };
    expect(positions(11)).toEqual(positions(11));
    expect(positions(11)).not.toEqual(positions(12));
  });

  it("caps what one collapse may ask for", () => {
    expect(MAX_CHUNKS_PER_COLLAPSE).toBeGreaterThan(4);
    expect(MAX_CHUNKS_PER_COLLAPSE).toBeLessThanOrEqual(64);
  });

  it("refuses a nonsense capacity at construction", () => {
    expect(() => new DebrisPool(0)).toThrow(/positive integer/);
    expect(() => new DebrisPool(2.5)).toThrow(/positive integer/);
  });
});

describe("regional destruction", () => {
  it("starts whole and says so", () => {
    const report = city().report();
    expect(report.integrity).toBe(1);
    expect(report.safety).toBe(1);
    expect(report.summary).toMatch(/whole/);
  });

  it("damages what was hit and leaves the rest of the city alone", () => {
    const destruction = city();
    const group = firstGroup();
    const result = destruction.applyImpact(group.centreEast, group.centreNorth, 200, 200_000);
    expect(result.groupsHit.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/hit/);

    const hit = destruction.group(group.id);
    expect(hit!.integrity).toBeLessThan(1);
    const far = destruction
      .groups()
      .filter((entry) => !result.groupsHit.includes(entry.groupId))
      .every((entry) => entry.integrity === 1);
    expect(far).toBe(true);
  });

  it("brings structures down in whole numbers and leaves rubble in the road", () => {
    const destruction = city();
    const group = firstGroup();
    destruction.applyImpact(group.centreEast, group.centreNorth, 300, 5_000_000);
    const damage = destruction.group(group.id)!;
    expect(Number.isInteger(damage.structuresDown)).toBe(true);
    expect(damage.structuresDown).toBeGreaterThan(0);
    expect(damage.rubble).toBeGreaterThan(0);
    expect(destruction.stateOf(group.id)).toBe("collapsing");
  });

  it("moves a collapse through to rubble on the fight clock", () => {
    const destruction = city();
    const group = firstGroup();
    destruction.applyImpact(group.centreEast, group.centreNorth, 300, 5_000_000);
    expect(destruction.stateOf(group.id)).toBe("collapsing");
    destruction.advanceSeconds(30);
    // Collapsing is a short state. Afterwards it is simply down.
    expect(destruction.stateOf(group.id)).toBe("ruined");
  });

  it("blocks the ground under heavy rubble and opens it again once cleared", () => {
    const destruction = city();
    const group = firstGroup();
    expect(destruction.isPassable(group.centreEast, group.centreNorth)).toBe(true);
    destruction.applyImpact(group.centreEast, group.centreNorth, 300, 9_000_000);
    destruction.advanceSeconds(30);
    expect(destruction.isPassable(group.centreEast, group.centreNorth)).toBe(false);
    destruction.advanceHours(48);
    destruction.startProject(group.id);
    destruction.progressProjects(100_000, { funding: 1_000_000_000 });
    expect(destruction.isPassable(group.centreEast, group.centreNorth)).toBe(true);
  });

  it("burns down and pulls people out over hours, not seconds", () => {
    const destruction = city();
    const group = firstGroup();
    destruction.applyImpact(group.centreEast, group.centreNorth, 300, 9_000_000);
    const afterFight = destruction.report();
    destruction.advanceHours(96);
    const later = destruction.report();
    expect(later.firesBurning).toBeLessThanOrEqual(afterFight.firesBurning);
    expect(later.trappedThousands).toBeLessThan(afterFight.trappedThousands);
    expect(later.rescuePressure).toBeLessThanOrEqual(afterFight.rescuePressure);
  });

  it("refuses to start work with a reason rather than doing nothing", () => {
    const destruction = city();
    const group = firstGroup();
    expect(destruction.startProject(group.id).message).toMatch(/Nothing to clear/);
    expect(destruction.startProject("nowhere").message).toMatch(/no block called/);

    destruction.applyImpact(group.centreEast, group.centreNorth, 300, 9_000_000);
    // Crews do not walk into a fire.
    const burning = destruction.group(group.id)!;
    burning.fire = 0.9;
    expect(destruction.startProject(group.id).message).toMatch(/still burning/);

    burning.fire = 0;
    expect(destruction.startProject(group.id).ok).toBe(true);
    expect(destruction.startProject(group.id).message).toMatch(/already underway/);
  });

  it("clears before it rebuilds, in stages rather than at once", () => {
    const destruction = city();
    const group = firstGroup();
    destruction.applyImpact(group.centreEast, group.centreNorth, 300, 9_000_000);
    destruction.advanceHours(200);
    destruction.startProject(group.id);
    expect(destruction.stateOf(group.id)).toBe("ruined");

    const quote = destruction.quoteProject(group.id);
    expect(quote!.hours).toBeGreaterThan(0);
    expect(quote!.funding).toBeGreaterThan(0);

    // A little work does not finish anything.
    destruction.progressProjects(10, { funding: 1_000_000_000 });
    expect(destruction.group(group.id)!.integrity).toBeLessThan(1);

    let guard = 0;
    while (destruction.activeProjects().length > 0 && guard < 500) {
      destruction.progressProjects(200, { funding: 1_000_000_000 });
      guard += 1;
    }
    expect(destruction.group(group.id)!.integrity).toBe(1);
    expect(destruction.stateOf(group.id)).toBe("intact");
  });

  it("works faster with facilities behind it and slower where it is not secure", () => {
    const spend = (modifiers: Record<string, number>): number => {
      const destruction = city();
      const group = firstGroup();
      destruction.applyImpact(group.centreEast, group.centreNorth, 300, 9_000_000);
      destruction.advanceHours(200);
      destruction.startProject(group.id);
      destruction.progressProjects(50, modifiers);
      return destruction.activeProjects()[0]?.hoursRemaining ?? 0;
    };
    const plain = spend({ facilityBonus: 1, security: 1 });
    const supported = spend({ facilityBonus: 2, security: 1 });
    const unsafe = spend({ facilityBonus: 1, security: 0.4 });
    expect(supported).toBeLessThan(plain);
    expect(unsafe).toBeGreaterThan(plain);
  });

  it("stalls a rebuild that has not been paid for rather than finishing it free", () => {
    const destruction = city();
    const group = firstGroup();
    destruction.applyImpact(group.centreEast, group.centreNorth, 300, 9_000_000);
    destruction.advanceHours(200);
    destruction.startProject(group.id);
    let guard = 0;
    let messages: readonly string[] = [];
    while (guard < 200) {
      messages = destruction.progressProjects(500, { funding: 0 });
      if (messages.some((message) => message.includes("short"))) break;
      guard += 1;
    }
    expect(messages.join(" ")).toMatch(/short/);
    // Unpaid means unfinished: the block is still down.
    expect(destruction.group(group.id)!.integrity).toBeLessThan(1);
  });
});

describe("the saved damage summary", () => {
  it("is empty for a city nobody has touched", () => {
    const snapshot = city().snapshot();
    expect(snapshot.groups).toEqual([]);
    expect(snapshot.landmarks).toEqual([]);
    expect(snapshot.projects).toEqual([]);
    expect(validateDamageSnapshot(snapshot)).toEqual([]);
  });

  it("records only what was damaged, and no scene graph", () => {
    const destruction = city();
    const group = firstGroup();
    destruction.applyImpact(group.centreEast, group.centreNorth, 400, 9_000_000);
    const snapshot = destruction.snapshot();
    expect(snapshot.groups.length).toBeGreaterThan(0);
    expect(snapshot.groups.length).toBeLessThan(layout.destructionGroups.length);
    // Seven numbers a group, and nothing that looks like geometry.
    for (const record of snapshot.groups) {
      expect(Object.keys(record).sort()).toEqual([
        "contamination",
        "down",
        "fire",
        "id",
        "integrity",
        "rubble",
        "trapped",
      ]);
    }
    expect(JSON.stringify(snapshot)).not.toMatch(/mesh|vertex|matrix|transform/i);
  });

  it("comes back the same city", () => {
    const destruction = city();
    const group = firstGroup();
    destruction.applyImpact(group.centreEast, group.centreNorth, 400, 9_000_000);
    destruction.advanceHours(24);
    destruction.startProject(group.id);
    const snapshot = destruction.snapshot();
    const before = destruction.report();

    const restored = city();
    restored.restore(snapshot);
    const after = restored.report();
    expect(after.integrity).toBeCloseTo(before.integrity, 3);
    expect(after.groupsDamaged).toBe(before.groupsDamaged);
    expect(restored.activeProjects().length).toBe(destruction.activeProjects().length);
  });

  it("drops a block this build has never heard of rather than resurrecting it", () => {
    const restored = city();
    restored.restore({
      ...emptyDamageSnapshot("hong-kong"),
      groups: [
        { id: "nowhere.group.9.9", integrity: 0, down: 5, fire: 1, contamination: 1, rubble: 1, trapped: 9 },
      ],
    });
    expect(restored.report().groupsDamaged).toBe(0);
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateDamageSnapshot(null).length).toBeGreaterThan(0);
    expect(validateDamageSnapshot({ schemaVersion: 99 }).length).toBeGreaterThan(0);
    expect(
      validateDamageSnapshot({
        ...emptyDamageSnapshot("hong-kong"),
        groups: [{ id: "g", integrity: 4, fire: 0, contamination: 0, rubble: 0, down: 0, trapped: 0 }],
      }).join(" "),
    ).toMatch(/within \[0, 1\]/);
  });
});
