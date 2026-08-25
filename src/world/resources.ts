import { ContentRegistry, type RegistryEntry } from "../data/registry";

/**
 * What the programme actually spends.
 *
 * The rule every entry here has to pass: it must have a sink nothing else
 * covers. A resource that is only ever earned, or that is spent on the same
 * things funding is spent on, is complexity for its own sake and the registry
 * refuses it. That is why there are six and not sixteen, and why regional
 * tokens are not among them: nothing needed one.
 *
 * Reputation is deliberately not here. It is not spent, it is held, and it
 * already lives per manufacturer where it is used.
 */

export const RESOURCE_KINDS = [
  /** The general fund. Wages, contracts, construction, purchases, upkeep. */
  "funding",
  /** Structural plate. Armour and frame repair, and nothing else. */
  "alloy",
  /** Actuators, optics, control runs. Component replacement and modules. */
  "components",
  /** Shielding and fuel. Reactor tiers and anything that draws on one. */
  "reactorMaterial",
  /** Kaiju tissue, by class. Converted into research data, never spent raw. */
  "tissue",
  /** What the laboratories produce. Research, and the machines it unlocks. */
  "researchData",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Tissue is not one thing. Class decides what it is worth to research. */
export const TISSUE_CLASSES = ["common", "rare", "exotic"] as const;
export type TissueClass = (typeof TISSUE_CLASSES)[number];

/** Research data one ton of each class converts into. */
export const TISSUE_VALUE: Readonly<Record<TissueClass, number>> = {
  common: 1,
  rare: 4,
  exotic: 12,
};

export interface ResourceDefinition extends RegistryEntry {
  readonly id: ResourceKind;
  readonly displayName: string;
  /** What it is measured in, for a panel that should not say "12 funding". */
  readonly unit: string;
  /**
   * What it is spent on. At least one, and no two resources may share their
   * whole list: a resource that buys only what another already buys is a second
   * name for the same thing.
   */
  readonly sinks: readonly string[];
  /** Where it comes from. At least one, or it is unobtainable. */
  readonly sources: readonly string[];
  /** True when it may go below zero. Only the general fund may. */
  readonly canGoNegative: boolean;
  readonly description: string;
}

const DEFINITIONS: readonly ResourceDefinition[] = [
  {
    id: "funding",
    displayName: "Funding",
    unit: "credits",
    sinks: ["machine purchases", "construction", "upkeep", "repair labour", "modules"],
    sources: ["government contracts", "defence rewards", "manufacturer deals", "facility income"],
    // The one resource that can go negative, because a programme in debt is a
    // situation to dig out of rather than a state the game refuses to enter.
    canGoNegative: true,
    description: "The general fund. Everything is paid for out of it in the end.",
  },
  {
    id: "alloy",
    displayName: "Structural alloy",
    unit: "tons",
    sinks: ["armour repair", "frame repair"],
    sources: ["salvage rights", "manufacture", "exploration finds"],
    canGoNegative: false,
    description: "Plate and beam. What a machine is patched back together with.",
  },
  {
    id: "components",
    displayName: "Components",
    unit: "units",
    sinks: ["component replacement", "machine modules"],
    sources: ["salvage rights", "manufacture", "manufacturer deals"],
    canGoNegative: false,
    description: "Actuators, optics and control runs. Fitted, not welded.",
  },
  {
    id: "reactorMaterial",
    displayName: "Reactor material",
    unit: "units",
    sinks: ["reactor construction", "reactor modules"],
    sources: ["government contracts", "exploration finds"],
    canGoNegative: false,
    description: "Shielding and fuel. Controlled, rationed, and never bought casually.",
  },
  {
    id: "tissue",
    displayName: "Kaiju tissue",
    unit: "tons",
    sinks: ["research conversion", "containment upkeep"],
    sources: ["salvage rights", "containment"],
    canGoNegative: false,
    description: "What comes back from a kill. Worth nothing until a laboratory works on it.",
  },
  {
    id: "researchData",
    displayName: "Research data",
    unit: "points",
    sinks: ["research programmes", "exclusive chassis"],
    sources: ["research conversion", "exploration finds"],
    canGoNegative: false,
    description: "What the laboratories produce, and the only thing research spends.",
  },
];

export function validateResource(entry: ResourceDefinition): string[] {
  const errors: string[] = [];
  if (!RESOURCE_KINDS.includes(entry.id)) errors.push(`unknown resource "${entry.id}"`);
  if (entry.sinks.length === 0) {
    errors.push("a resource with nothing to spend it on is a number that goes up");
  }
  if (entry.sources.length === 0) errors.push("a resource with no source can never be obtained");
  if (!entry.unit) errors.push("say what it is measured in");
  if (entry.description.trim().length < 15) errors.push("say what it is, in words");
  return errors;
}

export function createResourceRegistry(): ContentRegistry<ResourceDefinition> {
  const registry = new ContentRegistry<ResourceDefinition>(validateResource);
  for (const entry of DEFINITIONS) registry.register(entry);

  // The rule that keeps the list honest: no resource may be a second name for
  // another. Two resources sharing every sink are the same resource twice.
  for (const first of DEFINITIONS) {
    for (const second of DEFINITIONS) {
      if (first.id >= second.id) continue;
      const shared = first.sinks.filter((sink) => second.sinks.includes(sink));
      if (shared.length === first.sinks.length && shared.length === second.sinks.length) {
        throw new Error(`"${first.id}" and "${second.id}" are spent on exactly the same things`);
      }
    }
  }
  return registry;
}

export const RESOURCE_DEFINITIONS = DEFINITIONS;

/** A whole balance sheet. Tissue is held per class; everything else is a number. */
export interface ResourcePool {
  funding: number;
  alloy: number;
  components: number;
  reactorMaterial: number;
  tissue: Record<TissueClass, number>;
  researchData: number;
}

export function emptyPool(): ResourcePool {
  return {
    funding: 0,
    alloy: 0,
    components: 0,
    reactorMaterial: 0,
    tissue: { common: 0, rare: 0, exotic: 0 },
    researchData: 0,
  };
}

/** Total tons of tissue held, whatever class. */
export function tissueTons(pool: ResourcePool): number {
  return TISSUE_CLASSES.reduce((total, kind) => total + (pool.tissue[kind] ?? 0), 0);
}

/** What the tissue on hand would convert into, before any laboratory bonus. */
export function tissueWorth(pool: ResourcePool): number {
  return TISSUE_CLASSES.reduce((total, kind) => total + (pool.tissue[kind] ?? 0) * TISSUE_VALUE[kind], 0);
}

/** Reads one resource off the pool, with tissue summed across its classes. */
export function amountOf(pool: ResourcePool, kind: ResourceKind): number {
  if (kind === "tissue") return tissueTons(pool);
  return pool[kind];
}
