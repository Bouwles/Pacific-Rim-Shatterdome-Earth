import { createDistrictRegistry, type DistrictDefinition, type DistrictKind } from "../data/districts";
import { REGION_PROFILES, createRegionProfileRegistry } from "../data/regionProfiles";
import {
  conditionsFor,
  districtsFor,
  economicsFor,
  knockOnEffect,
  relationshipsFor,
  silhouetteOf,
  type SilhouetteSignature,
} from "../world/regionIdentity";
import { generateCityLayout } from "../world/cityLayout";
import { REGION_DEFINITIONS } from "../data/regions";

/**
 * Every region, measured against every other.
 *
 * What this proves: that the cities are actually different from each other
 * rather than recoloured copies, that the same encounter would play differently
 * in each of them, and that all of it comes out of the shared layout system
 * rather than bespoke code per city.
 *
 * Deterministic from a seed. No renderer, no clock, no world state.
 */

export const REGION_SCENARIO_SEED = 20260902;

function baseDistricts(): ReadonlyMap<DistrictKind, DistrictDefinition> {
  const registry = createDistrictRegistry();
  return new Map(registry.all().map((district) => [district.id, district]));
}

export interface RegionScenarioRow {
  readonly regionId: string;
  readonly silhouette: SilhouetteSignature;
  /** Blocks the shared generator actually produced for this plan. */
  readonly blocks: number;
  readonly landmarkSlots: number;
  /** What fighting here is like. */
  readonly footingScale: number;
  readonly accuracyScale: number;
  readonly visibilityScale: number;
  readonly effectiveDepthMeters: number;
  readonly divingPossible: boolean;
  readonly approaches: number;
  readonly defenceStrength: number;
  readonly rebuildRate: number;
  readonly contractScale: number;
  readonly salvageScale: number;
  readonly briefings: readonly string[];
}

/** One row per region, everything derived rather than written down. */
export function compareRegions(seed = REGION_SCENARIO_SEED): readonly RegionScenarioRow[] {
  const base = baseDistricts();
  const profiles = createRegionProfileRegistry();

  return profiles.all().map((profile) => {
    const region = REGION_DEFINITIONS.find((entry) => entry.id === profile.id);
    const conditions = conditionsFor(profile);
    const economics = economicsFor(profile);

    // The shared generator, with this region's own plan and reshaped districts.
    // Nothing here is a bespoke scene: it is the same call Hong Kong has always
    // made, with different data going in.
    const layout = generateCityLayout({
      regionId: profile.id,
      seed,
      radiusMeters: region?.radiusMeters ?? 5_000,
      seawardBearingDeg: region?.seawardBearingDeg ?? 180,
      plan: profile.plan,
      districts: districtsFor(profile, base),
      maxBlocks: 1_400,
    });

    return {
      regionId: profile.id,
      silhouette: silhouetteOf(profile, base),
      blocks: layout.blocks.length,
      landmarkSlots: profile.landmarks.length,
      footingScale: conditions.modifiers.footingScale,
      accuracyScale: conditions.modifiers.accuracyScale,
      visibilityScale: conditions.modifiers.visibilityScale,
      effectiveDepthMeters: conditions.effectiveDepthMeters,
      divingPossible: conditions.divingPossible,
      approaches: conditions.approachBearingsDeg.length,
      defenceStrength: conditions.defenceStrength,
      rebuildRate: conditions.rebuildRate,
      contractScale: economics.contractScale,
      salvageScale: economics.salvageScale,
      briefings: conditions.briefings,
    };
  });
}

export interface DistinctivenessResult {
  readonly regions: number;
  /** Distinct silhouette signatures. Must equal the number of regions. */
  readonly distinctSilhouettes: number;
  /** Distinct palettes. Two cities the same colour is a failure. */
  readonly distinctPalettes: number;
  /** Distinct sets of fight conditions. */
  readonly distinctConditions: number;
  /** The closest pair, and how far apart they are. */
  readonly closestPair: readonly [string, string];
  readonly closestDistance: number;
}

/**
 * How different the places actually are.
 *
 * The acceptance item is that a screenshot with no interface is identifiable by
 * region. A screenshot cannot be asserted on, so this measures the things a
 * screenshot would show: height, density, palette, relief and activity. Two
 * regions that collapse to the same numbers would look the same, and this
 * reports it rather than assuming otherwise.
 */
export function distinctiveness(): DistinctivenessResult {
  const rows = compareRegions();
  const key = (row: RegionScenarioRow) =>
    [
      row.silhouette.peakHeightMeters,
      row.silhouette.meanHeightMeters,
      row.silhouette.meanCoverage,
      row.silhouette.meanTowersPerBlock,
      row.silhouette.palette.join(","),
      row.silhouette.reliefMeters,
      row.silhouette.activityPerHour,
    ].join("|");

  const conditionKey = (row: RegionScenarioRow) =>
    [row.footingScale, row.accuracyScale, row.visibilityScale, row.divingPossible, row.approaches].join("|");

  let closest: readonly [string, string] = ["", ""];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const distance = silhouetteDistance(rows[i]!.silhouette, rows[j]!.silhouette);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = [rows[i]!.regionId, rows[j]!.regionId];
      }
    }
  }

  return {
    regions: rows.length,
    distinctSilhouettes: new Set(rows.map(key)).size,
    distinctPalettes: new Set(rows.map((row) => row.silhouette.palette.join(","))).size,
    distinctConditions: new Set(rows.map(conditionKey)).size,
    closestPair: closest,
    closestDistance: Math.round(closestDistance * 1000) / 1000,
  };
}

/**
 * How far apart two skylines are, as a single number.
 *
 * Each axis is normalised against a sensible range so height does not swamp
 * palette. Used to find the two cities most at risk of looking alike.
 */
export function silhouetteDistance(a: SilhouetteSignature, b: SilhouetteSignature): number {
  const axes: readonly (readonly [number, number, number])[] = [
    [a.peakHeightMeters, b.peakHeightMeters, 800],
    [a.meanHeightMeters, b.meanHeightMeters, 300],
    [a.meanCoverage, b.meanCoverage, 1],
    [a.meanTowersPerBlock, b.meanTowersPerBlock, 6],
    [a.palette[0], b.palette[0], 1],
    [a.palette[1], b.palette[1], 1],
    [a.palette[2], b.palette[2], 1],
    [a.meanNeon, b.meanNeon, 1],
    [a.reliefMeters, b.reliefMeters, 2_000],
    [a.activityPerHour, b.activityPerHour, 100],
  ];
  return Math.sqrt(
    axes.reduce((total, [first, second, range]) => {
      const delta = (first - second) / range;
      return total + delta * delta;
    }, 0),
  );
}

export interface EncounterComparison {
  readonly regionId: string;
  /** How far a machine slides on a hard stop, in metres. */
  readonly slideMeters: number;
  /** Hit chance at four hundred metres, as a fraction of the clear-air figure. */
  readonly hitChanceAtRange: number;
  /** Metres at which a contact is first held. */
  readonly detectionMeters: number;
  /** Whether the creature can open the fight from under the water. */
  readonly canOpenSubmerged: boolean;
  /** How many directions it can come from. */
  readonly approaches: number;
  /** Cost of a levelled block here, as a multiple of the ordinary bill. */
  readonly collateralScale: number;
}

/**
 * The same encounter, everywhere.
 *
 * Identical creature, identical machine, identical seed: only the place differs.
 * The acceptance item is that the fight plays differently because of terrain and
 * city structure, so this holds everything else still and reports what changes.
 */
export function sameEncounterEverywhere(): readonly EncounterComparison[] {
  const profiles = createRegionProfileRegistry();
  // One set of numbers for the encounter itself, used unchanged in every region.
  const BASE_SLIDE_METERS = 12;
  const BASE_DETECTION_METERS = 2_400;

  return profiles.all().map((profile) => {
    const conditions = conditionsFor(profile);
    const { modifiers } = conditions;
    return {
      regionId: profile.id,
      // Worse footing means a longer slide out of the same stop.
      slideMeters: Math.round((BASE_SLIDE_METERS / modifiers.footingScale) * 10) / 10,
      hitChanceAtRange: Math.round(modifiers.accuracyScale * 1000) / 1000,
      detectionMeters: Math.round(BASE_DETECTION_METERS * modifiers.visibilityScale),
      canOpenSubmerged: conditions.divingPossible,
      approaches: conditions.approachBearingsDeg.length,
      collateralScale: modifiers.collateralScale,
    };
  });
}

export interface StrategicWebResult {
  readonly links: number;
  readonly strongest: { readonly pair: string; readonly strength: number } | null;
  /** What a levelled Hong Kong does to everywhere else. */
  readonly knockOn: readonly { readonly regionId: string; readonly contractScale: number }[];
}

/** The trade web, and what wrecking one end of it does to the other. */
export function strategicWeb(): StrategicWebResult {
  const links = relationshipsFor(REGION_PROFILES);
  const strongest = links[0];
  return {
    links: links.length,
    strongest: strongest
      ? { pair: `${strongest.fromId}-${strongest.toId}`, strength: strongest.strength }
      : null,
    knockOn: knockOnEffect("hong-kong", 0.6, links).map((entry) => ({
      regionId: entry.regionId,
      contractScale: entry.contractScale,
    })),
  };
}
