import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * District grammar.
 *
 * A district is a rule for making city blocks, not a set of them. Each row says
 * how tall, how dense and how regular a part of the city is, and where it sits
 * relative to the water. `generateCityLayout` reads these rows and produces the
 * actual blocks, so a new district is a row here rather than a branch there.
 *
 * The Hong Kong plan below is an original stylised layout. It takes the shapes a
 * dense harbour city has - towers on the waterfront, a ridge behind, docks along
 * the shore, an improvised district grown against the Shatterdome wall - and
 * arranges them from a seed. No real street plan, building footprint or map
 * geometry is reproduced, and none is claimed. See GAME_SPEC.md on assets.
 */

export const DISTRICT_KINDS = [
  "downtown",
  "waterfront",
  "docks",
  "slums",
  "shatterdome",
  "hillside",
  "industrial",
] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

export interface DistrictDefinition extends RegistryEntry {
  readonly id: DistrictKind;
  readonly displayName: string;
  /** Metres along one edge of a typical block in this district. */
  readonly blockSizeMeters: number;
  /** Gap between blocks. Roads are drawn down these. */
  readonly streetWidthMeters: number;
  readonly minHeightMeters: number;
  readonly maxHeightMeters: number;
  /** 0 to 1. How much of the district's area is actually built on. */
  readonly coverage: number;
  /** How many separate towers stand on one block. Slums are many and small. */
  readonly towersPerBlock: number;
  /** 0 to 1. Zero is a perfect grid, one is completely irregular. */
  readonly irregularity: number;
  /** Linear RGB. What the district reads as from a distance. */
  readonly colour: readonly [number, number, number];
  /** 0 to 1 chance a block carries a lit sign at night. */
  readonly neonDensity: number;
  /** People per square kilometre, in thousands. Drives crowd and evacuation load. */
  readonly populationDensityThousands: number;
  /** 1 is evacuated first. Drives the order muster points fill. */
  readonly evacuationPriority: number;
  /** True where the shoreline runs through it, so it can host harbour lanes. */
  readonly coastal: boolean;
  readonly notes: string;
}

const DISTRICTS: readonly DistrictDefinition[] = [
  {
    id: "downtown",
    displayName: "Central towers",
    blockSizeMeters: 110,
    streetWidthMeters: 26,
    minHeightMeters: 90,
    maxHeightMeters: 420,
    coverage: 0.78,
    towersPerBlock: 2,
    irregularity: 0.12,
    colour: [0.42, 0.46, 0.52],
    neonDensity: 0.75,
    populationDensityThousands: 42,
    evacuationPriority: 2,
    coastal: false,
    notes: "Tight blocks and the tallest towers. The silhouette the region is recognised by.",
  },
  {
    id: "waterfront",
    displayName: "Harbour front",
    blockSizeMeters: 130,
    streetWidthMeters: 32,
    minHeightMeters: 40,
    maxHeightMeters: 240,
    coverage: 0.62,
    towersPerBlock: 1,
    irregularity: 0.22,
    colour: [0.46, 0.5, 0.56],
    neonDensity: 0.9,
    populationDensityThousands: 28,
    evacuationPriority: 1,
    coastal: true,
    notes: "First thing a kaiju walks through, and the first district evacuated.",
  },
  {
    id: "docks",
    displayName: "Container docks",
    blockSizeMeters: 190,
    streetWidthMeters: 44,
    minHeightMeters: 12,
    maxHeightMeters: 46,
    coverage: 0.55,
    towersPerBlock: 1,
    irregularity: 0.08,
    colour: [0.4, 0.38, 0.34],
    neonDensity: 0.1,
    populationDensityThousands: 4,
    evacuationPriority: 3,
    coastal: true,
    notes: "Low, wide, regular. Cranes stand here and shipping lanes end here.",
  },
  {
    id: "slums",
    displayName: "Bone Slums",
    blockSizeMeters: 58,
    streetWidthMeters: 11,
    minHeightMeters: 8,
    maxHeightMeters: 54,
    coverage: 0.88,
    towersPerBlock: 4,
    irregularity: 0.62,
    colour: [0.5, 0.44, 0.35],
    neonDensity: 0.55,
    populationDensityThousands: 96,
    evacuationPriority: 1,
    coastal: false,
    notes:
      "Grown against the Shatterdome wall out of what the last kaiju left. Densest, poorest, hardest to clear.",
  },
  {
    id: "shatterdome",
    displayName: "Shatterdome precinct",
    blockSizeMeters: 240,
    streetWidthMeters: 60,
    minHeightMeters: 30,
    maxHeightMeters: 110,
    coverage: 0.34,
    towersPerBlock: 1,
    irregularity: 0.05,
    colour: [0.34, 0.37, 0.41],
    neonDensity: 0.15,
    populationDensityThousands: 3,
    evacuationPriority: 5,
    coastal: true,
    notes: "Cleared ground, hangars and gantries. Evacuated last because it is where everyone else is sent.",
  },
  {
    id: "hillside",
    displayName: "Ridge terraces",
    blockSizeMeters: 96,
    streetWidthMeters: 20,
    minHeightMeters: 24,
    maxHeightMeters: 120,
    coverage: 0.44,
    towersPerBlock: 2,
    irregularity: 0.48,
    colour: [0.38, 0.44, 0.36],
    neonDensity: 0.28,
    populationDensityThousands: 18,
    evacuationPriority: 4,
    coastal: false,
    notes: "Terraced up the ridge behind the city. High ground, so muster points go here.",
  },
  {
    id: "industrial",
    displayName: "Works and yards",
    blockSizeMeters: 160,
    streetWidthMeters: 38,
    minHeightMeters: 16,
    maxHeightMeters: 72,
    coverage: 0.6,
    towersPerBlock: 1,
    irregularity: 0.18,
    colour: [0.44, 0.41, 0.38],
    neonDensity: 0.2,
    populationDensityThousands: 9,
    evacuationPriority: 3,
    coastal: false,
    notes: "Repair capacity and the reason the Shatterdome is here rather than somewhere prettier.",
  },
];

export function validateDistrict(district: DistrictDefinition): string[] {
  const errors: string[] = [];
  if (!DISTRICT_KINDS.includes(district.id)) {
    errors.push(`id must be one of: ${DISTRICT_KINDS.join(", ")}`);
  }
  if (!district.displayName) errors.push("displayName required");
  for (const key of [
    "blockSizeMeters",
    "streetWidthMeters",
    "minHeightMeters",
    "maxHeightMeters",
    "populationDensityThousands",
  ] as const) {
    if (!Number.isFinite(district[key]) || district[key] < 0) {
      errors.push(`${key} must be a non-negative finite number`);
    }
  }
  if (district.blockSizeMeters <= 0) errors.push("blockSizeMeters must be positive");
  if (district.maxHeightMeters < district.minHeightMeters) {
    errors.push("maxHeightMeters must not be below minHeightMeters");
  }
  for (const key of ["coverage", "irregularity", "neonDensity"] as const) {
    if (!Number.isFinite(district[key]) || district[key] < 0 || district[key] > 1) {
      errors.push(`${key} must be within [0, 1]`);
    }
  }
  if (!Number.isInteger(district.towersPerBlock) || district.towersPerBlock < 1) {
    errors.push("towersPerBlock must be a positive integer");
  }
  if (!Number.isInteger(district.evacuationPriority) || district.evacuationPriority < 1) {
    errors.push("evacuationPriority must be a positive integer");
  }
  if (district.colour.length !== 3 || district.colour.some((c) => !Number.isFinite(c) || c < 0 || c > 1)) {
    errors.push("colour must be three channels within [0, 1]");
  }
  return errors;
}

export function createDistrictRegistry(): ContentRegistry<DistrictDefinition> {
  const registry = new ContentRegistry<DistrictDefinition>(validateDistrict);
  for (const district of DISTRICTS) registry.register(district);
  return registry;
}

export const DISTRICT_DEFINITIONS = DISTRICTS;

/**
 * Where a district sits relative to the region centre and the water.
 *
 * `bearingOffsetDeg` is measured from the seaward bearing, so the whole plan
 * rotates with the coast rather than being pinned to compass north. Radii are
 * fractions of the region radius, which keeps one plan usable for regions of
 * different sizes.
 */
export interface DistrictPlacement {
  readonly districtId: DistrictKind;
  readonly innerRadiusFraction: number;
  readonly outerRadiusFraction: number;
  /** Degrees from the seaward bearing. Zero points at the water. */
  readonly bearingOffsetDeg: number;
  /** Angular width of the wedge, degrees. */
  readonly arcDeg: number;
}

/**
 * The Hong Kong plan: harbour ahead, towers behind it, docks along the shore one
 * way, the Shatterdome the other, slums pressed against the Shatterdome wall,
 * works inland and terraces up the ridge at the back.
 */
export const HONG_KONG_DISTRICT_PLAN: readonly DistrictPlacement[] = [
  {
    districtId: "waterfront",
    innerRadiusFraction: 0.1,
    outerRadiusFraction: 0.34,
    bearingOffsetDeg: 0,
    arcDeg: 92,
  },
  {
    districtId: "downtown",
    innerRadiusFraction: 0.16,
    outerRadiusFraction: 0.52,
    bearingOffsetDeg: 34,
    arcDeg: 86,
  },
  {
    districtId: "docks",
    innerRadiusFraction: 0.22,
    outerRadiusFraction: 0.6,
    bearingOffsetDeg: -68,
    arcDeg: 62,
  },
  {
    districtId: "shatterdome",
    innerRadiusFraction: 0.12,
    outerRadiusFraction: 0.42,
    bearingOffsetDeg: 96,
    arcDeg: 56,
  },
  {
    districtId: "slums",
    innerRadiusFraction: 0.3,
    outerRadiusFraction: 0.58,
    bearingOffsetDeg: 132,
    arcDeg: 64,
  },
  {
    districtId: "industrial",
    innerRadiusFraction: 0.44,
    outerRadiusFraction: 0.78,
    bearingOffsetDeg: -132,
    arcDeg: 70,
  },
  {
    districtId: "hillside",
    innerRadiusFraction: 0.52,
    outerRadiusFraction: 0.94,
    bearingOffsetDeg: 180,
    arcDeg: 128,
  },
];

export function validateDistrictPlan(plan: readonly DistrictPlacement[]): string[] {
  const errors: string[] = [];
  if (plan.length === 0) errors.push("a district plan needs at least one placement");
  for (const placement of plan) {
    if (!DISTRICT_KINDS.includes(placement.districtId)) {
      errors.push(`unknown district "${String(placement.districtId)}"`);
    }
    if (placement.innerRadiusFraction < 0 || placement.outerRadiusFraction > 1) {
      errors.push(`${placement.districtId} radii must be fractions within [0, 1]`);
    }
    if (placement.outerRadiusFraction <= placement.innerRadiusFraction) {
      errors.push(`${placement.districtId} outer radius must exceed its inner radius`);
    }
    if (!(placement.arcDeg > 0) || placement.arcDeg > 360) {
      errors.push(`${placement.districtId} arc must be within (0, 360]`);
    }
  }
  return errors;
}
