import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * What a place does to a fight.
 *
 * A modifier is a property of the ground, the water or the weather somewhere,
 * never a property of the people who live there. Ice is slippery, a shallow bay
 * cannot be dived in, a harbour full of shipping is full of things to trip over,
 * and a mountain approach means a creature arrives from one direction rather
 * than any direction. That is the whole vocabulary.
 *
 * Every modifier changes numbers the simulation already reads, so a fight in
 * Anchorage genuinely goes differently from the same fight in Manila without
 * anything in combat knowing which city it is in.
 *
 * No Babylon, no DOM, no RNG. This is a table.
 */

export const MISSION_MODIFIER_IDS = [
  "ice",
  "typhoon",
  "dense-harbour",
  "volcanic-risk",
  "shallow-bay",
  "shipping-congestion",
  "mountainous-approach",
] as const;
export type MissionModifierId = (typeof MISSION_MODIFIER_IDS)[number];

export interface MissionModifierDefinition extends RegistryEntry {
  readonly id: MissionModifierId;
  readonly displayName: string;
  /**
   * Multiplier on how well a machine keeps its feet.
   *
   * Below one means it slides. Reaches locomotion through the same footing
   * value the controller already reads.
   */
  readonly footingScale: number;
  /** Multiplier on ranged accuracy. Below one is wind, spray or poor sight. */
  readonly accuracyScale: number;
  /** Multiplier on how far anything can be seen or tracked. */
  readonly visibilityScale: number;
  /**
   * Multiplier on how deep the water is off this shore.
   *
   * Below one is a shelf: a creature cannot submerge and neither can you, which
   * changes an entire class of approach.
   */
  readonly waterDepthScale: number;
  /** Multiplier on how much cover and clutter the ground offers. */
  readonly clutterScale: number;
  /** Multiplier on collateral damage done to the city per exchange. */
  readonly collateralScale: number;
  /** Multiplier on how fast the region rebuilds afterwards. */
  readonly rebuildScale: number;
  /**
   * How much this narrows where a creature can come from, 0 to 1.
   *
   * One means a single approach. Mountains and narrow straits do this; open
   * water does not.
   */
  readonly approachNarrowing: number;
  /** What it means for the crew, in words, for the briefing. */
  readonly briefing: string;
  readonly description: string;
}

const MODIFIERS: readonly MissionModifierDefinition[] = [
  {
    id: "ice",
    displayName: "Ice",
    footingScale: 0.72,
    accuracyScale: 0.94,
    visibilityScale: 0.88,
    waterDepthScale: 1,
    clutterScale: 0.85,
    collateralScale: 0.9,
    rebuildScale: 0.7,
    approachNarrowing: 0.2,
    briefing: "Footing is poor and everything takes longer to put right afterwards.",
    description: "Sea ice and frozen ground. A machine slides where it would normally plant.",
  },
  {
    id: "typhoon",
    displayName: "Typhoon season",
    footingScale: 0.88,
    accuracyScale: 0.7,
    visibilityScale: 0.55,
    waterDepthScale: 1.15,
    clutterScale: 1,
    collateralScale: 1.2,
    rebuildScale: 0.85,
    approachNarrowing: 0,
    briefing: "You will not see it coming until it is close, and ranged fire is a waste.",
    description: "Storm surge and driving rain. Sight and gunnery both suffer badly.",
  },
  {
    id: "dense-harbour",
    displayName: "Dense harbour",
    footingScale: 0.95,
    accuracyScale: 0.9,
    visibilityScale: 0.85,
    waterDepthScale: 0.8,
    clutterScale: 1.45,
    collateralScale: 1.35,
    rebuildScale: 0.9,
    approachNarrowing: 0.35,
    briefing: "Cranes, hulls and gantries everywhere. Good cover, expensive to break.",
    description: "A working port packed to the waterline. Cover in every direction and a bill for all of it.",
  },
  {
    id: "volcanic-risk",
    displayName: "Volcanic ground",
    footingScale: 0.9,
    accuracyScale: 1,
    visibilityScale: 0.8,
    waterDepthScale: 1,
    clutterScale: 1.1,
    collateralScale: 1.1,
    rebuildScale: 0.75,
    approachNarrowing: 0.45,
    briefing: "The ground is unstable and the air is dirty. Rebuilding here is slow.",
    description: "Ash, unstable slopes and geothermal vents. The terrain is a hazard in its own right.",
  },
  {
    id: "shallow-bay",
    displayName: "Shallow bay",
    footingScale: 1,
    accuracyScale: 1.05,
    visibilityScale: 1.1,
    waterDepthScale: 0.45,
    clutterScale: 0.8,
    collateralScale: 0.9,
    rebuildScale: 1,
    approachNarrowing: 0.55,
    briefing: "Nothing can submerge here, yours or theirs. It has to come in on the surface.",
    description: "A wide shelf with no depth to hide in. Every approach is visible from a long way out.",
  },
  {
    id: "shipping-congestion",
    displayName: "Shipping congestion",
    footingScale: 1,
    accuracyScale: 0.88,
    visibilityScale: 0.9,
    waterDepthScale: 1,
    clutterScale: 1.25,
    collateralScale: 1.45,
    rebuildScale: 0.95,
    approachNarrowing: 0.25,
    briefing: "The lanes are full. Anything that misses hits somebody's hull.",
    description: "One of the busiest waterways there is. Traffic is cover and traffic is casualties.",
  },
  {
    id: "mountainous-approach",
    displayName: "Mountainous approach",
    footingScale: 0.85,
    accuracyScale: 1.1,
    visibilityScale: 1.2,
    waterDepthScale: 1,
    clutterScale: 1.15,
    collateralScale: 0.8,
    rebuildScale: 0.85,
    approachNarrowing: 0.75,
    briefing: "It can only come up the valley. Get there first and it is a corridor fight.",
    description: "High ground on three sides. Long sightlines and exactly one way in.",
  },
];

export function validateMissionModifier(entry: MissionModifierDefinition): string[] {
  const errors: string[] = [];
  if (!MISSION_MODIFIER_IDS.includes(entry.id)) errors.push(`unknown modifier id "${entry.id}"`);
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  for (const key of [
    "footingScale",
    "accuracyScale",
    "visibilityScale",
    "waterDepthScale",
    "clutterScale",
    "collateralScale",
    "rebuildScale",
  ] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
    if (entry[key] > 2) errors.push(`${key} above two is not a modifier, it is a different game`);
  }
  if (entry.approachNarrowing < 0 || entry.approachNarrowing > 1) {
    errors.push("approachNarrowing must be between 0 and 1");
  }
  // A modifier that changes nothing is a label, and a label is not identity.
  const changesSomething =
    entry.footingScale !== 1 ||
    entry.accuracyScale !== 1 ||
    entry.visibilityScale !== 1 ||
    entry.waterDepthScale !== 1 ||
    entry.clutterScale !== 1 ||
    entry.collateralScale !== 1 ||
    entry.rebuildScale !== 1 ||
    entry.approachNarrowing !== 0;
  if (!changesSomething) errors.push("a modifier that changes nothing is a label");
  if (entry.briefing.trim().length === 0) errors.push("briefing is required");
  if (entry.description.trim().length === 0) errors.push("description is required");
  return errors;
}

export function createMissionModifierRegistry(): ContentRegistry<MissionModifierDefinition> {
  const registry = new ContentRegistry<MissionModifierDefinition>(validateMissionModifier);
  for (const entry of MODIFIERS) registry.register(entry);
  return registry;
}

export const MISSION_MODIFIERS = MODIFIERS;

/** Everything the fight reads, once the modifiers on a place are combined. */
export interface CombinedModifiers {
  readonly footingScale: number;
  readonly accuracyScale: number;
  readonly visibilityScale: number;
  readonly waterDepthScale: number;
  readonly clutterScale: number;
  readonly collateralScale: number;
  readonly rebuildScale: number;
  readonly approachNarrowing: number;
  readonly briefings: readonly string[];
}

export function neutralModifiers(): CombinedModifiers {
  return {
    footingScale: 1,
    accuracyScale: 1,
    visibilityScale: 1,
    waterDepthScale: 1,
    clutterScale: 1,
    collateralScale: 1,
    rebuildScale: 1,
    approachNarrowing: 0,
    briefings: [],
  };
}

/**
 * Combines the modifiers on one place.
 *
 * Scales multiply, because two things that each make footing worse make it
 * worse than either alone. Narrowing takes the strongest rather than adding,
 * because two reasons a creature can only come one way is still one way.
 */
export function combineModifiers(
  ids: readonly MissionModifierId[],
  registry: ContentRegistry<MissionModifierDefinition> = createMissionModifierRegistry(),
): CombinedModifiers {
  const combined = { ...neutralModifiers() } as {
    footingScale: number;
    accuracyScale: number;
    visibilityScale: number;
    waterDepthScale: number;
    clutterScale: number;
    collateralScale: number;
    rebuildScale: number;
    approachNarrowing: number;
    briefings: string[];
  };
  combined.briefings = [];

  for (const id of ids) {
    const modifier = registry.get(id);
    if (!modifier) continue;
    combined.footingScale *= modifier.footingScale;
    combined.accuracyScale *= modifier.accuracyScale;
    combined.visibilityScale *= modifier.visibilityScale;
    combined.waterDepthScale *= modifier.waterDepthScale;
    combined.clutterScale *= modifier.clutterScale;
    combined.collateralScale *= modifier.collateralScale;
    combined.rebuildScale *= modifier.rebuildScale;
    combined.approachNarrowing = Math.max(combined.approachNarrowing, modifier.approachNarrowing);
    combined.briefings.push(modifier.briefing);
  }

  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    footingScale: round(combined.footingScale),
    accuracyScale: round(combined.accuracyScale),
    visibilityScale: round(combined.visibilityScale),
    waterDepthScale: round(combined.waterDepthScale),
    clutterScale: round(combined.clutterScale),
    collateralScale: round(combined.collateralScale),
    rebuildScale: round(combined.rebuildScale),
    approachNarrowing: round(combined.approachNarrowing),
    briefings: combined.briefings,
  };
}
