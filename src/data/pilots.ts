import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * The people in the Conn-Pod.
 *
 * A Jaeger needs two, and which two matters: the drift is a compatibility
 * between people rather than a stat on one of them. A pair that has fought
 * together holds a stronger link, and a strong link is worth more than either
 * pilot's own numbers.
 *
 * These are original characters. Nothing here is drawn from the films.
 */

export const PILOT_SPECIALISMS = [
  "melee",
  "gunnery",
  "piloting",
  "engineering",
  "science",
  "command",
] as const;
export type PilotSpecialism = (typeof PILOT_SPECIALISMS)[number];

/**
 * What a pilot is like to be around, and to drift with.
 *
 * Tags are how compatibility is decided without a table of every pair: two
 * people who share a tag understand each other faster, and some tags grate
 * against each other. It is looked up in one small table rather than switched.
 */
export const COMPATIBILITY_TAGS = [
  "veteran",
  "reckless",
  "methodical",
  "empathic",
  "stoic",
  "competitive",
] as const;
export type CompatibilityTag = (typeof COMPATIBILITY_TAGS)[number];

/** Pairs of tags that pull against each other. Symmetric, checked both ways. */
export const TAG_FRICTION: readonly (readonly [CompatibilityTag, CompatibilityTag])[] = [
  ["reckless", "methodical"],
  ["competitive", "empathic"],
  ["stoic", "empathic"],
];

/**
 * When a drawback applies.
 *
 * Structured rather than free text, so the planner can check it and say so
 * before launch instead of the player finding out afterwards. Each kind has one
 * evaluator in a table; adding a kind is a row plus an evaluator, never a
 * branch inside the drift calculation.
 */
export type DrawbackTrigger =
  | { readonly kind: "machine-role"; readonly roles: readonly string[] }
  | { readonly kind: "machine-damaged"; readonly belowIntegrity: number }
  | { readonly kind: "night" }
  | { readonly kind: "rough-weather"; readonly abovePenalty: number }
  | { readonly kind: "long-travel"; readonly aboveSeconds: number }
  | { readonly kind: "partner-tag"; readonly tags: readonly CompatibilityTag[] }
  | { readonly kind: "carrying-injury" };

export interface PilotDrawback {
  readonly id: string;
  readonly displayName: string;
  readonly trigger: DrawbackTrigger;
  /** Taken off drift stability when it fires, 0 to 1. */
  readonly stabilityCost: number;
  /** Taken off what the pair can do with the link, 0 to 1. */
  readonly effectivenessCost: number;
  /** The sentence shown before deployment, whether or not it is firing. */
  readonly description: string;
}

/**
 * What a perk does, from a fixed vocabulary.
 *
 * Named effects the game already has somewhere to put, so a perk cannot promise
 * something nothing reads. `poise`, `heat`, `damage` and `structure` reach the
 * machine through the same growth object levels and modules use; `salvage`,
 * `samples` and `recovery` reach the sortie's own ledger.
 */
export const PERK_EFFECTS = [
  "poise",
  "heat",
  "damage",
  "structure",
  "mobility",
  "salvage",
  "samples",
  "recovery",
] as const;
export type PerkEffect = (typeof PERK_EFFECTS)[number];

export interface PerkRank {
  /** Link level this rank arrives at. */
  readonly linkLevel: number;
  /** What it does, as multipliers on named effects. */
  readonly effects: Partial<Record<PerkEffect, number>>;
  /** One line describing what changed about this person, not about the numbers. */
  readonly note: string;
}

export interface PilotPerk {
  readonly id: string;
  readonly displayName: string;
  readonly ranks: readonly PerkRank[];
  readonly description: string;
}

/** What they are like on the radio. Presentation reads this; nothing balances on it. */
export interface DialogueProfile {
  /** How often they speak up, 0 to 1. */
  readonly chattiness: number;
  /** Lines for the moments the game already knows about. */
  readonly onDeploy: readonly string[];
  readonly onDamage: readonly string[];
  readonly onVictory: readonly string[];
  /** What they say off duty, which is where link is built outside a fight. */
  readonly offDuty: readonly string[];
}

export interface PilotDefinition extends RegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly callsign: string;
  readonly specialisms: readonly PilotSpecialism[];
  /** 0 to 1. How well they hold a drift on their own. */
  readonly neuralStability: number;
  /** 0 to 1. Raw skill, before any of the rest of it. */
  readonly skill: number;
  /** How many sorties they have flown. Feeds experience and fatigue. */
  readonly sorties: number;
  /**
   * Pilots this one drifts unusually well with, by id. Compatibility is
   * symmetric and is looked up rather than switched on.
   */
  readonly affinities: readonly string[];
  /** Chassis roles this pilot is at home in. Feeds drift, never a hard refusal. */
  readonly preferredRoles: readonly string[];
  readonly tags: readonly CompatibilityTag[];
  /** The thing that makes them difficult, and exactly when it bites. */
  readonly drawback: PilotDrawback;
  /** Their own perk, which grows with the link rather than with a level. */
  readonly perk: PilotPerk;
  /** 0 to 1. How well they come out of a bad sortie. Higher is tougher. */
  readonly injuryResistance: number;
  readonly dialogue: DialogueProfile;
  readonly biography: string;
}

const PILOTS: readonly PilotDefinition[] = [
  {
    id: "pilot.okonkwo",
    name: "Chidera Okonkwo",
    callsign: "Anvil",
    specialisms: ["melee", "command"],
    neuralStability: 0.82,
    skill: 0.78,
    sorties: 14,
    affinities: ["pilot.varga"],
    preferredRoles: ["brawler", "guardian"],
    tags: ["veteran", "stoic"],
    drawback: {
      id: "drawback.closes-distance",
      displayName: "Closes the distance",
      trigger: { kind: "machine-role", roles: ["marksman", "siege"] },
      stabilityCost: 0.07,
      effectivenessCost: 0.12,
      description:
        "Fights close whatever the machine is built for. In something meant to hold range, " +
        "she walks it into knife fights.",
    },
    perk: {
      id: "perk.anvil",
      displayName: "Set your feet",
      description: "She plants the machine before an exchange, and it stops moving when she says.",
      ranks: [
        { linkLevel: 2, effects: { poise: 1.08 }, note: "Braces before the hit lands." },
        {
          linkLevel: 4,
          effects: { poise: 1.16, structure: 1.04 },
          note: "Takes the blow on the plate she chose.",
        },
        {
          linkLevel: 6,
          effects: { poise: 1.24, structure: 1.08, damage: 1.05 },
          note: "Answers on the same beat.",
        },
      ],
    },
    injuryResistance: 0.72,
    dialogue: {
      chattiness: 0.4,
      onDeploy: ["Feet under us. Let's go to work."],
      onDamage: ["Took that one. Still standing."],
      onVictory: ["That is how it is done. Bring us home."],
      offDuty: [
        "Search and rescue teaches you the city is the thing you are protecting, not the ground you fight on.",
        "I do not need to like a partner. I need to know where they will be.",
      ],
    },
    biography: "Came up through search and rescue. Fights close and does not back off.",
  },
  {
    id: "pilot.varga",
    name: "Ilona Varga",
    callsign: "Ledger",
    specialisms: ["gunnery", "engineering"],
    neuralStability: 0.79,
    skill: 0.81,
    sorties: 16,
    affinities: ["pilot.okonkwo"],
    preferredRoles: ["marksman", "siege"],
    tags: ["methodical", "veteran"],
    drawback: {
      id: "drawback.reads-the-damage",
      displayName: "Reads the damage",
      trigger: { kind: "machine-damaged", belowIntegrity: 0.65 },
      stabilityCost: 0.12,
      effectivenessCost: 0.06,
      description:
        "She knows exactly what is broken and how it will fail. In a hurt machine she flies the " +
        "damage report instead of the fight.",
    },
    perk: {
      id: "perk.ledger",
      displayName: "Thermal discipline",
      description: "She runs the reactor the way it was meant to be run, and it lasts longer for it.",
      ranks: [
        { linkLevel: 2, effects: { heat: 1.1 }, note: "Stops wasting the coolant margin." },
        {
          linkLevel: 4,
          effects: { heat: 1.2, recovery: 0.92 },
          note: "Brings it home in a repairable state.",
        },
        { linkLevel: 6, effects: { heat: 1.3, recovery: 0.85, damage: 1.04 }, note: "Every shot is placed." },
      ],
    },
    injuryResistance: 0.65,
    dialogue: {
      chattiness: 0.6,
      onDeploy: ["Reactor is nominal. Coolant is nominal. Do not make me revise that."],
      onDamage: ["That was the left actuator. I felt it go."],
      onVictory: ["Log it. All of it. I want to know what it cost."],
      offDuty: [
        "Every machine tells you what it is about to do. Most people are too busy to listen.",
        "I did not want to pilot. I wanted to know why they kept coming back broken the same way.",
      ],
    },
    biography: "Engineer first, pilot second. Reads a machine's damage before the panel does.",
  },
  {
    id: "pilot.reyes",
    name: "Mateo Reyes",
    callsign: "Kingfisher",
    specialisms: ["piloting", "melee"],
    neuralStability: 0.74,
    skill: 0.86,
    sorties: 9,
    affinities: ["pilot.sato"],
    preferredRoles: ["skirmisher", "brawler"],
    tags: ["reckless", "competitive"],
    drawback: {
      id: "drawback.rides-the-line",
      displayName: "Rides the line",
      trigger: { kind: "partner-tag", tags: ["methodical", "empathic"] },
      stabilityCost: 0.14,
      effectivenessCost: 0.04,
      description:
        "The best hands in the bay and no patience for being told. Drifting with somebody careful " +
        "turns into an argument at neural speed.",
    },
    perk: {
      id: "perk.kingfisher",
      displayName: "Answer on the turn",
      description: "He does not block. He steps off the line and puts everything into the reply.",
      ranks: [
        { linkLevel: 2, effects: { mobility: 1.06 }, note: "Moves before the swing arrives." },
        { linkLevel: 4, effects: { mobility: 1.12, damage: 1.08 }, note: "Turns a miss into an opening." },
        {
          linkLevel: 6,
          effects: { mobility: 1.18, damage: 1.16, poise: 0.95 },
          note: "Never where it lands, and it costs him footing.",
        },
      ],
    },
    injuryResistance: 0.48,
    dialogue: {
      chattiness: 0.8,
      onDeploy: ["Finally. Try to keep up."],
      onDamage: ["Fine. Fine. That one was mine."],
      onVictory: ["Nine sorties. Nine. Somebody write that down."],
      offDuty: [
        "Everyone here flies like they are filling in a form.",
        "Sato is the only one who does not tell me to slow down. She just asks what I saw.",
      ],
    },
    biography: "The best hands in the bay and the worst temper. Everyone agrees on both.",
  },
  {
    id: "pilot.sato",
    name: "Rin Sato",
    callsign: "Quartz",
    specialisms: ["science", "gunnery"],
    neuralStability: 0.88,
    skill: 0.7,
    sorties: 11,
    affinities: ["pilot.reyes"],
    preferredRoles: ["marksman", "guardian"],
    tags: ["methodical", "empathic"],
    drawback: {
      id: "drawback.stops-to-look",
      displayName: "Stops to look",
      trigger: { kind: "long-travel", aboveSeconds: 5_400 },
      stabilityCost: 0.05,
      effectivenessCost: 0.11,
      description:
        "On a long approach she is already working, and arrives having thought about the specimen " +
        "rather than the fight.",
    },
    perk: {
      id: "perk.quartz",
      displayName: "Know what you are cutting",
      description: "She knows where the tissue gives, and the recovery teams get more back.",
      ranks: [
        { linkLevel: 2, effects: { samples: 1.25 }, note: "Takes the sample that is worth taking." },
        {
          linkLevel: 4,
          effects: { samples: 1.5, salvage: 1.2 },
          note: "Marks what the haulers should lift.",
        },
        {
          linkLevel: 6,
          effects: { samples: 1.9, salvage: 1.35, damage: 1.06 },
          note: "Puts rounds where the plate is thinnest.",
        },
      ],
    },
    injuryResistance: 0.6,
    dialogue: {
      chattiness: 0.5,
      onDeploy: ["Sensors are recording. Everything it does, we keep."],
      onDamage: ["Note the angle. It is favouring one side."],
      onVictory: ["Do not let the teams cut it up before I get there."],
      offDuty: [
        "They are not monsters. They are engineered, and somebody engineered them badly on purpose.",
        "Reyes flies like he already knows the answer. Sometimes he does.",
      ],
    },
    biography: "Xenobiologist who learned to pilot to get closer to the samples.",
  },
  {
    id: "pilot.ferrant",
    name: "Bo Ferrant",
    callsign: "Tallow",
    specialisms: ["command", "piloting"],
    neuralStability: 0.85,
    skill: 0.66,
    sorties: 22,
    affinities: [],
    preferredRoles: ["guardian", "siege"],
    tags: ["veteran", "stoic"],
    drawback: {
      id: "drawback.carries-them",
      displayName: "Carries them",
      trigger: { kind: "carrying-injury" },
      stabilityCost: 0.15,
      effectivenessCost: 0.05,
      description:
        "Twenty-two sorties and no partner left from any of them. Flying beside somebody already " +
        "hurt is the one thing that gets through.",
    },
    perk: {
      id: "perk.tallow",
      displayName: "Nobody else today",
      description: "He has done this before, and the machine and the city both come back in one piece.",
      ranks: [
        { linkLevel: 2, effects: { structure: 1.06 }, note: "Puts the machine between it and the block." },
        { linkLevel: 4, effects: { structure: 1.12, recovery: 0.9 }, note: "Knows what the bay can fix." },
        {
          linkLevel: 6,
          effects: { structure: 1.18, recovery: 0.82, heat: 1.08 },
          note: "Paces a fight nobody else could finish.",
        },
      ],
    },
    injuryResistance: 0.8,
    dialogue: {
      chattiness: 0.25,
      onDeploy: ["Understood. Taking her out."],
      onDamage: ["Noted."],
      onVictory: ["Everyone comes back. That is the whole job."],
      offDuty: [
        "You will want to know how the others died. I would rather talk about the machine.",
        "Twenty-two. I know exactly what that number is worth, and it is not experience.",
      ],
    },
    biography: "Twenty-two sorties and no partner left from any of them.",
  },
];

export function validatePilot(entry: PilotDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("pilot.")) errors.push('id must start with "pilot."');
  if (!entry.name) errors.push("name required");
  if (!entry.callsign) errors.push("callsign required");
  if (!entry.biography) errors.push("biography required");
  if (entry.specialisms.length === 0) errors.push("a pilot must be good at something");
  for (const specialism of entry.specialisms) {
    if (!PILOT_SPECIALISMS.includes(specialism)) errors.push(`unknown specialism "${specialism}"`);
  }
  for (const key of ["neuralStability", "skill"] as const) {
    const value = entry[key];
    if (!Number.isFinite(value) || value <= 0 || value > 1) errors.push(`${key} must be within (0, 1]`);
  }
  if (!Number.isInteger(entry.sorties) || entry.sorties < 0) {
    errors.push("sorties must be a non-negative integer");
  }
  if (entry.affinities.includes(entry.id)) errors.push("a pilot cannot be their own drift partner");

  if (entry.tags.length === 0) errors.push("a pilot needs at least one tag, or nobody can read them");
  for (const tag of entry.tags) {
    if (!COMPATIBILITY_TAGS.includes(tag)) errors.push(`unknown tag "${tag}"`);
  }
  if (entry.preferredRoles.length === 0) errors.push("a pilot has to be at home in something");
  if (!Number.isFinite(entry.injuryResistance) || entry.injuryResistance <= 0 || entry.injuryResistance > 1) {
    errors.push("injuryResistance must be within (0, 1]");
  }

  // A drawback that costs nothing is decoration, and one that costs everything
  // is a pilot nobody would fly. Both are refused here rather than discovered.
  const drawback = entry.drawback;
  if (!drawback || !drawback.id.startsWith("drawback.")) {
    errors.push('every pilot needs a drawback, with an id starting "drawback."');
  } else {
    const cost = drawback.stabilityCost + drawback.effectivenessCost;
    if (cost <= 0) errors.push("a drawback that costs nothing is not a drawback");
    if (drawback.stabilityCost > 0.4 || drawback.effectivenessCost > 0.4) {
      errors.push("a drawback that large would make the pilot unusable rather than difficult");
    }
    if (drawback.description.trim().length < 20) {
      errors.push("a drawback must be described, because it is shown before deployment");
    }
    if (!DRAWBACK_EVALUATORS[drawback.trigger.kind]) {
      errors.push(`no evaluator for drawback trigger "${drawback.trigger.kind}"`);
    }
  }

  const perk = entry.perk;
  if (!perk || !perk.id.startsWith("perk.")) errors.push('every pilot needs a perk, id starting "perk."');
  else {
    if (perk.ranks.length === 0) errors.push("a perk with no ranks never arrives");
    let previousLevel = 0;
    for (const rank of perk.ranks) {
      if (!Number.isInteger(rank.linkLevel) || rank.linkLevel <= previousLevel) {
        errors.push("perk ranks must arrive at ascending link levels");
      }
      previousLevel = rank.linkLevel;
      if (Object.keys(rank.effects).length === 0) errors.push("a perk rank must do something");
      for (const [effect, value] of Object.entries(rank.effects)) {
        if (!PERK_EFFECTS.includes(effect as PerkEffect)) errors.push(`unknown perk effect "${effect}"`);
        if (!Number.isFinite(value) || value <= 0) errors.push("perk effects must be positive multipliers");
      }
      if (rank.note.trim().length < 10) errors.push("say what the rank changed about the person");
    }
  }

  const dialogue = entry.dialogue;
  if (!dialogue) errors.push("a pilot needs a dialogue profile");
  else {
    if (!Number.isFinite(dialogue.chattiness) || dialogue.chattiness < 0 || dialogue.chattiness > 1) {
      errors.push("chattiness must be within [0, 1]");
    }
    for (const key of ["onDeploy", "onDamage", "onVictory", "offDuty"] as const) {
      if (dialogue[key].length === 0) errors.push(`${key} needs at least one line`);
    }
  }
  return errors;
}

/**
 * One evaluator per trigger kind.
 *
 * A table rather than a switch, so adding a trigger is a row here and a variant
 * on the union. Every evaluator answers the same question: given what we know
 * before launch, is this drawback biting today.
 */
const DRAWBACK_EVALUATORS: Readonly<
  Record<DrawbackTrigger["kind"], (trigger: DrawbackTrigger, context: DriftContext) => boolean>
> = {
  "machine-role": (trigger, context) =>
    trigger.kind === "machine-role" && context.machineRole !== undefined
      ? trigger.roles.includes(context.machineRole)
      : false,
  "machine-damaged": (trigger, context) =>
    trigger.kind === "machine-damaged" && context.machineIntegrity !== undefined
      ? context.machineIntegrity < trigger.belowIntegrity
      : false,
  night: (_trigger, context) => context.night === true,
  "rough-weather": (trigger, context) =>
    trigger.kind === "rough-weather" && context.weatherPenalty !== undefined
      ? context.weatherPenalty > trigger.abovePenalty
      : false,
  "long-travel": (trigger, context) =>
    trigger.kind === "long-travel" && context.travelSeconds !== undefined
      ? context.travelSeconds > trigger.aboveSeconds
      : false,
  "partner-tag": (trigger, context) =>
    trigger.kind === "partner-tag" ? trigger.tags.some((tag) => context.partnerTags?.includes(tag)) : false,
  "carrying-injury": (_trigger, context) => context.partnerInjured === true || context.selfInjured === true,
};

/**
 * Everything outside the two people that changes how they drift.
 *
 * All optional: a caller that knows nothing about the machine or the weather
 * still gets an answer, and the drawbacks that depend on what it did not say
 * simply do not fire.
 */
export interface DriftContext {
  /** Role of the chassis they are flying, from the chassis table. */
  readonly machineRole?: string;
  /** 0 to 1 of the machine's structure left. */
  readonly machineIntegrity?: number;
  readonly night?: boolean;
  /** 0 to 1, as the environment reports it. */
  readonly weatherPenalty?: number;
  readonly travelSeconds?: number;
  /** Link level between these two, from the crew record. */
  readonly linkLevel?: number;
  /** 0 to 1 of recent stress, per pilot. */
  readonly firstStress?: number;
  readonly secondStress?: number;
  /** Stability drag from injuries each of them is carrying, 0 to 1. */
  readonly firstInjuryPenalty?: number;
  readonly secondInjuryPenalty?: number;
  readonly firstInjured?: boolean;
  readonly secondInjured?: boolean;
  /** Filled in per pilot while evaluating their own drawback. */
  readonly partnerTags?: readonly CompatibilityTag[];
  readonly partnerInjured?: boolean;
  readonly selfInjured?: boolean;
}

/** A drawback and whether it is biting right now. */
export interface DrawbackReport {
  readonly pilotId: string;
  readonly pilotName: string;
  readonly drawback: PilotDrawback;
  readonly firing: boolean;
  /** Why it is or is not firing, in a sentence the planner can show. */
  readonly reason: string;
}

export function createPilotRegistry(): ContentRegistry<PilotDefinition> {
  const registry = new ContentRegistry<PilotDefinition>(validatePilot);
  for (const pilot of PILOTS) registry.register(pilot);
  // An affinity has to name somebody real, and has to be returned.
  for (const pilot of PILOTS) {
    for (const partner of pilot.affinities) {
      const other = registry.get(partner);
      if (!other) throw new Error(`Pilot "${pilot.id}" names "${partner}", who is not registered`);
      if (!other.affinities.includes(pilot.id)) {
        throw new Error(`Drift affinity between "${pilot.id}" and "${partner}" is not returned`);
      }
    }
  }
  return registry;
}

export const PILOT_DEFINITIONS = PILOTS;

/** What a pair is worth in the drift, and why. */
export interface DriftAssessment {
  /** 0 to 1. How strong the link between these two is. */
  readonly strength: number;
  /** 0 to 1. Combined effectiveness the machine actually gets. */
  readonly effectiveness: number;
  /** Plain language, for the planner. */
  readonly summary: string;
  /** True when this pair should not be sent out at all. */
  readonly refused: boolean;
  /** Every drawback either of them carries, and whether it is biting today. */
  readonly drawbacks: readonly DrawbackReport[];
  /** Each term that moved the number, so the planner can show its working. */
  readonly factors: readonly { readonly label: string; readonly delta: number }[];
}

/**
 * What each term is worth to a drift.
 *
 * Sized so that the best pair in the game, at the top of their link, in the
 * machine they are made for, lands near but under one. The first version of
 * this table let two different pairs both reach exactly one, which made the
 * number useless: a figure that saturates cannot tell two crews apart, and
 * telling two crews apart is the entire point of the system.
 */
export const STABILITY_WEIGHT = 0.7;
export const AFFINITY_BONUS = 0.1;
export const SHARED_TAG_BONUS = 0.025;
export const TAG_FRICTION_COST = 0.05;
export const ROLE_AT_HOME_BONUS = 0.03;
/** How much one link level is worth to the strength of a drift. */
export const LINK_LEVEL_VALUE = 0.024;
/** The most a link can add on its own, however long a pair have flown together. */
export const MAX_LINK_BONUS = 0.18;
/** Below this the pair cannot be sent out at all. */
export const DRIFT_REFUSAL_THRESHOLD = 0.25;

/**
 * How well two people drift, in the situation they are actually in.
 *
 * Stability holds the link, skill decides what they do with it, and a pair who
 * have flown together hold it better than two strangers who are individually
 * better. On top of that: what the machine asks of them, how long the link has
 * been built, what they are carrying, and how recently they were last hurt.
 *
 * Context is entirely optional. Called with two pilots and nothing else, this
 * answers exactly what it answered before any of that existed, which is why the
 * planner and every earlier test still work unchanged.
 *
 * A pilot cannot drift with themselves, which is the one hard refusal.
 */
export function assessDrift(
  first: PilotDefinition | undefined,
  second: PilotDefinition | undefined,
  context: DriftContext = {},
): DriftAssessment {
  if (!first || !second) {
    return {
      strength: 0,
      effectiveness: 0,
      summary: "A Jaeger needs two pilots.",
      refused: true,
      drawbacks: [],
      factors: [],
    };
  }
  if (first.id === second.id) {
    return {
      strength: 0,
      effectiveness: 0,
      summary: "Nobody drifts with themselves.",
      refused: true,
      drawbacks: [],
      factors: [],
    };
  }

  const factors: { label: string; delta: number }[] = [];
  const stability = ((first.neuralStability + second.neuralStability) / 2) * STABILITY_WEIGHT;
  factors.push({ label: "neural stability", delta: stability });

  const affinity = first.affinities.includes(second.id) ? AFFINITY_BONUS : 0;
  if (affinity > 0) factors.push({ label: "they have drifted before", delta: affinity });

  // A wide gap in stability is its own problem: the steadier one carries the
  // drift and both of them feel it.
  const mismatch = Math.abs(first.neuralStability - second.neuralStability) * 0.5;
  if (mismatch > 0) factors.push({ label: "uneven stability", delta: -mismatch });

  // Shared tags read each other quickly; some pairs of tags grate.
  const sharedTags = first.tags.filter((tag) => second.tags.includes(tag));
  const tagBonus = sharedTags.length * SHARED_TAG_BONUS;
  if (tagBonus > 0) factors.push({ label: `both ${sharedTags.join(" and ")}`, delta: tagBonus });
  const friction = TAG_FRICTION.filter(
    ([left, right]) =>
      (first.tags.includes(left) && second.tags.includes(right)) ||
      (first.tags.includes(right) && second.tags.includes(left)),
  );
  const frictionCost = friction.length * TAG_FRICTION_COST;
  if (frictionCost > 0) {
    factors.push({
      label: friction.map(([left, right]) => `${left} against ${right}`).join(", "),
      delta: -frictionCost,
    });
  }

  // Time in the harness together. Capped, so a long link is worth a lot and an
  // endless one is not worth everything.
  const linkBonus = Math.min(MAX_LINK_BONUS, Math.max(0, context.linkLevel ?? 0) * LINK_LEVEL_VALUE);
  if (linkBonus > 0) factors.push({ label: `link level ${context.linkLevel}`, delta: linkBonus });

  // Recent stress and carried injuries both drag on holding a drift.
  const stress = ((context.firstStress ?? 0) + (context.secondStress ?? 0)) / 2;
  const stressCost = stress * 0.2;
  if (stressCost > 0) factors.push({ label: "recent stress", delta: -stressCost });
  const injuryCost = (context.firstInjuryPenalty ?? 0) + (context.secondInjuryPenalty ?? 0);
  if (injuryCost > 0) factors.push({ label: "injuries carried", delta: -injuryCost });

  // What the machine asks for. A pilot at home in the role holds it better.
  const atHome = [first, second].filter((pilot) =>
    context.machineRole ? pilot.preferredRoles.includes(context.machineRole) : false,
  ).length;
  const roleBonus = atHome * ROLE_AT_HOME_BONUS;
  if (roleBonus > 0) {
    factors.push({ label: `at home in a ${context.machineRole}`, delta: roleBonus });
  }

  // Drawbacks last, so they are applied to a number that already accounts for
  // everything else, and reported whether or not they fire.
  const drawbacks = [
    describeDrawback(first, second, context, context.firstInjured, context.secondInjured),
    describeDrawback(second, first, context, context.secondInjured, context.firstInjured),
  ];
  let drawbackStability = 0;
  let drawbackEffectiveness = 0;
  for (const report of drawbacks) {
    if (!report.firing) continue;
    drawbackStability += report.drawback.stabilityCost;
    drawbackEffectiveness += report.drawback.effectivenessCost;
    factors.push({ label: report.drawback.displayName, delta: -report.drawback.stabilityCost });
  }

  const strength = clamp01(
    stability +
      affinity -
      mismatch +
      tagBonus -
      frictionCost +
      linkBonus -
      stressCost -
      injuryCost +
      roleBonus -
      drawbackStability,
  );
  const skill = (first.skill + second.skill) / 2;
  const effectiveness = clamp01(skill * (0.6 + strength * 0.5) - drawbackEffectiveness);

  const notes: string[] = [];
  if (affinity > 0) notes.push("they have drifted before");
  if (linkBonus > 0) notes.push(`link level ${context.linkLevel}`);
  if (mismatch > 0.05) notes.push("their stability is unevenly matched");
  if (frictionCost > 0) notes.push("they grate on each other");
  if (stressCost > 0.02) notes.push("both are carrying recent stress");
  if (injuryCost > 0) notes.push("somebody is flying hurt");
  const firingCount = drawbacks.filter((report) => report.firing).length;
  if (firingCount > 0) notes.push(`${firingCount} drawback${firingCount === 1 ? "" : "s"} in play`);
  const shared = first.specialisms.filter((entry) => second.specialisms.includes(entry));
  if (shared.length > 0) notes.push(`both lean ${shared.join(" and ")}`);
  else notes.push("their strengths do not overlap, which is usually good");

  return {
    strength,
    effectiveness,
    summary: `${Math.round(strength * 100)} percent link: ${notes.join(", ")}.`,
    refused: strength < DRIFT_REFUSAL_THRESHOLD,
    drawbacks,
    factors,
  };
}

/**
 * Whether one pilot's drawback is biting, and why.
 *
 * Always returned, firing or not, because the planner has to show what a pilot
 * is difficult about before the player commits rather than after.
 */
function describeDrawback(
  pilot: PilotDefinition,
  partner: PilotDefinition,
  context: DriftContext,
  selfInjured: boolean | undefined,
  partnerInjured: boolean | undefined,
): DrawbackReport {
  const evaluate = DRAWBACK_EVALUATORS[pilot.drawback.trigger.kind];
  const firing = evaluate
    ? evaluate(pilot.drawback.trigger, {
        ...context,
        partnerTags: partner.tags,
        selfInjured,
        partnerInjured,
      })
    : false;
  return {
    pilotId: pilot.id,
    pilotName: pilot.name,
    drawback: pilot.drawback,
    firing,
    reason: firing
      ? `${pilot.callsign}: ${pilot.drawback.displayName} applies to this sortie.`
      : `${pilot.callsign}: ${pilot.drawback.displayName} does not apply here.`,
  };
}

/**
 * What a pair's perks are worth at the link level they have reached.
 *
 * Multiplies the two pilots' perk effects together, so a pair is the sum of who
 * they are rather than the better of them. The vocabulary is fixed, so anything
 * returned here has somewhere in the game that already reads it.
 */
export function perkEffects(
  first: PilotDefinition | undefined,
  second: PilotDefinition | undefined,
  linkLevel: number,
): Partial<Record<PerkEffect, number>> {
  const total: Partial<Record<PerkEffect, number>> = {};
  for (const pilot of [first, second]) {
    if (!pilot) continue;
    // The highest rank whose link level has been reached, and only that one:
    // ranks replace each other rather than stacking.
    const rank = [...pilot.perk.ranks]
      .filter((entry) => linkLevel >= entry.linkLevel)
      .sort((a, b) => b.linkLevel - a.linkLevel)[0];
    if (!rank) continue;
    for (const [effect, value] of Object.entries(rank.effects)) {
      const key = effect as PerkEffect;
      total[key] = (total[key] ?? 1) * value;
    }
  }
  return total;
}

/** The perk rank a pilot is currently on, or null before the first one. */
export function currentPerkRank(pilot: PilotDefinition, linkLevel: number): PerkRank | null {
  return (
    [...pilot.perk.ranks]
      .filter((entry) => linkLevel >= entry.linkLevel)
      .sort((a, b) => b.linkLevel - a.linkLevel)[0] ?? null
  );
}

/** Everything a pair is collectively good at. */
export function combinedSpecialisms(
  first: PilotDefinition,
  second: PilotDefinition,
): readonly PilotSpecialism[] {
  return [...new Set([...first.specialisms, ...second.specialisms])];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
