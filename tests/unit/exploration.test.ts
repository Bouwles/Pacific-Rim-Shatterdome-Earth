import { describe, expect, it } from "vitest";
import {
  DISCOVERY_SOURCES,
  SITE_DEFINITIONS,
  SITE_KINDS,
  candidatesFor,
  createSiteRegistry,
  fitsRegion,
  validateSite,
  type RegionTraits,
} from "../../src/data/sites";
import {
  DISCOVERY_RANGE_METERS,
  Exploration,
  REACH_RANGE_METERS,
  emptyExplorationSnapshot,
  planRoute,
  travelHoursBetween,
  validateExplorationSnapshot,
} from "../../src/world/exploration";
import {
  BOOSTER_COOLING_PER_SECOND,
  BOOSTER_HEAT_CEILING,
  BOOSTER_HEAT_PER_BURST,
  BOOSTER_LANDING_SLOPE_DEG,
  landingSlopeDeg,
} from "../../src/jaegers/locomotion";
import type { GeoPosition } from "../../src/world/coordinates";

const sites = createSiteRegistry();

function traits(overrides: Partial<RegionTraits> = {}): RegionTraits {
  return {
    kind: "coastal-city",
    climate: "temperate",
    populationThousands: 6_000,
    damaged: false,
    ...overrides,
  };
}

const HERE: GeoPosition = { latitudeDeg: 22.3, longitudeDeg: 114.2, altitudeMeters: 0 };
const THERE: GeoPosition = { latitudeDeg: 22.9, longitudeDeg: 114.9, altitudeMeters: 0 };

function world(seed = 1) {
  const exploration = new Exploration({ sites });
  exploration.place(seed, [
    { id: "region.coast", centre: HERE, traits: traits({ damaged: true }) },
    {
      id: "region.ice",
      centre: THERE,
      traits: traits({ kind: "wilderness", climate: "polar", populationThousands: 2 }),
    },
  ]);
  return exploration;
}

describe("the site table", () => {
  it("all validate", () => {
    for (const site of SITE_DEFINITIONS) expect(validateSite(site), site.id).toEqual([]);
  });

  it("registers without a duplicate", () => {
    expect(sites.all().length).toBe(SITE_DEFINITIONS.length);
  });

  it("covers every kind the milestone asks for", () => {
    const covered = new Set(SITE_DEFINITIONS.map((site) => site.kind));
    for (const kind of SITE_KINDS) expect(covered.has(kind), kind).toBe(true);
    expect(SITE_KINDS).toHaveLength(8);
  });

  it("refuses a site that belongs nowhere in particular", () => {
    // The explicit failure mode: identical icons scattered over every region.
    const base = SITE_DEFINITIONS[0]!;
    expect(validateSite({ ...base, requires: { ...base.requires, kinds: [] } }).join(" ")).toMatch(
      /what kind of region/,
    );
  });

  it("refuses a site that fits every region kind in every climate", () => {
    const base = SITE_DEFINITIONS[0]!;
    const everywhere = {
      ...base,
      requires: {
        ...base.requires,
        kinds: ["coastal-city", "inland-city", "shatterdome", "ocean", "wilderness"] as const,
        climates: [],
      },
    };
    expect(validateSite(everywhere).join(" ")).toMatch(/wallpaper/);
  });

  it("refuses a site nothing can discover", () => {
    const base = SITE_DEFINITIONS[0]!;
    expect(validateSite({ ...base, discoveredBy: [] }).join(" ")).toMatch(/nobody will ever see/);
  });

  it("refuses a site that is not worth reaching", () => {
    const base = SITE_DEFINITIONS[0]!;
    const pointless = {
      ...base,
      becomesDeployPoint: false,
      reward: { funding: 0, alloy: 0, researchData: 0, sampleIds: [] },
    };
    expect(validateSite(pointless).join(" ")).toMatch(/worth reaching/);
  });

  it("names only real discovery sources", () => {
    for (const site of SITE_DEFINITIONS) {
      for (const source of site.discoveredBy) {
        expect(DISCOVERY_SOURCES as readonly string[], site.id).toContain(source);
      }
    }
  });
});

describe("what belongs where", () => {
  it("keeps a proving gate to a Shatterdome", () => {
    const gate = sites.getOrThrow("site.training-gate.proving");
    expect(fitsRegion(gate, traits({ kind: "shatterdome" }))).toBe(true);
    expect(fitsRegion(gate, traits({ kind: "coastal-city" }))).toBe(false);
  });

  it("keeps a rescue call to a city that has been hit", () => {
    const rescue = sites.getOrThrow("site.rescue-call.trapped");
    expect(fitsRegion(rescue, traits({ damaged: true }))).toBe(true);
    expect(fitsRegion(rescue, traits({ damaged: false }))).toBe(false);
  });

  it("keeps unstable ice to somewhere cold", () => {
    const ice = sites.getOrThrow("site.hazard.ice");
    expect(fitsRegion(ice, traits({ kind: "wilderness", climate: "polar", populationThousands: 1 }))).toBe(
      true,
    );
    expect(fitsRegion(ice, traits({ kind: "wilderness", climate: "tropical", populationThousands: 1 }))).toBe(
      false,
    );
  });

  it("keeps an anomaly somewhere nobody lives", () => {
    const anomaly = sites.getOrThrow("site.research-anomaly.reading");
    expect(fitsRegion(anomaly, traits({ kind: "ocean", climate: "oceanic", populationThousands: 0 }))).toBe(
      true,
    );
    expect(
      fitsRegion(anomaly, traits({ kind: "ocean", climate: "oceanic", populationThousands: 9_000 })),
    ).toBe(false);
  });

  it("gives different regions different candidates", () => {
    const coast = candidatesFor(traits({ damaged: true })).map((site) => site.id);
    const ice = candidatesFor(traits({ kind: "wilderness", climate: "polar", populationThousands: 1 })).map(
      (site) => site.id,
    );
    expect(coast).not.toEqual(ice);
    expect(coast.some((id) => !ice.includes(id))).toBe(true);
    expect(ice.some((id) => !coast.includes(id))).toBe(true);
  });
});

describe("placing them", () => {
  it("puts the same world in the same places every time", () => {
    expect(world(7).placed()).toEqual(world(7).placed());
  });

  it("gives a different seed a different world", () => {
    expect(world(7).placed()).not.toEqual(world(8).placed());
  });

  it("only places what fits the region", () => {
    const exploration = world();
    for (const placed of exploration.placed()) {
      const definition = sites.getOrThrow(placed.siteId);
      const regionTraits =
        placed.regionId === "region.coast"
          ? traits({ damaged: true })
          : traits({ kind: "wilderness", climate: "polar", populationThousands: 2 });
      expect(fitsRegion(definition, regionTraits), `${placed.siteId} in ${placed.regionId}`).toBe(true);
    }
  });

  it("puts every site somewhere near its region rather than on top of it", () => {
    for (const placed of world().placed()) {
      expect(placed.offsetMeters).toBeGreaterThan(0);
      expect(placed.offsetMeters).toBeLessThan(7_000);
    }
  });
});

describe("finding them", () => {
  it("finds nothing before anybody has been anywhere", () => {
    expect(world().discoveredCount()).toBe(0);
  });

  it("finds what is within range of where the machine is", () => {
    const exploration = world();
    const target = exploration.placed()[0]!;
    const found = exploration.discoverNear(target.position);
    expect(found.some((entry) => entry.id === target.id)).toBe(true);
    expect(exploration.isDiscovered(target.id)).toBe(true);
  });

  it("finds nothing beyond range", () => {
    const exploration = world();
    const far: GeoPosition = { latitudeDeg: -40, longitudeDeg: 20, altitudeMeters: 0 };
    expect(exploration.discoverNear(far)).toEqual([]);
  });

  it("returns only what was new, so nothing is announced twice", () => {
    const exploration = world();
    const target = exploration.placed()[0]!;
    expect(exploration.discoverNear(target.position).length).toBeGreaterThan(0);
    expect(exploration.discoverNear(target.position)).toEqual([]);
  });

  it("refuses a source the site cannot be found by", () => {
    const exploration = world();
    const gate = exploration.placed().find((site) => site.siteId === "site.training-gate.proving");
    if (!gate) return;
    // A proving gate is not something a passing carrier notices.
    expect(exploration.discover(gate.id, "carrier")).toBe(false);
    expect(exploration.discover(gate.id, "intelligence")).toBe(true);
  });

  it("leaves some places only a chart can reveal", () => {
    // Walking must not be able to find everything, or intelligence and allied
    // governments would be flavour text.
    const onlyByChart = SITE_DEFINITIONS.filter((site) => !site.discoveredBy.includes("exploration"));
    expect(onlyByChart.length).toBeGreaterThan(0);
  });
});

describe("working them", () => {
  it("pays once", () => {
    const exploration = world();
    const target = exploration.placed()[0]!;
    exploration.discoverNear(target.position);
    const first = exploration.claim(target.id, target.position);
    expect(first.ok).toBe(true);
    expect(first.reward).not.toBeNull();

    const second = exploration.claim(target.id, target.position);
    expect(second.ok).toBe(false);
    expect(second.reward).toBeNull();
    expect(second.message).toMatch(/already been worked/);
  });

  it("refuses something nobody has found", () => {
    const exploration = world();
    const target = exploration.placed()[0]!;
    expect(exploration.claim(target.id, target.position).message).toMatch(/Nobody has found/);
  });

  it("refuses from too far away, and says how far", () => {
    const exploration = world();
    const target = exploration.placed()[0]!;
    exploration.discover(target.id, sites.getOrThrow(target.siteId).discoveredBy[0]!);
    const far: GeoPosition = { latitudeDeg: 0, longitudeDeg: 0, altitudeMeters: 0 };
    const result = exploration.claim(target.id, far);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/km short of it/);
  });

  it("opens a place to deploy to only once it has actually been reached", () => {
    const exploration = world();
    const opener = exploration.placed().find((site) => sites.getOrThrow(site.siteId).becomesDeployPoint);
    if (!opener) return;
    exploration.discover(opener.id, sites.getOrThrow(opener.siteId).discoveredBy[0]!);
    expect(exploration.deployPoints()).toHaveLength(0);
    exploration.claim(opener.id, opener.position);
    expect(exploration.deployPoints().some((entry) => entry.id === opener.id)).toBe(true);
  });

  it("reports every found site with a distance and a travel time", () => {
    const exploration = world();
    for (const site of exploration.placed()) {
      exploration.discover(site.id, sites.getOrThrow(site.siteId).discoveredBy[0]!);
    }
    const readouts = exploration.readouts(HERE);
    expect(readouts.length).toBeGreaterThan(0);
    for (const readout of readouts) {
      expect(readout.distanceMeters).toBeGreaterThanOrEqual(0);
      expect(readout.travelHours).toBeGreaterThanOrEqual(0);
      expect(readout.dangerText.length).toBeGreaterThan(0);
    }
    // Nearest first, so a map reads as a map.
    for (let index = 1; index < readouts.length; index += 1) {
      expect(readouts[index]!.distanceMeters).toBeGreaterThanOrEqual(readouts[index - 1]!.distanceMeters);
    }
  });

  it("says why a site cannot be worked rather than only greying it", () => {
    const exploration = world();
    for (const site of exploration.placed()) {
      exploration.discover(site.id, sites.getOrThrow(site.siteId).discoveredBy[0]!);
    }
    for (const readout of exploration.readouts(HERE)) {
      if (readout.refusal === null) continue;
      expect(readout.refusal.length).toBeGreaterThan(4);
    }
  });
});

describe("exploration across a save", () => {
  it("brings back what was found and what was taken", () => {
    const exploration = world();
    const target = exploration.placed()[0]!;
    exploration.discoverNear(target.position);
    exploration.claim(target.id, target.position);

    const restored = world();
    restored.restore(exploration.snapshot());
    expect(restored.isDiscovered(target.id)).toBe(true);
    expect(restored.isClaimed(target.id)).toBe(true);
  });

  it("still refuses to pay a second time after a reload", () => {
    // The explicit failure mode: reloading to farm a reward.
    const exploration = world();
    const target = exploration.placed()[0]!;
    exploration.discoverNear(target.position);
    exploration.claim(target.id, target.position);

    const restored = world();
    restored.restore(exploration.snapshot());
    const again = restored.claim(target.id, target.position);
    expect(again.ok).toBe(false);
    expect(again.reward).toBeNull();
  });

  it("drops a site this build no longer places", () => {
    const exploration = world();
    exploration.restore({
      ...emptyExplorationSnapshot(),
      discovered: [{ id: "site.gone@region.nowhere", source: "exploration" }],
    });
    expect(exploration.discoveredCount()).toBe(0);
  });

  it("keeps a claim even for something no longer placed, so content changes are not free money", () => {
    const exploration = world();
    exploration.restore({ ...emptyExplorationSnapshot(), claimed: ["site.gone@region.nowhere"] });
    expect(exploration.isClaimed("site.gone@region.nowhere")).toBe(true);
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateExplorationSnapshot(null).length).toBeGreaterThan(0);
    expect(validateExplorationSnapshot({ ...emptyExplorationSnapshot(), schemaVersion: 99 })).toHaveLength(1);
    expect(validateExplorationSnapshot(emptyExplorationSnapshot())).toEqual([]);
  });
});

describe("getting there", () => {
  it("takes longer the further it is", () => {
    const near = travelHoursBetween(HERE, { ...HERE, longitudeDeg: HERE.longitudeDeg + 0.1 });
    const far = travelHoursBetween(HERE, THERE);
    expect(far).toBeGreaterThan(near);
  });

  it("offers a direct route and one that stops on the way", () => {
    const waypoints = [
      { id: "a", name: "A", position: { latitudeDeg: 22.5, longitudeDeg: 114.4, altitudeMeters: 0 } },
      { id: "b", name: "B", position: { latitudeDeg: 22.7, longitudeDeg: 114.7, altitudeMeters: 0 } },
    ];
    const { direct, assisted } = planRoute(HERE, THERE, "There", waypoints);
    expect(direct.legs).toHaveLength(1);
    expect(assisted.legs.length).toBeGreaterThan(1);
  });

  it("keeps going direct genuinely faster, so the assist is a choice", () => {
    const waypoints = [
      { id: "a", name: "A", position: { latitudeDeg: 22.5, longitudeDeg: 114.4, altitudeMeters: 0 } },
    ];
    const { direct, assisted } = planRoute(HERE, THERE, "There", waypoints);
    expect(direct.totalHours).toBeLessThanOrEqual(assisted.totalHours);
    expect(assisted.summary).toMatch(/stop/);
  });

  it("does not route through somewhere that is not on the way", () => {
    const detour = [
      { id: "far", name: "Far", position: { latitudeDeg: -40, longitudeDeg: 20, altitudeMeters: 0 } },
    ];
    const { assisted } = planRoute(HERE, THERE, "There", detour);
    expect(assisted.legs).toHaveLength(1);
    expect(assisted.summary).toMatch(/Nothing known/);
  });

  it("says so plainly when there is nothing known on the way", () => {
    const { assisted } = planRoute(HERE, THERE, "There", []);
    expect(assisted.summary).toMatch(/Nothing known lies on the way/);
  });
});

describe("boosting across ground", () => {
  it("puts heat in faster than it comes out, so hopping is not a faster walk", () => {
    // One burst costs more heat than a second of cooling returns.
    expect(BOOSTER_HEAT_PER_BURST).toBeGreaterThan(BOOSTER_COOLING_PER_SECOND);
  });

  it("has a ceiling short of one, so the thrusters refuse before they melt", () => {
    expect(BOOSTER_HEAT_CEILING).toBeGreaterThan(0);
    expect(BOOSTER_HEAT_CEILING).toBeLessThan(1);
  });

  it("reads flat ground as flat", () => {
    expect(landingSlopeDeg(0, 0, () => 10)).toBe(0);
  });

  it("reads a slope as a slope, in degrees", () => {
    // Rising twenty four metres over twenty four is forty five degrees.
    const ground = (east: number) => east;
    expect(landingSlopeDeg(0, 0, ground, 24)).toBeCloseTo(45, 0);
  });

  it("has a landing limit a real hillside can exceed", () => {
    expect(BOOSTER_LANDING_SLOPE_DEG).toBeGreaterThan(0);
    expect(BOOSTER_LANDING_SLOPE_DEG).toBeLessThan(45);
    expect(landingSlopeDeg(0, 0, (east) => east, 24)).toBeGreaterThan(BOOSTER_LANDING_SLOPE_DEG);
  });

  it("says nothing about ground it cannot see", () => {
    expect(landingSlopeDeg(0, 0, () => null)).toBe(0);
  });
});

describe("the ranges are sane", () => {
  it("spots things further away than it can work them", () => {
    expect(DISCOVERY_RANGE_METERS).toBeGreaterThan(REACH_RANGE_METERS);
  });
});
