import type { FinisherSpec, MoveDefinition } from "../data/moves";

/**
 * Finishers.
 *
 * A short state machine with a camera plan, not a cutscene. Five rules keep it
 * on the right side of that line:
 *
 * 1. **It is rare by construction.** A finisher is only legal against a target
 *    that is both nearly finished and already reeling, which is checked by the
 *    arena before this file is involved. Not every hit becomes one; almost none
 *    of them do.
 * 2. **The player is still playing.** Beats that ask for the input held are
 *    checked every tick, and letting go ends the sequence early with what was
 *    earned rather than the full guarantee.
 * 3. **It can be interrupted.** Anything landing on the attacker during an
 *    interruptible finisher stops it.
 * 4. **It cannot put anyone anywhere unsafe.** Placement is checked against an
 *    injected query before the sequence starts and before any repositioning
 *    inside it, so nothing ends up inside a building, under water it should not
 *    be in, or outside the loaded world.
 * 5. **It can be skipped, and it can be held rather than mashed.** Both are
 *    accessibility settings, and both produce the same outcome.
 */

export const FINISHER_PHASES = [
  "idle",
  "running",
  "completed",
  "interrupted",
  "released",
  "skipped",
] as const;
export type FinisherPhase = (typeof FINISHER_PHASES)[number];

export interface FinisherSettings {
  /** Turns the camera choreography into a fixed, level framing. */
  readonly reducedCameraMotion: boolean;
  /**
   * When true, a held input satisfies every beat that asks for one, rather than
   * requiring repeated presses. Present because repeated presses are a barrier.
   */
  readonly holdToComplete: boolean;
  /** Skips the sequence and applies the outcome immediately. */
  readonly skipSequences: boolean;
}

export const DEFAULT_FINISHER_SETTINGS: FinisherSettings = {
  reducedCameraMotion: false,
  holdToComplete: true,
  skipSequences: false,
};

export interface FinisherState {
  readonly phase: FinisherPhase;
  readonly moveId: string | null;
  readonly spec: FinisherSpec | null;
  readonly attackerId: string | null;
  readonly targetId: string | null;
  /** Ticks since the sequence started. */
  readonly tick: number;
  /** Index of the beat currently running. */
  readonly beatIndex: number;
  /** Damage banked so far. A released sequence keeps this much. */
  readonly earnedDamage: number;
  /** Camera framing the current beat asks for, or null when nothing is running. */
  readonly camera: string | null;
}

export const NO_FINISHER: FinisherState = {
  phase: "idle",
  moveId: null,
  spec: null,
  attackerId: null,
  targetId: null,
  tick: 0,
  beatIndex: 0,
  earnedDamage: 0,
  camera: null,
};

/** Where a finisher wants to put the two actors, before anything is checked. */
export interface FinisherPlacement {
  readonly attackerEast: number;
  readonly attackerNorth: number;
  readonly targetEast: number;
  readonly targetNorth: number;
}

export type FinisherRejection = "not-a-finisher" | "no-space" | "already-running" | "unsafe-ground";

export interface FinisherCheck {
  readonly ok: boolean;
  readonly reason: FinisherRejection | null;
  readonly message: string;
}

/**
 * Somewhere a machine may legally stand.
 *
 * Injected so this module never reads terrain, a city layout or a scene. The
 * arena supplies one that knows about buildings, water and loaded sectors; a
 * test supplies one that says yes.
 */
export interface SpaceQuery {
  /** True when a body of this radius fits here without intersecting anything solid. */
  isClear(east: number, north: number, radiusMeters: number): boolean;
  /** True when this point is inside the part of the world that is actually loaded. */
  inLoadedWorld(east: number, north: number): boolean;
  /**
   * Depth of water at a point, metres. Zero on dry land. A finisher that would
   * leave a machine underwater is refused unless it is meant to happen there.
   */
  waterDepthMeters(east: number, north: number): number;
}

/** A query that says yes to everything. The default, and what tests use. */
export const OPEN_GROUND: SpaceQuery = {
  isClear: () => true,
  inLoadedWorld: () => true,
  waterDepthMeters: () => 0,
};

/** Deeper than this and a finisher would be happening underwater. */
export const MAX_FINISHER_WATER_DEPTH_METERS = 24;

export function checkFinisher(
  move: MoveDefinition,
  state: FinisherState,
  placement: FinisherPlacement,
  space: SpaceQuery,
  bodyRadiusMeters: number,
): FinisherCheck {
  if (!move.finisher) {
    return { ok: false, reason: "not-a-finisher", message: `"${move.displayName}" is not a finisher.` };
  }
  if (state.phase === "running") {
    return { ok: false, reason: "already-running", message: "A finisher is already running." };
  }

  const points: Array<[number, number]> = [
    [placement.attackerEast, placement.attackerNorth],
    [placement.targetEast, placement.targetNorth],
  ];
  for (const [east, north] of points) {
    if (!space.inLoadedWorld(east, north)) {
      return {
        ok: false,
        reason: "unsafe-ground",
        message: "Too close to the edge of the loaded world for that.",
      };
    }
    if (!space.isClear(east, north, bodyRadiusMeters)) {
      return {
        ok: false,
        reason: "no-space",
        message: "Not enough clear ground for that here. Move away from the buildings.",
      };
    }
    if (space.waterDepthMeters(east, north) > MAX_FINISHER_WATER_DEPTH_METERS) {
      return {
        ok: false,
        reason: "unsafe-ground",
        message: "The water is too deep here to finish it.",
      };
    }
  }
  return { ok: true, reason: null, message: "" };
}

export function beginFinisher(
  move: MoveDefinition,
  attackerId: string,
  targetId: string,
  settings: FinisherSettings,
): FinisherState {
  const spec = move.finisher;
  if (!spec) throw new Error(`Move "${move.id}" carries no finisher`);
  if (settings.skipSequences) {
    // Skipped sequences pay out in full and immediately. The outcome is the
    // point of a finisher; the choreography is the part somebody may not want.
    return {
      phase: "skipped",
      moveId: move.id,
      spec,
      attackerId,
      targetId,
      tick: 0,
      beatIndex: spec.beats.length,
      earnedDamage: spec.guaranteedDamage,
      camera: null,
    };
  }
  return {
    phase: "running",
    moveId: move.id,
    spec,
    attackerId,
    targetId,
    tick: 0,
    beatIndex: 0,
    earnedDamage: 0,
    camera: spec.beats[0]?.camera ?? null,
  };
}

export interface FinisherInput {
  /** True while the player is holding the finisher input. */
  readonly holding: boolean;
  /** True when the attacker took a hit this tick. */
  readonly attackerHit: boolean;
  readonly settings: FinisherSettings;
}

export interface FinisherStep {
  readonly state: FinisherState;
  /** Damage to apply this tick, if any. */
  readonly damage: number;
  /** Fires once, on the tick the sequence ends. */
  readonly finished: boolean;
  readonly coaching: string;
}

/**
 * Advances a finisher by one tick.
 *
 * Damage is banked beat by beat rather than all at the end, so a sequence that
 * is interrupted or released still did what it did up to that point. That is
 * what makes an interruption a real risk rather than a total refund.
 */
export function advanceFinisher(state: FinisherState, input: FinisherInput): FinisherStep {
  if (state.phase !== "running" || !state.spec) {
    return { state, damage: 0, finished: false, coaching: "" };
  }

  const spec = state.spec;
  const beat = spec.beats[state.beatIndex];
  if (!beat) {
    return {
      state: { ...state, phase: "completed", camera: null },
      damage: Math.max(0, spec.guaranteedDamage - state.earnedDamage),
      finished: true,
      coaching: "Finished it.",
    };
  }

  if (spec.interruptible && input.attackerHit) {
    return {
      state: { ...state, phase: "interrupted", camera: null },
      damage: 0,
      finished: true,
      coaching: "You were hit out of it. Make room before starting one of those.",
    };
  }

  // A beat that asks for the input held checks it every tick. Hold-to-complete
  // is the setting that makes a single held input satisfy that; without it the
  // same check runs, and letting go ends the sequence early.
  const needsHold = beat.requiresHold && !input.settings.skipSequences;
  if (needsHold && !input.holding) {
    return {
      state: { ...state, phase: "released", camera: null },
      damage: 0,
      finished: true,
      coaching: "You let go part way through, so it only did what it had earned.",
    };
  }

  const tick = state.tick + 1;
  const beatDone = tick >= beat.durationTicks;
  if (!beatDone) {
    return {
      state: {
        ...state,
        tick,
        camera: input.settings.reducedCameraMotion ? "wide" : beat.camera,
      },
      damage: 0,
      finished: false,
      coaching: "",
    };
  }

  // Each completed beat banks its share of the guaranteed damage.
  const share = spec.guaranteedDamage / spec.beats.length;
  const beatIndex = state.beatIndex + 1;
  const earnedDamage = state.earnedDamage + share;
  const done = beatIndex >= spec.beats.length;
  return {
    state: {
      ...state,
      tick: 0,
      beatIndex,
      earnedDamage,
      phase: done ? "completed" : "running",
      camera: done
        ? null
        : input.settings.reducedCameraMotion
          ? "wide"
          : (spec.beats[beatIndex]?.camera ?? null),
    },
    damage: share,
    finished: done,
    coaching: done ? "Finished it." : "",
  };
}

/** Damage a sequence that ended early is owed. */
export function earnedDamageOf(state: FinisherState): number {
  return Math.round(state.earnedDamage);
}

export function describeFinisher(state: FinisherState): string {
  const table: Readonly<Record<FinisherPhase, string>> = {
    idle: "",
    running: `Finisher: beat ${state.beatIndex + 1} of ${state.spec?.beats.length ?? 0}`,
    completed: "Finisher landed in full.",
    interrupted: "Finisher interrupted.",
    released: "Finisher released early.",
    skipped: "Finisher applied without the sequence.",
  };
  return table[state.phase];
}
