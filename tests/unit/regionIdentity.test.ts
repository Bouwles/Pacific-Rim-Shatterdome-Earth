import { describe, expect, it } from "vitest";
import {
  MISSION_MODIFIERS,
  MISSION_MODIFIER_IDS,
  combineModifiers,
  createMissionModifierRegistry,
  neutralModifiers,
  validateMissionModifier,
} from "../../src/data/missionModifiers";
import {
  REGION_PROFILES,
  createRegionProfileRegistry,
  validateRegionProfile,
} from "../../src/data/regionProfiles";
import {
  DIVEABLE_DEPTH_METERS,
  conditionsFor,
  districtsFor,
  economicsFor,
  knockOnEffect,
  relationshipsFor,
  silhouetteOf,
} from "../../src/world/regionIdentity";
import { createDistrictRegistry, type DistrictDefinition, type DistrictKind } from "../../src/data/districts";
import { REGION_DEFINITIONS } from "../../src/data/regions";

const profiles = createRegionProfileRegistry();
const modifiers = createMissionModifierRegistry();

function baseDistricts(): ReadonlyMap<DistrictKind, DistrictDefinition> {
  return new Map(
    createDistrictRegistry()
      .all()
      .map((district) => [district.id, district]),
  );
}
const base = baseDistricts();

describe("mission modifiers", () => {
  it("all validate", () => {
    for (const entry of MISSION_MODIFIERS) expect(validateMissionModifier(entry), entry.id).toEqual([]);
  });

  it("cover every kind the milestone names", () => {
    const covered = new Set(MISSION_MODIFIERS.map((entry) => entry.id));
    for (const id of MISSION_MODIFIER_IDS) expect(covered.has(id), id).toBe(true);
    expect(MISSION_MODIFIER_IDS).toHaveLength(7);
  });

  it("refuse one that changes nothing", () => {
    const base = MISSION_MODIFIERS[0]!;
    const inert = {
      ...base,
      footingScale: 1,
      accuracyScale: 1,
      visibilityScale: 1,
      waterDepthScale: 1,
      clutterScale: 1,
      collateralScale: 1,
      rebuildScale: 1,
      approachNarrowing: 0,
    };
    expect(validateMissionModifier(inert).join(" ")).toMatch(/label/);
  });

  it("refuse one that changes everything", () => {
    const base = MISSION_MODIFIERS[0]!;
    expect(validateMissionModifier({ ...base, footingScale: 5 }).join(" ")).toMatch(/different game/);
  });

  it("start neutral with nothing applied", () => {
    expect(combineModifiers([], modifiers)).toEqual(neutralModifiers());
  });

  it("multiply scales, so two bad things are worse than one", () => {
    const one = combineModifiers(["ice"], modifiers);
    const two = combineModifiers(["ice", "typhoon"], modifiers);
    expect(two.footingScale).toBeLessThan(one.footingScale);
    expect(two.visibilityScale).toBeLessThan(one.visibilityScale);
  });

  it("take the strongest narrowing rather than adding it", () => {
    // Two reasons a creature can only come one way is still one way.
    const combined = combineModifiers(["mountainous-approach", "shallow-bay"], modifiers);
    expect(combined.approachNarrowing).toBe(0.75);
  });

  it("collect a briefing line for each", () => {
    const combined = combineModifiers(["ice", "shallow-bay"], modifiers);
    expect(combined.briefings).toHaveLength(2);
    for (const line of combined.briefings) expect(line.length).toBeGreaterThan(10);
  });

  it("ignore a modifier this build does not have", () => {
    expect(combineModifiers(["not-a-modifier" as never], modifiers)).toEqual(neutralModifiers());
  });
});

describe("region profiles", () => {
  it("all validate", () => {
    for (const profile of REGION_PROFILES) expect(validateRegionProfile(profile), profile.id).toEqual([]);
  });

  it("cover every region the milestone names, and more besides", () => {
    const ids = new Set(REGION_PROFILES.map((profile) => profile.id));
    for (const id of ["sydney", "tokyo", "anchorage", "manila"]) expect(ids.has(id), id).toBe(true);
    // Hong Kong plus the four named plus at least three more coastal regions.
    expect(REGION_PROFILES.length).toBeGreaterThanOrEqual(8 - 1);
  });

  it("names a region that actually exists", () => {
    const regionIds = new Set(REGION_DEFINITIONS.map((region) => region.id));
    for (const profile of REGION_PROFILES) expect(regionIds.has(profile.id), profile.id).toBe(true);
  });

  it("gives every land region a plan, so none is a strategic record any more", () => {
    for (const region of REGION_DEFINITIONS) {
      if (region.kind === "ocean") continue;
      expect(region.cityPlanId, region.id).not.toBeNull();
      expect(profiles.has(region.cityPlanId!), region.id).toBe(true);
    }
  });

  it("refuses a profile whose identity is only a label", () => {
    // The explicit failure mode: a flag and a name standing in for a place.
    const base = REGION_PROFILES[0]!;
    const label = {
      ...base,
      skyline: {
        ...base.skyline,
        heightScale: 1,
        coverageScale: 1,
        towersScale: 1,
        irregularityScale: 1,
        paletteTint: [1, 1, 1] as const,
      },
      modifiers: [],
    };
    expect(validateRegionProfile(label).join(" ")).toMatch(/only a label/);
  });

  it("refuses a profile with no landmark slots", () => {
    const base = REGION_PROFILES[0]!;
    expect(validateRegionProfile({ ...base, landmarks: [] }).join(" ")).toMatch(/no silhouette of its own/);
  });

  it("refuses a profile with no ambience", () => {
    const base = REGION_PROFILES[0]!;
    expect(validateRegionProfile({ ...base, ambience: [] }).join(" ")).toMatch(/every other place/);
  });

  it("refuses a plan too thin to read as a city", () => {
    const base = REGION_PROFILES[0]!;
    expect(validateRegionProfile({ ...base, plan: base.plan.slice(0, 2) }).join(" ")).toMatch(
      /at least four/,
    );
  });

  it("gives every profile an industry, a defence and an approach", () => {
    for (const profile of REGION_PROFILES) {
      expect(profile.industry.displayName.length, profile.id).toBeGreaterThan(0);
      expect(profile.defence.responseMinutes, profile.id).toBeGreaterThan(0);
      expect(profile.approachBearingsDeg.length, profile.id).toBeGreaterThan(0);
      expect(profile.ambience.length, profile.id).toBeGreaterThan(0);
    }
  });
});

describe("shaping a city", () => {
  it("keeps every district, so nothing needs bespoke content", () => {
    for (const profile of REGION_PROFILES) {
      expect(districtsFor(profile, base).size, profile.id).toBe(base.size);
    }
  });

  it("actually changes the districts rather than passing them through", () => {
    const tokyo = districtsFor(profiles.getOrThrow("tokyo"), base);
    const anchorage = districtsFor(profiles.getOrThrow("anchorage"), base);
    const downtownTokyo = tokyo.get("downtown")!;
    const downtownAnchorage = anchorage.get("downtown")!;
    expect(downtownTokyo.maxHeightMeters).toBeGreaterThan(downtownAnchorage.maxHeightMeters);
    expect(downtownTokyo.coverage).toBeGreaterThan(downtownAnchorage.coverage);
  });

  it("keeps fractions inside their range however hard a profile pushes", () => {
    for (const profile of REGION_PROFILES) {
      for (const district of districtsFor(profile, base).values()) {
        expect(district.coverage).toBeLessThanOrEqual(1);
        expect(district.coverage).toBeGreaterThanOrEqual(0);
        expect(district.irregularity).toBeLessThanOrEqual(1);
        expect(district.neonDensity).toBeLessThanOrEqual(1);
        for (const channel of district.colour) expect(channel).toBeLessThanOrEqual(1);
        expect(district.towersPerBlock).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("gives every region a different silhouette", () => {
    // The acceptance item: a screenshot with no interface is identifiable.
    const signatures = REGION_PROFILES.map((profile) => JSON.stringify(silhouetteOf(profile, base)));
    expect(new Set(signatures).size).toBe(REGION_PROFILES.length);
  });

  it("gives every region a different palette", () => {
    const palettes = REGION_PROFILES.map((profile) => silhouetteOf(profile, base).palette.join(","));
    expect(new Set(palettes).size).toBe(REGION_PROFILES.length);
  });

  it("separates the tall dense places from the low sparse ones", () => {
    const tokyo = silhouetteOf(profiles.getOrThrow("tokyo"), base);
    const anchorage = silhouetteOf(profiles.getOrThrow("anchorage"), base);
    expect(tokyo.meanCoverage).toBeGreaterThan(anchorage.meanCoverage * 2);
    // And relief runs the other way, because the mountains are the skyline there.
    expect(anchorage.reliefMeters).toBeGreaterThan(tokyo.reliefMeters * 5);
  });
});

describe("what fighting somewhere is like", () => {
  it("gives every region its own conditions", () => {
    const keys = REGION_PROFILES.map((profile) => {
      const conditions = conditionsFor(profile, modifiers);
      return [
        conditions.modifiers.footingScale,
        conditions.modifiers.accuracyScale,
        conditions.modifiers.visibilityScale,
        conditions.divingPossible,
        conditions.approachBearingsDeg.length,
      ].join("|");
    });
    expect(new Set(keys).size).toBe(REGION_PROFILES.length);
  });

  it("refuses diving where the shelf is too shallow", () => {
    const tokyo = conditionsFor(profiles.getOrThrow("tokyo"), modifiers);
    const sydney = conditionsFor(profiles.getOrThrow("sydney"), modifiers);
    expect(tokyo.divingPossible).toBe(false);
    expect(sydney.divingPossible).toBe(true);
    expect(tokyo.effectiveDepthMeters).toBeLessThan(DIVEABLE_DEPTH_METERS);
  });

  it("narrows the approaches where the ground does", () => {
    const anchorage = conditionsFor(profiles.getOrThrow("anchorage"), modifiers);
    expect(anchorage.approachBearingsDeg).toHaveLength(1);
    expect(anchorage.briefings.join(" ")).toMatch(/one way in/i);
  });

  it("says what the conditions mean rather than only naming them", () => {
    for (const profile of REGION_PROFILES) {
      const conditions = conditionsFor(profile, modifiers);
      if (profile.modifiers.length === 0) continue;
      expect(conditions.briefings.length, profile.id).toBeGreaterThan(0);
      for (const line of conditions.briefings) expect(line.length).toBeGreaterThan(10);
    }
  });

  it("makes local defences worth more where there are more of them", () => {
    const tokyo = conditionsFor(profiles.getOrThrow("tokyo"), modifiers);
    const manila = conditionsFor(profiles.getOrThrow("manila"), modifiers);
    expect(tokyo.defenceStrength).toBeGreaterThan(manila.defenceStrength);
  });

  it("slows rebuilding where the conditions make it hard", () => {
    const anchorage = conditionsFor(profiles.getOrThrow("anchorage"), modifiers);
    const tokyo = conditionsFor(profiles.getOrThrow("tokyo"), modifiers);
    expect(anchorage.rebuildRate).toBeLessThan(tokyo.rebuildRate);
  });
});

describe("what a place is worth", () => {
  it("varies by what the region makes, not by where it is", () => {
    const scales = REGION_PROFILES.map((profile) => {
      const economics = economicsFor(profile);
      return `${economics.contractScale}|${economics.salvageScale}|${economics.researchScale}`;
    });
    expect(new Set(scales).size).toBeGreaterThan(4);
  });

  it("describes industry in terms of infrastructure", () => {
    // The rule this project holds itself to: places are described by what is
    // built there, never by the people who live there.
    for (const profile of REGION_PROFILES) {
      const text = `${profile.industry.displayName} ${profile.industry.notes} ${profile.notes}`.toLowerCase();
      for (const word of ["people are", "locals", "natives", "culture", "traditional"]) {
        expect(text.includes(word), `${profile.id}: ${word}`).toBe(false);
      }
    }
  });

  it("links places that trade, and says why", () => {
    const links = relationshipsFor(REGION_PROFILES);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.strength).toBeGreaterThan(0);
      expect(link.strength).toBeLessThanOrEqual(1);
      expect(link.reason.length).toBeGreaterThan(10);
      expect(link.fromId).not.toBe(link.toId);
    }
  });

  it("makes wrecking one place cost the places that trade with it", () => {
    const effects = knockOnEffect("hong-kong", 0.6);
    expect(effects.length).toBeGreaterThan(0);
    for (const effect of effects) {
      expect(effect.regionId).not.toBe("hong-kong");
      expect(effect.contractScale).toBeLessThan(1);
      expect(effect.reason).toMatch(/Trade with hong-kong/);
    }
  });

  it("costs nothing when nothing was lost", () => {
    expect(knockOnEffect("hong-kong", 0)).toEqual([]);
  });
});
