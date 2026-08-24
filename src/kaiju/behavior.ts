import { ContentRegistry, type RegistryEntry } from "../data/registry";
import type { LocomotionFamilyDefinition, Medium } from "../data/locomotionFamilies";
import type { SenseContact, SensorySnapshot } from "./senses";

/**
 * How a creature decides what to do.
 *
 * Utility scoring rather than a hand-written tree: every goal is a row with a
 * scoring function, the situation is a plain object of numbers, and the highest
 * score wins with a little hysteresis so nothing dithers. Adding a goal is a
 * registry entry.
 *
 * **No goal knows any creature by name.** A creature's differences reach the
 * engine as weights, traits and a locomotion family, which is what stops this
 * from becoming a switch on kaiju ids the moment a second creature exists.
 */

export const GOALS = [
  "hunt",
  "approach",
  "flank",
  "ambush",
  "climb",
  "burrow",
  "swim",
  "destroy-objective",
  "feed",
  "retreat",
  "enrage",
] as const;
export type Goal = (typeof GOALS)[number];

/** Everything a decision is allowed to look at. */
export interface Situation {
  /** Distance to the best contact, or Infinity when nothing is sensed. */
  readonly distanceMeters: number;
  /** 0 to 1 confidence in the best contact. */
  readonly contactConfidence: number;
  /** 0 to 1 of the creature's own core health left. */
  readonly healthFraction: number;
  /** 0 to 1 of its poise left before it staggers. */
  readonly poiseFraction: number;
  /** Damage the best contact has done to it. Drives grudges. */
  readonly damageTaken: number;
  /** Metres to the nearest objective it wants to destroy. */
  readonly objectiveDistanceMeters: number;
  /** Metres to the nearest thing it can eat. Infinity when nothing is on offer. */
  readonly feedDistanceMeters: number;
  /** What the creature is standing in right now. */
  readonly medium: Medium;
  /** True when deep water is within reach. */
  readonly waterNearby: boolean;
  /** True when there is something climbable within reach. */
  readonly climbableNearby: boolean;
  /** True when the direct route is blocked by rubble or terrain. */
  readonly routeBlocked: boolean;
  /** 0 to 1. How much of its usual approach has already failed. */
  readonly frustration: number;
  /** Phase index, so a creature past a threshold behaves differently. */
  readonly phase: number;
}

/** What the creature is: weights and traits, never a name. */
export interface BehaviorProfile {
  /** Per-goal multiplier. Missing means one. */
  readonly weights: Partial<Record<Goal, number>>;
  /** 0 to 1. How readily it disengages when hurt. */
  readonly caution: number;
  /** 0 to 1. How much it prefers objectives over the thing shooting at it. */
  readonly objectiveFocus: number;
  /** 0 to 1. How much it wants to eat. */
  readonly appetite: number;
  /** Health fraction below which it enrages instead of retreating. */
  readonly enrageBelow: number;
  readonly family: LocomotionFamilyDefinition;
}

export interface GoalDefinition extends RegistryEntry {
  readonly id: Goal;
  readonly displayName: string;
  /**
   * Raw desire for this goal, before weights. Zero means "not now"; anything
   * above zero competes. Pure: same inputs, same number, no randomness.
   */
  score(situation: Situation, profile: BehaviorProfile): number;
  /** Why, in words, for the debug view. Must not mention a creature by name. */
  explain(situation: Situation, profile: BehaviorProfile): string;
  readonly description: string;
}

const GOAL_DEFINITIONS: readonly GoalDefinition[] = [
  {
    id: "hunt",
    displayName: "Hunt",
    description: "Looking for something it can only half sense.",
    score: (situation) => {
      if (situation.contactConfidence >= 0.6) return 0;
      // Something is out there and it does not know where. That is the whole
      // reason this goal exists.
      return 30 + (1 - situation.contactConfidence) * 25;
    },
    explain: (situation) =>
      situation.contactConfidence <= 0
        ? "nothing sensed, sweeping"
        : `only ${Math.round(situation.contactConfidence * 100)} percent sure where it is`,
  },
  {
    id: "approach",
    displayName: "Approach",
    description: "Closing on what it is sure about.",
    score: (situation) => {
      if (situation.contactConfidence < 0.35) return 0;
      if (situation.distanceMeters <= 40) return 20;
      return 45 + situation.contactConfidence * 30 - Math.min(25, situation.distanceMeters / 60);
    },
    explain: (situation) => `${Math.round(situation.distanceMeters)} m out and confident`,
  },
  {
    id: "flank",
    displayName: "Flank",
    description: "Going around rather than straight in.",
    score: (situation, profile) => {
      if (situation.contactConfidence < 0.4 || situation.distanceMeters > 400) return 0;
      // A creature that has been hurt going straight in stops going straight in.
      return 25 + situation.frustration * 45 + profile.caution * 20;
    },
    explain: (situation) => `straight in has cost it (${Math.round(situation.frustration * 100)} percent)`,
  },
  {
    id: "ambush",
    displayName: "Ambush",
    description: "Waiting out of sight for something to come close.",
    score: (situation, profile) => {
      if (situation.contactConfidence > 0.7 || situation.distanceMeters < 120) return 0;
      const hidden = situation.medium === "underground" || situation.medium === "water";
      if (!hidden && !profile.family.canClimb) return 0;
      return 30 + profile.caution * 35;
    },
    explain: (situation) => `out of sight in ${situation.medium}, letting it come`,
  },
  {
    id: "climb",
    displayName: "Climb",
    description: "Going up, because up is where it wants to be.",
    score: (situation, profile) => {
      if (!profile.family.canClimb || !situation.climbableNearby) return 0;
      return 20 + (situation.routeBlocked ? 35 : 0);
    },
    explain: (situation) =>
      situation.routeBlocked ? "the road is blocked, so it goes over" : "there is something to climb",
  },
  {
    id: "burrow",
    displayName: "Burrow",
    description: "Going under whatever is in the way.",
    score: (situation, profile) => {
      if (!profile.family.media.includes("underground")) return 0;
      if (situation.medium === "underground") return 15;
      return 25 + (situation.routeBlocked ? 40 : 0) + (1 - situation.healthFraction) * 20;
    },
    explain: (situation) =>
      situation.routeBlocked ? "the surface route is closed" : "underground is where it is safe",
  },
  {
    id: "swim",
    displayName: "Swim",
    description: "Getting into the water, where it is faster.",
    score: (situation, profile) => {
      if (!profile.family.media.includes("water") || !situation.waterNearby) return 0;
      if (situation.medium === "water") return profile.family.preferredMedium === "water" ? 30 : 5;
      return profile.family.preferredMedium === "water" ? 40 : 10;
    },
    explain: (situation, profile) =>
      profile.family.preferredMedium === "water"
        ? "the water is where it is fastest"
        : `crossing water at ${situation.distanceMeters.toFixed(0)} m`,
  },
  {
    id: "destroy-objective",
    displayName: "Destroy objective",
    description: "It came here for something, and that something is not you.",
    score: (situation, profile) => {
      if (!Number.isFinite(situation.objectiveDistanceMeters)) return 0;
      return 20 + profile.objectiveFocus * 60 - Math.min(30, situation.objectiveDistanceMeters / 100);
    },
    explain: (situation) => `objective ${Math.round(situation.objectiveDistanceMeters)} m away`,
  },
  {
    id: "feed",
    displayName: "Feed",
    description: "Stopping to eat, which is a real thing kaiju do and a real opening.",
    score: (situation, profile) => {
      if (!Number.isFinite(situation.feedDistanceMeters)) return 0;
      if (situation.healthFraction > 0.8 && profile.appetite < 0.5) return 0;
      return profile.appetite * 45 + (1 - situation.healthFraction) * 30 - situation.feedDistanceMeters / 40;
    },
    explain: (situation) =>
      `hurt and there is something to eat ${Math.round(situation.feedDistanceMeters)} m away`,
  },
  {
    id: "retreat",
    displayName: "Retreat",
    description: "Breaking off, because dying here achieves nothing.",
    score: (situation, profile) => {
      if (situation.healthFraction > 0.35) return 0;
      if (situation.healthFraction <= profile.enrageBelow) return 0;
      // Below a third, breaking off is a serious option rather than a nudge:
      // it has to be able to beat closing on something it is sure about. How
      // seriously it takes it is the creature's own caution, so a fearless one
      // keeps coming and a wary one leaves.
      return (60 + (0.35 - situation.healthFraction) * 300) * (0.3 + profile.caution * 1.4);
    },
    explain: (situation) => `down to ${Math.round(situation.healthFraction * 100)} percent`,
  },
  {
    id: "enrage",
    displayName: "Enrage",
    description: "Past the point of caring, and considerably more dangerous.",
    score: (situation, profile) => {
      if (situation.healthFraction > profile.enrageBelow) return 0;
      return 120 + situation.damageTaken / 50;
    },
    explain: (situation, profile) => `below the ${Math.round(profile.enrageBelow * 100)} percent line`,
  },
];

export function validateGoal(entry: GoalDefinition): string[] {
  const errors: string[] = [];
  if (!GOALS.includes(entry.id)) errors.push(`unknown goal "${String(entry.id)}"`);
  if (!entry.displayName) errors.push("displayName required");
  if (!entry.description) errors.push("description required");
  if (typeof entry.score !== "function") errors.push("score must be a function");
  if (typeof entry.explain !== "function") errors.push("explain must be a function");
  return errors;
}

export function createGoalRegistry(): ContentRegistry<GoalDefinition> {
  const registry = new ContentRegistry<GoalDefinition>(validateGoal);
  for (const goal of GOAL_DEFINITIONS) registry.register(goal);
  for (const id of GOALS) {
    if (!registry.get(id)) throw new Error(`Goal "${id}" is declared but not registered`);
  }
  return registry;
}

export const GOAL_LIST = GOAL_DEFINITIONS;

/** One goal's standing in a decision, kept for the debug view. */
export interface GoalScore {
  readonly goal: Goal;
  readonly score: number;
  readonly reason: string;
}

export interface Decision {
  readonly goal: Goal;
  readonly score: number;
  readonly reason: string;
  /** Everything that was considered, best first. This is the debug view. */
  readonly considered: readonly GoalScore[];
  /** True when this decision changed the creature's mind. */
  readonly changed: boolean;
}

/** How much better a new goal has to be before a creature changes its mind. */
export const SWITCH_MARGIN = 8;

/**
 * Picks what to do next.
 *
 * Pure: the same situation, profile and current goal always produce the same
 * decision, which is what lets a test assert that three creatures facing the
 * same objective behave differently for reasons rather than by luck.
 */
export function decide(
  registry: ContentRegistry<GoalDefinition>,
  situation: Situation,
  profile: BehaviorProfile,
  currentGoal: Goal | null,
): Decision {
  const considered: GoalScore[] = [];
  for (const definition of registry.all()) {
    const raw = definition.score(situation, profile);
    if (raw <= 0) continue;
    const weight = profile.weights[definition.id] ?? 1;
    const score = raw * weight;
    if (score <= 0) continue;
    considered.push({ goal: definition.id, score, reason: definition.explain(situation, profile) });
  }
  considered.sort((a, b) => b.score - a.score);

  const best = considered[0];
  if (!best) {
    // Nothing wants anything. Hunting is the honest default: it is what a
    // creature with no information does.
    return {
      goal: "hunt",
      score: 0,
      reason: "nothing to go on",
      considered,
      changed: currentGoal !== "hunt",
    };
  }

  // Hysteresis, so a creature does not flicker between two goals a point apart.
  const current = currentGoal ? considered.find((entry) => entry.goal === currentGoal) : undefined;
  if (current && best.score - current.score < SWITCH_MARGIN) {
    return { goal: current.goal, score: current.score, reason: current.reason, considered, changed: false };
  }
  return {
    goal: best.goal,
    score: best.score,
    reason: best.reason,
    considered,
    changed: best.goal !== currentGoal,
  };
}

/**
 * Builds the situation from what the creature can actually sense.
 *
 * Deliberately the only place that turns contacts into numbers, so a goal can
 * never reach around its senses and read the truth.
 */
export function situationFrom(options: {
  readonly snapshot: SensorySnapshot;
  readonly self: { readonly east: number; readonly north: number };
  readonly healthFraction: number;
  readonly poiseFraction: number;
  readonly objectiveDistanceMeters: number;
  readonly feedDistanceMeters: number;
  readonly medium: Medium;
  readonly waterNearby: boolean;
  readonly climbableNearby: boolean;
  readonly routeBlocked: boolean;
  readonly frustration: number;
  readonly phase: number;
}): Situation {
  const best: SenseContact | null = options.snapshot.best;
  const distance = best
    ? Math.hypot(best.east - options.self.east, best.north - options.self.north)
    : Number.POSITIVE_INFINITY;
  return {
    distanceMeters: distance,
    contactConfidence: best?.confidence ?? 0,
    healthFraction: options.healthFraction,
    poiseFraction: options.poiseFraction,
    damageTaken: best?.damageDealt ?? 0,
    objectiveDistanceMeters: options.objectiveDistanceMeters,
    feedDistanceMeters: options.feedDistanceMeters,
    medium: options.medium,
    waterNearby: options.waterNearby,
    climbableNearby: options.climbableNearby,
    routeBlocked: options.routeBlocked,
    frustration: options.frustration,
    phase: options.phase,
  };
}
