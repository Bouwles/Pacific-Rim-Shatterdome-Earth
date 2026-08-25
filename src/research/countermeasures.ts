import { createResearchRegistry, type ResearchNodeDefinition } from "../data/research";
import { ContentRegistry } from "../data/registry";

/**
 * What research does to a fight.
 *
 * One object, composed from everything finished, applied where the fight already
 * derives its numbers. This is the same shape as the machine growth object from
 * the progression work and the facility effects object from the construction
 * work, for the same reason: a benefit reaches the simulation through a value
 * the simulation already reads, so nothing in combat has to know that research
 * exists.
 *
 * The hard rule, which the node validator also enforces: **none of this is a
 * damage bonus.** A countermeasure tells you what is coming, refuses a status,
 * holds a contact that would have been lost, or opens a piece of equipment. A
 * player with the whole tree finished hits exactly as hard as one with none of
 * it, and knows vastly more about what they are hitting.
 *
 * Pure and serialisable. No Babylon, no DOM, no RNG.
 */

export interface CountermeasureProfile {
  /**
   * Seconds of warning before a wind-up commits, 0 to 1 of the startup window.
   *
   * Zero means a player sees what any player sees: the animation. Above zero
   * means the display calls it, and at the top end it says which way.
   */
  readonly telegraphLead: number;
  /** True once the readout names the move rather than only flagging one. */
  readonly telegraphNamesMove: boolean;
  /** Per status id, the fraction of its duration refused. 0 to 0.9. */
  readonly statusResistance: Readonly<Record<string, number>>;
  /** Extra metres a contact holds for, per condition. `*` applies everywhere. */
  readonly trackingRange: Readonly<Record<string, number>>;
  /** True once weak zones are marked before the first exchange. */
  readonly weakPointsMarked: boolean;
  /** Equipment ids research has opened. */
  readonly equipment: readonly string[];
  /** Chassis ids research has put within reach. */
  readonly chassis: readonly string[];
  /** Facility effect names research improves, and by how much. */
  readonly facility: Readonly<Record<string, number>>;
}

export function neutralCountermeasures(): CountermeasureProfile {
  return {
    telegraphLead: 0,
    telegraphNamesMove: false,
    statusResistance: {},
    trackingRange: {},
    weakPointsMarked: false,
    equipment: [],
    chassis: [],
    facility: {},
  };
}

/** The most a status can be refused. Nothing is ever immune to anything. */
export const MAX_STATUS_RESISTANCE = 0.85;
/** Above this telegraph lead the readout starts naming the move. */
export const TELEGRAPH_NAMING_THRESHOLD = 0.5;

/**
 * Builds the profile from what has been finished.
 *
 * Benefits of the same kind against the same target do not add. They take the
 * best, because two ways of learning the same thing is knowing it once, and
 * adding them is how a tree turns into a pile of stacking percentages.
 */
export function resolveCountermeasures(
  completedIds: readonly string[],
  registry: ContentRegistry<ResearchNodeDefinition> = createResearchRegistry(),
): CountermeasureProfile {
  let telegraphLead = 0;
  let weakPointsMarked = false;
  const statusResistance: Record<string, number> = {};
  const trackingRange: Record<string, number> = {};
  const facility: Record<string, number> = {};
  const equipment = new Set<string>();
  const chassis = new Set<string>();

  for (const id of completedIds) {
    const node = registry.get(id);
    if (!node) continue;
    for (const benefit of node.benefits) {
      switch (benefit.kind) {
        case "telegraph":
          telegraphLead = Math.max(telegraphLead, benefit.magnitude);
          break;
        case "status-resist":
          statusResistance[benefit.target] = Math.min(
            MAX_STATUS_RESISTANCE,
            Math.max(statusResistance[benefit.target] ?? 0, benefit.magnitude),
          );
          break;
        case "tracking":
          trackingRange[benefit.target] = Math.max(trackingRange[benefit.target] ?? 0, benefit.magnitude);
          break;
        case "weak-point":
          // Half marks the recovery crews; a full mark reaches the fight.
          if (benefit.magnitude >= 1) weakPointsMarked = true;
          break;
        case "equipment":
          equipment.add(benefit.target);
          break;
        case "chassis":
          chassis.add(benefit.target);
          break;
        default:
          facility[benefit.target] = Math.max(facility[benefit.target] ?? 0, benefit.magnitude);
          break;
      }
    }
  }

  return {
    telegraphLead: Math.min(1, telegraphLead),
    telegraphNamesMove: telegraphLead >= TELEGRAPH_NAMING_THRESHOLD,
    statusResistance,
    trackingRange,
    weakPointsMarked,
    equipment: [...equipment].sort(),
    chassis: [...chassis].sort(),
    facility,
  };
}

/**
 * How long a status actually lasts.
 *
 * Applied where a status is placed, so every source of that status is covered by
 * one change rather than each weapon having to remember.
 */
export function resistedDuration(
  baseTicks: number,
  statusId: string,
  profile: CountermeasureProfile,
): number {
  const resistance = Math.min(MAX_STATUS_RESISTANCE, profile.statusResistance[statusId] ?? 0);
  // Never to zero. Something always gets through, so no research finishes the
  // conversation about a damage type.
  return Math.max(1, Math.round(baseTicks * (1 - resistance)));
}

/**
 * How far a contact holds, given the conditions it is being held in.
 *
 * Conditions are things like `water` or `storm`. The wildcard applies whatever
 * the conditions are, and the best matching condition applies on top of it.
 */
export function trackingRangeFor(
  baseMetres: number,
  conditions: readonly string[],
  profile: CountermeasureProfile,
): number {
  const universal = profile.trackingRange["*"] ?? 0;
  let conditional = 0;
  for (const condition of conditions) {
    conditional = Math.max(conditional, profile.trackingRange[condition] ?? 0);
  }
  return baseMetres + universal + conditional;
}

/** What the display can say about a wind-up in progress. */
export interface TelegraphReadout {
  /** True when the player is told anything at all. */
  readonly visible: boolean;
  /** Ticks before it commits, once it is visible. */
  readonly ticksToCommit: number;
  /** Named once the behavioural model is in. Otherwise a generic warning. */
  readonly label: string;
  /** Zones it is about to threaten. Empty until weak points are marked. */
  readonly threatenedZones: readonly string[];
}

/**
 * Reads a wind-up.
 *
 * A move's startup window is the telegraph; it exists already and always has.
 * What research changes is how much of that window the player is told about, and
 * whether they are told what it is. Without any research the readout is silent
 * and a player reads the animation, which is exactly the fight everyone had
 * before this milestone.
 */
export function readTelegraph(
  input: {
    readonly moveDisplayName: string;
    readonly startupTicks: number;
    readonly ticksElapsed: number;
    readonly threatenedZones: readonly string[];
  },
  profile: CountermeasureProfile,
): TelegraphReadout {
  const remaining = Math.max(0, input.startupTicks - input.ticksElapsed);
  const window = Math.round(input.startupTicks * profile.telegraphLead);
  const visible = profile.telegraphLead > 0 && remaining <= window && remaining > 0;
  return {
    visible,
    ticksToCommit: remaining,
    label: !visible ? "" : profile.telegraphNamesMove ? input.moveDisplayName : "Committing",
    threatenedZones: visible && profile.weakPointsMarked ? input.threatenedZones : [],
  };
}
