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

/**
 * What a hit is made of.
 *
 * Armour answers different kinds differently, which is the whole reason the list
 * is longer than "damage". Shear and pierce arrived with ranged weapons; heat,
 * corrosive, electrical, radiation and neural shock are here because component
 * damage reads them, and adding them one milestone at a time would have meant
 * two migrations instead of none.
 */
export const DAMAGE_KINDS = [
  "impact",
  "crush",
  "shear",
  "pierce",
  "heat",
  "energy",
  "plasma",
  "corrosive",
  "electrical",
  "radiation",
  "neural",
] as const;
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

/**
 * Which way the stick was pushed when the move came out.
 *
 * A directional variant is the same button with a different answer, which is
 * how a move list stays short while the moveset stays deep.
 */
export const MOVE_DIRECTIONS = ["neutral", "forward", "back", "side"] as const;
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/** What a defensive move does. Present only on defensive rows. */
export interface DefenseSpec {
  readonly kind: "dodge" | "block" | "parry";
  /** Ticks of invulnerability, for a dodge. */
  readonly invulnerableFromTick: number;
  readonly invulnerableToTick: number;
  /**
   * Ticks from the start of the move in which a block counts as perfect: no
   * guard damage, no chip, and the attacker is left open.
   */
  readonly perfectFromTick: number;
  readonly perfectToTick: number;
  /** Move that comes out free when a parry connects, or null for a plain block. */
  readonly counterMoveId: string | null;
  /** Metres the dodge carries, in the direction the move is tagged with. */
  readonly travelMeters: number;
}

/** What a grapple initiator asks for. Present only on grapple rows. */
export interface GrappleSpec {
  /** Metres the target must be inside to be seized at all. */
  readonly reachMeters: number;
  /** Ticks the hold lasts before it must be resolved or released. */
  readonly holdTicks: number;
  /** How hard the victim has to work to break out, against their own poise. */
  readonly escapeDifficulty: number;
  /** Clear ground the throw needs, or it fails safely instead of throwing into a wall. */
  readonly clearanceMeters: number;
  /** Metres a throw carries the victim. */
  readonly throwDistanceMeters: number;
}

/** What a cinematic finisher runs. Present only on finisher rows. */
export interface FinisherSpec {
  /**
   * Beats of the sequence: each is a camera framing, a length, and whether the
   * player has to do anything to keep it going.
   */
  readonly beats: readonly {
    readonly id: string;
    readonly durationTicks: number;
    /** Camera framing this beat asks for. Presentation reads it; rules do not. */
    readonly camera: "close" | "wide" | "low" | "orbit";
    /** True when the player must be holding the input through this beat. */
    readonly requiresHold: boolean;
  }[];
  /** Damage guaranteed on completion, whatever else happens. */
  readonly guaranteedDamage: number;
  /** True when anything hitting the attacker mid-sequence stops it. */
  readonly interruptible: boolean;
  /** Clear ground both actors need before it may start. */
  readonly clearanceMeters: number;
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
  /**
   * Direction this variant answers to. Defaults to neutral, so every move
   * written before directional variants existed still reads correctly.
   */
  readonly direction?: MoveDirection;
  /** Ticks of holding that fully charge the move. Zero or absent means it does not charge. */
  readonly chargeTicks?: number;
  /** Damage multiplier at a full charge. */
  readonly chargedDamageScale?: number;
  /** Prop tag this move needs in hand, or absent for a bare-handed move. */
  readonly requiresPropTag?: string;
  readonly defense?: DefenseSpec;
  readonly grapple?: GrappleSpec;
  readonly finisher?: FinisherSpec;
  /** Plain language for the move list. No frame data, no jargon. */
  readonly coaching: string;
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
    cancelFromTick: 7,
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
    coaching: "Your quickest punch. Throw it first, then follow it with anything.",
    description: "Fast, cheap, and cancels into almost anything. The move that opens a guard.",
  },
  {
    id: "melee.light.cross",
    displayName: "Right cross",
    kind: "light",
    startupTicks: 8,
    activeTicks: 5,
    recoveryTicks: 13,
    turnAuthority: 0.5,
    movement: { forwardMps: 4.5, fromTick: 5, toTick: 13 },
    armor: "none",
    cancelInto: ["heavy", "launcher", "guard", "evade"],
    cancelFromTick: 8,
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
    coaching:
      "The follow-up to a jab. It only leads anywhere if it connects, so do not throw it into a guard.",
    description: "The second half of a jab. Only cancels onward if it actually landed.",
  },
  {
    id: "melee.heavy.overhead",
    displayName: "Overhead hammer",
    kind: "heavy",
    startupTicks: 18,
    activeTicks: 6,
    recoveryTicks: 28,
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
    coaching:
      "A big commitment. Land it off a combo rather than throwing it on its own, and it shrugs off small hits while it swings.",
    description: "Slow, expensive and worth respecting. Light armour, so it trades rather than loses.",
  },
  {
    id: "melee.launcher.uppercut",
    displayName: "Rising uppercut",
    kind: "launcher",
    startupTicks: 15,
    activeTicks: 5,
    recoveryTicks: 24,
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
    coaching: "Lifts the target off its feet. Follow it up while they are in the air.",
    description: "Lifts what it hits. The opening of anything that follows a kaiju off its feet.",
  },
  {
    id: "melee.guard-break.shoulder",
    displayName: "Shoulder charge",
    kind: "guard-break",
    startupTicks: 16,
    activeTicks: 8,
    recoveryTicks: 22,
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
    coaching: "Use this when they will not stop blocking. Nothing interrupts it once it starts.",
    description: "Goes through a guard rather than around it, and cannot be interrupted while it runs.",
  },
  {
    id: "melee.finisher.plasma-drop",
    displayName: "Plasma drop",
    kind: "finisher",
    startupTicks: 22,
    activeTicks: 8,
    recoveryTicks: 36,
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
    coaching: "Only available when the target is nearly finished and reeling. Ends the fight.",
    description:
      "Only legal against a target that is already finished. Ends fights, and costs a fight's worth of heat.",
  },
  {
    id: "kaiju.claw.swipe",
    displayName: "Claw swipe",
    kind: "heavy",
    startupTicks: 20,
    activeTicks: 7,
    recoveryTicks: 24,
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
    coaching: "The creature's opening swing. Wide, and slow enough to read.",
    description: "A wide swing that reaches across the front. The attack a kaiju opens with.",
  },
  {
    id: "kaiju.tail.sweep",
    displayName: "Tail sweep",
    kind: "launcher",
    startupTicks: 18,
    activeTicks: 9,
    recoveryTicks: 28,
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
    coaching: "A low sweep. Step out of it rather than trying to trade with it.",
    description: "Low and wide, and it takes the legs out. Nothing interrupts it once it starts.",
  },
  // ------------------------------------------------------------------ combos
  {
    id: "melee.heavy.smash.forward",
    displayName: "Forward smash",
    kind: "heavy",
    direction: "forward",
    startupTicks: 16,
    activeTicks: 6,
    recoveryTicks: 24,
    turnAuthority: 0.25,
    movement: { forwardMps: 9, fromTick: 14, toTick: 26 },
    armor: "light",
    cancelInto: ["finisher", "grapple"],
    cancelFromTick: 26,
    cancelToTick: 44,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "fist.forward",
        heightFraction: 0.7,
        fromForwardMeters: 10,
        toForwardMeters: 32,
        lateralMeters: 0,
        radiusMeters: 7,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 340,
      kind: "impact",
      poise: 72,
      guardDamage: 48,
      knockbackMps: 12,
      componentShock: 0.2,
      reaction: "stagger",
    },
    staminaCost: 22,
    heatCost: 14,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "Push forward with a heavy attack to close distance and put your weight behind it.",
    description: "The forward variant of a heavy: more travel, more knockback, and it leads into a grapple.",
  },
  {
    id: "melee.heavy.spin.side",
    displayName: "Spinning backhand",
    kind: "heavy",
    direction: "side",
    startupTicks: 18,
    activeTicks: 8,
    recoveryTicks: 24,
    turnAuthority: 0.6,
    movement: { forwardMps: 2, fromTick: 16, toTick: 28 },
    armor: "light",
    cancelInto: ["light", "guard"],
    cancelFromTick: 30,
    cancelToTick: 48,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "arm.sweep.L",
        heightFraction: 0.68,
        fromForwardMeters: 8,
        toForwardMeters: 26,
        lateralMeters: -12,
        radiusMeters: 8,
        activeFromTick: 0,
        activeToTick: 4,
      },
      {
        id: "arm.sweep.R",
        heightFraction: 0.68,
        fromForwardMeters: 8,
        toForwardMeters: 26,
        lateralMeters: 12,
        radiusMeters: 8,
        activeFromTick: 4,
        activeToTick: 8,
      },
    ],
    damage: {
      amount: 230,
      kind: "impact",
      poise: 48,
      guardDamage: 34,
      knockbackMps: 8,
      componentShock: 0.1,
      reaction: "flinch",
    },
    staminaCost: 18,
    heatCost: 11,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching:
      "Hold sideways with a heavy attack to sweep both arms around you. Good when something is beside you.",
    description: "Two volumes, one either side, so it answers a target that has circled rather than closed.",
  },
  {
    id: "melee.charge.haymaker",
    displayName: "Charged haymaker",
    kind: "heavy",
    direction: "neutral",
    chargeTicks: 72,
    chargedDamageScale: 2.3,
    startupTicks: 22,
    activeTicks: 6,
    recoveryTicks: 32,
    turnAuthority: 0.12,
    movement: { forwardMps: 7, fromTick: 20, toTick: 32 },
    armor: "super",
    cancelInto: ["finisher"],
    cancelFromTick: 32,
    cancelToTick: 52,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "fist.charged",
        heightFraction: 0.72,
        fromForwardMeters: 12,
        toForwardMeters: 34,
        lateralMeters: 4,
        radiusMeters: 8,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 380,
      kind: "crush",
      poise: 110,
      guardDamage: 90,
      knockbackMps: 16,
      componentShock: 0.35,
      reaction: "stagger",
    },
    staminaCost: 30,
    heatCost: 24,
    tag: "heavy",
    cues: { windUp: "reactor.charge", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching:
      "Hold the button to wind it up. A full charge more than doubles the damage, but you cannot be interrupted out of it either.",
    description: "The only chargeable move. Super armour throughout, and it hurts to be wrong about.",
  },
  // ----------------------------------------------------------------- defense
  {
    id: "defense.dodge.step",
    displayName: "Evasive step",
    kind: "light",
    direction: "side",
    startupTicks: 3,
    activeTicks: 10,
    recoveryTicks: 8,
    turnAuthority: 0.9,
    movement: { forwardMps: 0, fromTick: 0, toTick: 0 },
    armor: "none",
    cancelInto: ["light", "heavy", "guard"],
    cancelFromTick: 12,
    cancelToTick: 21,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "step.none",
        heightFraction: 0.5,
        fromForwardMeters: 0,
        toForwardMeters: 0,
        lateralMeters: 0,
        radiusMeters: 0.1,
        activeFromTick: 0,
        activeToTick: 1,
      },
    ],
    damage: {
      amount: 1,
      kind: "impact",
      poise: 0,
      guardDamage: 0,
      knockbackMps: 0,
      componentShock: 0,
      reaction: "none",
    },
    defense: {
      kind: "dodge",
      invulnerableFromTick: 2,
      invulnerableToTick: 12,
      perfectFromTick: 0,
      perfectToTick: 0,
      counterMoveId: null,
      travelMeters: 34,
    },
    staminaCost: 14,
    heatCost: 2,
    tag: "evade",
    cues: { windUp: "thruster.step", impact: "impact.none", whiff: "thruster.step" },
    coaching:
      "A short burst sideways. You cannot be hit through the middle of it, but the recovery is real: it is not a free cancel.",
    description:
      "The dodge. Costs stamina, has a recovery, and only cancels out of moves that list an evade.",
  },
  {
    id: "defense.block.raise",
    displayName: "Raise guard",
    kind: "light",
    startupTicks: 2,
    activeTicks: 8,
    recoveryTicks: 6,
    turnAuthority: 0.8,
    movement: { forwardMps: 0, fromTick: 0, toTick: 0 },
    armor: "light",
    cancelInto: ["light", "heavy", "grapple"],
    cancelFromTick: 3,
    cancelToTick: 16,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "guard.none",
        heightFraction: 0.6,
        fromForwardMeters: 0,
        toForwardMeters: 0,
        lateralMeters: 0,
        radiusMeters: 0.1,
        activeFromTick: 0,
        activeToTick: 1,
      },
    ],
    damage: {
      amount: 1,
      kind: "impact",
      poise: 0,
      guardDamage: 0,
      knockbackMps: 0,
      componentShock: 0,
      reaction: "none",
    },
    defense: {
      kind: "block",
      invulnerableFromTick: 0,
      invulnerableToTick: 0,
      perfectFromTick: 0,
      perfectToTick: 7,
      counterMoveId: null,
      travelMeters: 0,
    },
    staminaCost: 4,
    heatCost: 0,
    tag: "guard",
    cues: { windUp: "servo.guard", impact: "impact.guard", whiff: "servo.guard" },
    coaching:
      "Raise your arms. Blocking at the last moment turns it into a perfect guard, which costs you nothing and leaves them open.",
    description: "The block, with a seven tick perfect window at the front of it.",
  },
  {
    id: "defense.counter.parry",
    displayName: "Parry",
    kind: "light",
    startupTicks: 2,
    activeTicks: 8,
    recoveryTicks: 12,
    turnAuthority: 0.7,
    movement: { forwardMps: 0, fromTick: 0, toTick: 0 },
    armor: "none",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "parry.none",
        heightFraction: 0.6,
        fromForwardMeters: 0,
        toForwardMeters: 0,
        lateralMeters: 0,
        radiusMeters: 0.1,
        activeFromTick: 0,
        activeToTick: 1,
      },
    ],
    damage: {
      amount: 1,
      kind: "impact",
      poise: 0,
      guardDamage: 0,
      knockbackMps: 0,
      componentShock: 0,
      reaction: "none",
    },
    defense: {
      kind: "parry",
      invulnerableFromTick: 0,
      invulnerableToTick: 0,
      perfectFromTick: 0,
      perfectToTick: 9,
      counterMoveId: "melee.light.cross",
      travelMeters: 0,
    },
    staminaCost: 10,
    heatCost: 3,
    tag: "guard",
    cues: { windUp: "servo.parry", impact: "impact.parry", whiff: "whiff.parry" },
    coaching:
      "Time it against an incoming swing and you turn it around for free. Miss the timing and you are wide open for a long moment.",
    description:
      "A nine tick window that answers with a free cross. The recovery is punishing when it misses.",
  },
  // ---------------------------------------------------------------- grapples
  {
    id: "grapple.clinch",
    displayName: "Seize",
    kind: "grapple",
    startupTicks: 10,
    activeTicks: 5,
    recoveryTicks: 18,
    turnAuthority: 0.35,
    movement: { forwardMps: 8, fromTick: 8, toTick: 18 },
    armor: "light",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "hands",
        heightFraction: 0.62,
        fromForwardMeters: 8,
        toForwardMeters: 22,
        lateralMeters: 0,
        radiusMeters: 7,
        activeFromTick: 0,
        activeToTick: 5,
      },
    ],
    damage: {
      amount: 40,
      kind: "impact",
      poise: 20,
      guardDamage: 30,
      knockbackMps: 0,
      componentShock: 0.05,
      reaction: "none",
    },
    grapple: {
      reachMeters: 34,
      holdTicks: 150,
      escapeDifficulty: 140,
      clearanceMeters: 70,
      throwDistanceMeters: 60,
    },
    staminaCost: 16,
    heatCost: 6,
    tag: "grapple",
    cues: { windUp: "servo.grab", impact: "impact.grab", whiff: "whiff.grab" },
    coaching:
      "Take hold of them. While you have them you can throw, slam or keep hitting, and they will be fighting to get loose.",
    description: "The grapple initiator. Everything a hold can become is decided after it lands, not here.",
  },
  // --------------------------------------------------------- environmental
  {
    id: "env.swing.prop",
    displayName: "Swing what you are holding",
    kind: "heavy",
    requiresPropTag: "any",
    startupTicks: 14,
    activeTicks: 7,
    recoveryTicks: 26,
    turnAuthority: 0.2,
    movement: { forwardMps: 5, fromTick: 12, toTick: 26 },
    armor: "light",
    cancelInto: ["finisher"],
    cancelFromTick: 26,
    cancelToTick: 46,
    cancelRequiresHit: true,
    volumes: [
      {
        id: "prop.head",
        heightFraction: 0.7,
        fromForwardMeters: 14,
        toForwardMeters: 40,
        lateralMeters: -6,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 7,
      },
    ],
    damage: {
      amount: 220,
      kind: "crush",
      poise: 65,
      guardDamage: 60,
      knockbackMps: 13,
      componentShock: 0.18,
      reaction: "stagger",
    },
    staminaCost: 20,
    heatCost: 8,
    tag: "heavy",
    cues: { windUp: "prop.lift", impact: "impact.prop", whiff: "whiff.prop" },
    coaching:
      "Swing whatever you picked up. The heavier it is the slower it comes round, and it will not last many hits.",
    description: "One move for every prop. What changes is the prop's own mass, reach and damage scale.",
  },
  // ---------------------------------------------------------------- finisher
  {
    id: "finisher.grapple.tear",
    displayName: "Tear down",
    kind: "finisher",
    startupTicks: 12,
    activeTicks: 4,
    recoveryTicks: 24,
    turnAuthority: 0.05,
    movement: { forwardMps: 0, fromTick: 0, toTick: 0 },
    armor: "super",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "tear",
        heightFraction: 0.6,
        fromForwardMeters: 6,
        toForwardMeters: 20,
        lateralMeters: 0,
        radiusMeters: 9,
        activeFromTick: 0,
        activeToTick: 4,
      },
    ],
    damage: {
      amount: 700,
      kind: "crush",
      poise: 130,
      guardDamage: 150,
      knockbackMps: 6,
      componentShock: 0.7,
      reaction: "knockdown",
    },
    finisher: {
      beats: [
        { id: "seize", durationTicks: 30, camera: "close", requiresHold: true },
        { id: "lift", durationTicks: 36, camera: "low", requiresHold: true },
        { id: "tear", durationTicks: 42, camera: "orbit", requiresHold: false },
        { id: "release", durationTicks: 24, camera: "wide", requiresHold: false },
      ],
      guaranteedDamage: 1_400,
      interruptible: true,
      clearanceMeters: 60,
    },
    staminaCost: 35,
    heatCost: 30,
    tag: "finisher",
    cues: { windUp: "servo.tear", impact: "impact.tear", whiff: "whiff.tear" },
    coaching:
      "Available out of a hold when the target is nearly finished. Keep holding through the first half or it lets go.",
    description:
      "The grapple finisher: four beats, two of which need the input held, and it can be interrupted.",
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
  // The move list is written from this, so a move without it would appear in the
  // interface as a blank line.
  if (!entry.coaching) errors.push("coaching line required: the move list is written from it");

  if (entry.direction !== undefined && !MOVE_DIRECTIONS.includes(entry.direction)) {
    errors.push(`unknown direction "${entry.direction}"`);
  }
  if (entry.chargeTicks !== undefined) {
    if (!Number.isInteger(entry.chargeTicks) || entry.chargeTicks < 0) {
      errors.push("chargeTicks must be a whole number of ticks");
    }
    // A charge that adds nothing is a hold the player is punished for.
    if (entry.chargeTicks > 0 && (entry.chargedDamageScale ?? 1) <= 1) {
      errors.push("a chargeable move must be worth charging: chargedDamageScale has to exceed 1");
    }
  }

  const defense = entry.defense;
  if (defense) {
    if (!["dodge", "block", "parry"].includes(defense.kind)) {
      errors.push(`unknown defense kind "${defense.kind}"`);
    }
    if (defense.invulnerableToTick < defense.invulnerableFromTick) {
      errors.push("invulnerable window must not end before it starts");
    }
    if (defense.perfectToTick < defense.perfectFromTick) {
      errors.push("perfect window must not end before it starts");
    }
    // A dodge with no invulnerability is a sidestep that gets hit anyway, and a
    // block with no perfect window has nothing to time.
    if (defense.kind === "dodge" && defense.invulnerableToTick <= defense.invulnerableFromTick) {
      errors.push("a dodge needs invulnerable frames, or it is only a step");
    }
    if (defense.kind !== "dodge" && defense.perfectToTick <= defense.perfectFromTick) {
      errors.push("a block or parry needs a perfect window, or there is nothing to time");
    }
    if (defense.kind === "parry" && !defense.counterMoveId) {
      errors.push("a parry needs a counter move to answer with");
    }
    if (defense.travelMeters < 0) errors.push("travelMeters must not be negative");
  }

  const grapple = entry.grapple;
  if (grapple) {
    for (const key of ["reachMeters", "holdTicks", "escapeDifficulty", "clearanceMeters"] as const) {
      if (!Number.isFinite(grapple[key]) || grapple[key] <= 0) {
        errors.push(`grapple.${key} must be positive`);
      }
    }
    if (grapple.throwDistanceMeters <= 0) errors.push("a throw has to move the target somewhere");
    // A grapple that needs less room than the throw covers would put the victim
    // through whatever was standing there.
    if (grapple.clearanceMeters < grapple.throwDistanceMeters) {
      errors.push("grapple clearance must cover the distance the throw carries");
    }
  }

  const finisher = entry.finisher;
  if (finisher) {
    if (finisher.beats.length === 0) errors.push("a finisher with no beats is not a sequence");
    for (const beat of finisher.beats) {
      if (!beat.id) errors.push("every finisher beat needs an id");
      if (!Number.isInteger(beat.durationTicks) || beat.durationTicks <= 0) {
        errors.push(`finisher beat "${beat.id}" needs a positive length`);
      }
    }
    if (finisher.guaranteedDamage <= 0) {
      errors.push("a finisher must guarantee damage, or it is a cutscene with no outcome");
    }
    if (finisher.clearanceMeters <= 0) errors.push("a finisher needs room, so clearance must be positive");
  }

  // Only a finisher row may carry a finisher script, and only a grapple row a
  // grapple. Otherwise the resolver would have to guess what a move is.
  if (entry.finisher && entry.kind !== "finisher") errors.push("only a finisher move may carry a finisher");
  if (entry.grapple && entry.kind !== "grapple") errors.push("only a grapple move may carry a grapple");
  return errors;
}

/** Full charge multiplier for a move held this long. One when it does not charge. */
export function chargeScale(move: MoveDefinition, heldTicks: number): number {
  const ticks = move.chargeTicks ?? 0;
  if (ticks <= 0) return 1;
  const full = move.chargedDamageScale ?? 1;
  const progress = Math.min(1, Math.max(0, heldTicks / ticks));
  return 1 + (full - 1) * progress;
}

/**
 * Titan Break additions: the flagship's directional, counter and weapon
 * branches, and Knifehead's own move list. Same table, same validator.
 */
const TITAN_MOVES: readonly MoveDefinition[] = [
  {
    id: "melee.heavy.back.counter",
    displayName: "Retreating counter",
    kind: "heavy",
    startupTicks: 12,
    activeTicks: 6,
    recoveryTicks: 24,
    turnAuthority: 0.5,
    movement: { forwardMps: -9, fromTick: 0, toTick: 10 },
    armor: "light",
    cancelInto: ["guard", "evade"],
    cancelFromTick: 26,
    cancelToTick: 42,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "fist.R",
        heightFraction: 0.7,
        fromForwardMeters: 6,
        toForwardMeters: 30,
        lateralMeters: 5,
        radiusMeters: 7,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 300,
      kind: "impact",
      poise: 95,
      guardDamage: 40,
      knockbackMps: 10,
      componentShock: 0.12,
      reaction: "stagger",
    },
    staminaCost: 14,
    heatCost: 6,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    direction: "back",
    coaching: "Step back and hit what followed you. Space and a stagger in one move.",
    description: "Back plus heavy: a short retreat into a straight right that punishes a lunge.",
  },
  {
    id: "melee.run.punch",
    displayName: "Running punch",
    kind: "light",
    startupTicks: 8,
    activeTicks: 6,
    recoveryTicks: 18,
    turnAuthority: 0.45,
    movement: { forwardMps: 16, fromTick: 0, toTick: 12 },
    armor: "none",
    cancelInto: ["light", "heavy", "guard", "evade"],
    cancelFromTick: 12,
    cancelToTick: 30,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "fist.R",
        heightFraction: 0.7,
        fromForwardMeters: 6,
        toForwardMeters: 30,
        lateralMeters: 4,
        radiusMeters: 7,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 180,
      kind: "impact",
      poise: 45,
      guardDamage: 24,
      knockbackMps: 8,
      componentShock: 0.08,
      reaction: "flinch",
    },
    staminaCost: 10,
    heatCost: 4,
    tag: "light",
    cues: { windUp: "servo.light", impact: "impact.light", whiff: "whiff.light" },
    direction: "forward",
    coaching: "Sprint into it. The momentum is the damage.",
    description: "Sprint plus light: a straight that carries the run into the contact.",
  },
  {
    id: "melee.counter.heavy",
    displayName: "Guard punish",
    kind: "heavy",
    startupTicks: 12,
    activeTicks: 6,
    recoveryTicks: 22,
    turnAuthority: 0.6,
    movement: { forwardMps: 5, fromTick: 4, toTick: 14 },
    armor: "light",
    cancelInto: ["guard"],
    cancelFromTick: 30,
    cancelToTick: 38,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "fist.both",
        heightFraction: 0.72,
        fromForwardMeters: 6,
        toForwardMeters: 28,
        lateralMeters: 0,
        radiusMeters: 9,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 360,
      kind: "crush",
      poise: 150,
      guardDamage: 60,
      knockbackMps: 12,
      componentShock: 0.16,
      reaction: "stagger",
    },
    staminaCost: 16,
    heatCost: 8,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "After a perfect guard, the slow answer: it cracks armour and balance.",
    description: "Perfect guard plus heavy: a two-fisted punish that takes armour and stability.",
  },
  {
    id: "ability.elbow-rocket",
    displayName: "Elbow Rocket",
    kind: "heavy",
    startupTicks: 8,
    activeTicks: 10,
    recoveryTicks: 22,
    turnAuthority: 0.35,
    movement: { forwardMps: 110, fromTick: 2, toTick: 14 },
    armor: "light",
    cancelInto: ["guard"],
    cancelFromTick: 30,
    cancelToTick: 40,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "elbow.R",
        heightFraction: 0.68,
        fromForwardMeters: 4,
        toForwardMeters: 24,
        lateralMeters: 4,
        radiusMeters: 8,
        activeFromTick: 0,
        activeToTick: 10,
      },
    ],
    damage: {
      amount: 260,
      kind: "impact",
      poise: 130,
      guardDamage: 40,
      knockbackMps: 9,
      componentShock: 0.1,
      reaction: "stagger",
    },
    staminaCost: 12,
    heatCost: 12,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    direction: "forward",
    coaching: "The gap closer. Fire it into a commitment, not into a guard.",
    description: "Ability one: a rocket-assisted elbow that closes twenty metres and shoves balance hard.",
  },
  {
    id: "melee.sword.slash",
    displayName: "Chain Sword slash",
    kind: "light",
    startupTicks: 9,
    activeTicks: 6,
    recoveryTicks: 16,
    turnAuthority: 0.5,
    movement: { forwardMps: 4, fromTick: 4, toTick: 12 },
    armor: "none",
    cancelInto: ["light", "heavy", "guard", "evade"],
    cancelFromTick: 11,
    cancelToTick: 28,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "sword.R",
        heightFraction: 0.7,
        fromForwardMeters: 6,
        toForwardMeters: 34,
        lateralMeters: 8,
        radiusMeters: 6,
        activeFromTick: 0,
        activeToTick: 6,
      },
      {
        id: "sword.R.sweep",
        heightFraction: 0.7,
        fromForwardMeters: 6,
        toForwardMeters: 34,
        lateralMeters: -6,
        radiusMeters: 6,
        activeFromTick: 2,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 160,
      kind: "shear",
      poise: 30,
      guardDamage: 20,
      knockbackMps: 4,
      componentShock: 0.06,
      reaction: "flinch",
    },
    staminaCost: 8,
    heatCost: 5,
    tag: "light",
    cues: { windUp: "servo.light", impact: "impact.light", whiff: "whiff.light" },
    coaching: "The sword cuts tissue, not plate. Take the armour off first.",
    description: "With the sword out: a fast cut that shreds an exposed region and skates off intact armour.",
  },
  {
    id: "melee.sword.cleave",
    displayName: "Chain Sword cleave",
    kind: "heavy",
    startupTicks: 14,
    activeTicks: 7,
    recoveryTicks: 26,
    turnAuthority: 0.45,
    movement: { forwardMps: 6, fromTick: 6, toTick: 18 },
    armor: "light",
    cancelInto: ["guard"],
    cancelFromTick: 32,
    cancelToTick: 44,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "sword.R",
        heightFraction: 0.72,
        fromForwardMeters: 4,
        toForwardMeters: 36,
        lateralMeters: 0,
        radiusMeters: 8,
        activeFromTick: 0,
        activeToTick: 7,
      },
    ],
    damage: {
      amount: 340,
      kind: "shear",
      poise: 70,
      guardDamage: 40,
      knockbackMps: 8,
      componentShock: 0.12,
      reaction: "stagger",
    },
    staminaCost: 16,
    heatCost: 9,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "The heavy cut. Slow, and everything against an open wound.",
    description: "With the sword out: a two-handed cleave for an exposed region.",
  },
  {
    id: "ability.reactor-purge",
    displayName: "Reactor Purge",
    kind: "heavy",
    startupTicks: 6,
    activeTicks: 6,
    recoveryTicks: 22,
    turnAuthority: 0.2,
    movement: { forwardMps: 0, fromTick: 0, toTick: 0 },
    armor: "super",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "purge.front",
        heightFraction: 0.55,
        fromForwardMeters: 0,
        toForwardMeters: 16,
        lateralMeters: 0,
        radiusMeters: 12,
        activeFromTick: 0,
        activeToTick: 6,
      },
      {
        id: "purge.left",
        heightFraction: 0.55,
        fromForwardMeters: -4,
        toForwardMeters: 12,
        lateralMeters: -12,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 6,
      },
      {
        id: "purge.right",
        heightFraction: 0.55,
        fromForwardMeters: -4,
        toForwardMeters: 12,
        lateralMeters: 12,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 80,
      kind: "heat",
      poise: 110,
      guardDamage: 30,
      knockbackMps: 18,
      componentShock: 0.04,
      reaction: "stagger",
    },
    staminaCost: 6,
    heatCost: 0,
    tag: "heavy",
    cues: { windUp: "servo.heavy", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "Vent everything. It makes room and cools the reactor; it does not win fights on its own.",
    description: "Ability four: a heat vent that shoves everything off the machine and clears a grab.",
  },
  {
    id: "kaiju.claw.left",
    displayName: "Left claw",
    kind: "heavy",
    startupTicks: 18,
    activeTicks: 7,
    recoveryTicks: 22,
    turnAuthority: 0.35,
    movement: { forwardMps: 6, fromTick: 18, toTick: 28 },
    armor: "light",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "claw.L",
        heightFraction: 0.6,
        fromForwardMeters: 8,
        toForwardMeters: 36,
        lateralMeters: -14,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 7,
      },
    ],
    damage: {
      amount: 300,
      kind: "impact",
      poise: 55,
      guardDamage: 70,
      knockbackMps: 9,
      componentShock: 0.1,
      reaction: "flinch",
    },
    staminaCost: 0,
    heatCost: 0,
    tag: "heavy",
    cues: { windUp: "kaiju.windup", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "The left arm goes high before it comes down. Step right of it.",
    description: "Knifehead: a raised left claw brought down and across.",
  },
  {
    id: "kaiju.claw.right",
    displayName: "Right claw",
    kind: "heavy",
    startupTicks: 16,
    activeTicks: 7,
    recoveryTicks: 22,
    turnAuthority: 0.35,
    movement: { forwardMps: 6, fromTick: 16, toTick: 26 },
    armor: "light",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "claw.R",
        heightFraction: 0.6,
        fromForwardMeters: 8,
        toForwardMeters: 36,
        lateralMeters: 14,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 7,
      },
    ],
    damage: {
      amount: 300,
      kind: "impact",
      poise: 55,
      guardDamage: 70,
      knockbackMps: 9,
      componentShock: 0.1,
      reaction: "flinch",
    },
    staminaCost: 0,
    heatCost: 0,
    tag: "heavy",
    cues: { windUp: "kaiju.windup", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "The right arm is quicker. Guard it, then answer.",
    description: "Knifehead: the faster right claw, thrown second in a string.",
  },
  {
    id: "kaiju.blade.sweep",
    displayName: "Blade sweep",
    kind: "heavy",
    startupTicks: 24,
    activeTicks: 9,
    recoveryTicks: 26,
    turnAuthority: 0.3,
    movement: { forwardMps: 4, fromTick: 24, toTick: 36 },
    armor: "light",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "blade.L",
        heightFraction: 0.66,
        fromForwardMeters: 6,
        toForwardMeters: 44,
        lateralMeters: -18,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 5,
      },
      {
        id: "blade.R",
        heightFraction: 0.66,
        fromForwardMeters: 6,
        toForwardMeters: 44,
        lateralMeters: 18,
        radiusMeters: 10,
        activeFromTick: 3,
        activeToTick: 9,
      },
    ],
    damage: {
      amount: 380,
      kind: "shear",
      poise: 85,
      guardDamage: 90,
      knockbackMps: 12,
      componentShock: 0.14,
      reaction: "stagger",
    },
    staminaCost: 0,
    heatCost: 0,
    tag: "heavy",
    cues: { windUp: "kaiju.windup", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "The head swings the blade across. Guard it or get under it.",
    description: "Knifehead: the crest swept wide at chest height.",
  },
  {
    id: "kaiju.blade.down",
    displayName: "Blade drive",
    kind: "launcher",
    startupTicks: 30,
    activeTicks: 6,
    recoveryTicks: 40,
    turnAuthority: 0.15,
    movement: { forwardMps: 5, fromTick: 20, toTick: 34 },
    armor: "super",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "blade.down",
        heightFraction: 0.6,
        fromForwardMeters: 8,
        toForwardMeters: 46,
        lateralMeters: 0,
        radiusMeters: 10,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 520,
      kind: "crush",
      poise: 140,
      guardDamage: 120,
      knockbackMps: 14,
      componentShock: 0.2,
      reaction: "knockdown",
    },
    staminaCost: 0,
    heatCost: 0,
    tag: "launcher",
    cues: { windUp: "kaiju.windup", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "It rears the blade up. That is the long window: sidestep, then take the back.",
    description:
      "Knifehead: the crest driven straight down. Slow, unblockable in spirit, wide open afterwards.",
  },
  {
    id: "kaiju.charge.blade",
    displayName: "Blade charge",
    kind: "heavy",
    startupTicks: 22,
    activeTicks: 14,
    recoveryTicks: 30,
    turnAuthority: 0.1,
    movement: { forwardMps: 200, fromTick: 20, toTick: 38 },
    armor: "super",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "charge",
        heightFraction: 0.55,
        fromForwardMeters: 2,
        toForwardMeters: 30,
        lateralMeters: 0,
        radiusMeters: 11,
        activeFromTick: 0,
        activeToTick: 14,
      },
    ],
    damage: {
      amount: 440,
      kind: "impact",
      poise: 120,
      guardDamage: 110,
      knockbackMps: 22,
      componentShock: 0.16,
      reaction: "knockdown",
    },
    staminaCost: 0,
    heatCost: 0,
    tag: "heavy",
    cues: { windUp: "kaiju.windup", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "Head down, blade first, straight at you. Dodge across it, never back.",
    description: "Knifehead: the gap-closing charge behind the head blade.",
  },
  {
    id: "kaiju.bite.clinch",
    displayName: "Bite",
    kind: "grapple",
    startupTicks: 16,
    activeTicks: 6,
    recoveryTicks: 24,
    turnAuthority: 0.4,
    movement: { forwardMps: 10, fromTick: 8, toTick: 20 },
    armor: "light",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "jaw",
        heightFraction: 0.62,
        fromForwardMeters: 4,
        toForwardMeters: 30,
        lateralMeters: 0,
        radiusMeters: 9,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 200,
      kind: "pierce",
      poise: 40,
      guardDamage: 50,
      knockbackMps: 6,
      componentShock: 0.1,
      reaction: "flinch",
    },
    staminaCost: 0,
    heatCost: 0,
    tag: "grapple",
    cues: { windUp: "kaiju.windup", impact: "impact.heavy", whiff: "whiff.heavy" },
    grapple: {
      reachMeters: 30,
      holdTicks: 90,
      escapeDifficulty: 110,
      clearanceMeters: 40,
      throwDistanceMeters: 40,
    },
    coaching: "The jaw opens before it lunges. Purge or dodge; a guard does not stop teeth.",
    description: "Knifehead: a lunging bite that becomes a hold.",
  },
  {
    id: "kaiju.shove",
    displayName: "Shoulder shove",
    kind: "heavy",
    startupTicks: 10,
    activeTicks: 6,
    recoveryTicks: 16,
    turnAuthority: 0.5,
    movement: { forwardMps: 14, fromTick: 6, toTick: 16 },
    armor: "super",
    cancelInto: [],
    cancelFromTick: 0,
    cancelToTick: 0,
    cancelRequiresHit: false,
    volumes: [
      {
        id: "shove",
        heightFraction: 0.55,
        fromForwardMeters: 2,
        toForwardMeters: 26,
        lateralMeters: 0,
        radiusMeters: 13,
        activeFromTick: 0,
        activeToTick: 6,
      },
    ],
    damage: {
      amount: 140,
      kind: "impact",
      poise: 60,
      guardDamage: 40,
      knockbackMps: 28,
      componentShock: 0.06,
      reaction: "stagger",
    },
    staminaCost: 0,
    heatCost: 0,
    tag: "heavy",
    cues: { windUp: "kaiju.windup", impact: "impact.heavy", whiff: "whiff.heavy" },
    coaching: "It is tired of your rhythm. The shove comes through anything light.",
    description: "Knifehead: an armoured shove that makes space against repeated pressure.",
  },
];

export function createMoveRegistry(): ContentRegistry<MoveDefinition> {
  const registry = new ContentRegistry<MoveDefinition>(validateMove);
  for (const move of MOVES) registry.register(move);
  for (const move of TITAN_MOVES) registry.register(move);
  return registry;
}

export const MOVE_DEFINITIONS: readonly MoveDefinition[] = [...MOVES, ...TITAN_MOVES];

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
