import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Passive traits.
 *
 * A passive is a choice, not a reward: every one of them costs something, and
 * the tradeoff is written into the row rather than hidden in a tooltip. Four
 * choices over a climb to the cap, from a table of ten, so two machines of the
 * same chassis end up different because their crews decided differently.
 *
 * A passive contributes multipliers to the same `MachineGrowth` object levels
 * feed, so nothing downstream needs a second code path. Adding a passive is a
 * row here, and nothing else.
 */

export const PASSIVE_TIERS = [1, 2, 3, 4] as const;
export type PassiveTier = (typeof PASSIVE_TIERS)[number];

export interface PassiveDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** Which of the four choices this can be taken at. Later tiers are stronger and cost more. */
  readonly tier: PassiveTier;
  /** Multipliers applied to the machine's growth. Anything omitted is 1. */
  readonly structure?: number;
  readonly damage?: number;
  readonly heat?: number;
  readonly mobility?: number;
  /** What it costs. Every passive gives something up, and this says what. */
  readonly tradeoff: string;
  readonly description: string;
}

const DEFINITIONS: readonly PassiveDefinition[] = [
  {
    id: "passive.reinforced-frame",
    displayName: "Reinforced frame",
    tier: 1,
    structure: 1.1,
    mobility: 0.96,
    tradeoff: "Heavier. It walks and turns a little slower for the rest of its life.",
    description: "Extra ribbing through the torso and shoulders. Takes more before anything gives.",
  },
  {
    id: "passive.tuned-actuators",
    displayName: "Tuned actuators",
    tier: 1,
    mobility: 1.09,
    structure: 0.97,
    tradeoff: "Lighter linkages. Slightly less able to absorb a hit.",
    description: "Faster on its feet and quicker to turn, at the cost of some margin in the joints.",
  },
  {
    id: "passive.overpressure-coolant",
    displayName: "Overpressure coolant",
    tier: 1,
    heat: 1.12,
    damage: 0.97,
    tradeoff: "Some reactor output is spent on cooling rather than on the swing.",
    description: "Keeps swinging for longer before the heat locks it out.",
  },
  {
    id: "passive.weighted-knuckles",
    displayName: "Weighted knuckles",
    tier: 2,
    damage: 1.1,
    heat: 0.95,
    tradeoff: "Runs hotter. The lockout arrives sooner.",
    description: "Mass moved into the hands. Every impact lands harder.",
  },
  {
    id: "passive.ablative-plating",
    displayName: "Ablative plating",
    tier: 2,
    structure: 1.14,
    mobility: 0.94,
    tradeoff: "Real weight, and it shows in every step.",
    description: "Sacrificial plate over the critical components. It survives things it should not.",
  },
  {
    id: "passive.drift-rhythm",
    displayName: "Drift rhythm",
    tier: 2,
    damage: 1.07,
    heat: 1.07,
    mobility: 0.95,
    tradeoff: "Everything is timed to the swing. It steps and turns less freely between them.",
    description: "The pair and the machine learn each other. Cleaner strikes, less wasted energy.",
  },
  {
    id: "passive.reactor-tap",
    displayName: "Reactor tap",
    tier: 3,
    damage: 1.15,
    structure: 0.95,
    tradeoff: "Pulls power through the frame. It carries less damage before failing.",
    description: "More of the reactor reaches the arms, and the frame lives with the consequences.",
  },
  {
    id: "passive.load-bearing-spine",
    displayName: "Load bearing spine",
    tier: 3,
    structure: 1.18,
    damage: 0.96,
    tradeoff: "Stiffer through the middle. Less of the swing carries through.",
    description: "The spine takes the load the shoulders used to. Very hard to put down.",
  },
  {
    id: "passive.veteran-hull",
    displayName: "Veteran hull",
    tier: 4,
    structure: 1.12,
    heat: 1.08,
    damage: 1.04,
    tradeoff: "Only available to a machine that has been all the way up once. Nothing given up.",
    description: "Twenty years of repairs, each one a little better than the plate it replaced.",
  },
  {
    id: "passive.finishing-instinct",
    displayName: "Finishing instinct",
    tier: 4,
    damage: 1.18,
    structure: 0.94,
    tradeoff: "Built to end fights rather than survive them.",
    description: "Everything is set up for the last exchange rather than the first.",
  },
];

export function validatePassive(entry: PassiveDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("passive.")) errors.push('passive ids must start with "passive."');
  if (!PASSIVE_TIERS.includes(entry.tier)) errors.push(`unknown tier ${entry.tier}`);

  const axes = [entry.structure, entry.damage, entry.heat, entry.mobility];
  if (axes.every((value) => value === undefined)) {
    errors.push("a passive that changes nothing is not a choice");
  }
  for (const value of axes) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      errors.push("every multiplier must be a positive number");
    }
  }
  // A passive that is better at everything is not a decision, it is a reward.
  // Tier four is the exception, earned by having been to the cap and back.
  const gains = axes.filter((value) => value !== undefined && value > 1).length;
  const losses = axes.filter((value) => value !== undefined && value < 1).length;
  if (entry.tier < 4 && losses === 0) {
    errors.push("a passive below tier four must give something up, or it is not a choice");
  }
  if (gains === 0) errors.push("a passive must be worth taking");
  if (entry.tradeoff.trim().length < 10) errors.push("the tradeoff must be written out in words");
  return errors;
}

export function createPassiveRegistry(): ContentRegistry<PassiveDefinition> {
  const registry = new ContentRegistry<PassiveDefinition>(validatePassive);
  for (const entry of DEFINITIONS) registry.register(entry);
  return registry;
}

export const PASSIVE_DEFINITIONS = DEFINITIONS;

/** What a machine may choose from at this tier. */
export function passivesForTier(
  registry: ContentRegistry<PassiveDefinition>,
  tier: PassiveTier,
): readonly PassiveDefinition[] {
  return registry.all().filter((entry) => entry.tier === tier);
}

/** The multipliers a set of chosen passives contributes, multiplied together. */
export function passiveBonus(
  registry: ContentRegistry<PassiveDefinition>,
  chosen: readonly string[],
): { structure: number; damage: number; heat: number; mobility: number } {
  const total = { structure: 1, damage: 1, heat: 1, mobility: 1 };
  for (const id of chosen) {
    const entry = registry.get(id);
    if (!entry) continue;
    total.structure *= entry.structure ?? 1;
    total.damage *= entry.damage ?? 1;
    total.heat *= entry.heat ?? 1;
    total.mobility *= entry.mobility ?? 1;
  }
  return total;
}
