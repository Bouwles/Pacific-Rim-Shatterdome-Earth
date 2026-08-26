import { ContentRegistry } from "../data/registry";
import type { DistrictDefinition, DistrictKind } from "../data/districts";
import {
  combineModifiers,
  createMissionModifierRegistry,
  type CombinedModifiers,
  type MissionModifierDefinition,
} from "../data/missionModifiers";
import { createRegionProfileRegistry, type RegionProfileDefinition } from "../data/regionProfiles";

/**
 * Turning a place into numbers the rest of the game already reads.
 *
 * This is the whole integration. A region profile is data; this module reshapes
 * the district table and produces the fight conditions, and everything
 * downstream carries on exactly as it did. The layout generator, the destruction
 * system and the streaming system are untouched: they take an injected district
 * map and a plan, which is precisely what a profile is.
 *
 * Nothing here is bespoke per city. Adding a region is a row in the profile
 * table, and this file does not change.
 *
 * Pure. No Babylon, no DOM, no RNG, no clock.
 */

/**
 * Reshapes the district rules for one place.
 *
 * The same seven districts everywhere, built differently: Tokyo's towers are
 * capped and packed, Anchorage's are low and sparse, Manila's are many and
 * small. That is what makes a skyline read as a different city rather than the
 * same city in a different colour.
 */
export function districtsFor(
  profile: RegionProfileDefinition,
  base: ReadonlyMap<DistrictKind, DistrictDefinition>,
): ReadonlyMap<DistrictKind, DistrictDefinition> {
  const { skyline } = profile;
  const shaped = new Map<DistrictKind, DistrictDefinition>();

  for (const [id, district] of base) {
    shaped.set(id, {
      ...district,
      minHeightMeters: Math.max(4, district.minHeightMeters * skyline.heightScale),
      maxHeightMeters: Math.max(6, district.maxHeightMeters * skyline.heightScale),
      // Coverage and irregularity are fractions, so they are clamped rather than
      // scaled without limit: a city cannot be more than completely built on.
      coverage: clamp01(district.coverage * skyline.coverageScale),
      irregularity: clamp01(district.irregularity * skyline.irregularityScale),
      neonDensity: clamp01(district.neonDensity * skyline.neonScale),
      towersPerBlock: Math.max(1, Math.round(district.towersPerBlock * skyline.towersScale)),
      colour: [
        clamp01(district.colour[0] * skyline.paletteTint[0]),
        clamp01(district.colour[1] * skyline.paletteTint[1]),
        clamp01(district.colour[2] * skyline.paletteTint[2]),
      ],
    });
  }
  return shaped;
}

/** What one place looks like from a distance, as numbers a test can compare. */
export interface SilhouetteSignature {
  readonly regionId: string;
  /** Tallest thing in the city, landmarks included. */
  readonly peakHeightMeters: number;
  /** Average of every district's height band. */
  readonly meanHeightMeters: number;
  /** How much of the ground is built on, averaged. */
  readonly meanCoverage: number;
  /** Towers per block, averaged. Density of the skyline rather than its height. */
  readonly meanTowersPerBlock: number;
  /** Mean district colour, so two cities can be compared by palette. */
  readonly palette: readonly [number, number, number];
  /** Lit signage, averaged. Night reads differently from day. */
  readonly meanNeon: number;
  /** Metres of ground relief. Flat delta against mountain wall. */
  readonly reliefMeters: number;
  /** Movements per hour through the region, of every kind. */
  readonly activityPerHour: number;
}

/**
 * What a place would look like in a screenshot with the interface turned off.
 *
 * Deliberately a set of numbers rather than an image: an automated test can
 * compare these and fail when two cities have become the same place, which a
 * screenshot cannot do on its own.
 */
export function silhouetteOf(
  profile: RegionProfileDefinition,
  base: ReadonlyMap<DistrictKind, DistrictDefinition>,
): SilhouetteSignature {
  const shaped = districtsFor(profile, base);
  const used = profile.plan
    .map((placement) => shaped.get(placement.districtId))
    .filter((district): district is DistrictDefinition => district !== undefined);

  const count = Math.max(1, used.length);
  const mean = (pick: (district: DistrictDefinition) => number) =>
    used.reduce((total, district) => total + pick(district), 0) / count;

  const tallestDistrict = used.reduce((most, district) => Math.max(most, district.maxHeightMeters), 0);
  const tallestLandmark = profile.landmarks.reduce((most, slot) => Math.max(most, slot.heightMeters), 0);

  return {
    regionId: profile.id,
    peakHeightMeters: Math.round(Math.max(tallestDistrict, tallestLandmark)),
    meanHeightMeters: Math.round(
      mean((district) => (district.minHeightMeters + district.maxHeightMeters) / 2),
    ),
    meanCoverage: round3(mean((district) => district.coverage)),
    meanTowersPerBlock: round3(mean((district) => district.towersPerBlock)),
    palette: [
      round3(mean((district) => district.colour[0])),
      round3(mean((district) => district.colour[1])),
      round3(mean((district) => district.colour[2])),
    ],
    meanNeon: round3(mean((district) => district.neonDensity)),
    reliefMeters: Math.round(profile.shoreline.reliefMeters),
    activityPerHour: Math.round(
      profile.traffic.harbourPerHour + profile.traffic.airPerHour + profile.traffic.roadScale * 10,
    ),
  };
}

/** Everything a fight in one place has to know about the place. */
export interface RegionConditions {
  readonly regionId: string;
  readonly modifiers: CombinedModifiers;
  /**
   * How deep the water actually is off this shore, after the modifiers.
   *
   * Below about fifteen metres nothing the size of a Jaeger or a kaiju can hide
   * in it, which changes how a fight opens.
   */
  readonly effectiveDepthMeters: number;
  /** True when neither side can submerge here. */
  readonly divingPossible: boolean;
  /** Bearings a creature can actually arrive on, after narrowing. */
  readonly approachBearingsDeg: readonly number[];
  /** What the local guns accomplish without anybody deploying. */
  readonly defenceStrength: number;
  /** How fast the place puts itself back together. */
  readonly rebuildRate: number;
  /** Lines for the briefing, in the order they matter. */
  readonly briefings: readonly string[];
}

/** Below this, nothing large can submerge. */
export const DIVEABLE_DEPTH_METERS = 15;

/**
 * Works out what fighting here is like.
 *
 * Everything is derived from the profile and its modifiers, so a new region is a
 * data row and this function does not change.
 */
export function conditionsFor(
  profile: RegionProfileDefinition,
  modifiers: ContentRegistry<MissionModifierDefinition> = createMissionModifierRegistry(),
): RegionConditions {
  const combined = combineModifiers(profile.modifiers, modifiers);
  const depth = profile.shoreline.shelfDepthMeters * combined.waterDepthScale;

  // Narrowing removes approaches rather than scaling a number: a corridor means
  // there is one way in, and that is a different fight rather than a harder one.
  const keep = Math.max(1, Math.round(profile.approachBearingsDeg.length * (1 - combined.approachNarrowing)));
  const approaches = [...profile.approachBearingsDeg]
    .sort((a, b) => Math.abs(a) - Math.abs(b))
    .slice(0, keep);

  // What the local defences are worth: guns and aircraft, blunted by how long
  // they take to arrive and by how little they can see.
  const responsiveness = Math.max(0.2, Math.min(1.4, 12 / profile.defence.responseMinutes));
  const defenceStrength =
    round3(
      (profile.defence.batteries * 0.14 + profile.defence.interceptors * 0.1) *
        responsiveness *
        combined.visibilityScale,
    ) + 1;

  const briefings = [...combined.briefings];
  if (depth < DIVEABLE_DEPTH_METERS) {
    briefings.unshift("The water is too shallow to dive. Everything happens on the surface.");
  }
  if (approaches.length === 1) {
    briefings.unshift("There is one way in. Hold it and the fight is yours to shape.");
  }

  return {
    regionId: profile.id,
    modifiers: combined,
    effectiveDepthMeters: Math.round(depth * 10) / 10,
    divingPossible: depth >= DIVEABLE_DEPTH_METERS,
    approachBearingsDeg: approaches,
    defenceStrength: round3(defenceStrength),
    rebuildRate: round3(profile.rebuildRate * combined.rebuildScale),
    briefings,
  };
}

/** What defending a place is worth, and what comes back from it. */
export interface RegionEconomics {
  readonly regionId: string;
  readonly contractScale: number;
  readonly salvageScale: number;
  readonly researchScale: number;
  /** What the industry is, in words, for the map. */
  readonly industry: string;
}

export function economicsFor(profile: RegionProfileDefinition): RegionEconomics {
  return {
    regionId: profile.id,
    contractScale: profile.industry.contractScale,
    salvageScale: profile.industry.salvageScale,
    researchScale: profile.industry.researchScale,
    industry: profile.industry.displayName,
  };
}

/**
 * How much two places have to do with each other.
 *
 * Derived from what they make and how far apart they are, so a relationship is
 * a shipping lane and a shared industry rather than an opinion about anybody.
 * Symmetric by construction: a link is a link from either end.
 */
export interface RegionRelationship {
  readonly fromId: string;
  readonly toId: string;
  /** 0 to 1. How much trade actually moves between them. */
  readonly strength: number;
  /** What the link is for, in words. */
  readonly reason: string;
}

export function relationshipsFor(
  profiles: readonly RegionProfileDefinition[] = createRegionProfileRegistry().all(),
): readonly RegionRelationship[] {
  const links: RegionRelationship[] = [];
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const first = profiles[i]!;
      const second = profiles[j]!;

      // Ports trade with ports. The more shipping both move, the stronger it is.
      const shipping = Math.min(first.traffic.harbourPerHour, second.traffic.harbourPerHour) / 60;
      // Places that make different things have more reason to deal with each
      // other than places that make the same thing.
      const complementary = first.industry.id === second.industry.id ? 0.25 : 0.6;
      const strength = round3(Math.min(1, shipping * complementary * 2.2));
      if (strength < 0.05) continue;

      links.push({
        fromId: first.id,
        toId: second.id,
        strength,
        reason:
          first.industry.id === second.industry.id
            ? `Both work in ${first.industry.displayName.toLowerCase()}, so they compete more than they trade.`
            : `${first.industry.displayName} moving against ${second.industry.displayName.toLowerCase()}.`,
      });
    }
  }
  return links.sort((a, b) => b.strength - a.strength);
}

/**
 * What losing a region costs everywhere else.
 *
 * A place that trades heavily with a wrecked one loses part of its own contract
 * income, so the strategic map has consequences that reach past the region that
 * was actually hit.
 */
export function knockOnEffect(
  regionId: string,
  integrityLost: number,
  links: readonly RegionRelationship[] = relationshipsFor(),
): readonly { readonly regionId: string; readonly contractScale: number; readonly reason: string }[] {
  const loss = Math.max(0, Math.min(1, integrityLost));
  if (loss <= 0) return [];
  return links
    .filter((link) => link.fromId === regionId || link.toId === regionId)
    .map((link) => {
      const other = link.fromId === regionId ? link.toId : link.fromId;
      return {
        regionId: other,
        contractScale: round3(1 - loss * link.strength * 0.5),
        reason: `Trade with ${regionId} is down. ${link.reason}`,
      };
    })
    .filter((entry) => entry.contractScale < 1)
    .sort((a, b) => a.contractScale - b.contractScale);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
