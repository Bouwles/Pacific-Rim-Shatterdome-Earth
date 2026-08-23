import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * The move table.
 *
 * Every attack in the game is a row here: how long each phase lasts, how the
 * body moves and turns through it, what it can be cancelled into and when, which
 * volumes are live on which ticks, what a connecting hit actually does, and what
 * it costs. Nothing about an attack lives in an animation string, and nothing
 * about it is decided by code that knows a move by name.
 *
 * Timings are in ticks. One tick is one sixtieth of a second of combat time,
 * which is the rate the combat resolver runs at, so a 12 tick startup is 200 ms.
 */

/** Combat runs on its own fixed tick, independent of the render rate. */
export const COMBAT_TICK_SECONDS = 1 / 60;

export const MOVE_KINDS = [
  "light",
  "heavy",
  "launcher",
  "guard-break",
  "grapple",
  "finisher",
  "ranged",
] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

/**
 * What a move can be cancelled into, by tag rather than by id, so adding a move
 * does not mean editing every other move's cancel list.
 */
export const CANCEL_TAGS = ["light", "heavy", "launcher", "guard", "evade", "finisher", "grapple"] as const;
export type CancelTag = (typeof CANCEL_TAGS)[number];

/** How much a move can be interrupted while it runs. */
export const ARMOR_LEVELS = ["none", "light", "super"] as const;
export type ArmorLevel = (typeof ARMOR_LEVELS)[number];

export const DAMAGE_KINDS = ["impact", "crush", "energy", "plasma"] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

/** What a clean hit does to whoever took it. Reused by every attacker. */
export interface DamagePacket {
  readonly amount: number;
  readonly kind: DamageKind;
  /** Pressure against the target's poise. Enough of it staggers them. */
  readonly poise: number;
  /** Damage done to a raised guard. Enough of it breaks the guard. */
  readonly guardDamage: number;
  /** Metres per second imparted to the target on a clean hit. */
  readonly knockbackMps: number;
  /** 0 to 1 of extra shock dealt to the component zone that was struck. */
  readonly componentShock: number;
  /** Reaction a clean, unguarded hit produces. */
  readonly reaction: "none" | "flinch" | "stagger" | "launch" | "knockdown";
}

/**
 * A swept volume, described in the attacker's own frame.
 *
 * The volume is a capsule that travels from `fromForward` to `toForward` over
 * its active ticks, and hit detection sweeps it rather than sampling it, so a
 * fast limb cannot pass through a target between two ticks.
 */
export interface HitVolumeSpec {
  readonly id: string;
  /** Height up the attacker's body the volume sits at, as a fraction of height. */
  readonly heightFraction: number;
  /** Metres in front of the attacker at the start and end of the sweep. */
  readonly fromForwardMeters: number;
  readonly toForwardMeters: number;
  /** Metres to the side. Positive is the attacker's right. */
  readonly lateralMeters: number;
  readonly radiusMeters: number;
  /** Ticks from the start of the active phase this volume is live. */
  readonly activeFromTick: number;
  readonly activeToTick: number;
}

/** Where a move takes the body, as a simple curve rather than root motion baked into a clip. */
export interface MovementCurve {
  /** Metres per second forward, applied between these ticks of the move. */
  readonly forwardMps: number;
  readonly fromTick: number;
  readonly toTick: number;
}

/** Audiovisual cues, named rather than embedded. Presentation resolves them. */
export interface MoveCues {
  readonly windUp: string;
  readonly impact: string;
  readonly whiff: string;
}

export interface MoveDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly kind: MoveKind;
  readonly startupTicks: number;
  readonly activeTicks: number;
  readonly recoveryTicks: number;
  /** How much of the machine's turn rate survives while this move runs, 0 to 1. */
  readonly turnAuthority: number;
  readonly movement: MovementCurve;
  readonly armor: ArmorLevel;
  /** Tags this move may be cancelled into, and the window it may happen in. */
  readonly cancelInto: readonly CancelTag[];
  readonly cancelFromTick: number;
  readonly cancelToTick: number;
  /**
   * True when the cancel window only opens if the move connected. A whiffed
   * heavy that could still be cancelled would remove every reason to respect it.
   */
  readonly cancelRequiresHit: boolean;
  readonly volumes: readonly HitVolumeSpec[];
  readonly damage: DamagePacket;
  readonly staminaCost: number;
  readonly heatCost: number;
  /** Tag this move answers to when something else cancels into it. */
  readonly tag: CancelTag;
  readonly cues: MoveCues;
  readonly description: string;
}

const MOVES: readonly MoveDefinition[] = [
  {
    id: "melee.light.jab",
    displayName: "Left jab",
    kind: "light",
    startupTicks: 7,
    activeTicks: 4,
    recoveryTicks: 12,
    turnAuthority: 0.55,
    movement: { forwardMps: 3.5, fromTick: 4, toTick: 11 },
    armor: "none",
    cancelInto: ["light", "heavy", "guard", "evade"],
    cancelFromTick: 8,
    cancelToTick: 20,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "fist.L",
        heightFraction: 0.72,
        fromForwardMeters: 8,
        toForwardMeters: 26,
        lateralMeters: -6,
        radiusMeters: 5.5,
        activeFromTick: 0,
        activeToTick: 4,
      },
    ],
    damage: {
      amount: 90,
      kind: "impact",
      poise: 18,
      guardDamage: 14,
      knockbackMps: 3,
      componentShock: 0.05,
      reaction: "flinch",
    },
    staminaCost: 6,
    heatCost: 3,
    tag: "light",
    cues: { windUp: "servo.light", impact: "impact.light", whiff: "whiff.light" },
    description: "Fast, cheap, and cancels into almost anything. The move that opens a guard.",
  },
  {
    id: "melee.light.cross",
    displayName: "Right cross",
    kind: "light",
    startupTicks: 9,
    activeTicks: 5,
    recoveryTicks: 15,
    turnAuthority: 0.5,
    movement: { forwardMps: 4.5, fromTick: 5, toTick: 13 },
    armor: "none",
    cancelInto: ["heavy", "launcher", "guard", "evade"],
    cancelFromTick: 10,
    cancelToTick: 24,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "fist.R",
        heightFraction: 0.74,
        fromForwardMeters: 9,
        toForwardMeters: 30,
        lateralMeters: 6,
        radiusMeters: 6,
        activeFromTick: 0,
        activeToTick: 5,
      },
    ],
    damage: {
      amount: 140,
      kind: "impact",
      poise: 26,
      guardDamage: 20,
      knockbackMps: 5,
      componentShock: 0.08,
      reaction: "flinch",
    },
    staminaCost: 9,
    heatCost: 5,
    tag: "light",
    cues: { windUp: "servo.light", impact: "impact.light", whiff: "whiff.light" },
    description: "The second half of a jab. Only cancels onward if it actually landed.",
  },
  {
    id: "melee.heavy.overhead",
    displayName: "Overhead hammer",
    kind: "heavy",
    startupTicks: 24,
    activeTicks: 6,
    recoveryTicks: 34,
    turnAuthority: 0.2,
    movement: { forwardMps: 6, fromTick: 18, toTick: 30 },
    armor: "light",
    cancelInto: ["finisher"],
    cancelFromTick: 30,
    cancelToTick: 46,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "fist.both",
        heightFraction: 0.85,
        fromForwardMeters: 12,
        toForwardMeters: 34,
        lateralMeters: 0,
        radiusMeters: 8,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 420,
      kind: "crush",
      poise: 85,
      guardDamage: 70,
      knockbackMps: 14,
      componentShock: 0.3,
      reaction: "stagger",
    },
    staminaCost: 26,
    heatCost: 18,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    description: "Slow, expensive and worth respecting. Light armour, so it trades rather than loses.",
  },
  {
    id: "melee.launcher.uppercut",
    displayName: "Rising uppercut",
    kind: "launcher",
    startupTicks: 18,
    activeTicks: 5,
    recoveryTicks: 30,
    turnAuthority: 0.25,
    movement: { forwardMps: 5, fromTick: 12, toTick: 23 },
    armor: "none",
    cancelInto: ["heavy", "finisher"],
    cancelFromTick: 24,
    cancelToTick: 40,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "fist.rising",
        heightFraction: 0.6,
        fromForwardMeters: 10,
        toForwardMeters: 24,
        lateralMeters: 3,
        radiusMeters: 7,
        activeFromTick: 0,
        activeToTick: 5,
      },
    ],
    damage: {
      amount: 260,
      kind: "impact",
      poise: 70,
      guardDamage: 30,
      knockbackMps: 9,
      componentShock: 0.18,
      reaction: "launch",
    },
    staminaCost: 20,
    heatCost: 14,
    tag: "launcher",
    cues: { windUp: "servo.heavy", impact: "impact.launch", whiff: "whiff.heavy" },
    description: "Lifts what it hits. The opening of anything that follows a kaiju off its feet.",
  },
  {
    id: "melee.guard-break.shoulder",
    displayName: "Shoulder charge",
    kind: "guard-break",
    startupTicks: 20,
    activeTicks: 8,
    recoveryTicks: 26,
    turnAuthority: 0.15,
    movement: { forwardMps: 11, fromTick: 14, toTick: 28 },
    armor: "super",
    cancelInto: ["light", "heavy"],
    cancelFromTick: 28,
    cancelToTick: 44,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "shoulder",
        heightFraction: 0.68,
        fromForwardMeters: 6,
        toForwardMeters: 22,
        lateralMeters: 0,
        radiusMeters: 9,
        activeFromTick: 0,
        activeToTick: 8,
      },
    ],
    damage: {
      amount: 180,
      kind: "crush",
      poise: 55,
      guardDamage: 200,
      knockbackMps: 11,
      componentShock: 0.12,
      reaction: "stagger",
    },
    staminaCost: 24,
    heatCost: 16,
    tag: "heavy",
    cues: { windUp: "servo.charge", impact: "impact.guardbreak", whiff: "whiff.heavy" },
    description: "Goes through a guard rather than around it, and cannot be interrupted while it runs.",
  },
  {
    id: "melee.finisher.plasma-drop",
    displayName: "Plasma drop",
    kind: "finisher",
    startupTicks: 30,
    activeTicks: 8,
    recoveryTicks: 46,
    turnAuthority: 0.1,
    movement: { forwardMps: 4, fromTick: 24, toTick: 36 },
    armor: "super",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "plasma",
        heightFraction: 0.55,
        fromForwardMeters: 8,
        toForwardMeters: 28,
        lateralMeters: 0,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 8,
      },
    ],
    damage: {
      amount: 900,
      kind: "plasma",
      poise: 140,
      guardDamage: 160,
      knockbackMps: 18,
      componentShock: 0.6,
      reaction: "knockdown",
    },
    staminaCost: 45,
    heatCost: 55,
    tag: "finisher",
    cues: { windUp: "reactor.charge", impact: "impact.plasma", whiff: "whiff.plasma" },
    description:
      "Only legal against a target that is already finished. Ends fights, and costs a fight's worth of heat.",
  },
  {
    id: "kaiju.claw.swipe",
    displayName: "Claw swipe",
    kind: "heavy",
    startupTicks: 26,
    activeTicks: 7,
    recoveryTicks: 30,
    turnAuthority: 0.3,
    movement: { forwardMps: 7, fromTick: 20, toTick: 32 },
    armor: "light",
    cancelInto: ["heavy"],
    cancelFromTick: 33,
    cancelToTick: 50,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "claw",
        heightFraction: 0.62,
        fromForwardMeters: 10,
        toForwardMeters: 34,
        lateralMeters: -8,
        radiusMeters: 9,
        activeFromTick: 0,
        activeToTick: 7,
      },
    ],
    damage: {
      amount: 320,
      kind: "impact",
      poise: 60,
      guardDamage: 55,
      knockbackMps: 10,
      componentShock: 0.2,
      reaction: "stagger",
    },
    staminaCost: 18,
    heatCost: 0,
    tag: "heavy",
    cues: { windUp: "kaiju.roar", impact: "impact.claw", whiff: "whiff.claw" },
    description: "A wide swing that reaches across the front. The attack a kaiju opens with.",
  },
  {
    id: "kaiju.tail.sweep",
    displayName: "Tail sweep",
    kind: "launcher",
    startupTicks: 22,
    activeTicks: 9,
    recoveryTicks: 36,
    turnAuthority: 0.15,
    movement: { forwardMps: 0, fromTick: 0, toTick: 0 },
    armor: "super",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "tail",
        heightFraction: 0.28,
        fromForwardMeters: 6,
        toForwardMeters: 30,
        lateralMeters: 10,
        radiusMeters: 8,
        activeFromTick: 0,
        activeToTick: 9,
      },
    ],
    damage: {
      amount: 240,
      kind: "crush",
      poise: 95,
      guardDamage: 45,
      knockbackMps: 16,
      componentShock: 0.15,
      reaction: "knockdown",
    },
    staminaCost: 22,
    heatCost: 0,
    tag: "launcher",
    cues: { windUp: "kaiju.tail", impact: "impact.tail", whiff: "whiff.tail" },
    description: "Low and wide, and it takes the legs out. Nothing interrupts it once it starts.",
  },
];

export function validateMove(entry: MoveDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.includes(".")) errors.push("id should be namespaced, e.g. melee.light.jab");
  if (!entry.displayName) errors.push("displayName required");
  if (!MOVE_KINDS.includes(entry.kind)) errors.push(`unknown kind "${entry.kind}"`);
  if (!CANCEL_TAGS.includes(entry.tag)) errors.push(`unknown tag "${entry.tag}"`);
  if (!ARMOR_LEVELS.includes(entry.armor)) errors.push(`unknown armor level "${entry.armor}"`);

  for (const key of ["startupTicks", "activeTicks", "recoveryTicks"] as const) {
    const value = entry[key];
    if (!Number.isInteger(value) || value < 1) errors.push(`${key} must be a positive whole number of ticks`);
  }
  if (entry.turnAuthority < 0 || entry.turnAuthority > 1) errors.push("turnAuthority must be within 0 and 1");

  const total = entry.startupTicks + entry.activeTicks + entry.recoveryTicks;
  if (entry.cancelInto.length > 0) {
    if (entry.cancelToTick <= entry.cancelFromTick) {
      errors.push("a move with cancels needs a window with some width to it");
    }
    // A cancel window that opens before the move can connect would let a player
    // skip the commitment the startup is there to impose.
    if (entry.cancelFromTick < entry.startupTicks) {
      errors.push("cancel window must not open before the active frames start");
    }
    if (entry.cancelToTick > total) errors.push("cancel window must end inside the move");
  }
  for (const tag of entry.cancelInto) {
    if (!CANCEL_TAGS.includes(tag)) errors.push(`unknown cancel tag "${tag}"`);
  }

  if (entry.volumes.length === 0) errors.push("an attack with no hit volume can never connect");
  for (const volume of entry.volumes) {
    if (!volume.id) errors.push("every hit volume needs an id, so a hit can say which one connected");
    if (volume.radiusMeters <= 0) errors.push(`volume "${volume.id}" needs a positive radius`);
    if (volume.activeToTick <= volume.activeFromTick) {
      errors.push(`volume "${volume.id}" is never live`);
    }
    if (volume.activeToTick > entry.activeTicks) {
      errors.push(`volume "${volume.id}" stays live past the move's active frames`);
    }
    if (volume.heightFraction < 0 || volume.heightFraction > 1.2) {
      errors.push(`volume "${volume.id}" sits outside the attacker's own body`);
    }
  }

  const damage = entry.damage;
  if (!DAMAGE_KINDS.includes(damage.kind)) errors.push(`unknown damage kind "${damage.kind}"`);
  for (const key of ["amount", "poise", "guardDamage", "knockbackMps", "componentShock"] as const) {
    if (!Number.isFinite(damage[key]) || damage[key] < 0) errors.push(`damage.${key} must be zero or more`);
  }
  if (damage.componentShock > 1) errors.push("damage.componentShock is a fraction, so it cannot exceed 1");
  if (damage.amount <= 0) errors.push("an attack that does no damage is not an attack");

  for (const key of ["staminaCost", "heatCost"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] < 0) errors.push(`${key} must be zero or more`);
  }
  if (!entry.cues.windUp || !entry.cues.impact || !entry.cues.whiff) {
    errors.push("every move needs wind-up, impact and whiff cues so presentation has something to resolve");
  }
  if (!entry.description) errors.push("description required");
  return errors;
}

export function createMoveRegistry(): ContentRegistry<MoveDefinition> {
  const registry = new ContentRegistry<MoveDefinition>(validateMove);
  for (const move of MOVES) registry.register(move);
  return registry;
}

export const MOVE_DEFINITIONS = MOVES;

/** Total length of a move in ticks. */
export function moveLengthTicks(move: MoveDefinition): number {
  return move.startupTicks + move.activeTicks + move.recoveryTicks;
}

/** Which phase a move is in at a given tick from its start. */
export function phaseAt(move: MoveDefinition, tick: number): "startup" | "active" | "recovery" | "done" {
  if (tick < move.startupTicks) return "startup";
  if (tick < move.startupTicks + move.activeTicks) return "active";
  if (tick < moveLengthTicks(move)) return "recovery";
  return "done";
}
