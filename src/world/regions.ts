import { ContentRegistry, type RegistryEntry } from "../data/registry";
import { validateGeoPosition, type GeoPosition } from "./coordinates";

/**
 * Strategic region records.
 *
 * Everywhere that is not the active bubble exists only as one of these: a small
 * plain-data record the strategic layer can tick cheaply. No meshes, no physics
 * bodies, no detailed AI. Promoting a region to combat-grade detail is what
 * makes it "active", and only one region is active at a time.
 */

export const CLIMATE_ZONES = [
  "polar",
  "subarctic",
  "temperate",
  "subtropical",
  "tropical",
  "arid",
  "oceanic",
] as const;
export type ClimateZone = (typeof CLIMATE_ZONES)[number];

export const REGION_KINDS = ["coastal-city", "inland-city", "shatterdome", "ocean", "wilderness"] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

/** How much of the simulation a region is receiving right now. */
export const SIMULATION_TIERS = ["active", "strategic"] as const;
export type SimulationTier = (typeof SIMULATION_TIERS)[number];

export interface RegionDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly kind: RegionKind;
  readonly climate: ClimateZone;
  readonly centre: GeoPosition;
  /** Radius of the populated area, in metres on the scaled globe. */
  readonly radiusMeters: number;
  /** Rough population in thousands, used by strategic pressure maths later. */
  readonly populationThousands: number;
  /** True when the region can be deployed to directly. */
  readonly deploymentPoint: boolean;
  readonly notes: string;
}

export function validateRegion(region: RegionDefinition): string[] {
  const errors: string[] = [];
  if (!region.id) errors.push("id required");
  if (!region.displayName) errors.push("displayName required");
  if (!REGION_KINDS.includes(region.kind)) {
    errors.push(`kind must be one of: ${REGION_KINDS.join(", ")}`);
  }
  if (!CLIMATE_ZONES.includes(region.climate)) {
    errors.push(`climate must be one of: ${CLIMATE_ZONES.join(", ")}`);
  }
  errors.push(...validateGeoPosition(region.centre, "centre"));
  if (!Number.isFinite(region.radiusMeters) || region.radiusMeters <= 0) {
    errors.push("radiusMeters must be a positive number");
  }
  if (!Number.isFinite(region.populationThousands) || region.populationThousands < 0) {
    errors.push("populationThousands must be a non-negative number");
  }
  return errors;
}

export function createRegionRegistry(): ContentRegistry<RegionDefinition> {
  return new ContentRegistry<RegionDefinition>(validateRegion);
}

/**
 * Mutable strategic state for one region. Kept deliberately small and plain: it
 * is saved, and every region on the planet carries one.
 */
export interface RegionRecord {
  readonly regionId: string;
  /** 0 means levelled, 1 means untouched. */
  readonly integrity: number;
  /** 0 to 1. Drives rescue pressure and rebuild rate later. */
  readonly safetyRating: number;
  /** Tick at which this region was last visited or resolved. */
  readonly lastVisitedTick: number;
  readonly tier: SimulationTier;
}

export function initialRecord(regionId: string): RegionRecord {
  return { regionId, integrity: 1, safetyRating: 1, lastVisitedTick: 0, tier: "strategic" };
}

export function validateRegionRecord(record: RegionRecord, knownIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (!knownIds.has(record.regionId)) errors.push(`unknown region "${record.regionId}"`);
  for (const key of ["integrity", "safetyRating"] as const) {
    const value = record[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${record.regionId}.${key} must be within [0, 1]`);
    }
  }
  if (!Number.isInteger(record.lastVisitedTick) || record.lastVisitedTick < 0) {
    errors.push(`${record.regionId}.lastVisitedTick must be a non-negative integer`);
  }
  if (!SIMULATION_TIERS.includes(record.tier)) {
    errors.push(`${record.regionId}.tier must be one of: ${SIMULATION_TIERS.join(", ")}`);
  }
  return errors;
}
