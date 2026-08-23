import { ContentRegistry, type RegistryEntry } from "../data/registry";
import type { DamagePacket } from "../data/moves";

/**
 * Reactions.
 *
 * What being hit does, as a shared table both sides read. A Jaeger staggering
 * and a kaiju staggering are the same reaction with different numbers behind
 * them, which is what makes a reaction reusable rather than a special case
 * written twice.
 *
 * Every reaction is a length, a loss of control and what it does to the poise
 * that produced it. Nothing here decides who hit whom.
 */

export const REACTION_IDS = [
  "none",
  "flinch",
  "stagger",
  "guard-break",
  "launch",
  "wall-impact",
  "knockdown",
  "component-shock",
] as const;
export type ReactionId = (typeof REACTION_IDS)[number];

export interface ReactionDefinition extends RegistryEntry {
  readonly id: ReactionId;
  readonly displayName: string;
  /** Ticks the reaction holds. Combat runs at sixty ticks a second. */
  readonly durationTicks: number;
  /** True when the victim cannot act at all for the duration. */
  readonly losesControl: boolean;
  /** True when the victim can be hit by anything without further reaction. */
  readonly vulnerable: boolean;
  /** Fraction of accumulated poise damage cleared when the reaction fires. */
  readonly poiseReset: number;
  /** Multiplier on knockback the packet asked for. */
  readonly knockbackScale: number;
  /** True when this reaction opens the target to a finisher while it lasts. */
  readonly finisherWindow: boolean;
  readonly description: string;
}

const REACTIONS: readonly ReactionDefinition[] = [
  {
    id: "none",
    displayName: "Absorbed",
    durationTicks: 0,
    losesControl: false,
    vulnerable: false,
    poiseReset: 0,
    knockbackScale: 0,
    finisherWindow: false,
    description: "Took it and kept going. Something this heavy does that a lot.",
  },
  {
    id: "flinch",
    displayName: "Flinch",
    durationTicks: 8,
    losesControl: false,
    vulnerable: false,
    poiseReset: 0,
    knockbackScale: 0.4,
    finisherWindow: false,
    description: "A hitch in what it was doing. Enough to interrupt a light attack, not a heavy one.",
  },
  {
    id: "stagger",
    displayName: "Stagger",
    durationTicks: 42,
    losesControl: true,
    vulnerable: true,
    poiseReset: 1,
    knockbackScale: 1,
    finisherWindow: false,
    description: "Off balance and not acting. This is what poise damage is for.",
  },
  {
    id: "guard-break",
    displayName: "Guard broken",
    durationTicks: 54,
    losesControl: true,
    vulnerable: true,
    poiseReset: 0.5,
    knockbackScale: 0.6,
    finisherWindow: true,
    description: "The guard is gone and so is the next few seconds. The opening a finisher wants.",
  },
  {
    id: "launch",
    displayName: "Launched",
    durationTicks: 66,
    losesControl: true,
    vulnerable: true,
    poiseReset: 1,
    knockbackScale: 1.2,
    finisherWindow: true,
    description: "Lifted off its feet. Everything that follows lands on something in the air.",
  },
  {
    id: "wall-impact",
    displayName: "Wall impact",
    durationTicks: 48,
    losesControl: true,
    vulnerable: true,
    poiseReset: 1,
    knockbackScale: 0.2,
    finisherWindow: true,
    description: "Driven into a building and stopped by it, which costs the building as much as the fight.",
  },
  {
    id: "knockdown",
    displayName: "Knocked down",
    durationTicks: 96,
    losesControl: true,
    vulnerable: true,
    poiseReset: 1,
    knockbackScale: 1.4,
    finisherWindow: true,
    description: "Down. Getting up takes the frame's own time, and it is a long time.",
  },
  {
    id: "component-shock",
    displayName: "Component shock",
    durationTicks: 20,
    losesControl: false,
    vulnerable: false,
    poiseReset: 0,
    knockbackScale: 0.3,
    finisherWindow: false,
    description: "A part took the hit rather than the body. Something specific stops working.",
  },
];

export function validateReaction(entry: ReactionDefinition): string[] {
  const errors: string[] = [];
  if (!REACTION_IDS.includes(entry.id)) errors.push(`unknown reaction "${entry.id}"`);
  if (!Number.isInteger(entry.durationTicks) || entry.durationTicks < 0) {
    errors.push("durationTicks must be a whole number of ticks, zero or more");
  }
  if (entry.poiseReset < 0 || entry.poiseReset > 1) errors.push("poiseReset is a fraction");
  if (entry.knockbackScale < 0) errors.push("knockbackScale must be zero or more");
  if (!entry.description) errors.push("description required");
  // A reaction that takes control away for no time is a reaction that does
  // nothing, which would be a silently dead rule.
  if (entry.losesControl && entry.durationTicks <= 0) {
    errors.push("a reaction that takes control away must last some ticks");
  }
  if (entry.finisherWindow && !entry.vulnerable) {
    errors.push("a finisher window must also be a vulnerable one");
  }
  return errors;
}

export function createReactionRegistry(): ContentRegistry<ReactionDefinition> {
  const registry = new ContentRegistry<ReactionDefinition>(validateReaction);
  for (const reaction of REACTIONS) registry.register(reaction);
  return registry;
}

export const REACTION_DEFINITIONS = REACTIONS;

const BY_ID: ReadonlyMap<ReactionId, ReactionDefinition> = new Map(
  REACTIONS.map((reaction) => [reaction.id, reaction]),
);

export function reactionDefinition(id: ReactionId): ReactionDefinition {
  const definition = BY_ID.get(id);
  if (!definition) throw new Error(`Unknown reaction "${id}"`);
  return definition;
}

export interface ReactionContext {
  /** Poise already taken, before this packet. */
  readonly poiseAccumulated: number;
  readonly poiseCapacity: number;
  /** Guard health, or null when the defender is not guarding. */
  readonly guardRemaining: number | null;
  /** True when the defender is already down or launched. */
  readonly alreadyReeling: boolean;
  /** Health fraction of the zone that decides whether the fight is over. */
  readonly coreHealthFraction: number;
  readonly finisherThreshold: number;
}

export interface ReactionOutcome {
  readonly reaction: ReactionDefinition;
  /** Poise carried forward after this hit. */
  readonly poiseAccumulated: number;
  /** Guard left, or null when the defender was not guarding. */
  readonly guardRemaining: number | null;
  readonly guardBroken: boolean;
  readonly knockbackMps: number;
  /** True when a finisher is legal against this target right now. */
  readonly finisherEligible: boolean;
}

/**
 * Turns a packet and a defender's state into what actually happens.
 *
 * The order of the rules is the design: a guard eats the hit until it breaks,
 * poise decides whether a flinch becomes a stagger, and a reaction the packet
 * named outright always wins. There is no branch on who threw the punch.
 */
export function resolveReaction(packet: DamagePacket, context: ReactionContext): ReactionOutcome {
  const guarding = context.guardRemaining !== null;
  let guardRemaining = context.guardRemaining;
  let guardBroken = false;

  if (guarding && guardRemaining !== null) {
    guardRemaining = guardRemaining - packet.guardDamage;
    if (guardRemaining <= 0) {
      guardBroken = true;
      guardRemaining = 0;
    }
  }

  const poiseAfter = context.poiseAccumulated + packet.poise;
  const poiseSpent = poiseAfter >= context.poiseCapacity;

  // Order is the design, and it reads top to bottom.
  //
  // A broken guard beats everything and an intact one absorbs. A knockdown or a
  // launch is what the packet asked for outright: those belong to slow,
  // expensive moves that have earned the right to ignore poise. **Everything
  // else is gated by poise**, which is the rule that stops a heavy attack from
  // staggering on every landing. Without it a machine that could keep throwing
  // heavies held a kaiju in a stagger for the whole fight and the creature never
  // acted once.
  const reactionId: ReactionId = guardBroken
    ? "guard-break"
    : guarding
      ? "none"
      : packet.reaction === "knockdown"
        ? "knockdown"
        : packet.reaction === "launch"
          ? "launch"
          : poiseSpent
            ? "stagger"
            : packet.componentShock >= 0.25
              ? "component-shock"
              : packet.reaction === "none"
                ? "none"
                : "flinch";

  const reaction = reactionDefinition(reactionId);
  const poiseAccumulated = Math.max(0, poiseAfter * (1 - reaction.poiseReset));

  return {
    reaction,
    poiseAccumulated,
    guardRemaining,
    guardBroken,
    knockbackMps: packet.knockbackMps * reaction.knockbackScale,
    // A finisher is legal when the target is both hurt enough and open enough.
    // Either alone is not an opening.
    finisherEligible:
      context.coreHealthFraction <= context.finisherThreshold &&
      (reaction.finisherWindow || context.alreadyReeling),
  };
}
