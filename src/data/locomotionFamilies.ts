import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * How a creature gets around.
 *
 * A kaiju is not a reskinned humanoid. A serpent cannot turn on the spot, a
 * burrower does not care that a road is blocked, a swimmer is faster in the
 * water than out of it, and a colossal thing walks through a building rather
 * than around it. All of that is numbers on a family, read by the shared
 * movement and navigation code, so adding a family is a row rather than a
 * branch.
 *
 * Nothing here imports Babylon or the DOM.
 */

export const LOCOMOTION_FAMILIES = [
  "biped",
  "quadruped",
  "serpentine",
  "winged",
  "burrower",
  "swimmer",
  "amphibious",
  "crawler",
  "colossal",
] as const;
export type LocomotionFamily = (typeof LOCOMOTION_FAMILIES)[number];

/** The surfaces a body can be on. Read by navigation, never switched on. */
export const MEDIA = ["ground", "water", "underground", "air", "wall"] as const;
export type Medium = (typeof MEDIA)[number];

export interface LocomotionFamilyDefinition extends RegistryEntry {
  readonly id: LocomotionFamily;
  readonly displayName: string;
  /** Media this family can travel through at all. */
  readonly media: readonly Medium[];
  /** Metres per second on open ground, before any per-creature scaling. */
  readonly groundSpeedMps: number;
  /** Metres per second in its preferred medium, which may be the same. */
  readonly preferredSpeedMps: number;
  readonly preferredMedium: Medium;
  /**
   * Degrees per second it can change heading while moving. A serpent has to
   * arc; a crawler pivots on the spot.
   */
  readonly turnRateDegPerSecond: number;
  /**
   * Degrees per second while standing still. Zero means it genuinely cannot
   * turn in place and must move to change direction.
   */
  readonly turnInPlaceDegPerSecond: number;
  /** Metres of vertical step it can take without climbing. */
  readonly stepUpMeters: number;
  /** Steepest slope it will walk up, degrees. */
  readonly maxSlopeDeg: number;
  /** True when it can go up a sheer face rather than around it. */
  readonly canClimb: boolean;
  /** True when rubble in the road does not stop it. */
  readonly ignoresRubble: boolean;
  /** Seconds to change medium, such as surfacing or going under. */
  readonly transitionSeconds: number;
  /** How wide a body this family needs to fit through a gap, metres per height metre. */
  readonly widthPerHeight: number;
  readonly description: string;
}

const FAMILIES: readonly LocomotionFamilyDefinition[] = [
  {
    id: "biped",
    displayName: "Biped",
    media: ["ground", "water"],
    groundSpeedMps: 16,
    preferredSpeedMps: 16,
    preferredMedium: "ground",
    turnRateDegPerSecond: 55,
    turnInPlaceDegPerSecond: 90,
    stepUpMeters: 14,
    maxSlopeDeg: 42,
    canClimb: false,
    ignoresRubble: false,
    transitionSeconds: 1.5,
    widthPerHeight: 0.35,
    description: "Upright and direct. Walks where a Jaeger walks and fights the same ground.",
  },
  {
    id: "quadruped",
    displayName: "Quadruped",
    media: ["ground"],
    groundSpeedMps: 22,
    preferredSpeedMps: 22,
    preferredMedium: "ground",
    turnRateDegPerSecond: 40,
    turnInPlaceDegPerSecond: 45,
    stepUpMeters: 9,
    maxSlopeDeg: 50,
    canClimb: false,
    ignoresRubble: false,
    transitionSeconds: 2,
    widthPerHeight: 0.55,
    description: "Low and fast in a straight line, and slow to change its mind about direction.",
  },
  {
    id: "serpentine",
    displayName: "Serpentine",
    media: ["ground", "water"],
    groundSpeedMps: 18,
    preferredSpeedMps: 26,
    preferredMedium: "water",
    turnRateDegPerSecond: 26,
    turnInPlaceDegPerSecond: 0,
    stepUpMeters: 6,
    maxSlopeDeg: 35,
    canClimb: true,
    ignoresRubble: true,
    transitionSeconds: 1,
    widthPerHeight: 0.2,
    description: "Cannot turn on the spot at all. It has to travel to change where it is pointing.",
  },
  {
    id: "winged",
    displayName: "Winged",
    media: ["air", "ground"],
    groundSpeedMps: 9,
    preferredSpeedMps: 48,
    preferredMedium: "air",
    turnRateDegPerSecond: 70,
    turnInPlaceDegPerSecond: 20,
    stepUpMeters: 40,
    maxSlopeDeg: 90,
    canClimb: true,
    ignoresRubble: true,
    transitionSeconds: 2.5,
    widthPerHeight: 0.9,
    description: "Awkward on the ground and untouchable above it. Rubble and cliffs mean nothing.",
  },
  {
    id: "burrower",
    displayName: "Burrower",
    media: ["underground", "ground"],
    groundSpeedMps: 12,
    preferredSpeedMps: 20,
    preferredMedium: "underground",
    turnRateDegPerSecond: 35,
    turnInPlaceDegPerSecond: 30,
    stepUpMeters: 8,
    maxSlopeDeg: 60,
    canClimb: false,
    ignoresRubble: true,
    transitionSeconds: 4,
    widthPerHeight: 0.4,
    description: "Goes under anything in the way, and comes up somewhere nobody was looking.",
  },
  {
    id: "swimmer",
    displayName: "Swimmer",
    media: ["water"],
    groundSpeedMps: 3,
    preferredSpeedMps: 34,
    preferredMedium: "water",
    turnRateDegPerSecond: 50,
    turnInPlaceDegPerSecond: 25,
    stepUpMeters: 2,
    maxSlopeDeg: 20,
    canClimb: false,
    ignoresRubble: false,
    transitionSeconds: 1,
    widthPerHeight: 0.5,
    description: "Belongs in the water and is nearly helpless out of it.",
  },
  {
    id: "amphibious",
    displayName: "Amphibious",
    media: ["ground", "water"],
    groundSpeedMps: 14,
    preferredSpeedMps: 24,
    preferredMedium: "water",
    turnRateDegPerSecond: 45,
    turnInPlaceDegPerSecond: 55,
    stepUpMeters: 10,
    maxSlopeDeg: 40,
    canClimb: false,
    ignoresRubble: false,
    transitionSeconds: 1.2,
    widthPerHeight: 0.45,
    description: "Comfortable either side of the waterline, and better on the wet side.",
  },
  {
    id: "crawler",
    displayName: "Crawler",
    media: ["ground", "wall"],
    groundSpeedMps: 20,
    preferredSpeedMps: 20,
    preferredMedium: "ground",
    turnRateDegPerSecond: 80,
    turnInPlaceDegPerSecond: 120,
    stepUpMeters: 20,
    maxSlopeDeg: 85,
    canClimb: true,
    ignoresRubble: true,
    transitionSeconds: 0.8,
    widthPerHeight: 0.6,
    description: "Goes up the side of a tower as readily as along the street beside it.",
  },
  {
    id: "colossal",
    displayName: "Colossal",
    media: ["ground", "water"],
    groundSpeedMps: 11,
    preferredSpeedMps: 11,
    preferredMedium: "ground",
    turnRateDegPerSecond: 14,
    turnInPlaceDegPerSecond: 8,
    stepUpMeters: 40,
    maxSlopeDeg: 55,
    canClimb: false,
    ignoresRubble: true,
    transitionSeconds: 6,
    widthPerHeight: 0.8,
    description: "Slow, unturnable, and takes the shortest line because nothing is in its way.",
  },
];

export function validateLocomotionFamily(entry: LocomotionFamilyDefinition): string[] {
  const errors: string[] = [];
  if (!entry.displayName) errors.push("displayName required");
  if (!entry.description) errors.push("description required");
  if (entry.media.length === 0) errors.push("a family must be able to travel through something");
  if (!entry.media.includes(entry.preferredMedium)) {
    errors.push("preferredMedium must be one of the media this family can travel through");
  }
  for (const key of ["groundSpeedMps", "preferredSpeedMps", "turnRateDegPerSecond"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
  }
  if (!Number.isFinite(entry.turnInPlaceDegPerSecond) || entry.turnInPlaceDegPerSecond < 0) {
    errors.push("turnInPlaceDegPerSecond must be zero or more: zero means it genuinely cannot");
  }
  if (entry.maxSlopeDeg <= 0 || entry.maxSlopeDeg > 90) errors.push("maxSlopeDeg must be within (0, 90]");
  if (entry.stepUpMeters < 0) errors.push("stepUpMeters must be zero or more");
  if (entry.transitionSeconds < 0) errors.push("transitionSeconds must be zero or more");
  if (entry.widthPerHeight <= 0) errors.push("widthPerHeight must be above zero");
  // A family that climbs sheer faces but refuses a moderate slope is a
  // contradiction that would show up as a creature stuck against a kerb.
  if (entry.canClimb && entry.maxSlopeDeg < 35) {
    errors.push("a climbing family cannot also refuse a moderate slope");
  }
  return errors;
}

export function createLocomotionFamilyRegistry(): ContentRegistry<LocomotionFamilyDefinition> {
  const registry = new ContentRegistry<LocomotionFamilyDefinition>(validateLocomotionFamily);
  for (const family of FAMILIES) registry.register(family);
  for (const id of LOCOMOTION_FAMILIES) {
    if (!registry.get(id)) throw new Error(`Locomotion family "${id}" is declared but not registered`);
  }
  return registry;
}

export const LOCOMOTION_FAMILY_DEFINITIONS = FAMILIES;

/** Speed in a given medium, or zero where this family cannot go at all. */
export function speedIn(family: LocomotionFamilyDefinition, medium: Medium): number {
  if (!family.media.includes(medium)) return 0;
  return medium === family.preferredMedium ? family.preferredSpeedMps : family.groundSpeedMps;
}

/** True when this family can be in this medium at all. */
export function canEnter(family: LocomotionFamilyDefinition, medium: Medium): boolean {
  return family.media.includes(medium);
}
