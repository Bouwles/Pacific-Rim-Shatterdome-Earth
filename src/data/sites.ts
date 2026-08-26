import { ContentRegistry, type RegistryEntry } from "./registry";
import { CLIMATE_ZONES, REGION_KINDS, type ClimateZone, type RegionKind } from "../world/regions";

/**
 * What is out there worth going to look at.
 *
 * The rule that shapes this whole file: **a site has to belong somewhere**.
 * Every entry states the kind of region it can appear in, and the validator
 * refuses one that could appear anywhere. That is what stops the map becoming a
 * uniform scatter of identical collectible icons: a trawler wreck is on a coast,
 * a training gate is at a Shatterdome, a research anomaly is somewhere nobody
 * lives, and a rescue call only happens where a city has been hit.
 *
 * The second rule: **a site is a place, not a pickup**. Most of them are worth
 * visiting once and then become somewhere you can deploy to, which is the whole
 * point of exploring a continuous Earth rather than collecting from it.
 *
 * No Babylon, no DOM, no RNG. This is a table.
 */

export const SITE_KINDS = [
  "salvage",
  "landmark",
  "shipping-incident",
  "military-exercise",
  "training-gate",
  "research-anomaly",
  "rescue-call",
  "hazard",
] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

/** How a point can become known. Each is a real route, not a difficulty. */
export const DISCOVERY_SOURCES = [
  /** Walked or flown within range of it. */
  "exploration",
  /** Named in a government contract. */
  "contract",
  /** Worked out by the complex's own analysts. */
  "intelligence",
  /** Handed over by an allied government. */
  "allied-government",
  /** Spotted on a carrier run to somewhere else. */
  "carrier",
  /** Opened up again by rebuilding something that was knocked down. */
  "repaired-infrastructure",
] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

/** What a region has to be like for a site to belong in it. */
export interface RegionRequirement {
  /** Region kinds this can appear in. Empty is refused. */
  readonly kinds: readonly RegionKind[];
  /** Climates it can appear in. Empty means any. */
  readonly climates: readonly ClimateZone[];
  /** Smallest population, in thousands, the region needs. */
  readonly minPopulationThousands: number;
  /** Largest population it tolerates. Some things only happen where nobody is. */
  readonly maxPopulationThousands: number;
  /** True when the region must have been damaged for this to appear. */
  readonly requiresDamage: boolean;
}

export interface SiteDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly kind: SiteKind;
  readonly requires: RegionRequirement;
  /**
   * Relative likelihood against other sites that fit the same region.
   *
   * Weights rather than counts, so a region with unusual traits gets the
   * unusual thing rather than one of everything.
   */
  readonly weight: number;
  /** What visiting it pays, once and only once. */
  readonly reward: {
    readonly funding: number;
    readonly alloy: number;
    readonly researchData: number;
    /** Sample ids handed over, if any. */
    readonly sampleIds: readonly string[];
  };
  /** True when reaching it opens a place the carrier can drop you in future. */
  readonly becomesDeployPoint: boolean;
  /** Ways this particular site can come to be known about. */
  readonly discoveredBy: readonly DiscoverySource[];
  /**
   * How dangerous standing here is, 0 to 1.
   *
   * Above zero means the site itself is a reason to be careful rather than a
   * reward with a coat of paint.
   */
  readonly danger: number;
  /** What it is, in words, for the map. */
  readonly description: string;
}

const SITES: readonly SiteDefinition[] = [
  // ============================ salvage ===================================
  {
    id: "site.salvage.trawler",
    displayName: "Grounded trawler",
    kind: "salvage",
    requires: {
      kinds: ["coastal-city", "ocean"],
      climates: [],
      minPopulationThousands: 0,
      maxPopulationThousands: 40_000,
      requiresDamage: false,
    },
    weight: 3,
    reward: { funding: 180_000, alloy: 90, researchData: 0, sampleIds: [] },
    becomesDeployPoint: false,
    discoveredBy: ["exploration", "carrier"],
    danger: 0.1,
    description: "Steel on a sandbar. Worth cutting up if you are passing.",
  },
  {
    id: "site.salvage.jaeger-wreck",
    displayName: "Jaeger wreck",
    kind: "salvage",
    requires: {
      kinds: ["coastal-city", "inland-city"],
      climates: [],
      minPopulationThousands: 0,
      maxPopulationThousands: 60_000,
      requiresDamage: true,
    },
    weight: 2,
    reward: { funding: 620_000, alloy: 320, researchData: 40, sampleIds: [] },
    becomesDeployPoint: true,
    discoveredBy: ["exploration", "intelligence", "repaired-infrastructure"],
    danger: 0.2,
    description: "Somebody else's machine, where it fell. The pad under it still works.",
  },

  // =========================== landmarks ==================================
  {
    id: "site.landmark.span",
    displayName: "Standing span",
    kind: "landmark",
    requires: {
      kinds: ["coastal-city"],
      climates: [],
      minPopulationThousands: 2_000,
      maxPopulationThousands: 60_000,
      requiresDamage: false,
    },
    weight: 2,
    reward: { funding: 90_000, alloy: 0, researchData: 20, sampleIds: [] },
    becomesDeployPoint: true,
    discoveredBy: ["exploration", "contract", "carrier"],
    danger: 0,
    description: "A bridge that has survived everything so far. Wide enough to set down on.",
  },
  {
    id: "site.landmark.range",
    displayName: "Ridge line",
    kind: "landmark",
    requires: {
      kinds: ["wilderness", "inland-city"],
      climates: ["subarctic", "temperate", "arid"],
      minPopulationThousands: 0,
      maxPopulationThousands: 20_000,
      requiresDamage: false,
    },
    weight: 2,
    reward: { funding: 60_000, alloy: 0, researchData: 30, sampleIds: [] },
    becomesDeployPoint: true,
    discoveredBy: ["exploration"],
    danger: 0.05,
    description: "High ground that sees a long way. Sensor crews have wanted it for years.",
  },

  // ======================= shipping incidents =============================
  {
    id: "site.shipping-incident.convoy",
    displayName: "Convoy in trouble",
    kind: "shipping-incident",
    requires: {
      kinds: ["ocean", "coastal-city"],
      climates: [],
      minPopulationThousands: 0,
      maxPopulationThousands: 80_000,
      requiresDamage: false,
    },
    weight: 3,
    reward: { funding: 340_000, alloy: 40, researchData: 0, sampleIds: [] },
    becomesDeployPoint: false,
    discoveredBy: ["contract", "carrier", "allied-government"],
    danger: 0.25,
    description: "A hull holed and taking water, and nobody else close enough.",
  },

  // ====================== military exercises ==============================
  {
    id: "site.military-exercise.live-fire",
    displayName: "Live fire exercise",
    kind: "military-exercise",
    requires: {
      kinds: ["wilderness", "inland-city"],
      climates: [],
      minPopulationThousands: 0,
      maxPopulationThousands: 12_000,
      requiresDamage: false,
    },
    weight: 2,
    reward: { funding: 220_000, alloy: 0, researchData: 60, sampleIds: [] },
    becomesDeployPoint: true,
    discoveredBy: ["allied-government", "intelligence"],
    danger: 0.15,
    description: "Somebody else's army, and an invitation to stand in it.",
  },

  // ======================== training gates ================================
  {
    id: "site.training-gate.proving",
    displayName: "Proving gate",
    kind: "training-gate",
    requires: {
      kinds: ["shatterdome"],
      climates: [],
      minPopulationThousands: 0,
      maxPopulationThousands: 100_000,
      requiresDamage: false,
    },
    weight: 4,
    reward: { funding: 0, alloy: 0, researchData: 80, sampleIds: [] },
    becomesDeployPoint: true,
    discoveredBy: ["exploration", "intelligence", "repaired-infrastructure"],
    danger: 0,
    description: "A course somebody built to find out what a machine can actually do.",
  },

  // ====================== research anomalies ==============================
  {
    id: "site.research-anomaly.reading",
    displayName: "Anomalous reading",
    kind: "research-anomaly",
    requires: {
      kinds: ["wilderness", "ocean"],
      climates: ["polar", "subarctic", "oceanic", "tropical"],
      minPopulationThousands: 0,
      maxPopulationThousands: 800,
      requiresDamage: false,
    },
    weight: 2,
    reward: { funding: 0, alloy: 0, researchData: 220, sampleIds: ["sample.blood"] },
    becomesDeployPoint: false,
    discoveredBy: ["intelligence", "exploration"],
    danger: 0.35,
    description: "Instruments disagreeing with each other, a long way from anywhere.",
  },

  // ========================= rescue calls =================================
  {
    id: "site.rescue-call.trapped",
    displayName: "Trapped civilians",
    kind: "rescue-call",
    requires: {
      kinds: ["coastal-city", "inland-city"],
      climates: [],
      minPopulationThousands: 500,
      maxPopulationThousands: 100_000,
      requiresDamage: true,
    },
    weight: 4,
    reward: { funding: 140_000, alloy: 0, researchData: 0, sampleIds: [] },
    becomesDeployPoint: false,
    discoveredBy: ["contract", "exploration", "allied-government"],
    danger: 0.2,
    description: "People under a building, and hours rather than days to get them out.",
  },

  // ============================ hazards ===================================
  {
    id: "site.hazard.spill",
    displayName: "Chemical spill",
    kind: "hazard",
    requires: {
      kinds: ["coastal-city", "ocean", "wilderness"],
      climates: [],
      minPopulationThousands: 0,
      maxPopulationThousands: 40_000,
      requiresDamage: false,
    },
    weight: 2,
    reward: { funding: 80_000, alloy: 0, researchData: 40, sampleIds: [] },
    becomesDeployPoint: false,
    discoveredBy: ["exploration", "carrier"],
    danger: 0.5,
    description: "Something in the water that eats hull coating. Worth knowing where it is.",
  },
  {
    id: "site.hazard.ice",
    displayName: "Unstable ice",
    kind: "hazard",
    requires: {
      kinds: ["wilderness", "ocean"],
      climates: ["polar", "subarctic"],
      minPopulationThousands: 0,
      maxPopulationThousands: 4_000,
      requiresDamage: false,
    },
    weight: 2,
    reward: { funding: 40_000, alloy: 0, researchData: 60, sampleIds: [] },
    becomesDeployPoint: false,
    discoveredBy: ["exploration"],
    danger: 0.45,
    description: "It will hold a machine, right up until it does not.",
  },
];

export function validateSite(entry: SiteDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("site.")) errors.push('id must start with "site."');
  if (!entry.id.startsWith(`site.${entry.kind}.`)) errors.push(`id must name its kind "${entry.kind}"`);
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (!SITE_KINDS.includes(entry.kind)) errors.push(`unknown kind "${entry.kind}"`);
  if (entry.weight <= 0) errors.push("weight must be positive");
  if (entry.danger < 0 || entry.danger > 1) errors.push("danger must be between 0 and 1");
  if (entry.discoveredBy.length === 0) {
    errors.push("a site nothing can discover is a site nobody will ever see");
  }
  for (const source of entry.discoveredBy) {
    if (!DISCOVERY_SOURCES.includes(source)) errors.push(`unknown discovery source "${source}"`);
  }

  const { requires } = entry;
  if (requires.kinds.length === 0) {
    // The rule that keeps the map from becoming a uniform scatter: a site that
    // belongs everywhere belongs nowhere in particular.
    errors.push("a site must say what kind of region it belongs in");
  }
  if (requires.kinds.length === REGION_KINDS.length && requires.climates.length === 0) {
    errors.push("a site that fits every region kind and every climate is not a place, it is wallpaper");
  }
  for (const kind of requires.kinds) {
    if (!REGION_KINDS.includes(kind)) errors.push(`unknown region kind "${kind}"`);
  }
  for (const climate of requires.climates) {
    if (!CLIMATE_ZONES.includes(climate)) errors.push(`unknown climate "${climate}"`);
  }
  if (requires.minPopulationThousands < 0) errors.push("minPopulationThousands cannot be negative");
  if (requires.maxPopulationThousands <= requires.minPopulationThousands) {
    errors.push("maxPopulationThousands must be above the minimum");
  }

  const { reward } = entry;
  for (const key of ["funding", "alloy", "researchData"] as const) {
    if (!Number.isFinite(reward[key]) || reward[key] < 0) errors.push(`reward.${key} must be zero or above`);
  }
  const paysSomething =
    reward.funding > 0 || reward.alloy > 0 || reward.researchData > 0 || reward.sampleIds.length > 0;
  if (!paysSomething && !entry.becomesDeployPoint) {
    errors.push("a site must be worth reaching, either for what it pays or for what it opens");
  }
  if (entry.description.trim().length === 0) errors.push("description is required");
  return errors;
}

export function createSiteRegistry(): ContentRegistry<SiteDefinition> {
  const registry = new ContentRegistry<SiteDefinition>(validateSite);
  for (const entry of SITES) registry.register(entry);
  return registry;
}

export const SITE_DEFINITIONS = SITES;

/** What a region is, as far as site placement is concerned. */
export interface RegionTraits {
  readonly kind: RegionKind;
  readonly climate: ClimateZone;
  readonly populationThousands: number;
  /** True when the region has been knocked about. */
  readonly damaged: boolean;
}

/** Whether a site belongs in a region at all. */
export function fitsRegion(site: SiteDefinition, traits: RegionTraits): boolean {
  const { requires } = site;
  if (!requires.kinds.includes(traits.kind)) return false;
  if (requires.climates.length > 0 && !requires.climates.includes(traits.climate)) return false;
  if (traits.populationThousands < requires.minPopulationThousands) return false;
  if (traits.populationThousands > requires.maxPopulationThousands) return false;
  if (requires.requiresDamage && !traits.damaged) return false;
  return true;
}

/** Every site that could appear in a region, with its weight. */
export function candidatesFor(traits: RegionTraits): readonly SiteDefinition[] {
  return SITES.filter((site) => fitsRegion(site, traits));
}
