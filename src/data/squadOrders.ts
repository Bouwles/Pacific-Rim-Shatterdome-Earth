import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * What you can tell an ally to do.
 *
 * An order is not a script. It does not say "play this animation" or "walk to
 * this point and swing"; it changes what the ally *wants*, and the ally's own
 * utility scoring decides what that means given where it is standing, what it
 * is carrying and what is trying to kill it. That is the difference between a
 * squad you command and a squad you puppet.
 *
 * Every order therefore is a set of weights on the ally goal table plus a few
 * hard constraints, and each one is a row here. Adding an order is a row and a
 * goal to weight, never a branch in the ally controller.
 */

export const SQUAD_ORDERS = [
  "focus-target",
  "defend-area",
  "protect-civilians",
  "hold",
  "regroup",
  "ranged-pressure",
  "conserve-ammunition",
  "disengage",
  "synchronized-attack",
] as const;
export type SquadOrderId = (typeof SQUAD_ORDERS)[number];

/** Goals an ally can pursue. The order table weights these; it never sets them. */
export const ALLY_GOALS = [
  "engage",
  "focus",
  "screen",
  "escort",
  "hold-position",
  "regroup",
  "suppress",
  "reposition",
  "withdraw",
  "assist",
] as const;
export type AllyGoal = (typeof ALLY_GOALS)[number];

export interface SquadOrderDefinition extends RegistryEntry {
  readonly id: SquadOrderId;
  readonly displayName: string;
  /** Key that issues it from the quick command. One character, shown on the dial. */
  readonly hotkey: string;
  /** Per-goal multiplier while this order stands. Missing means one. */
  readonly weights: Partial<Record<AllyGoal, number>>;
  /**
   * Hard constraints the order imposes, which scoring cannot argue with.
   *
   * Kept small and explicit: an order that only nudged weights could always be
   * ignored by a stubborn profile, and an order nobody obeys is not an order.
   */
  readonly constraints: {
    /** Ally will not fire a weapon whose remaining ammunition is below this. */
    readonly ammunitionFloor?: number;
    /** Ally will not move further than this from the point the order named. */
    readonly leashMeters?: number;
    /** Ally refuses to close inside this range. */
    readonly minimumRangeMeters?: number;
    /** Ally will not spend a signature or finisher move. */
    readonly holdSignature?: boolean;
  };
  /** True when the order needs a target or a place to make sense. */
  readonly needsTarget: boolean;
  readonly needsPoint: boolean;
  /** What the ally says back. Acknowledgement is how you know it heard. */
  readonly acknowledgements: readonly string[];
  readonly description: string;
}

const DEFINITIONS: readonly SquadOrderDefinition[] = [
  {
    id: "focus-target",
    displayName: "Focus target",
    hotkey: "1",
    weights: { focus: 2.4, engage: 1.3, suppress: 1.2, withdraw: 0.7 },
    constraints: {},
    needsTarget: true,
    needsPoint: false,
    acknowledgements: ["On it.", "Switching to your mark.", "Same target, understood."],
    description: "Everything they have goes at the thing you are looking at.",
  },
  {
    id: "defend-area",
    displayName: "Defend area",
    hotkey: "2",
    weights: { screen: 2.2, "hold-position": 1.4, engage: 1.1, reposition: 0.6 },
    constraints: { leashMeters: 260 },
    needsTarget: false,
    needsPoint: true,
    acknowledgements: ["Holding this block.", "We have the area.", "Nothing gets past us."],
    description: "They stay near the place you named and meet whatever comes into it.",
  },
  {
    id: "protect-civilians",
    displayName: "Protect civilians",
    hotkey: "3",
    weights: { escort: 2.6, screen: 1.6, engage: 0.9, focus: 0.7, suppress: 0.6 },
    constraints: { leashMeters: 340, holdSignature: true },
    needsTarget: false,
    needsPoint: true,
    acknowledgements: ["Getting between it and them.", "Covering the evacuation.", "People first."],
    description: "They put themselves between the creature and the evacuation, and stop swinging wide.",
  },
  {
    id: "hold",
    displayName: "Hold",
    hotkey: "4",
    weights: { "hold-position": 3, engage: 0.8, reposition: 0.4, focus: 0.7 },
    constraints: { leashMeters: 90 },
    needsTarget: false,
    needsPoint: true,
    acknowledgements: ["Holding.", "Rooted here.", "Not moving."],
    description: "They stand where you put them and fight from there.",
  },
  {
    id: "regroup",
    displayName: "Regroup",
    hotkey: "5",
    weights: { regroup: 3, assist: 1.6, engage: 0.6, focus: 0.5, withdraw: 1.2 },
    constraints: { leashMeters: 140 },
    needsTarget: false,
    needsPoint: false,
    acknowledgements: ["Coming to you.", "Forming up.", "On your position."],
    description: "They break off and come back to you, and cover each other on the way.",
  },
  {
    id: "ranged-pressure",
    displayName: "Ranged pressure",
    hotkey: "6",
    weights: { suppress: 2.6, reposition: 1.4, engage: 0.5, focus: 1.1 },
    constraints: { minimumRangeMeters: 120 },
    needsTarget: false,
    needsPoint: false,
    acknowledgements: ["Opening up from here.", "Keeping it honest.", "Staying out and shooting."],
    description: "They keep their distance and keep firing rather than closing.",
  },
  {
    id: "conserve-ammunition",
    displayName: "Conserve ammunition",
    hotkey: "7",
    weights: { engage: 1.5, suppress: 0.3, focus: 1.1 },
    constraints: { ammunitionFloor: 0.35, holdSignature: true },
    needsTarget: false,
    needsPoint: false,
    acknowledgements: ["Going quiet.", "Saving what we have.", "Hands only from here."],
    description: "They stop spending rounds and finish it up close instead.",
  },
  {
    id: "disengage",
    displayName: "Disengage",
    hotkey: "8",
    weights: { withdraw: 3.2, reposition: 1.5, engage: 0.2, focus: 0.2, suppress: 0.5 },
    constraints: { minimumRangeMeters: 200, holdSignature: true },
    needsTarget: false,
    needsPoint: false,
    acknowledgements: ["Breaking off.", "Falling back.", "Getting clear."],
    description: "They get out, and stay out until told otherwise.",
  },
  {
    id: "synchronized-attack",
    displayName: "Synchronized attack",
    hotkey: "9",
    weights: { assist: 2.8, focus: 2, engage: 1.4, withdraw: 0.5 },
    constraints: {},
    needsTarget: true,
    needsPoint: false,
    acknowledgements: ["On your call.", "Waiting for the mark.", "Together, then."],
    description: "They hold their heaviest attack until you commit, then land it with yours.",
  },
];

export function validateSquadOrder(entry: SquadOrderDefinition): string[] {
  const errors: string[] = [];
  if (!SQUAD_ORDERS.includes(entry.id)) errors.push(`unknown order id "${entry.id}"`);
  if (entry.hotkey.length !== 1) errors.push("hotkey must be exactly one character");
  if (Object.keys(entry.weights).length === 0) {
    errors.push("an order that changes no goal weight would change no behaviour");
  }
  for (const [goal, weight] of Object.entries(entry.weights)) {
    if (!ALLY_GOALS.includes(goal as AllyGoal)) errors.push(`unknown ally goal "${goal}"`);
    if (!Number.isFinite(weight) || weight < 0) errors.push("goal weights must be zero or positive");
  }
  const { ammunitionFloor, leashMeters, minimumRangeMeters } = entry.constraints;
  if (ammunitionFloor !== undefined && (ammunitionFloor <= 0 || ammunitionFloor >= 1)) {
    errors.push("ammunitionFloor must be within (0, 1)");
  }
  if (leashMeters !== undefined && leashMeters <= 0) errors.push("a leash must be a real distance");
  if (minimumRangeMeters !== undefined && minimumRangeMeters <= 0) {
    errors.push("a minimum range must be a real distance");
  }
  if (entry.acknowledgements.length === 0) {
    errors.push("an order with no acknowledgement leaves the player unsure it was heard");
  }
  if (entry.description.trim().length < 15) errors.push("say what the order does, in words");
  return errors;
}

export function createSquadOrderRegistry(): ContentRegistry<SquadOrderDefinition> {
  const registry = new ContentRegistry<SquadOrderDefinition>(validateSquadOrder);
  for (const entry of DEFINITIONS) registry.register(entry);
  // A hotkey that two orders answer to is a quick command that guesses.
  const seen = new Set<string>();
  for (const entry of DEFINITIONS) {
    if (seen.has(entry.hotkey)) throw new Error(`Two squad orders answer to "${entry.hotkey}"`);
    seen.add(entry.hotkey);
  }
  return registry;
}

export const SQUAD_ORDER_DEFINITIONS = DEFINITIONS;

/** The order every ally starts on when nothing has been said. */
export const DEFAULT_ORDER: SquadOrderId = "focus-target";
