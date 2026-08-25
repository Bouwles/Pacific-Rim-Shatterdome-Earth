import { ContentRegistry, type RegistryEntry } from "../data/registry";
import {
  ALLY_GOALS,
  DEFAULT_ORDER,
  createSquadOrderRegistry,
  type AllyGoal,
  type SquadOrderDefinition,
  type SquadOrderId,
} from "../data/squadOrders";
import type { GoalBias } from "../data/allyCrews";

/**
 * What an ally decides to do, and why.
 *
 * The same shape the creatures use: every goal scores itself from the situation
 * and the crew, the highest wins with a little hysteresis so nothing dithers,
 * and adding a goal is a row rather than a branch. An order multiplies those
 * scores; it never sets the answer, which is what keeps an order from being an
 * animation script.
 *
 * Pure arithmetic over plain numbers. No arena, no scene, no clock, so the same
 * decision can be made in a test with nothing loaded.
 */

/** Everything an ally decision is allowed to look at. */
export interface AllySituation {
  /** Metres to the creature it is currently interested in. Infinity when none. */
  readonly targetDistanceMeters: number;
  /** Metres to the target the player has marked, or Infinity when unmarked. */
  readonly markedDistanceMeters: number;
  /** True when the marked target and its own are the same thing. */
  readonly onMarkedTarget: boolean;
  /** 0 to 1 of its own structure left. */
  readonly healthFraction: number;
  /** 0 to 1 of the player machine's structure left. */
  readonly playerHealthFraction: number;
  /** Metres to the player machine. */
  readonly playerDistanceMeters: number;
  /** Metres to the point the standing order named, or Infinity when none. */
  readonly anchorDistanceMeters: number;
  /** Metres to the nearest civilians still being moved out. */
  readonly civilianDistanceMeters: number;
  /** 0 to 1 of ammunition left across everything it is carrying. */
  readonly ammunitionFraction: number;
  /** True when firing right now would put a round through a friendly. */
  readonly friendlyInLine: boolean;
  /** Metres to the nearest other ally, for spacing. */
  readonly nearestAllyMeters: number;
  /** True when another ally is already committed to this target's same zone. */
  readonly zoneContested: boolean;
  /** True when the route to what it wants is blocked. */
  readonly routeBlocked: boolean;
  /** 0 to 1. How long it has been failing to reach anything. */
  readonly frustration: number;
  /** True when the player is winding up something worth joining. */
  readonly playerCommitted: boolean;
}

/** What the crew is, as numbers. Personality plus whatever they have learned. */
export interface AllyProfile {
  readonly confidence: number;
  readonly preferredRangeMeters: number;
  readonly aggression: number;
  readonly supportTendency: number;
  /** Standing lean plus everything learned, already multiplied together. */
  readonly bias: GoalBias;
}

export interface AllyGoalDefinition extends RegistryEntry {
  readonly id: AllyGoal;
  readonly displayName: string;
  /**
   * Raw desire, before order weights and crew bias. Zero means "not now".
   * Pure: same inputs, same number, no randomness anywhere.
   */
  score(situation: AllySituation, profile: AllyProfile): number;
  /** Why, in words, for the debug view and the squad readout. */
  explain(situation: AllySituation, profile: AllyProfile): string;
  readonly description: string;
}

/** Distance at which an ally considers itself to be in the fight. */
export const ENGAGEMENT_RANGE_METERS = 160;
/** Below this fraction of structure an ally starts looking for the door. */
export const SELF_PRESERVATION_HEALTH = 0.35;
/** How much the leading goal must be beaten by before an ally changes its mind. */
export const HYSTERESIS = 0.12;

const GOAL_DEFINITIONS: readonly AllyGoalDefinition[] = [
  {
    id: "engage",
    displayName: "Engage",
    description: "Close with whatever it is already interested in and hit it.",
    score: (situation, profile) => {
      if (!Number.isFinite(situation.targetDistanceMeters)) return 0;
      const reach = clamp01(1 - situation.targetDistanceMeters / (ENGAGEMENT_RANGE_METERS * 2));
      return (0.35 + profile.aggression * 0.5) * reach * healthNerve(situation, profile);
    },
    explain: (situation) => `something is ${Math.round(situation.targetDistanceMeters)} m away`,
  },
  {
    id: "focus",
    displayName: "Focus the mark",
    description: "Attack what the player marked, rather than what is nearest.",
    score: (situation, profile) => {
      if (!Number.isFinite(situation.markedDistanceMeters)) return 0;
      const reach = clamp01(1 - situation.markedDistanceMeters / (ENGAGEMENT_RANGE_METERS * 3));
      // Following a mark is partly discipline and partly wanting the kill.
      const willingness = 0.4 + profile.confidence * 0.35 + profile.aggression * 0.2;
      return willingness * reach * healthNerve(situation, profile) * (situation.onMarkedTarget ? 1.1 : 1);
    },
    explain: (situation) => (situation.onMarkedTarget ? "already on the mark" : "the mark is somewhere else"),
  },
  {
    id: "screen",
    displayName: "Screen",
    description: "Put itself between the creature and whatever is behind it.",
    score: (situation, profile) => {
      if (!Number.isFinite(situation.targetDistanceMeters)) return 0;
      // Worth doing when somebody needs it, and more so for a crew who cover.
      const need =
        clamp01(1 - situation.playerHealthFraction) * 0.6 +
        (situation.civilianDistanceMeters < 400 ? 0.4 : 0);
      return profile.supportTendency * need * healthNerve(situation, profile);
    },
    explain: (situation) =>
      situation.playerHealthFraction < 0.6 ? "you are taking damage" : "somebody is behind it",
  },
  {
    id: "escort",
    displayName: "Escort",
    description: "Stay with the people being moved out and keep it off them.",
    score: (situation, profile) => {
      if (!Number.isFinite(situation.civilianDistanceMeters)) return 0;
      const proximity = clamp01(1 - situation.civilianDistanceMeters / 800);
      return (0.3 + profile.supportTendency * 0.5) * proximity;
    },
    explain: (situation) => `civilians ${Math.round(situation.civilianDistanceMeters)} m away`,
  },
  {
    id: "hold-position",
    displayName: "Hold position",
    description: "Stay where it was put and fight from there.",
    score: (situation) => {
      // Only interesting when it has somewhere it is supposed to be.
      if (!Number.isFinite(situation.anchorDistanceMeters)) return 0;
      return 0.3 + clamp01(situation.anchorDistanceMeters / 200) * 0.4;
    },
    explain: (situation) => `${Math.round(situation.anchorDistanceMeters)} m off its post`,
  },
  {
    id: "regroup",
    displayName: "Regroup",
    description: "Break contact and come back to the player.",
    score: (situation, profile) => {
      const separation = clamp01(situation.playerDistanceMeters / 600);
      const worry = clamp01(1 - situation.healthFraction) * 0.5 + (1 - profile.confidence) * 0.3;
      return separation * (0.3 + worry);
    },
    explain: (situation) => `${Math.round(situation.playerDistanceMeters)} m from you`,
  },
  {
    id: "suppress",
    displayName: "Suppress",
    description: "Shoot it from where it cannot reach.",
    score: (situation, profile) => {
      if (situation.ammunitionFraction <= 0.02) return 0;
      if (situation.friendlyInLine) return 0;
      // Best at the range this crew likes, falling away either side of it.
      const offRange = Math.abs(situation.targetDistanceMeters - profile.preferredRangeMeters);
      const fit = clamp01(1 - offRange / Math.max(80, profile.preferredRangeMeters));
      return fit * (0.3 + situation.ammunitionFraction * 0.5) * (1 - profile.aggression * 0.3);
    },
    explain: (situation, profile) =>
      situation.friendlyInLine
        ? "somebody is in the line of fire"
        : `${Math.round(situation.targetDistanceMeters)} m against a preferred ${Math.round(profile.preferredRangeMeters)} m`,
  },
  {
    id: "reposition",
    displayName: "Reposition",
    description: "Move to somewhere it can actually work from.",
    score: (situation, profile) => {
      const crowded = situation.nearestAllyMeters < 70 ? 0.4 : 0;
      const blocked = situation.routeBlocked ? 0.35 : 0;
      const badRange =
        Math.abs(situation.targetDistanceMeters - profile.preferredRangeMeters) >
        profile.preferredRangeMeters * 0.8
          ? 0.3
          : 0;
      const lineOfFire = situation.friendlyInLine ? 0.45 : 0;
      return clamp01(crowded + blocked + badRange + lineOfFire + situation.frustration * 0.3);
    },
    explain: (situation) =>
      situation.friendlyInLine
        ? "needs an angle that is not through a friendly"
        : situation.nearestAllyMeters < 70
          ? "too close to the other machine"
          : "wrong distance for this crew",
  },
  {
    id: "withdraw",
    displayName: "Withdraw",
    description: "Get out before the machine is lost.",
    score: (situation, profile) => {
      // A small standing willingness to leave, so an order to disengage has
      // something to multiply. Without it a healthy crew told to break contact
      // would score zero for leaving and quietly keep fighting.
      const baseline = 0.15;
      if (situation.healthFraction > SELF_PRESERVATION_HEALTH) return baseline;
      const hurt = clamp01((SELF_PRESERVATION_HEALTH - situation.healthFraction) / SELF_PRESERVATION_HEALTH);
      // A confident crew stays longer. Nobody stays forever, and a machine
      // close to being lost stops arguing about whether the shot was good.
      return baseline + hurt * (1.3 - profile.confidence * 0.5) * 1.6;
    },
    explain: (situation) => `${Math.round(situation.healthFraction * 100)} percent structure left`,
  },
  {
    id: "assist",
    displayName: "Assist",
    description: "Land something at the moment the player commits.",
    score: (situation, profile) => {
      if (!situation.playerCommitted) return 0;
      if (situation.playerDistanceMeters > 400) return 0;
      return (
        (0.4 + profile.supportTendency * 0.4 + profile.aggression * 0.2) * healthNerve(situation, profile)
      );
    },
    explain: () => "you are committing to something",
  },
];

export function validateAllyGoal(entry: AllyGoalDefinition): string[] {
  const errors: string[] = [];
  if (!ALLY_GOALS.includes(entry.id)) errors.push(`unknown ally goal "${entry.id}"`);
  if (typeof entry.score !== "function") errors.push("score must be a function");
  if (typeof entry.explain !== "function") errors.push("explain must be a function");
  if (entry.description.trim().length < 10) errors.push("say what the goal is, in words");
  return errors;
}

export function createAllyGoalRegistry(): ContentRegistry<AllyGoalDefinition> {
  const registry = new ContentRegistry<AllyGoalDefinition>(validateAllyGoal);
  for (const entry of GOAL_DEFINITIONS) registry.register(entry);
  return registry;
}

export const ALLY_GOAL_DEFINITIONS = GOAL_DEFINITIONS;

export interface AllyGoalScore {
  readonly goal: AllyGoal;
  readonly score: number;
  readonly reason: string;
}

export interface AllyDecision {
  readonly goal: AllyGoal;
  readonly score: number;
  readonly reason: string;
  /** Everything considered, highest first, for the debug view. */
  readonly considered: readonly AllyGoalScore[];
  /** The order that was standing when this was decided. */
  readonly order: SquadOrderId;
  /** True when the order's own constraints changed what was possible. */
  readonly constrained: boolean;
}

export interface DecideOptions {
  readonly situation: AllySituation;
  readonly profile: AllyProfile;
  readonly order?: SquadOrderDefinition;
  /** What it decided last time, so a marginally better goal does not flip it. */
  readonly previous?: AllyGoal | null;
  readonly goals?: ContentRegistry<AllyGoalDefinition>;
}

/**
 * What an ally does next.
 *
 * Three multipliers, in one place: the goal's own desire, the crew's standing
 * lean, and the order that is currently in force. Nothing else touches the
 * number, so a surprising decision can always be explained by reading three
 * values rather than by tracing a state machine.
 */
export function decideAllyGoal(options: DecideOptions): AllyDecision {
  const goals = options.goals ?? createAllyGoalRegistry();
  const order = options.order;
  const situation = options.situation;
  const profile = options.profile;

  const considered: AllyGoalScore[] = [];
  for (const goal of goals.all()) {
    const raw = goal.score(situation, profile);
    if (raw <= 0) continue;
    const bias = profile.bias[goal.id] ?? 1;
    const weight = order?.weights[goal.id] ?? 1;
    let score = raw * bias * weight;

    // Constraints are not advice. A crew told to stay out does not get to
    // decide that closing scored well enough this tick.
    if (order?.constraints.minimumRangeMeters !== undefined && goal.id === "engage") {
      if (situation.targetDistanceMeters < order.constraints.minimumRangeMeters) score = 0;
    }
    if (order?.constraints.ammunitionFloor !== undefined && goal.id === "suppress") {
      if (situation.ammunitionFraction < order.constraints.ammunitionFloor) score = 0;
    }
    if (order?.constraints.leashMeters !== undefined && (goal.id === "engage" || goal.id === "focus")) {
      if (situation.anchorDistanceMeters > order.constraints.leashMeters) score *= 0.25;
    }
    if (score <= 0) continue;

    considered.push({ goal: goal.id, score, reason: goal.explain(situation, profile) });
  }

  considered.sort((a, b) => b.score - a.score || a.goal.localeCompare(b.goal));
  const leader = considered[0];
  if (!leader) {
    return {
      goal: "hold-position",
      score: 0,
      reason: "nothing worth doing",
      considered,
      order: order?.id ?? DEFAULT_ORDER,
      constrained: false,
    };
  }

  // Hysteresis: keep doing what it was doing unless something is clearly better.
  const previous = options.previous ? considered.find((entry) => entry.goal === options.previous) : undefined;
  const chosen = previous && leader.score - previous.score < HYSTERESIS ? previous : leader;

  return {
    goal: chosen.goal,
    score: chosen.score,
    reason: chosen.reason,
    considered,
    order: order?.id ?? DEFAULT_ORDER,
    constrained: order ? Object.keys(order.constraints).length > 0 : false,
  };
}

/** The order table, so callers do not each build their own. */
export { createSquadOrderRegistry };

/**
 * How much nerve the crew has left.
 *
 * Everything aggressive is scaled by this, so a hurt machine with a nervous crew
 * stops volunteering without needing a separate "am I scared" branch in each
 * goal. It never reaches zero: an ally that freezes completely is a turret that
 * has stopped being a turret.
 */
function healthNerve(situation: AllySituation, profile: AllyProfile): number {
  const floor = 0.15;
  const nerve = situation.healthFraction * (0.6 + profile.confidence * 0.4) + profile.aggression * 0.2;
  return Math.max(floor, Math.min(1, nerve));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
