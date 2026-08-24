import { canEnter, speedIn, type LocomotionFamilyDefinition, type Medium } from "../data/locomotionFamilies";

/**
 * Getting somewhere, in a city that may no longer have streets.
 *
 * This is not a path finder. It is the set of rules a creature falls back on
 * when the straight line does not work: go around, go over, go under, go
 * through the water, or go through whatever is in the way. Which of those it
 * reaches for is decided by its locomotion family, so a serpent, a burrower and
 * a colossal thing solve the same blocked road differently.
 *
 * Two rules the milestone names explicitly are enforced here rather than
 * assumed away. **The ground is not flat**: every step is checked against the
 * family's own slope and step-up limits. **Not everything can turn in place**: a
 * family with no turn-in-place rate has to travel to change heading, which is
 * what makes a serpent arc rather than pivot.
 */

export const NAV_OUTCOMES = [
  "direct",
  "detour",
  "climb-over",
  "burrow-under",
  "swim-across",
  "smash-through",
  "blocked",
] as const;
export type NavOutcome = (typeof NAV_OUTCOMES)[number];

/** What the world tells navigation. Injected, so nothing here reads terrain. */
export interface NavigationQuery {
  /** Ground height at a point, or null outside the loaded world. */
  groundHeight(east: number, north: number): number | null;
  /** Water depth at a point. Zero on dry land. */
  waterDepth(east: number, north: number): number;
  /** True when rubble or a wall closes this point on the ground. */
  isPassable(east: number, north: number): boolean;
  /** Height of anything climbable at a point, or zero for open ground. */
  climbableHeight(east: number, north: number): number;
}

export interface NavStep {
  readonly east: number;
  readonly north: number;
  readonly medium: Medium;
  readonly outcome: NavOutcome;
  /** Metres per second this leg is travelled at. */
  readonly speedMps: number;
  /** Plain language, for the debug view. */
  readonly reason: string;
}

/** How far a creature looks ahead when testing the direct line. */
export const PROBE_METERS = 60;
/** How far either side it will try when the direct line fails. */
const DETOUR_ANGLES_DEG = [25, -25, 55, -55, 90, -90, 135, -135] as const;
/** Water deeper than this is swimming rather than wading. */
export const SWIM_DEPTH_METERS = 18;

/**
 * Works out the next step toward a target.
 *
 * Tries the direct line first, then the family's own answers to a blocked line
 * in the order that suits it, and finally gives up honestly rather than walking
 * into a wall.
 */
export function nextStep(
  from: { readonly east: number; readonly north: number; readonly headingDeg: number },
  target: { readonly east: number; readonly north: number },
  family: LocomotionFamilyDefinition,
  world: NavigationQuery,
  strideMeters = PROBE_METERS,
): NavStep {
  const bearing = bearingTo(from, target);

  const direct = probe(from, bearing, strideMeters, family, world);
  if (direct) return direct;

  // Something is in the way. What it tries next is its own business.
  if (family.media.includes("underground")) {
    const under = stepAt(from, bearing, strideMeters);
    return {
      ...under,
      medium: "underground",
      outcome: "burrow-under",
      speedMps: speedIn(family, "underground"),
      reason: "went under the obstruction",
    };
  }

  if (family.canClimb) {
    const over = stepAt(from, bearing, strideMeters);
    const height = world.climbableHeight(over.east, over.north);
    if (height > 0) {
      return {
        ...over,
        medium: "wall",
        outcome: "climb-over",
        speedMps: speedIn(family, "ground") * 0.6,
        reason: `climbed ${Math.round(height)} m rather than going round`,
      };
    }
  }

  if (family.ignoresRubble) {
    const through = stepAt(from, bearing, strideMeters);
    return {
      ...through,
      medium: "ground",
      outcome: "smash-through",
      speedMps: speedIn(family, "ground") * 0.7,
      reason: "went through what was in the way",
    };
  }

  if (canEnter(family, "water")) {
    const wet = stepAt(from, bearing, strideMeters);
    if (world.waterDepth(wet.east, wet.north) >= SWIM_DEPTH_METERS) {
      return {
        ...wet,
        medium: "water",
        outcome: "swim-across",
        speedMps: speedIn(family, "water"),
        reason: "took to the water",
      };
    }
  }

  for (const offset of DETOUR_ANGLES_DEG) {
    const detour = probe(from, bearing + offset, strideMeters, family, world);
    if (detour) {
      return { ...detour, outcome: "detour", reason: `went ${Math.abs(offset)} degrees around` };
    }
  }

  return {
    east: from.east,
    north: from.north,
    medium: "ground",
    outcome: "blocked",
    speedMps: 0,
    reason: "nothing it can do gets it through here",
  };
}

/**
 * How far a creature may turn this tick.
 *
 * A family with no turn-in-place rate cannot change heading while stationary at
 * all, which is the rule that stops a serpent pivoting like a tank.
 */
export function turnToward(
  headingDeg: number,
  desiredDeg: number,
  family: LocomotionFamilyDefinition,
  movingMps: number,
  deltaSeconds: number,
): number {
  const rate = movingMps > 0.5 ? family.turnRateDegPerSecond : family.turnInPlaceDegPerSecond;
  if (rate <= 0) return headingDeg;
  const delta = normalize180(desiredDeg - headingDeg);
  const step = Math.min(Math.abs(delta), rate * deltaSeconds);
  return normalize360(headingDeg + Math.sign(delta) * step);
}

/** The medium a creature is in at a point, given what it can enter. */
export function mediumAt(
  east: number,
  north: number,
  family: LocomotionFamilyDefinition,
  world: NavigationQuery,
): Medium {
  const depth = world.waterDepth(east, north);
  if (depth >= SWIM_DEPTH_METERS && canEnter(family, "water")) return "water";
  if (canEnter(family, "air") && family.preferredMedium === "air") return "air";
  return "ground";
}

function probe(
  from: { readonly east: number; readonly north: number },
  bearingDeg: number,
  strideMeters: number,
  family: LocomotionFamilyDefinition,
  world: NavigationQuery,
): NavStep | null {
  const step = stepAt(from, bearingDeg, strideMeters);
  const here = world.groundHeight(from.east, from.north);
  const there = world.groundHeight(step.east, step.north);
  // Outside the loaded world is not a place to walk into.
  if (there === null) return null;

  const depth = world.waterDepth(step.east, step.north);
  if (depth >= SWIM_DEPTH_METERS) {
    if (!canEnter(family, "water")) return null;
    return {
      ...step,
      medium: "water",
      outcome: "direct",
      speedMps: speedIn(family, "water"),
      reason: "swimming the direct line",
    };
  }

  if (!world.isPassable(step.east, step.north) && !family.ignoresRubble) return null;

  // The ground is not flat, and this is where that is enforced.
  if (here !== null) {
    const rise = there - here;
    if (rise > family.stepUpMeters) {
      const slope = (Math.atan2(rise, strideMeters) * 180) / Math.PI;
      if (slope > family.maxSlopeDeg) return null;
    }
  }

  return {
    ...step,
    medium: "ground",
    outcome: "direct",
    speedMps: speedIn(family, "ground"),
    reason: "straight line is clear",
  };
}

function stepAt(
  from: { readonly east: number; readonly north: number },
  bearingDeg: number,
  strideMeters: number,
): { east: number; north: number } {
  const radians = (bearingDeg * Math.PI) / 180;
  return {
    east: from.east + Math.sin(radians) * strideMeters,
    north: from.north + Math.cos(radians) * strideMeters,
  };
}

export function bearingTo(
  from: { readonly east: number; readonly north: number },
  target: { readonly east: number; readonly north: number },
): number {
  return normalize360((Math.atan2(target.east - from.east, target.north - from.north) * 180) / Math.PI);
}

function normalize360(degrees: number): number {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

function normalize180(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

/** Open ground everywhere. What a test uses, and what an empty world looks like. */
export const OPEN_GROUND: NavigationQuery = {
  groundHeight: () => 0,
  waterDepth: () => 0,
  isPassable: () => true,
  climbableHeight: () => 0,
};
