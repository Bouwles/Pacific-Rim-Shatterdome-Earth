import type { DefenseSpec, MoveDefinition } from "../data/moves";

/**
 * Defence.
 *
 * Dodges, blocks, perfect guards and parries, as a set of windows and the
 * answers they produce. Two rules shape the whole file:
 *
 * 1. **A dodge does not erase weight.** It costs stamina, it has invulnerable
 *    frames in the middle rather than at the front, and it has a recovery of its
 *    own. It cancels out of moves that list an evade and nothing else, so it can
 *    never be used to make every attack safe.
 * 2. **Timing is graded, and explained in words.** Early, late and perfect are
 *    different outcomes, and the training feedback says which one happened
 *    without ever showing a tick count.
 */

export const DEFENSE_OUTCOMES = [
  "none",
  "blocked",
  "perfect",
  "parried",
  "evaded",
  "too-early",
  "too-late",
] as const;
export type DefenseOutcome = (typeof DEFENSE_OUTCOMES)[number];

export interface DefenseState {
  /** Move providing the defence, or null when the fighter is simply guarding. */
  readonly moveId: string | null;
  readonly spec: DefenseSpec | null;
  /** Ticks since the defensive move started. */
  readonly tick: number;
}

export const NO_DEFENSE: DefenseState = { moveId: null, spec: null, tick: 0 };

export function beginDefense(move: MoveDefinition): DefenseState {
  if (!move.defense) throw new Error(`Move "${move.id}" is not a defensive move`);
  return { moveId: move.id, spec: move.defense, tick: 0 };
}

export function advanceDefense(state: DefenseState, ticks = 1): DefenseState {
  if (state.spec === null) return state;
  return { ...state, tick: state.tick + ticks };
}

/** True while the defensive move's invulnerable frames are live. */
export function isInvulnerable(state: DefenseState): boolean {
  const spec = state.spec;
  if (!spec || spec.kind !== "dodge") return false;
  return state.tick >= spec.invulnerableFromTick && state.tick <= spec.invulnerableToTick;
}

/** True while a block or parry is inside its perfect window. */
export function isPerfect(state: DefenseState): boolean {
  const spec = state.spec;
  if (!spec || spec.kind === "dodge") return false;
  return state.tick >= spec.perfectFromTick && state.tick <= spec.perfectToTick;
}

export interface DefenseResolution {
  readonly outcome: DefenseOutcome;
  /** Fraction of incoming damage that gets through. Zero for a perfect answer. */
  readonly damageScale: number;
  /** Fraction of guard damage that gets through. */
  readonly guardScale: number;
  /** True when the attacker is left open and owes the defender a free answer. */
  readonly opensAttacker: boolean;
  /** Move the defender answers with, for a parry. */
  readonly counterMoveId: string | null;
  /** Plain language for the training feedback line. No frame numbers. */
  readonly coaching: string;
}

const CLEAN_HIT: DefenseResolution = {
  outcome: "none",
  damageScale: 1,
  guardScale: 1,
  opensAttacker: false,
  counterMoveId: null,
  coaching: "",
};

/**
 * What a defence does to an incoming hit.
 *
 * Called with whatever defence the fighter has running, plus whether they are
 * simply holding a guard. Holding a guard always does something; timing one
 * does much more.
 */
export function resolveDefense(state: DefenseState, holdingGuard: boolean): DefenseResolution {
  const spec = state.spec;

  if (spec?.kind === "dodge") {
    if (isInvulnerable(state)) {
      return {
        outcome: "evaded",
        damageScale: 0,
        guardScale: 0,
        opensAttacker: false,
        counterMoveId: null,
        coaching: "Clean evade. You were never there.",
      };
    }
    // A dodge that started too late, or has already recovered, takes the hit in
    // full. This is the cost that keeps a dodge from erasing everything.
    const early = state.tick < spec.invulnerableFromTick;
    return {
      outcome: early ? "too-early" : "too-late",
      damageScale: 1,
      guardScale: 1,
      opensAttacker: false,
      counterMoveId: null,
      coaching: early
        ? "You moved before the swing came. Wait until it is on its way."
        : "The step had already finished. Leave it a moment longer next time.",
    };
  }

  if (spec?.kind === "parry") {
    if (isPerfect(state)) {
      return {
        outcome: "parried",
        damageScale: 0,
        guardScale: 0,
        opensAttacker: true,
        counterMoveId: spec.counterMoveId,
        coaching: "Parried. They are wide open, and the counter is free.",
      };
    }
    // A missed parry is worse than no parry at all: no guard behind it.
    return {
      outcome: state.tick < spec.perfectFromTick ? "too-early" : "too-late",
      damageScale: 1.15,
      guardScale: 1,
      opensAttacker: false,
      counterMoveId: null,
      coaching: "The parry window had passed. Missing it costs more than not trying.",
    };
  }

  if (spec?.kind === "block") {
    if (isPerfect(state)) {
      return {
        outcome: "perfect",
        damageScale: 0,
        guardScale: 0,
        opensAttacker: true,
        counterMoveId: null,
        coaching: "Perfect guard. Nothing got through and they are off balance.",
      };
    }
    return {
      outcome: "blocked",
      damageScale: 0.25,
      guardScale: 1,
      opensAttacker: false,
      counterMoveId: null,
      coaching: "Blocked, but late. Guard as the hit lands to take nothing at all.",
    };
  }

  if (holdingGuard) {
    return {
      outcome: "blocked",
      damageScale: 0.25,
      guardScale: 1,
      opensAttacker: false,
      counterMoveId: null,
      coaching: "",
    };
  }

  return CLEAN_HIT;
}

/**
 * How long an attacker is left open after a perfect answer.
 *
 * Long enough to be worth timing, short enough that a whole combo does not come
 * free out of one block.
 */
export const OPENING_TICKS = 40;

/** Combo tracking, so the interface can say "three in a row" without frame data. */
export interface ComboState {
  readonly hits: number;
  readonly lastHitTick: number;
  readonly bestHits: number;
}

export const NO_COMBO: ComboState = { hits: 0, lastHitTick: -1, bestHits: 0 };

/** A combo drops when nothing has connected for this long. */
export const COMBO_WINDOW_TICKS = 90;

export function registerHit(state: ComboState, tick: number): ComboState {
  const continuing = state.lastHitTick >= 0 && tick - state.lastHitTick <= COMBO_WINDOW_TICKS;
  const hits = continuing ? state.hits + 1 : 1;
  return { hits, lastHitTick: tick, bestHits: Math.max(state.bestHits, hits) };
}

export function expireCombo(state: ComboState, tick: number): ComboState {
  if (state.hits === 0) return state;
  if (state.lastHitTick >= 0 && tick - state.lastHitTick <= COMBO_WINDOW_TICKS) return state;
  return { ...state, hits: 0 };
}
