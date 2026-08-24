import { ContentRegistry, type RegistryEntry } from "./registry";
import type { DamageKind } from "./moves";
import type { Medium } from "./locomotionFamilies";

/**
 * What makes one attack different from the last one.
 *
 * A mutation is a modifier a creature arrives with: thicker plate, a second
 * organ, a taste for the water, a resistance it should not have. The director
 * is given a budget and spends it, so escalation shows up as creatures that are
 * harder in specific, readable ways rather than as a difficulty multiplier
 * nobody can see.
 *
 * Every mutation says what it costs, what it changes and what it cannot be
 * combined with. Nothing here knows a creature by name.
 */

export const MUTATION_KINDS = ["armour", "offence", "mobility", "sensory", "resilience", "swarm"] as const;
export type MutationKind = (typeof MUTATION_KINDS)[number];

export interface MutationDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly kind: MutationKind;
  /** Budget this costs the director. Higher is rarer and nastier. */
  readonly cost: number;
  /** Multiplier on the creature's damage. One means no change. */
  readonly damageScale: number;
  /** Multiplier on its effective armour. */
  readonly armourScale: number;
  /** Multiplier on its movement. */
  readonly speedScale: number;
  /** Multiplier on its sense ranges. */
  readonly senseScale: number;
  /** Extra resistance per damage kind, multiplied onto whatever it had. */
  readonly resistances: Partial<Record<DamageKind, number>>;
  /** Media this mutation opens up, such as a walker that can now swim. */
  readonly grantsMedia: readonly Medium[];
  /** Mutations that cannot appear alongside this one. */
  readonly excludes: readonly string[];
  /** Escalation at or above which the director may consider it, 0 to 1. */
  readonly minimumEscalation: number;
  /** What a warning would tell the player about it, in plain language. */
  readonly tell: string;
  readonly description: string;
}

const MUTATIONS: readonly MutationDefinition[] = [
  {
    id: "mutation.carapace",
    displayName: "Heavy carapace",
    kind: "armour",
    cost: 2,
    damageScale: 1,
    armourScale: 1.45,
    speedScale: 0.9,
    senseScale: 1,
    resistances: { pierce: 0.7, shear: 0.75 },
    grantsMedia: [],
    excludes: ["mutation.sprinter"],
    minimumEscalation: 0,
    tell: "Reads heavy on thermal. Expect plate before anything soft.",
    description: "Layered plate. Slower, and everything bounces off it for longer.",
  },
  {
    id: "mutation.sprinter",
    displayName: "Sprinter build",
    kind: "mobility",
    cost: 2,
    damageScale: 0.95,
    armourScale: 0.85,
    speedScale: 1.4,
    senseScale: 1,
    resistances: {},
    grantsMedia: [],
    excludes: ["mutation.carapace", "mutation.colossal-growth"],
    minimumEscalation: 0,
    tell: "Wake pattern is wrong for its size. It is going to be quick.",
    description: "Light and fast. It reaches the shore long before anyone is ready.",
  },
  {
    id: "mutation.acid-blood",
    displayName: "Acid blood",
    kind: "offence",
    cost: 3,
    damageScale: 1.2,
    armourScale: 1,
    speedScale: 1,
    senseScale: 1,
    resistances: { corrosive: 0.2 },
    grantsMedia: [],
    excludes: [],
    minimumEscalation: 0.2,
    tell: "Water samples came back wrong. Do not stand under it.",
    description: "Everything it bleeds on stops working. Cutting it open costs you.",
  },
  {
    id: "mutation.deep-lungs",
    displayName: "Deep lungs",
    kind: "mobility",
    cost: 2,
    damageScale: 1,
    armourScale: 1,
    speedScale: 1.05,
    senseScale: 1,
    resistances: {},
    grantsMedia: ["water"],
    excludes: [],
    minimumEscalation: 0.15,
    tell: "It went under an hour ago and has not come up.",
    description: "It can take the water route whatever it is, and it will.",
  },
  {
    id: "mutation.echo-organ",
    displayName: "Echo organ",
    kind: "sensory",
    cost: 2,
    damageScale: 1,
    armourScale: 1,
    speedScale: 1,
    senseScale: 1.6,
    resistances: {},
    grantsMedia: [],
    excludes: [],
    minimumEscalation: 0.25,
    tell: "It found the last patrol through a hillside. Hiding will not work.",
    description: "It knows where you are through cover, rubble and darkness.",
  },
  {
    id: "mutation.regenerator",
    displayName: "Regenerating tissue",
    kind: "resilience",
    cost: 4,
    damageScale: 1,
    armourScale: 1.1,
    speedScale: 1,
    senseScale: 1,
    resistances: { heat: 1.4 },
    grantsMedia: [],
    excludes: [],
    minimumEscalation: 0.4,
    tell: "Tissue samples are closing while we watch. Burn it or finish it fast.",
    description: "Anything that is not finished heals. Fire is the answer, and it knows.",
  },
  {
    id: "mutation.colossal-growth",
    displayName: "Colossal growth",
    kind: "resilience",
    cost: 5,
    damageScale: 1.5,
    armourScale: 1.3,
    speedScale: 0.75,
    senseScale: 0.9,
    resistances: { impact: 0.8 },
    grantsMedia: [],
    excludes: ["mutation.sprinter"],
    minimumEscalation: 0.55,
    tell: "Silhouette is half again the category we expected.",
    description: "Too big for the category it was called in as. Everything it does is worse.",
  },
  {
    id: "mutation.brood",
    displayName: "Brood carrier",
    kind: "swarm",
    cost: 4,
    damageScale: 0.9,
    armourScale: 1,
    speedScale: 0.95,
    senseScale: 1.1,
    resistances: {},
    grantsMedia: [],
    excludes: [],
    minimumEscalation: 0.5,
    tell: "It is carrying something. Whatever comes ashore, it will not come alone.",
    description: "It brings company. The fight is longer than the creature that started it.",
  },
];

export function validateMutation(entry: MutationDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("mutation.")) errors.push('id must start with "mutation."');
  if (!entry.displayName) errors.push("displayName required");
  if (!entry.description) errors.push("description required");
  if (!entry.tell) errors.push("tell required: a warning has to be able to say something about it");
  if (!MUTATION_KINDS.includes(entry.kind)) errors.push(`unknown mutation kind "${String(entry.kind)}"`);
  if (!Number.isInteger(entry.cost) || entry.cost <= 0) errors.push("cost must be a positive integer");
  for (const key of ["damageScale", "armourScale", "speedScale", "senseScale"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
  }
  for (const [kind, scale] of Object.entries(entry.resistances)) {
    if (!Number.isFinite(scale) || (scale as number) < 0) {
      errors.push(`resistance to ${kind} must be zero or more`);
    }
  }
  if (entry.minimumEscalation < 0 || entry.minimumEscalation > 1) {
    errors.push("minimumEscalation must be within [0, 1]");
  }
  // A mutation that changes nothing is a mutation the player cannot notice.
  const changesSomething =
    entry.damageScale !== 1 ||
    entry.armourScale !== 1 ||
    entry.speedScale !== 1 ||
    entry.senseScale !== 1 ||
    Object.keys(entry.resistances).length > 0 ||
    entry.grantsMedia.length > 0;
  if (!changesSomething) errors.push("a mutation must change something about the creature");
  return errors;
}

export function createMutationRegistry(): ContentRegistry<MutationDefinition> {
  const registry = new ContentRegistry<MutationDefinition>(validateMutation);
  for (const mutation of MUTATIONS) registry.register(mutation);
  // Exclusions have to name something real, or a rule silently never applies.
  for (const mutation of MUTATIONS) {
    for (const excluded of mutation.excludes) {
      if (!registry.get(excluded)) {
        throw new Error(`Mutation "${mutation.id}" excludes "${excluded}", which is not registered`);
      }
    }
  }
  return registry;
}

export const MUTATION_DEFINITIONS = MUTATIONS;

/** True when these two can appear on the same creature. */
export function compatible(a: MutationDefinition, b: MutationDefinition): boolean {
  return !a.excludes.includes(b.id) && !b.excludes.includes(a.id);
}

/** The combined effect of a set of mutations, as plain multipliers. */
export interface MutationEffect {
  readonly damageScale: number;
  readonly armourScale: number;
  readonly speedScale: number;
  readonly senseScale: number;
  readonly resistances: Partial<Record<DamageKind, number>>;
  readonly grantsMedia: readonly Medium[];
  readonly totalCost: number;
}

export function combineMutations(mutations: readonly MutationDefinition[]): MutationEffect {
  const resistances: Partial<Record<DamageKind, number>> = {};
  const media = new Set<Medium>();
  let damage = 1;
  let armour = 1;
  let speed = 1;
  let sense = 1;
  let cost = 0;
  for (const mutation of mutations) {
    damage *= mutation.damageScale;
    armour *= mutation.armourScale;
    speed *= mutation.speedScale;
    sense *= mutation.senseScale;
    cost += mutation.cost;
    for (const medium of mutation.grantsMedia) media.add(medium);
    for (const [kind, scale] of Object.entries(mutation.resistances)) {
      const key = kind as DamageKind;
      resistances[key] = (resistances[key] ?? 1) * (scale as number);
    }
  }
  return {
    damageScale: damage,
    armourScale: armour,
    speedScale: speed,
    senseScale: sense,
    resistances,
    grantsMedia: [...media],
    totalCost: cost,
  };
}
