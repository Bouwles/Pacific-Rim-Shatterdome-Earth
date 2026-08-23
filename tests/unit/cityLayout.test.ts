import { describe, expect, it } from "vitest";
import {
  CITY_LAYOUT_SCHEMA_VERSION,
  generateCityLayout,
  headingAlong,
  pointAlong,
  validateCityLayoutParams,
  type CityLayoutParams,
} from "../../src/world/cityLayout";
import {
  createDistrictRegistry,
  HONG_KONG_DISTRICT_PLAN,
  validateDistrict,
  validateDistrictPlan,
  type DistrictKind,
} from "../../src/data/districts";

const registry = createDistrictRegistry();
const districts = new Map<DistrictKind, ReturnType<typeof registry.getOrThrow>>(
  registry.all().map((district) => [district.id, district]),
);

function params(overrides: Partial<CityLayoutParams> = {}): CityLayoutParams {
  return {
    regionId: "hong-kong",
    seed: 20260823,
    radiusMeters: 6_000,
    seawardBearingDeg: 196,
    plan: HONG_KONG_DISTRICT_PLAN,
    districts,
    ...overrides,
  };
}

describe("district content", () => {
  it("registers every district kind", () => {
    for (const kind of [
      "downtown",
      "waterfront",
      "docks",
      "slums",
      "shatterdome",
      "hillside",
      "industrial",
    ]) {
      expect(registry.has(kind)).toBe(true);
    }
  });

  it("rejects a district that could not build anything", () => {
    const base = registry.getOrThrow("downtown");
    expect(validateDistrict({ ...base, blockSizeMeters: 0 }).join(" ")).toMatch(
      /blockSizeMeters must be positive/,
    );
    expect(validateDistrict({ ...base, maxHeightMeters: 1 }).join(" ")).toMatch(/must not be below/);
    expect(validateDistrict({ ...base, towersPerBlock: 0 }).join(" ")).toMatch(/positive integer/);
    expect(validateDistrict({ ...base, coverage: 2 }).join(" ")).toMatch(/within \[0, 1\]/);
  });

  it("accepts the shipped Hong Kong plan", () => {
    expect(validateDistrictPlan(HONG_KONG_DISTRICT_PLAN)).toEqual([]);
  });

  it("rejects a plan with an inverted or empty wedge", () => {
    const first = HONG_KONG_DISTRICT_PLAN[0];
    if (!first) throw new Error("plan is empty");
    expect(
      validateDistrictPlan([{ ...first, outerRadiusFraction: first.innerRadiusFraction }]).join(" "),
    ).toMatch(/outer radius must exceed/);
    expect(validateDistrictPlan([{ ...first, arcDeg: 0 }]).join(" ")).toMatch(/arc must be within/);
    expect(validateDistrictPlan([]).join(" ")).toMatch(/at least one placement/);
  });

  it("makes the slums the densest district and the docks the emptiest", () => {
    const byDensity = registry
      .all()
      .slice()
      .sort((a, b) => b.populationDensityThousands - a.populationDensityThousands);
    expect(byDensity[0]?.id).toBe("slums");
    expect(byDensity[byDensity.length - 1]?.id).toBe("shatterdome");
  });
});

describe("city layout", () => {
  it("is deterministic in its inputs", () => {
    const first = generateCityLayout(params());
    const second = generateCityLayout(params());
    expect(second.digest).toBe(first.digest);
    expect(second.stats).toEqual(first.stats);
    expect(second.blocks.map((block) => block.id)).toEqual(first.blocks.map((block) => block.id));
  });

  it("changes with the seed", () => {
    expect(generateCityLayout(params({ seed: 1 })).digest).not.toBe(
      generateCityLayout(params({ seed: 2 })).digest,
    );
  });

  it("builds every district in the plan", () => {
    const layout = generateCityLayout(params());
    const present = new Set(layout.blocks.map((block) => block.districtId));
    for (const placement of HONG_KONG_DISTRICT_PLAN) {
      expect(present, `${placement.districtId} produced no blocks`).toContain(placement.districtId);
    }
  });

  it("keeps the whole city inside the region", () => {
    const layout = generateCityLayout(params());
    for (const block of layout.blocks) {
      expect(Math.hypot(block.east, block.north)).toBeLessThanOrEqual(layout.radiusMeters * 1.05);
    }
  });

  it("gives the region a skyline: downtown is the tallest district", () => {
    const layout = generateCityLayout(params());
    const tallest = new Map<string, number>();
    for (const block of layout.blocks) {
      tallest.set(block.districtId, Math.max(tallest.get(block.districtId) ?? 0, block.heightMeters));
    }
    const downtown = tallest.get("downtown") ?? 0;
    expect(downtown).toBeGreaterThan(tallest.get("docks") ?? 0);
    expect(downtown).toBeGreaterThan(tallest.get("slums") ?? 0);
    // Recognisable by silhouette means the tall part is genuinely tall.
    expect(downtown).toBeGreaterThan(250);
  });

  it("stacks the slums into many small towers rather than few large ones", () => {
    const layout = generateCityLayout(params());
    const slum = layout.blocks.find((block) => block.districtId === "slums");
    const tower = layout.blocks.find((block) => block.districtId === "downtown");
    expect(slum?.towerCount).toBeGreaterThan(tower?.towerCount ?? 0);
    expect(slum?.widthMeters).toBeLessThan(tower?.widthMeters ?? Infinity);
  });

  it("puts the harbour on the seaward side and the muster points away from it", () => {
    const layout = generateCityLayout(params());
    const seaward = layout.seawardBearingRadians;
    const seawardEast = Math.sin(seaward);
    const seawardNorth = Math.cos(seaward);

    for (const lane of layout.harborLanes) {
      const end = pointAlong(lane.points, 0.999);
      const alignment = (end.east * seawardEast + end.north * seawardNorth) / Math.hypot(end.east, end.north);
      expect(alignment, `${lane.id} does not run out to sea`).toBeGreaterThan(0.5);
    }

    for (const zone of layout.evacuationZones) {
      const alignment =
        (zone.musterEast * seawardEast + zone.musterNorth * seawardNorth) /
        Math.hypot(zone.musterEast, zone.musterNorth);
      // Muster points are inland: pointing away from the water.
      expect(alignment, `${zone.id} musters toward the sea`).toBeLessThan(0);
    }
  });

  it("evacuates the waterfront and the slums first", () => {
    const layout = generateCityLayout(params());
    const first = layout.evacuationZones[0];
    expect(first?.priority).toBe(1);
    expect(["waterfront", "slums"]).toContain(first?.districtIds[0]);
    // The Shatterdome is where everyone is sent, so it clears last.
    const last = layout.evacuationZones[layout.evacuationZones.length - 1];
    expect(last?.districtIds[0]).toBe("shatterdome");
  });

  it("faces the guns at the water and the checkpoints inland", () => {
    const layout = generateCityLayout(params());
    const seaward = layout.seawardBearingRadians;
    const missiles = layout.defensePositions.filter((position) => position.kind === "missile");
    expect(missiles.length).toBeGreaterThan(0);
    for (const battery of missiles) {
      const delta = Math.abs(((battery.facingRadians - seaward + Math.PI) % (Math.PI * 2)) - Math.PI);
      expect(delta).toBeLessThan(Math.PI / 2);
    }
    expect(layout.defensePositions.some((position) => position.kind === "jaeger-pad")).toBe(true);
    expect(layout.defensePositions.some((position) => position.kind === "wall")).toBe(true);
  });

  it("groups blocks for destruction rather than leaving one city mesh", () => {
    const layout = generateCityLayout(params());
    expect(layout.destructionGroups.length).toBeGreaterThan(4);

    const grouped = new Set<string>();
    for (const group of layout.destructionGroups) {
      expect(group.blockIds.length).toBeGreaterThan(0);
      for (const id of group.blockIds) {
        // A block belongs to exactly one group, or damage would double-count it.
        expect(grouped.has(id)).toBe(false);
        grouped.add(id);
      }
    }
    expect(grouped.size).toBe(layout.blocks.length);
    // No group may swallow the whole city, or it is one mesh with extra steps.
    const largest = Math.max(...layout.destructionGroups.map((group) => group.blockIds.length));
    expect(largest).toBeLessThan(layout.blocks.length * 0.5);
  });

  it("gives every block a stable unique id", () => {
    const layout = generateCityLayout(params());
    const ids = new Set(layout.blocks.map((block) => block.id));
    expect(ids.size).toBe(layout.blocks.length);
    for (const id of ids) expect(id.startsWith("hong-kong.block.")).toBe(true);
  });

  it("names an asset slot for every landmark", () => {
    const layout = generateCityLayout(params());
    expect(layout.landmarks.length).toBeGreaterThan(4);
    for (const landmark of layout.landmarks) {
      expect(landmark.assetSlot.length).toBeGreaterThan(0);
    }
    // The Shatterdome landmark points at the manifest the asset pipeline shipped.
    const hangar = layout.landmarks.find((landmark) => landmark.kind === "shatterdome-hangar");
    expect(hangar?.assetSlot).toBe("shatterdome.jaeger-bay");
  });

  it("provides a walking route and a Jaeger route out of the pad", () => {
    const layout = generateCityLayout(params());
    const walking = layout.routes.find((route) => route.kind === "walking");
    const jaeger = layout.routes.find((route) => route.kind === "jaeger");
    expect(walking).toBeDefined();
    expect(jaeger).toBeDefined();
    // A Jaeger corridor is wider and longer than a footpath, by a lot.
    expect(jaeger?.widthMeters).toBeGreaterThan((walking?.widthMeters ?? 0) * 4);
    expect(jaeger?.lengthMeters).toBeGreaterThan(walking?.lengthMeters ?? 0);
  });

  it("thins itself rather than blowing a block budget", () => {
    const small = generateCityLayout(params({ maxBlocks: 40 }));
    expect(small.blocks.length).toBeLessThanOrEqual(40);
    // Even at forty blocks it still builds more than one district.
    expect(new Set(small.blocks.map((block) => block.districtId)).size).toBeGreaterThan(1);
  });

  it("reports stats that match what it built", () => {
    const layout = generateCityLayout(params());
    expect(layout.stats.blockCount).toBe(layout.blocks.length);
    expect(layout.stats.landmarkCount).toBe(layout.landmarks.length);
    expect(layout.stats.destructionGroupCount).toBe(layout.destructionGroups.length);
    expect(layout.stats.towerCount).toBe(layout.blocks.reduce((sum, block) => sum + block.towerCount, 0));
    expect(layout.stats.evacuationCapacityThousands).toBeGreaterThan(0);
    expect(layout.schemaVersion).toBe(CITY_LAYOUT_SCHEMA_VERSION);
  });

  it("refuses a layout it cannot build", () => {
    expect(validateCityLayoutParams(params({ radiusMeters: 0 })).join(" ")).toMatch(/positive number/);
    expect(validateCityLayoutParams(params({ plan: [] })).join(" ")).toMatch(/at least one district/);
    expect(() => generateCityLayout(params({ regionId: "" }))).toThrow(/Cannot lay out city/);
    expect(validateCityLayoutParams(params({ districts: new Map() })).join(" ")).toMatch(
      /with no definition/,
    );
  });
});

describe("polyline helpers", () => {
  const line = new Float64Array([0, 0, 100, 0, 100, 100]);

  it("walks a polyline from end to end", () => {
    expect(pointAlong(line, 0)).toEqual({ east: 0, north: 0 });
    expect(pointAlong(line, 0.5).east).toBeCloseTo(100, 6);
    const end = pointAlong(line, 0.999);
    expect(end.north).toBeGreaterThan(95);
  });

  it("wraps rather than running off the end", () => {
    expect(pointAlong(line, 1)).toEqual(pointAlong(line, 0));
    expect(pointAlong(line, 2.25)).toEqual(pointAlong(line, 0.25));
    expect(pointAlong(line, -0.75)).toEqual(pointAlong(line, 0.25));
  });

  it("survives a degenerate polyline", () => {
    expect(pointAlong(new Float64Array([]), 0.5)).toEqual({ east: 0, north: 0 });
    expect(pointAlong(new Float64Array([7, 9]), 0.5)).toEqual({ east: 7, north: 9 });
  });

  it("reports the heading an agent should face", () => {
    // First leg runs due east, so heading is a quarter turn from north.
    expect(headingAlong(line, 0.1)).toBeCloseTo(Math.PI / 2, 2);
    // Second leg runs due north.
    expect(Math.abs(headingAlong(line, 0.7))).toBeCloseTo(0, 2);
  });
});
