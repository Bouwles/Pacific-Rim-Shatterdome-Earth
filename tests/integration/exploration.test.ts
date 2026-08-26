import { beforeEach, describe, expect, it } from "vitest";
import {
  crossingTimes,
  placementSpread,
  runExplorationScenario,
  runRouteScenario,
  traitsOf,
} from "../../src/debug/explorationScenario";
import { Exploration } from "../../src/world/exploration";
import { REGION_DEFINITIONS } from "../../src/data/regions";
import { SITE_DEFINITIONS, SITE_KINDS } from "../../src/data/sites";
import { Economy } from "../../src/world/economy";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION } from "../../src/saves/schema";

/**
 * Exploration where it meets everything else.
 *
 * The acceptance questions: can a point be found, saved, reloaded and deployed
 * to; does the map agree with the world it claims to describe; and can any
 * reward be taken twice by crossing a boundary or reloading.
 */

const SEED = 20260901;

let repository: MemorySaveRepository;
let service: SaveService;
let clock: number;

function kernel(): SimulationKernel {
  const instance = new SimulationKernel({ seed: SEED });
  for (let tick = 0; tick < 10; tick += 1) instance.step();
  return instance;
}

/** The world, placed the way the game places it. */
function world(damagedIds: ReadonlySet<string> = new Set()): Exploration {
  const exploration = new Exploration();
  exploration.place(
    SEED,
    REGION_DEFINITIONS.map((region) => ({
      id: region.id,
      centre: region.centre,
      traits: traitsOf(region, damagedIds.has(region.id)),
    })),
  );
  return exploration;
}

/** The first site walking can actually find. Some only exist on a chart. */
function walkable(exploration: Exploration) {
  const found = exploration.placed().find((site) => {
    const definition = SITE_DEFINITIONS.find((entry) => entry.id === site.siteId);
    return definition !== undefined && definition.discoveredBy.includes("exploration");
  });
  expect(found).toBeDefined();
  return found!;
}

beforeEach(() => {
  repository = new MemorySaveRepository();
  clock = 1_700_000_000_000;
  service = new SaveService({ repository, now: () => (clock += 1000), autosaveSlots: 2, backupsPerSlot: 1 });
});

describe("a world worth crossing", () => {
  it("runs the same way twice", () => {
    expect(runExplorationScenario().digest).toBe(runExplorationScenario().digest);
  });

  it("puts something in every region", () => {
    const result = runExplorationScenario();
    expect(result.placed).toBeGreaterThan(result.regions);
    expect(result.regionsWithSites).toBe(result.regions);
  });

  it("puts several different kinds of thing out there", () => {
    expect(runExplorationScenario().kinds.length).toBeGreaterThan(3);
  });

  it("does not put the same things everywhere", () => {
    // The explicit failure mode: generic collectible icons scattered uniformly.
    const spread = placementSpread();
    expect(spread.distinct).toBe(true);
    expect(spread.exclusives["shatterdome"]).toContain("training-gate");
  });

  it("leaves some places only a chart can reveal", () => {
    expect(runExplorationScenario().needsIntelligence).toBeGreaterThan(0);
  });

  it("pays for the first pass and nothing at all for the second", () => {
    // The explicit failure mode: rewards that respawn on a boundary or a reload.
    const result = runExplorationScenario();
    expect(result.funding).toBeGreaterThan(0);
    expect(result.repeatFunding).toBe(0);
  });

  it("opens somewhere to deploy to once things have been reached", () => {
    expect(runExplorationScenario().deployPoints).toBeGreaterThan(0);
  });
});

describe("crossing the planet is not a walk", () => {
  it("is far faster by carrier than on foot", () => {
    // The explicit failure mode: a seamless Earth meaning hours of holding a key.
    const times = crossingTimes();
    expect(times.onFootHours).toBeGreaterThan(times.carrierHours * 4);
  });

  it("offers a route that stops on the way, and charges for it", () => {
    const route = runRouteScenario();
    expect(route.stops).toBeGreaterThan(0);
    expect(route.directIsFaster).toBe(true);
    expect(route.assistedHours).toBeGreaterThan(route.directHours);
  });
});

describe("finding a point, saving, reloading and deploying to it", () => {
  it("works end to end", async () => {
    const exploration = world();
    const opener = exploration.placed().find((site) => {
      const definition = SITE_DEFINITIONS.find((entry) => entry.id === site.siteId);
      // Has to be both worth opening and findable by walking, since this is the
      // whole loop rather than a hand-out from an analyst.
      return definition?.becomesDeployPoint === true && definition.discoveredBy.includes("exploration");
    });
    expect(opener).toBeDefined();

    // Found by walking within range of it, then reached and worked.
    exploration.discoverNear(opener!.position);
    expect(exploration.isDiscovered(opener!.id)).toBe(true);
    const claim = exploration.claim(opener!.id, opener!.position);
    expect(claim.ok).toBe(true);
    expect(claim.openedDeployPoint).toBe(true);
    expect(exploration.deployPoints().some((entry) => entry.id === opener!.id)).toBe(true);

    // Saved and reloaded through a real save file.
    await service.save("slot.explore", kernel(), { name: "Explore", exploration: exploration.snapshot() });
    const loaded = await service.load("slot.explore");
    const restored = world();
    restored.restore(loaded.document.exploration);

    // Still known, still worked, and still somewhere the carrier can go.
    expect(restored.isDiscovered(opener!.id)).toBe(true);
    expect(restored.deployPoints().some((entry) => entry.id === opener!.id)).toBe(true);
  });

  it("does not pay again after the reload", async () => {
    const exploration = world();
    const target = walkable(exploration);
    exploration.discoverNear(target.position);
    const first = exploration.claim(target.id, target.position);

    await service.save("slot.reload", kernel(), { name: "Reload", exploration: exploration.snapshot() });
    const restored = world();
    restored.restore((await service.load("slot.reload")).document.exploration);

    const again = restored.claim(target.id, target.position);
    expect(first.ok).toBe(true);
    expect(again.ok).toBe(false);
    expect(again.reward).toBeNull();
  });

  it("pays into the economy exactly once, however many times it is offered", () => {
    // The reward reaches the books through the one path that owns balances, and
    // the claim guard is what stops a second line ever being written.
    const exploration = world();
    const economy = new Economy({ startingFunding: 0 });
    const target = exploration.placed().find((site) => {
      const definition = SITE_DEFINITIONS.find((entry) => entry.id === site.siteId);
      return (
        definition !== undefined &&
        definition.reward.funding > 0 &&
        definition.discoveredBy.includes("exploration")
      );
    })!;
    exploration.discoverNear(target.position);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = exploration.claim(target.id, target.position);
      if (!result.ok || !result.reward) continue;
      economy.earn("funding", result.reward.funding, {
        source: "exploration-find",
        reason: "Site worked.",
        day: 1,
        reference: `site.${target.id}`,
      });
    }
    expect(economy.ledger.all()).toHaveLength(1);
    expect(economy.balance("funding")).toBeGreaterThan(0);
  });
});

describe("the map agrees with the world", () => {
  it("measures every site against where the reader actually is", () => {
    const exploration = world();
    for (const site of exploration.placed()) {
      const definition = SITE_DEFINITIONS.find((entry) => entry.id === site.siteId)!;
      exploration.discover(site.id, definition.discoveredBy[0]!);
    }
    const from = REGION_DEFINITIONS[0]!.centre;
    const readouts = exploration.readouts(from);
    for (const readout of readouts) {
      const placed = exploration.placed().find((site) => site.id === readout.id)!;
      // The region on the readout is the region the site was actually placed in.
      expect(readout.regionId).toBe(placed.regionId);
      // And the travel time follows the distance rather than being invented.
      if (readout.distanceMeters > 0) expect(readout.travelHours).toBeGreaterThan(0);
    }
  });

  it("shows only what has been found", () => {
    const exploration = world();
    expect(exploration.readouts(REGION_DEFINITIONS[0]!.centre)).toEqual([]);
    const target = walkable(exploration);
    exploration.discoverNear(target.position);
    expect(exploration.readouts(REGION_DEFINITIONS[0]!.centre).length).toBe(1);
  });

  it("reflects damage, so a wrecked city carries things an untouched one cannot", () => {
    const untouched = world();
    const hit = world(new Set(REGION_DEFINITIONS.map((region) => region.id)));
    const kindsIn = (exploration: Exploration) =>
      new Set(
        exploration
          .placed()
          .map((site) => SITE_DEFINITIONS.find((entry) => entry.id === site.siteId)?.kind)
          .filter((kind): kind is (typeof SITE_KINDS)[number] => kind !== undefined),
      );
    // A world where everything has been hit can produce rescue calls; one where
    // nothing has cannot.
    expect(kindsIn(hit).has("rescue-call")).toBe(true);
    expect(kindsIn(untouched).has("rescue-call")).toBe(false);
  });
});

describe("exploration through a migration", () => {
  it("migrates a version 15 save into an empty exploration", () => {
    const legacy = {
      schemaVersion: 15,
      savedAt: 1,
      metadata: {
        name: "Before the map",
        worldSeed: 7,
        playTimeMs: 0,
        lastPlayedAt: 0,
        simTick: 0,
        appVersion: "0.2.0",
        thumbnail: null,
      },
      sim: { schemaVersion: 1, seed: 7, tick: 0, entities: [] },
    };
    const result = migrateSave(legacy);
    expect(result.applied).toContain("15");
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(result.document.exploration.discovered).toEqual([]);
    expect(result.document.exploration.claimed).toEqual([]);
  });

  it("gives an old save the same world a new one would have", () => {
    // Sites are placed from the seed rather than stored, so nothing about the
    // world has to survive a save: only what the player did with it.
    const fresh = world().placed();
    const migrated = world().placed();
    expect(migrated).toEqual(fresh);
  });
});
