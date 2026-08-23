import type { GrappleSpec } from "../data/moves";

/**
 * Grapples.
 *
 * Taking hold of something, keeping hold of it while it fights back, and
 * deciding what to do with it. Four things make this more than an animation:
 *
 * - **Eligibility is checked before the hold, not after.** Out of reach, already
 *   held, or too big to seize while it is standing, and the attempt is refused
 *   with a reason.
 * - **The victim gets a say.** A struggle meter fills from their own effort and
 *   empties from the holder's grip; whoever wins decides how it ends.
 * - **Space is checked before anything is thrown.** A throw that would put the
 *   victim through a building fails safely and becomes a release instead, which
 *   is the difference between a physics system and a hazard.
 * - **Everything is a number.** No part of this file knows what a mesh is.
 */

export const GRAPPLE_PHASES = ["none", "seizing", "held", "throwing", "slamming", "released"] as const;
export type GrapplePhase = (typeof GRAPPLE_PHASES)[number];

export interface GrappleState {
  readonly phase: GrapplePhase;
  readonly holderId: string | null;
  readonly victimId: string | null;
  readonly moveId: string | null;
  readonly spec: GrappleSpec | null;
  /** Ticks the hold has lasted. */
  readonly tick: number;
  /** 0 to 1. At one the victim breaks out. */
  readonly struggle: number;
  /** What the hold turned into, once it is over. */
  readonly outcome: GrappleOutcome | null;
}

export const NO_GRAPPLE: GrappleState = {
  phase: "none",
  holderId: null,
  victimId: null,
  moveId: null,
  spec: null,
  tick: 0,
  struggle: 0,
  outcome: null,
};

export type GrappleOutcome =
  "escaped" | "timed-out" | "thrown" | "slammed" | "released" | "blocked-by-space" | "holder-interrupted";

export type GrappleRejection =
  "out-of-reach" | "already-held" | "target-too-heavy" | "no-space" | "target-down";

export interface GrappleAttempt {
  readonly holderId: string;
  readonly victimId: string;
  readonly spec: GrappleSpec;
  readonly distanceMeters: number;
  /** True when the victim is already in somebody else's hold. */
  readonly victimHeld: boolean;
  /** True when the victim is knocked down, which is a different move entirely. */
  readonly victimDown: boolean;
  /** Mass ratio, holder over victim. Under this a seize is refused. */
  readonly massRatio: number;
  /** Metres of clear ground around the holder, from the space query. */
  readonly clearanceMeters: number;
}

/** Lightest a holder may be relative to its victim and still take hold of it. */
export const MIN_GRAPPLE_MASS_RATIO = 0.55;

export interface GrappleCheck {
  readonly ok: boolean;
  readonly reason: GrappleRejection | null;
  readonly message: string;
}

export function checkGrapple(attempt: GrappleAttempt): GrappleCheck {
  if (attempt.victimDown) {
    return {
      ok: false,
      reason: "target-down",
      message: "It is already on the ground. Hit it rather than trying to pick it up.",
    };
  }
  if (attempt.victimHeld) {
    return { ok: false, reason: "already-held", message: "Something already has hold of it." };
  }
  if (attempt.distanceMeters > attempt.spec.reachMeters) {
    return {
      ok: false,
      reason: "out-of-reach",
      message: `Too far to take hold: ${Math.round(attempt.distanceMeters)} m against a reach of ${attempt.spec.reachMeters} m.`,
    };
  }
  if (attempt.massRatio < MIN_GRAPPLE_MASS_RATIO) {
    return {
      ok: false,
      reason: "target-too-heavy",
      message: "It is far too heavy to get hold of while it is still standing.",
    };
  }
  if (attempt.clearanceMeters < attempt.spec.clearanceMeters) {
    return {
      ok: false,
      reason: "no-space",
      message: "Not enough room here to grapple safely. Back into the open first.",
    };
  }
  return { ok: true, reason: null, message: "" };
}

export function beginGrapple(attempt: GrappleAttempt, moveId: string): GrappleState {
  return {
    phase: "held",
    holderId: attempt.holderId,
    victimId: attempt.victimId,
    moveId,
    spec: attempt.spec,
    tick: 0,
    struggle: 0,
    outcome: null,
  };
}

export interface StruggleInput {
  /** How hard the victim is fighting this tick, 0 to 1. */
  readonly victimEffort: number;
  /** How hard the holder is gripping, 0 to 1. */
  readonly holderGrip: number;
  /** True when the holder was hit hard enough to lose the hold. */
  readonly holderInterrupted: boolean;
}

/**
 * Advances a hold by one tick.
 *
 * The struggle meter is the whole negotiation: the victim pushes it up, the
 * holder pushes it down, and the hold times out on its own if neither wins. A
 * hold that could only end when the holder chose would be a stun, not a grapple.
 */
export function advanceGrapple(state: GrappleState, input: StruggleInput): GrappleState {
  if (state.phase !== "held" || !state.spec) return state;

  if (input.holderInterrupted) {
    return { ...state, phase: "released", outcome: "holder-interrupted" };
  }

  // Tuned so a victim fighting flat out takes a couple of seconds to break a
  // grip, and one that is reeling takes far longer. The first pass had a hold
  // lasting eight ticks, which is not a grapple, it is a nudge.
  const difficulty = Math.max(1, state.spec.escapeDifficulty);
  const gain = (input.victimEffort * 7) / difficulty;
  const loss = (input.holderGrip * 4) / difficulty;
  const struggle = Math.min(1, Math.max(0, state.struggle + gain - loss));
  const tick = state.tick + 1;

  if (struggle >= 1) {
    return { ...state, tick, struggle, phase: "released", outcome: "escaped" };
  }
  if (tick >= state.spec.holdTicks) {
    return { ...state, tick, struggle, phase: "released", outcome: "timed-out" };
  }
  return { ...state, tick, struggle };
}

export interface ThrowRequest {
  readonly state: GrappleState;
  /** Where the holder is standing. */
  readonly holderEast: number;
  readonly holderNorth: number;
  readonly holderYawDeg: number;
  /**
   * Answers whether a body of this radius fits at a point. Injected, so this
   * module never touches terrain, a city layout or a scene.
   */
  readonly isClear: (east: number, north: number, radiusMeters: number) => boolean;
  readonly victimRadiusMeters: number;
}

export interface ThrowResult {
  readonly state: GrappleState;
  /** Where the victim ends up. Unchanged from the holder's position on a failure. */
  readonly east: number;
  readonly north: number;
  /** True when the throw actually happened. */
  readonly thrown: boolean;
  readonly message: string;
}

/**
 * Throws a held target.
 *
 * The landing spot is checked before anything moves, and if it is not clear the
 * throw becomes a release on the spot. Walking a body through a tower is a worse
 * outcome than a throw that did not come off.
 */
export function throwTarget(request: ThrowRequest): ThrowResult {
  const { state, holderEast, holderNorth, holderYawDeg } = request;
  if (state.phase !== "held" || !state.spec) {
    return {
      state,
      east: holderEast,
      north: holderNorth,
      thrown: false,
      message: "Nothing in hand to throw.",
    };
  }

  const radians = (holderYawDeg * Math.PI) / 180;
  const distance = state.spec.throwDistanceMeters;
  const east = holderEast + Math.sin(radians) * distance;
  const north = holderNorth + Math.cos(radians) * distance;

  if (!request.isClear(east, north, request.victimRadiusMeters)) {
    return {
      state: { ...state, phase: "released", outcome: "blocked-by-space" },
      east: holderEast,
      north: holderNorth,
      thrown: false,
      message: "No room to throw: it would have gone through something. Released instead.",
    };
  }

  return {
    state: { ...state, phase: "throwing", outcome: "thrown" },
    east,
    north,
    thrown: true,
    message: "Thrown clear.",
  };
}

/**
 * Slams a held target into whatever is behind them.
 *
 * A slam needs something solid to slam into, which is the opposite requirement
 * to a throw: `isClear` returning false a short way behind the victim is exactly
 * what makes it work.
 */
export function slamTarget(request: ThrowRequest): ThrowResult {
  const { state, holderEast, holderNorth, holderYawDeg } = request;
  if (state.phase !== "held" || !state.spec) {
    return {
      state,
      east: holderEast,
      north: holderNorth,
      thrown: false,
      message: "Nothing in hand to slam.",
    };
  }

  const radians = (holderYawDeg * Math.PI) / 180;
  // Half the throw distance: a slam is a short, hard shove into something.
  const distance = state.spec.throwDistanceMeters * 0.45;
  const east = holderEast + Math.sin(radians) * distance;
  const north = holderNorth + Math.cos(radians) * distance;
  const intoSomething = !request.isClear(east, north, request.victimRadiusMeters);

  if (!intoSomething) {
    return {
      state,
      east: holderEast,
      north: holderNorth,
      thrown: false,
      message: "Nothing solid behind them. Throw them instead, or keep hitting.",
    };
  }

  // Stop short of the obstacle rather than inside it.
  const stopEast = holderEast + Math.sin(radians) * distance * 0.6;
  const stopNorth = holderNorth + Math.cos(radians) * distance * 0.6;
  return {
    state: { ...state, phase: "slamming", outcome: "slammed" },
    east: stopEast,
    north: stopNorth,
    thrown: true,
    message: "Slammed into it.",
  };
}

export function releaseGrapple(state: GrappleState): GrappleState {
  if (state.phase === "none") return state;
  return { ...state, phase: "released", outcome: state.outcome ?? "released" };
}

/** Plain language for the training feedback line. */
export function describeGrapple(state: GrappleState): string {
  if (state.phase === "held") {
    const pressure = Math.round(state.struggle * 100);
    return pressure > 60
      ? `They are close to breaking free. Finish it or let go.`
      : `You have hold of them. Throw, slam, or keep hitting.`;
  }
  const table: Readonly<Record<GrappleOutcome, string>> = {
    escaped: "They fought loose. Grip harder next time, or finish sooner.",
    "timed-out": "The hold ran out on its own.",
    thrown: "Thrown clear.",
    slammed: "Slammed into something solid.",
    released: "Let go.",
    "blocked-by-space": "There was no room for that throw, so you let go instead.",
    "holder-interrupted": "You were hit hard enough to lose your grip.",
  };
  return state.outcome ? table[state.outcome] : "";
}
