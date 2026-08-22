import { ContentRegistry, type RegistryEntry } from "./registry";
import { CLIMATE_ZONES, type ClimateZone } from "../world/regions";

/**
 * Biome identity for generated terrain.
 *
 * This is broad-strokes climate, not geography. The generator knows latitude and
 * a seeded moisture field; it does not know where any real continent, mountain
 * range or river is, and nothing here should be read as a claim that it does.
 * See CONTENT_SCHEMA.md.
 *
 * One biome per climate zone, with a surface class layered on top, rather than a
 * biome per (climate, surface) pair. Seven rows and five surfaces beat a
 * thirty-five row table nobody would keep consistent.
 */

export interface BiomeDefinition extends RegistryEntry {
  readonly id: ClimateZone;
  readonly displayName: string;
  /** Base surface colour, linear RGB in [0, 1]. */
  readonly colour: readonly [number, number, number];
  /** Colour of standing water in this biome. */
  readonly waterColour: readonly [number, number, number];
  /** 0 to 1. Drives how much scatter the generator places on land. */
  readonly scatterDensity: number;
  readonly notes: string;
}

const BIOMES: readonly BiomeDefinition[] = [
  {
    id: "polar",
    displayName: "Polar",
    colour: [0.86, 0.9, 0.94],
    waterColour: [0.28, 0.42, 0.55],
    scatterDensity: 0.05,
    notes: "Ice shelf and exposed rock. Almost no scatter.",
  },
  {
    id: "subarctic",
    displayName: "Subarctic",
    colour: [0.34, 0.42, 0.36],
    waterColour: [0.16, 0.3, 0.4],
    scatterDensity: 0.35,
    notes: "Cold coast and conifer cover; the Anchorage and Vladivostok band.",
  },
  {
    id: "temperate",
    displayName: "Temperate",
    colour: [0.29, 0.44, 0.24],
    waterColour: [0.12, 0.28, 0.42],
    scatterDensity: 0.55,
    notes: "Mixed farmland and forest. The default look of an inhabited coast.",
  },
  {
    id: "subtropical",
    displayName: "Subtropical",
    colour: [0.27, 0.45, 0.21],
    waterColour: [0.1, 0.32, 0.45],
    scatterDensity: 0.6,
    notes: "Humid coastal hills; the Hong Kong band.",
  },
  {
    id: "tropical",
    displayName: "Tropical",
    colour: [0.2, 0.42, 0.18],
    waterColour: [0.08, 0.4, 0.5],
    scatterDensity: 0.75,
    notes: "Dense low canopy and shallow reef water.",
  },
  {
    id: "arid",
    displayName: "Arid",
    colour: [0.6, 0.5, 0.31],
    waterColour: [0.14, 0.3, 0.38],
    scatterDensity: 0.12,
    notes: "Dry coast and bare rock; the Lima band.",
  },
  {
    id: "oceanic",
    displayName: "Open ocean",
    colour: [0.16, 0.3, 0.36],
    waterColour: [0.06, 0.18, 0.32],
    scatterDensity: 0,
    notes: "Deep water with no land identity of its own.",
  },
];

export function validateBiome(biome: BiomeDefinition): string[] {
  const errors: string[] = [];
  if (!CLIMATE_ZONES.includes(biome.id)) {
    errors.push(`id must be a climate zone: ${CLIMATE_ZONES.join(", ")}`);
  }
  if (!biome.displayName) errors.push("displayName required");
  for (const key of ["colour", "waterColour"] as const) {
    const channels = biome[key];
    if (channels.length !== 3 || channels.some((c) => !Number.isFinite(c) || c < 0 || c > 1)) {
      errors.push(`${key} must be three channels within [0, 1]`);
    }
  }
  if (!Number.isFinite(biome.scatterDensity) || biome.scatterDensity < 0 || biome.scatterDensity > 1) {
    errors.push("scatterDensity must be within [0, 1]");
  }
  return errors;
}

export function createBiomeRegistry(): ContentRegistry<BiomeDefinition> {
  const registry = new ContentRegistry<BiomeDefinition>(validateBiome);
  for (const biome of BIOMES) registry.register(biome);
  return registry;
}

export const BIOME_DEFINITIONS = BIOMES;

/**
 * Surface classes layered over a biome, ordered from lowest to highest.
 *
 * `maxElevationMeters` is the top of each band. The last row is open-ended, so a
 * lookup always resolves rather than falling off the end of the table.
 */
export interface SurfaceClass {
  readonly id: string;
  readonly maxElevationMeters: number;
  /** Multiplier applied to the biome colour. Below 1 darkens, above 1 lightens. */
  readonly shade: number;
  readonly walkable: boolean;
}

export const SURFACE_CLASSES: readonly SurfaceClass[] = [
  { id: "seabed", maxElevationMeters: -120, shade: 0.45, walkable: false },
  { id: "shallows", maxElevationMeters: 0, shade: 0.7, walkable: false },
  { id: "shore", maxElevationMeters: 25, shade: 1.25, walkable: true },
  { id: "lowland", maxElevationMeters: 320, shade: 1, walkable: true },
  { id: "hills", maxElevationMeters: 900, shade: 0.85, walkable: true },
  { id: "highland", maxElevationMeters: 1_800, shade: 0.72, walkable: true },
  { id: "peak", maxElevationMeters: Number.POSITIVE_INFINITY, shade: 1.45, walkable: true },
];

/** Index into {@link SURFACE_CLASSES} for an elevation. */
export function surfaceClassIndex(elevationMeters: number): number {
  for (let index = 0; index < SURFACE_CLASSES.length; index += 1) {
    const entry = SURFACE_CLASSES[index];
    if (entry && elevationMeters <= entry.maxElevationMeters) return index;
  }
  return SURFACE_CLASSES.length - 1;
}

/**
 * Climate bands by absolute latitude, coldest last.
 *
 * A table rather than a chain of comparisons, so the boundaries are visible in
 * one place and a new band is a row instead of an edit to control flow.
 */
export const CLIMATE_BANDS: readonly { readonly maxAbsLatitudeDeg: number; readonly climate: ClimateZone }[] =
  [
    { maxAbsLatitudeDeg: 15, climate: "tropical" },
    { maxAbsLatitudeDeg: 28, climate: "subtropical" },
    { maxAbsLatitudeDeg: 48, climate: "temperate" },
    { maxAbsLatitudeDeg: 66, climate: "subarctic" },
    { maxAbsLatitudeDeg: 90, climate: "polar" },
  ];

export function climateForLatitude(latitudeDeg: number): ClimateZone {
  const absolute = Math.abs(latitudeDeg);
  for (const band of CLIMATE_BANDS) {
    if (absolute <= band.maxAbsLatitudeDeg) return band.climate;
  }
  return "polar";
}
