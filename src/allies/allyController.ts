import {
  decideAllyGoal,
  createAllyGoalRegistry,
  type AllyDecision,
  type AllyGoalDefinition,
  type AllyProfile,
  type AllySituation,
} from "./allyBehavior";
import type { SquadOrderDefinition } from "../data/squadOrders";
import type { ContentRegistry } from "../data/registry";

/**
 * What an ally actually does about what it decided.
 *
 * The decision is a goal; this turns a goal into an intent, which is a small
 * description of what the ally wants this tick: somewhere to be, something to
 * hit, whether to shoot, whether to guard. A thin adapter applies an intent to
 * the arena with the same calls the player's own input makes.
 *
 * Deliberately pure. An intent can be computed and asserted with no arena, no
 * scene and no clock, which is what makes "two allies do not both waste their
 * signature" a test rather than an observation.
 *
 * Nothing here plays an animation or drives a position directly. An order
 * changes a goal, a goal produces an intent, and the arena decides what any of
 * that looks like, exactly as it does for the player.
 */

export interface Point2 {
  readonly east: number;
  readonly north: number;
}

export interface AllyIntent {
  readonly crewId: string;
  readonly goal: AllyDecision["goal"];
  /** Where it wants to be, or null when it is happy where it is. */
  readonly movePoint: Point2 | null;
  /** What it wants to hit, or null. */
  readonly targetId: string | null;
  /** Which part of that target, chosen to avoid doubling up with another ally. */
  readonly targetZoneId: string | null;
  readonly fire: boolean;
  readonly guard: boolean;
  /** True only when the moment is worth a signature or a finisher. */
  readonly useSignature: boolean;
  /** Something to say, or null. Acknowledgements and warnings, not chatter. */
  readonly say: string | null;
  readonly reason: string;
}

export interface AllyInputs {
  readonly situation: AllySituation;
  /** Where this ally is standing. */
  readonly position: Point2;
  /** Where the player machine is. */
  readonly playerPosition: Point2;
  /** Where the thing it is interested in is, or null. */
  readonly targetPosition: Point2 | null;
  /** Where the marked target is, or null. */
  readonly markedPosition: Point2 | null;
  /** Where the standing order pointed, or null. */
  readonly anchor: Point2 | null;
  /** Where the civilians are, or null. */
  readonly civilianPosition: Point2 | null;
  /** Ids of the target's zones, in the order the arena reports them. */
  readonly targetZoneIds: readonly string[];
  /** Zones other allies have already claimed this tick. */
  readonly claimedZones: readonly string[];
  /** Whether the player is close enough to a finisher for a joint attack. */
  readonly signatureWindow: boolean;
}

export interface AllyControllerOptions {
  readonly crewId: string;
  readonly profile: AllyProfile;
  readonly goals?: ContentRegistry<AllyGoalDefinition>;
  /** Minimum spacing between two allies, so they do not stand in each other. */
  readonly spacingMeters?: number;
}

/** How far apart two ally machines try to stay. Roughly two machine widths. */
export const ALLY_SPACING_METERS = 85;

export class AllyController {
  private readonly crewId: string;
  private readonly goals: ContentRegistry<AllyGoalDefinition>;
  private readonly spacing: number;
  private profileValue: AllyProfile;
  private previousGoal: AllyDecision["goal"] | null = null;
  private lastDecision: AllyDecision | null = null;
  /** True once this ally has spent its signature on the current target. */
  private signatureSpent = false;
  /** How long the route has been failing, for path recovery. */
  private stuckSeconds = 0;

  constructor(options: AllyControllerOptions) {
    this.crewId = options.crewId;
    this.goals = options.goals ?? createAllyGoalRegistry();
    this.spacing = options.spacingMeters ?? ALLY_SPACING_METERS;
    this.profileValue = options.profile;
  }

  /** Personality can change between sorties, so it is settable rather than fixed. */
  setProfile(profile: AllyProfile): void {
    this.profileValue = profile;
  }

  decision(): AllyDecision | null {
    return this.lastDecision;
  }

  /** Reset the signature guard when the ally moves on to something else. */
  clearSignature(): void {
    this.signatureSpent = false;
  }

  /**
   * One tick of thinking.
   *
   * Deterministic: the same inputs and the same profile give the same intent,
   * which is what lets a squad be replayed from a seed.
   */
  advance(deltaSeconds: number, inputs: AllyInputs, order?: SquadOrderDefinition): AllyIntent {
    const decision = decideAllyGoal({
      situation: inputs.situation,
      profile: this.profileValue,
      order,
      previous: this.previousGoal,
      goals: this.goals,
    });
    this.previousGoal = decision.goal;
    this.lastDecision = decision;

    // Path recovery: if the route has been blocked for a while, stop trying the
    // same way through and take an offset instead of standing in the rubble.
    this.stuckSeconds = inputs.situation.routeBlocked ? this.stuckSeconds + deltaSeconds : 0;
    const detour = this.stuckSeconds > 3;

    const targetId = inputs.situation.onMarkedTarget || order?.needsTarget ? "marked" : "nearest";
    const wantsTarget = decision.goal !== "escort" && decision.goal !== "hold-position";

    const intent: AllyIntent = {
      crewId: this.crewId,
      goal: decision.goal,
      movePoint: this.movePointFor(decision, inputs, order, detour),
      targetId: wantsTarget ? targetId : null,
      targetZoneId: wantsTarget ? this.zoneFor(inputs) : null,
      // Never fire through a friendly, whatever the goal says. This is a hard
      // rule rather than a weight: an ally that shoots the player occasionally
      // is worse than one that never shoots at all.
      fire: this.shouldFire(decision, inputs, order),
      guard: this.shouldGuard(decision, inputs),
      useSignature: this.shouldUseSignature(decision, inputs, order),
      say: null,
      reason: decision.reason,
    };
    if (intent.useSignature) this.signatureSpent = true;
    return intent;
  }

  /** Where this goal wants the machine to be. */
  private movePointFor(
    decision: AllyDecision,
    inputs: AllyInputs,
    order: SquadOrderDefinition | undefined,
    detour: boolean,
  ): Point2 | null {
    const spaced = (point: Point2 | null): Point2 | null => {
      if (!point) return null;
      // Keep out of the other machine's way. A squad that stands in one place
      // is one machine with two health bars.
      if (inputs.situation.nearestAllyMeters >= this.spacing && !detour) return point;
      const dx = point.east - inputs.position.east;
      const dy = point.north - inputs.position.north;
      const length = Math.hypot(dx, dy) || 1;
      // Step sideways from the direct line rather than reversing.
      return {
        east: point.east + (-dy / length) * this.spacing,
        north: point.north + (dx / length) * this.spacing,
      };
    };

    switch (decision.goal) {
      case "hold-position":
        return inputs.anchor;
      case "regroup":
        return spaced(inputs.playerPosition);
      case "escort":
        return spaced(inputs.civilianPosition ?? inputs.anchor);
      case "screen":
        return spaced(this.between(inputs.targetPosition, inputs.playerPosition));
      case "withdraw":
        return this.away(inputs.position, inputs.targetPosition, 240);
      case "suppress":
      case "reposition": {
        const target = inputs.markedPosition ?? inputs.targetPosition;
        // An order that says stay out overrides what this crew would prefer.
        // Otherwise a brawler crew told to keep its distance would reposition
        // to forty metres and call it obeying.
        const range = Math.max(
          this.profileValue.preferredRangeMeters,
          order?.constraints.minimumRangeMeters ?? 0,
        );
        return spaced(this.standOff(inputs.position, target, range));
      }
      case "focus":
        return spaced(this.closeTo(inputs.markedPosition ?? inputs.targetPosition, order));
      default:
        return spaced(this.closeTo(inputs.targetPosition, order));
    }
  }

  /**
   * Which part of the creature to attack.
   *
   * Skips anything another ally has already claimed this tick, so two machines
   * do not both grind the same leg while the head goes unanswered. Falls back to
   * the first zone when everything is claimed, because refusing to attack is
   * worse than doubling up.
   */
  private zoneFor(inputs: AllyInputs): string | null {
    const free = inputs.targetZoneIds.filter((id) => !inputs.claimedZones.includes(id));
    return free[0] ?? inputs.targetZoneIds[0] ?? null;
  }

  private shouldFire(
    decision: AllyDecision,
    inputs: AllyInputs,
    order: SquadOrderDefinition | undefined,
  ): boolean {
    if (inputs.situation.friendlyInLine) return false;
    if (inputs.situation.ammunitionFraction <= 0) return false;
    const floor = order?.constraints.ammunitionFloor;
    if (floor !== undefined && inputs.situation.ammunitionFraction < floor) return false;
    return decision.goal === "suppress" || decision.goal === "focus" || decision.goal === "assist";
  }

  private shouldGuard(decision: AllyDecision, inputs: AllyInputs): boolean {
    if (decision.goal === "screen") return true;
    if (decision.goal === "withdraw") return true;
    // Hurt and close to something is when a machine puts its arms up.
    return inputs.situation.healthFraction < 0.5 && inputs.situation.targetDistanceMeters < 90;
  }

  /**
   * Whether this is the moment for the big one.
   *
   * Once per target, only when the player has committed or the order asked for
   * it, and never while told to hold it. Two allies cannot both burn a signature
   * on the same swing because each one spends its own only once and only inside
   * the window the player opened.
   */
  private shouldUseSignature(
    decision: AllyDecision,
    inputs: AllyInputs,
    order: SquadOrderDefinition | undefined,
  ): boolean {
    if (this.signatureSpent) return false;
    if (order?.constraints.holdSignature) return false;
    if (!inputs.signatureWindow) return false;
    return decision.goal === "assist" || decision.goal === "focus";
  }

  private closeTo(target: Point2 | null, order: SquadOrderDefinition | undefined): Point2 | null {
    if (!target) return null;
    const minimum = order?.constraints.minimumRangeMeters;
    if (minimum === undefined) return target;
    return this.standOff({ east: target.east, north: target.north }, target, minimum);
  }

  /** A point the given distance away from the target, on the line from here. */
  private standOff(from: Point2, target: Point2 | null, distance: number): Point2 | null {
    if (!target) return null;
    const dx = from.east - target.east;
    const dy = from.north - target.north;
    const length = Math.hypot(dx, dy);
    if (length < 1) return { east: target.east + distance, north: target.north };
    return {
      east: target.east + (dx / length) * distance,
      north: target.north + (dy / length) * distance,
    };
  }

  private away(from: Point2, target: Point2 | null, distance: number): Point2 | null {
    if (!target) return null;
    return this.standOff(from, target, distance);
  }

  private between(first: Point2 | null, second: Point2 | null): Point2 | null {
    if (!first || !second) return null;
    return { east: (first.east + second.east) / 2, north: (first.north + second.north) / 2 };
  }
}

/**
 * Resolves a whole squad's intents in one pass.
 *
 * Done together rather than one at a time so that zone claims and spacing are
 * decided against what the others are actually doing this tick, not against
 * what they did last tick. This is what stops two allies picking the same leg.
 */
export function resolveSquadIntents(
  members: readonly {
    readonly controller: AllyController;
    readonly inputs: AllyInputs;
    readonly order?: SquadOrderDefinition;
  }[],
  deltaSeconds: number,
): readonly AllyIntent[] {
  const claimed: string[] = [];
  const intents: AllyIntent[] = [];
  for (const member of members) {
    const intent = member.controller.advance(
      deltaSeconds,
      { ...member.inputs, claimedZones: [...member.inputs.claimedZones, ...claimed] },
      member.order,
    );
    if (intent.targetZoneId) claimed.push(intent.targetZoneId);
    intents.push(intent);
  }
  return intents;
}
