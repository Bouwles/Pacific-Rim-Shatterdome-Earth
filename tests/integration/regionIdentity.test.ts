import { describe, expect, it } from "vitest";
import {
  compareRegions,
  distinctiveness,
  sameEncounterEverywhere,
  silhouetteDistance,
  strategicWeb,
} from "../../src/debug/regionScenario";
import { REGION_PROFILES } from "../../src/data/regionProfiles";
import { conditionsFor, districtsFor, silhouetteOf } from "../../src/world/regionIdentity";
import { createDistrictRegistry, type DistrictDefinition, type DistrictKind } from "../../src/data/districts";
import { generateCityLayout } from "../../src/world/cityLayout";
import { REGION_DEFINITIONS } from "../../src/data/regions";
import { RegionDestruction } from "../../src/world/destruction";

/**
 * Region identity where it meets everything else.
 *
 * The acceptance questions: are the cities actually distinguishable, does the
 * same encounter play differently in each of them, and does all of it come out
 * of the shared layout and destruction systems rather than bespoke scene code.
 */

const base: ReadonlyMap<DistrictKind, DistrictDefinition> = new Map(
  createDistrictRegistry()
    .all()
    .map((district) => [district.id, district]),
);
const SEED = 20260902;

describe("the cities are different places", () => {
  it("runs the same way twice", () => {
    expect(JSON.stringify(compareRegions(SEED))).toBe(JSON.stringify(compareRegions(SEED)));
  });

  it("gives every region a distinct silhouette, palette and set of conditions", () => {
    // The acceptance item is that a screenshot with the interface off is
    // identifiable by region. A screenshot cannot be asserted on, so this
    // measures what a screenshot would show.
    const result = distinctiveness();
    expect(result.distinctSilhouettes).toBe(result.regions);
    expect(result.distinctPalettes).toBe(result.regions);
    expect(result.distinctConditions).toBe(result.regions);
  });

  it("keeps even the two most similar cities clearly apart", () => {
    const result = distinctiveness();
    expect(result.closestDistance).toBeGreaterThan(0.15);
  });

  it("builds cities of genuinely different size and shape", () => {
    const rows = compareRegions(SEED);
    const blocks = rows.map((row) => row.blocks);
    expect(Math.max(...blocks)).toBeGreaterThan(Math.min(...blocks) * 2);

    const peaks = rows.map((row) => row.silhouette.peakHeightMeters);
    expect(Math.max(...peaks)).toBeGreaterThan(Math.min(...peaks) * 2);
  });

  it("does not let any two regions collapse into the same skyline", () => {
    for (const first of REGION_PROFILES) {
      for (const second of REGION_PROFILES) {
        if (first.id >= second.id) continue;
        const distance = silhouetteDistance(silhouetteOf(first, base), silhouetteOf(second, base));
        expect(distance, `${first.id} against ${second.id}`).toBeGreaterThan(0.15);
      }
    }
  });
});

describe("the same encounter plays differently", () => {
  const runs = sameEncounterEverywhere();

  it("covers every region", () => {
    expect(runs).toHaveLength(REGION_PROFILES.length);
  });

  it("changes how far a machine slides", () => {
    const slides = runs.map((run) => run.slideMeters);
    expect(Math.max(...slides)).toBeGreaterThan(Math.min(...slides) * 1.4);
  });

  it("changes what a ranged weapon is worth", () => {
    const hits = runs.map((run) => run.hitChanceAtRange);
    expect(Math.max(...hits)).toBeGreaterThan(Math.min(...hits) * 1.5);
  });

  it("changes how early a contact is held", () => {
    const detection = runs.map((run) => run.detectionMeters);
    expect(Math.max(...detection)).toBeGreaterThan(Math.min(...detection) * 2);
  });

  it("changes whether a fight can open underwater at all", () => {
    expect(runs.some((run) => run.canOpenSubmerged)).toBe(true);
    expect(runs.some((run) => !run.canOpenSubmerged)).toBe(true);
  });

  it("changes how many directions it can come from", () => {
    const approaches = new Set(runs.map((run) => run.approaches));
    expect(approaches.size).toBeGreaterThan(1);
  });

  it("changes what breaking the place costs", () => {
    const collateral = runs.map((run) => run.collateralScale);
    expect(new Set(collateral).size).toBeGreaterThan(2);
  });
});

describe("everything uses the shared systems", () => {
  it("lays every city out with the one generator", () => {
    // No bespoke scene code anywhere: the same call, different data.
    for (const profile of REGION_PROFILES) {
      const region = REGION_DEFINITIONS.find((entry) => entry.id === profile.id)!;
      const layout = generateCityLayout({
        regionId: profile.id,
        seed: SEED,
        radiusMeters: region.radiusMeters,
        seawardBearingDeg: region.seawardBearingDeg,
        plan: profile.plan,
        districts: districtsFor(profile, base),
        maxBlocks: 1_400,
      });
      expect(layout.blocks.length, profile.id).toBeGreaterThan(0);
      expect(layout.regionId).toBe(profile.id);
    }
  });

  it("keeps every city inside the same block ceiling", () => {
    for (const row of compareRegions(SEED)) {
      expect(row.blocks, row.regionId).toBeLessThanOrEqual(1_400);
    }
  });

  it("uses only districts the shared registry already ships", () => {
    for (const profile of REGION_PROFILES) {
      for (const placement of profile.plan) {
        expect(base.has(placement.districtId), `${profile.id}: ${placement.districtId}`).toBe(true);
      }
    }
  });

  it("takes damage through the one destruction system", () => {
    for (const profile of REGION_PROFILES) {
      const region = REGION_DEFINITIONS.find((entry) => entry.id === profile.id)!;
      const layout = generateCityLayout({
        regionId: profile.id,
        seed: SEED,
        radiusMeters: region.radiusMeters,
        seawardBearingDeg: region.seawardBearingDeg,
        plan: profile.plan,
        districts: districtsFor(profile, base),
        maxBlocks: 1_400,
      });
      // The same destruction class every region uses, handed this region's
      // layout. Nothing about it knows which city it is wrecking.
      const destruction = new RegionDestruction({ layout, seed: SEED });
      expect(destruction.regionId, profile.id).toBe(profile.id);
      expect(destruction.groups().length, profile.id).toBeGreaterThan(0);

      // Hit the city where it actually is, and check something was damaged. A
      // hit that lands nowhere would pass without proving anything.
      const block = layout.blocks[0]!;
      destruction.applyImpact(block.east, block.north, 400, 4_000);
      const damaged = destruction.groups().filter((group) => group.integrity < 1 || group.structuresDown > 0);
      expect(damaged.length, profile.id).toBeGreaterThan(0);
    }
  });
});

describe("the strategic web", () => {
  it("links places that trade with each other", () => {
    const web = strategicWeb();
    expect(web.links).toBeGreaterThan(0);
    expect(web.strongest).not.toBeNull();
  });

  it("makes losing one place cost the places that trade with it", () => {
    const web = strategicWeb();
    expect(web.knockOn.length).toBeGreaterThan(0);
    for (const entry of web.knockOn) expect(entry.contractScale).toBeLessThan(1);
  });
});

describe("a region reports itself honestly", () => {
  it("says something specific about every one", () => {
    for (const profile of REGION_PROFILES) {
      const conditions = conditionsFor(profile);
      expect(profile.skyline.notes.length, profile.id).toBeGreaterThan(20);
      expect(profile.shoreline.notes.length, profile.id).toBeGreaterThan(20);
      expect(conditions.regionId).toBe(profile.id);
    }
  });

  it("never describes a place by the people in it", () => {
    // Checked here as well as in the unit suite, because this is the rule most
    // easily broken by somebody adding a region later.
    const banned = ["people are", "locals", "natives", "culture", "traditional", "exotic"];
    for (const profile of REGION_PROFILES) {
      const text = [
        profile.notes,
        profile.skyline.notes,
        profile.shoreline.notes,
        profile.defence.notes,
        profile.industry.notes,
        ...profile.landmarks.map((slot) => slot.notes),
      ]
        .join(" ")
        .toLowerCase();
      for (const word of banned) expect(text.includes(word), `${profile.id}: ${word}`).toBe(false);
    }
  });
});
