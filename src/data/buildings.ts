import { ContentRegistry, type RegistryEntry } from "./registry";
import type { DistrictKind } from "./districts";

/**
 * What the city is made of, and what happens to it.
 *
 * Every structure in a district is one of a handful of archetypes: a harbour
 * tower, a tenement stack, a warehouse, a viaduct. An archetype says how much
 * punishment the thing takes, how it comes apart, how long it burns, how much
 * rubble it leaves, and what it costs to clear and rebuild.
 *
 * The seven states are the whole lifecycle of a building in this game:
 *
 * - **intact**: untouched.
 * - **damaged**: scarred, still standing, still working.
 * - **breached**: opened up, structurally compromised, no longer usable.
 * - **collapsing**: coming down right now. A short, loud state.
 * - **ruined**: down, and in the way. Blocks roads and routes.
 * - **cleared**: the rubble is gone. An empty lot.
 * - **rebuilding**: work is underway on a replacement.
 *
 * Nothing here imports Babylon or the DOM. A state is a name and a set of
 * numbers; what a state looks like is the renderer's problem.
 */

export const BUILDING_STATES = [
  "intact",
  "damaged",
  "breached",
  "collapsing",
  "ruined",
  "cleared",
  "rebuilding",
] as const;
export type BuildingState = (typeof BUILDING_STATES)[number];

/** Where each state begins, as a fraction of the structure's own integrity. */
const STATE_THRESHOLDS: readonly { readonly state: BuildingState; readonly above: number }[] = [
  { state: "intact", above: 0.85 },
  { state: "damaged", above: 0.55 },
  { state: "breached", above: 0.15 },
];

/**
 * The standing state for an integrity value.
 *
 * Only covers the states a structure falls into by being hit. Collapsing,
 * ruined, cleared and rebuilding are stages a structure is moved through by
 * time and work, not by damage, so they are never returned here.
 */
export function standingState(integrity: number): BuildingState {
  if (integrity <= 0) return "collapsing";
  for (const step of STATE_THRESHOLDS) {
    if (integrity > step.above) return step.state;
  }
  return "breached";
}

/** True when the structure is no longer holding anything up. */
export function isDown(state: BuildingState): boolean {
  return state === "collapsing" || state === "ruined";
}

/** True when the state leaves rubble in the road. */
export function blocksRoutes(state: BuildingState): boolean {
  return state === "collapsing" || state === "ruined";
}

export interface BuildingArchetype extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** Districts this archetype is used for. Empty means anywhere. */
  readonly districts: readonly DistrictKind[];
  /** Structure per metre of height. A tower has more to lose than a shed. */
  readonly structurePerMeter: number;
  /**
   * True for structures worth authoring fracture chunks for: landmarks and the
   * towers close enough to matter. Everything else is swapped and decalled.
   */
  readonly fractured: boolean;
  /** How many authored chunks a fractured structure comes apart into. */
  readonly fractureChunks: number;
  /** Debris bodies a collapse yields, before the pool ceiling is applied. */
  readonly debrisYield: number;
  /** Seconds spent in the collapsing state before it is simply ruined. */
  readonly collapseSeconds: number;
  /** Fraction of the original height the rubble pile stands at. */
  readonly rubbleHeightFraction: number;
  /** 0 to 1 chance a collapse starts a fire. */
  readonly fireChance: number;
  /** 0 to 1 chance a collapse leaves contamination behind. */
  readonly contaminationChance: number;
  /** People at risk per structure, thousands, at full occupancy. */
  readonly occupancyThousands: number;
  /** Crew hours to clear the rubble from one structure. */
  readonly clearHours: number;
  /** Crew hours to put a replacement up, once the lot is clear. */
  readonly rebuildHours: number;
  /** Funding to rebuild one structure. */
  readonly rebuildCost: number;
  readonly description: string;
}

const ARCHETYPES: readonly BuildingArchetype[] = [
  {
    id: "building.harbour-tower",
    displayName: "Harbour tower",
    districts: ["waterfront", "downtown"],
    structurePerMeter: 42,
    fractured: true,
    fractureChunks: 14,
    debrisYield: 26,
    collapseSeconds: 9,
    rubbleHeightFraction: 0.18,
    fireChance: 0.35,
    contaminationChance: 0.05,
    occupancyThousands: 2.4,
    clearHours: 210,
    rebuildHours: 1_400,
    rebuildCost: 8_600_000,
    description: "Glass and steel on the water. Comes apart in slabs and burns for a long time.",
  },
  {
    id: "building.tenement-stack",
    displayName: "Tenement stack",
    districts: ["slums", "hillside"],
    structurePerMeter: 18,
    fractured: false,
    fractureChunks: 0,
    debrisYield: 12,
    collapseSeconds: 5,
    rubbleHeightFraction: 0.3,
    fireChance: 0.55,
    contaminationChance: 0.02,
    occupancyThousands: 4.1,
    clearHours: 90,
    rebuildHours: 420,
    rebuildCost: 1_200_000,
    description: "Packed housing built fast and cheap. Falls quickly and holds the most people.",
  },
  {
    id: "building.dock-warehouse",
    displayName: "Dock warehouse",
    districts: ["docks", "industrial"],
    structurePerMeter: 26,
    fractured: false,
    fractureChunks: 0,
    debrisYield: 18,
    collapseSeconds: 4,
    rubbleHeightFraction: 0.22,
    fireChance: 0.4,
    contaminationChance: 0.25,
    occupancyThousands: 0.3,
    clearHours: 120,
    rebuildHours: 380,
    rebuildCost: 900_000,
    description: "Wide, low, and full of whatever was being shipped. The contamination risk lives here.",
  },
  {
    id: "building.precinct-block",
    displayName: "Precinct block",
    districts: ["shatterdome"],
    structurePerMeter: 58,
    fractured: true,
    fractureChunks: 18,
    debrisYield: 30,
    collapseSeconds: 12,
    rubbleHeightFraction: 0.2,
    fireChance: 0.2,
    contaminationChance: 0.08,
    occupancyThousands: 1.2,
    clearHours: 260,
    rebuildHours: 1_900,
    rebuildCost: 12_400_000,
    description:
      "Hardened concrete around the complex. Takes the most to bring down and the most to replace.",
  },
  {
    id: "building.viaduct",
    displayName: "Viaduct",
    districts: [],
    structurePerMeter: 34,
    fractured: true,
    fractureChunks: 10,
    debrisYield: 22,
    collapseSeconds: 6,
    rubbleHeightFraction: 0.12,
    fireChance: 0.1,
    contaminationChance: 0.03,
    occupancyThousands: 0.2,
    clearHours: 150,
    rebuildHours: 900,
    rebuildCost: 4_100_000,
    description: "Roadway on piers. Dropping one closes the route under it as well as the one on it.",
  },
];

export function validateBuildingArchetype(entry: BuildingArchetype): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("building.")) errors.push('id must start with "building."');
  if (!entry.displayName) errors.push("displayName required");
  if (!entry.description) errors.push("description required");
  for (const key of [
    "structurePerMeter",
    "debrisYield",
    "collapseSeconds",
    "clearHours",
    "rebuildHours",
    "rebuildCost",
  ] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
  }
  for (const key of ["fireChance", "contaminationChance", "rubbleHeightFraction"] as const) {
    const value = entry[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${key} must be within [0, 1]`);
    }
  }
  if (entry.occupancyThousands < 0) errors.push("occupancyThousands must be zero or more");
  // Fracture chunks are the expensive path, so an archetype has to mean it.
  if (entry.fractured && entry.fractureChunks < 4) {
    errors.push("a fractured archetype needs at least four authored chunks, or it should not be fractured");
  }
  if (!entry.fractured && entry.fractureChunks > 0) {
    errors.push("only a fractured archetype may declare chunks: everything else is swapped and decalled");
  }
  // Rebuilding must cost more than clearing, or nobody would ever clear a site.
  if (entry.rebuildHours <= entry.clearHours) {
    errors.push("rebuildHours must exceed clearHours: putting one up is more work than taking one away");
  }
  return errors;
}

export function createBuildingRegistry(): ContentRegistry<BuildingArchetype> {
  const registry = new ContentRegistry<BuildingArchetype>(validateBuildingArchetype);
  for (const archetype of ARCHETYPES) registry.register(archetype);
  return registry;
}

export const BUILDING_ARCHETYPES = ARCHETYPES;

/**
 * Which archetype a district builds with.
 *
 * A lookup over the table rather than a switch on the district name, so adding
 * a district or an archetype is a data change. Anything unlisted falls back to
 * the first archetype that takes any district.
 */
export function archetypeForDistrict(
  registry: ContentRegistry<BuildingArchetype>,
  districtId: DistrictKind,
): BuildingArchetype {
  const match = registry.all().find((entry) => entry.districts.includes(districtId));
  if (match) return match;
  const anywhere = registry.all().find((entry) => entry.districts.length === 0);
  const fallback = anywhere ?? registry.all()[0];
  if (!fallback) throw new Error("No building archetypes are registered");
  return fallback;
}

/** How much punishment one structure of this archetype takes at this height. */
export function structureFor(archetype: BuildingArchetype, heightMeters: number): number {
  return Math.max(1, Math.round(archetype.structurePerMeter * Math.max(1, heightMeters)));
}
