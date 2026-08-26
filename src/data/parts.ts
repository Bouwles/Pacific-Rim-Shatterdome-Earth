import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Parts for the one machine you build yourself.
 *
 * This exists so that exactly one custom Jaeger can be a deep build, and so
 * that every other machine on the roster keeps its identity. Nothing in this
 * file can be fitted to a canon chassis: the assembly reads these to synthesise
 * a new definition, and never edits an existing one.
 *
 * The design rule that shapes the whole catalogue: **a part is good at
 * something and bad at something else, and the two are different axes.** A
 * heavier torso carries more ammunition and unbalances the machine. A bigger
 * reactor powers more and runs hotter. Thicker armour protects and loads the
 * actuators. There is deliberately no part that is simply better than another,
 * and deliberately no single capacity number that all of it collapses into.
 *
 * No Babylon, no DOM, no RNG. This is a table.
 */

/** Where a part goes. Cosmetic slots carry no numbers at all. */
export const PART_SLOTS = [
  "head",
  "torso",
  "arms",
  "legs",
  "reactor",
  "armor",
  "movement",
  "weapon",
  "ability",
  "paint",
  "markings",
  "emblem",
] as const;
export type PartSlot = (typeof PART_SLOTS)[number];

/** Slots that contribute numbers. The rest are paint. */
export const STRUCTURAL_SLOTS: readonly PartSlot[] = [
  "head",
  "torso",
  "arms",
  "legs",
  "reactor",
  "armor",
  "movement",
];

/** Slots a build may carry more than one of. */
export const MULTI_SLOTS: readonly PartSlot[] = ["weapon", "ability"];

/**
 * Physical fittings a part offers or needs.
 *
 * Compatibility is a fitting match rather than a name check, so a new torso
 * with the right fittings takes existing arms without anything being edited.
 */
export const FITTINGS = [
  "mount.standard",
  "mount.heavy",
  "spine.light",
  "spine.heavy",
  "hip.standard",
  "hip.wide",
  "neck.standard",
  "coupling.compact",
  "coupling.wide",
] as const;
export type Fitting = (typeof FITTINGS)[number];

export interface PartDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly slot: PartSlot;
  /** Tons this part adds. Cosmetics are zero. */
  readonly massTons: number;
  /**
   * Where the mass sits, 0 at the feet and 1 at the head.
   *
   * This is what makes balance a real constraint rather than a number: two
   * builds of identical mass handle differently if one carries it high.
   */
  readonly massHeight: number;
  /** Megawatts produced. Reactors only. */
  readonly powerOutputMw: number;
  /** Megawatts drawn at sustained load. */
  readonly powerDrawMw: number;
  /** Heat produced at sustained load, in arbitrary but consistent units. */
  readonly heatOutput: number;
  /** Heat this part can shed. Cooling lives in armour, torsos and reactors. */
  readonly heatDissipation: number;
  /** 0 to 1 of incoming damage stopped before structure is touched. */
  readonly armorRating: number;
  /** Structure this part contributes. */
  readonly structure: number;
  /** Tons of load the actuators in this part can carry. Legs and arms only. */
  readonly actuatorCapacity: number;
  /** Multiplier on walk and run. One is stock. */
  readonly mobilityScale: number;
  /** Multiplier on turn rate. Wide hips turn slower than they walk. */
  readonly turnScale: number;
  /** Rounds of ammunition this part can stow. */
  readonly ammunitionVolume: number;
  /** Module slots this part opens. */
  readonly moduleSlots: number;
  /** Weapon hardpoints this part offers. */
  readonly hardpoints: number;
  /** Fittings this part provides to whatever attaches to it. */
  readonly provides: readonly Fitting[];
  /** Fittings this part needs from whatever it attaches to. */
  readonly requires: readonly Fitting[];
  /** What it costs to manufacture, once. */
  readonly cost: number;
  /**
   * Silhouette contribution, fed to the procedural generator.
   *
   * Proportions rather than a mesh, so two builds look different because they
   * are different, and a real model can replace any of it later.
   */
  readonly silhouette: {
    readonly heightScale: number;
    readonly bulk: number;
    readonly shoulderRatio: number;
  };
  /** The honest sentence about what this part costs you. */
  readonly tradeoff: string;
  readonly description: string;
}

/** Everything a cosmetic part leaves at zero, so a row stays short. */
const COSMETIC = {
  massTons: 0,
  massHeight: 0.5,
  powerOutputMw: 0,
  powerDrawMw: 0,
  heatOutput: 0,
  heatDissipation: 0,
  armorRating: 0,
  structure: 0,
  actuatorCapacity: 0,
  mobilityScale: 1,
  turnScale: 1,
  ammunitionVolume: 0,
  moduleSlots: 0,
  hardpoints: 0,
  provides: [] as readonly Fitting[],
  requires: [] as readonly Fitting[],
  silhouette: { heightScale: 1, bulk: 1, shoulderRatio: 1 },
} as const;

const PARTS: readonly PartDefinition[] = [
  // ============================ heads =====================================
  {
    id: "part.head.standard",
    displayName: "Standard Conn-Pod",
    slot: "head",
    massTons: 60,
    massHeight: 0.95,
    powerOutputMw: 0,
    powerDrawMw: 8,
    heatOutput: 2,
    heatDissipation: 0,
    armorRating: 0.2,
    structure: 220,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 1,
    hardpoints: 0,
    provides: [],
    requires: ["neck.standard"],
    cost: 190_000,
    silhouette: { heightScale: 1, bulk: 1, shoulderRatio: 1 },
    tradeoff: "Good at nothing in particular, bad at nothing in particular.",
    description: "The pod everybody starts with. Two seats, one drift, no surprises.",
  },
  {
    id: "part.head.sensor",
    displayName: "Sensor Conn-Pod",
    slot: "head",
    massTons: 78,
    massHeight: 0.97,
    powerOutputMw: 0,
    powerDrawMw: 22,
    heatOutput: 6,
    heatDissipation: 0,
    armorRating: 0.12,
    structure: 180,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 2,
    hardpoints: 0,
    provides: [],
    requires: ["neck.standard"],
    cost: 400_000,
    silhouette: { heightScale: 1.02, bulk: 1.05, shoulderRatio: 1 },
    tradeoff: "Sees everything and is made of glass. Draws power a fight would rather have.",
    description: "Arrays where the armour should be. Two extra module slots and a thin skull.",
  },
  {
    id: "part.head.armoured",
    displayName: "Armoured Conn-Pod",
    slot: "head",
    massTons: 110,
    massHeight: 0.93,
    powerOutputMw: 0,
    powerDrawMw: 6,
    heatOutput: 2,
    heatDissipation: 0,
    armorRating: 0.42,
    structure: 340,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 0.94,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: ["neck.standard"],
    cost: 310_000,
    silhouette: { heightScale: 0.98, bulk: 1.14, shoulderRatio: 1 },
    tradeoff: "Survives a headshot and carries no modules, and the weight is all at the top.",
    description: "A pod built on the assumption that something will get to it.",
  },

  // ============================ torsos ====================================
  {
    id: "part.torso.balanced",
    displayName: "Balanced Frame",
    slot: "torso",
    massTons: 480,
    massHeight: 0.6,
    powerOutputMw: 0,
    powerDrawMw: 14,
    heatOutput: 4,
    heatDissipation: 40,
    armorRating: 0.28,
    structure: 900,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 240,
    moduleSlots: 2,
    hardpoints: 1,
    provides: ["mount.standard", "neck.standard", "coupling.compact", "coupling.wide"],
    requires: ["spine.light", "spine.heavy"],
    cost: 500_000,
    silhouette: { heightScale: 1, bulk: 1, shoulderRatio: 1 },
    tradeoff: "Nothing to complain about and nothing to build a machine around.",
    description: "The frame every yard makes. Takes any coupling, carries a fair magazine.",
  },
  {
    id: "part.torso.magazine",
    displayName: "Deep Magazine Frame",
    slot: "torso",
    massTons: 640,
    massHeight: 0.55,
    powerOutputMw: 0,
    powerDrawMw: 18,
    heatOutput: 6,
    heatDissipation: 30,
    armorRating: 0.22,
    structure: 820,
    actuatorCapacity: 0,
    mobilityScale: 0.92,
    turnScale: 0.9,
    ammunitionVolume: 720,
    moduleSlots: 1,
    hardpoints: 2,
    provides: ["mount.standard", "mount.heavy", "neck.standard", "coupling.wide"],
    requires: ["spine.heavy"],
    cost: 800_000,
    silhouette: { heightScale: 0.98, bulk: 1.22, shoulderRatio: 1.08 },
    tradeoff: "Carries three times the ammunition and needs a heavy spine to stand up under it.",
    description: "A hull built around its own magazines. Refuses a light spine outright.",
  },
  {
    id: "part.torso.compact",
    displayName: "Compact Frame",
    slot: "torso",
    massTons: 360,
    massHeight: 0.62,
    powerOutputMw: 0,
    powerDrawMw: 10,
    heatOutput: 3,
    heatDissipation: 46,
    armorRating: 0.24,
    structure: 700,
    actuatorCapacity: 0,
    mobilityScale: 1.1,
    turnScale: 1.14,
    ammunitionVolume: 120,
    moduleSlots: 2,
    hardpoints: 1,
    provides: ["mount.standard", "neck.standard", "coupling.compact"],
    requires: ["spine.light", "spine.heavy"],
    cost: 450_000,
    silhouette: { heightScale: 0.94, bulk: 0.84, shoulderRatio: 0.92 },
    tradeoff: "Quick and cool and always nearly out of ammunition.",
    description: "Light, well ventilated, and will not take a wide coupling.",
  },

  // ============================= arms =====================================
  {
    id: "part.arms.standard",
    displayName: "Standard Actuator Arms",
    slot: "arms",
    massTons: 260,
    massHeight: 0.66,
    powerOutputMw: 0,
    powerDrawMw: 26,
    heatOutput: 10,
    heatDissipation: 10,
    armorRating: 0.24,
    structure: 520,
    actuatorCapacity: 600,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 80,
    moduleSlots: 1,
    hardpoints: 2,
    provides: [],
    requires: ["coupling.compact", "coupling.wide"],
    cost: 430_000,
    silhouette: { heightScale: 1, bulk: 1, shoulderRatio: 1 },
    tradeoff: "Lifts what it should and nothing more.",
    description: "Two arms, two hardpoints, no opinions.",
  },
  {
    id: "part.arms.heavy",
    displayName: "Heavy Lift Arms",
    slot: "arms",
    massTons: 420,
    massHeight: 0.64,
    powerOutputMw: 0,
    powerDrawMw: 48,
    heatOutput: 22,
    heatDissipation: 10,
    armorRating: 0.34,
    structure: 760,
    actuatorCapacity: 1_300,
    mobilityScale: 0.88,
    turnScale: 0.86,
    ammunitionVolume: 60,
    moduleSlots: 1,
    hardpoints: 3,
    provides: [],
    requires: ["coupling.wide"],
    cost: 890_000,
    silhouette: { heightScale: 1, bulk: 1.28, shoulderRatio: 1.18 },
    tradeoff: "Carries the whole machine's load and will not fit a compact coupling.",
    description: "Arms that make a heavy build possible and a fast one impossible.",
  },
  {
    id: "part.arms.light",
    displayName: "Fast Cycling Arms",
    slot: "arms",
    massTons: 180,
    massHeight: 0.68,
    powerOutputMw: 0,
    powerDrawMw: 20,
    heatOutput: 8,
    heatDissipation: 12,
    armorRating: 0.16,
    structure: 380,
    actuatorCapacity: 320,
    mobilityScale: 1.14,
    turnScale: 1.1,
    ammunitionVolume: 40,
    moduleSlots: 2,
    hardpoints: 1,
    provides: [],
    requires: ["coupling.compact"],
    cost: 520_000,
    silhouette: { heightScale: 1, bulk: 0.82, shoulderRatio: 0.9 },
    tradeoff: "Fast, cool, and cannot hold up a heavy machine.",
    description: "Thin actuators that cycle quickly and give up when overloaded.",
  },

  // ============================= legs =====================================
  {
    id: "part.legs.standard",
    displayName: "Standard Legs",
    slot: "legs",
    massTons: 520,
    massHeight: 0.25,
    powerOutputMw: 0,
    powerDrawMw: 34,
    heatOutput: 14,
    heatDissipation: 14,
    armorRating: 0.24,
    structure: 780,
    actuatorCapacity: 1_900,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 1,
    hardpoints: 0,
    provides: ["spine.light", "spine.heavy", "hip.standard"],
    requires: [],
    cost: 470_000,
    silhouette: { heightScale: 1, bulk: 1, shoulderRatio: 1 },
    tradeoff: "Takes any spine and excels at nothing.",
    description: "The legs on almost everything. Carry a great deal, walk at a walk.",
  },
  {
    id: "part.legs.heavy",
    displayName: "Siege Legs",
    slot: "legs",
    massTons: 880,
    massHeight: 0.22,
    powerOutputMw: 0,
    powerDrawMw: 52,
    heatOutput: 24,
    heatDissipation: 18,
    armorRating: 0.36,
    structure: 1_240,
    actuatorCapacity: 3_200,
    mobilityScale: 0.78,
    turnScale: 0.7,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: ["spine.heavy", "hip.wide"],
    requires: [],
    cost: 980_000,
    silhouette: { heightScale: 1.04, bulk: 1.32, shoulderRatio: 1 },
    tradeoff: "Holds up anything you can build and will never catch anything.",
    description: "Legs that refuse a light spine and make a heavy build stand.",
  },
  {
    id: "part.legs.sprint",
    displayName: "Sprint Legs",
    slot: "legs",
    massTons: 380,
    massHeight: 0.28,
    powerOutputMw: 0,
    powerDrawMw: 40,
    heatOutput: 20,
    heatDissipation: 10,
    armorRating: 0.14,
    structure: 520,
    actuatorCapacity: 1_000,
    mobilityScale: 1.32,
    turnScale: 1.24,
    ammunitionVolume: 0,
    moduleSlots: 1,
    hardpoints: 0,
    provides: ["spine.light", "hip.standard"],
    requires: [],
    cost: 680_000,
    silhouette: { heightScale: 1.02, bulk: 0.78, shoulderRatio: 0.94 },
    tradeoff: "Quickest thing on the pad and cannot carry a heavy hull at all.",
    description: "Long, thin, and offers only a light spine. Everything above has to be light too.",
  },

  // ============================ reactors ==================================
  {
    id: "part.reactor.standard",
    displayName: "Standard Reactor",
    slot: "reactor",
    massTons: 220,
    massHeight: 0.58,
    powerOutputMw: 180,
    powerDrawMw: 0,
    heatOutput: 40,
    heatDissipation: 24,
    armorRating: 0.2,
    structure: 420,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 1,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 600_000,
    silhouette: { heightScale: 1, bulk: 1, shoulderRatio: 1 },
    tradeoff: "Enough power for a sensible build and not one part more.",
    description: "A reactor sized for a machine that made ordinary choices.",
  },
  {
    id: "part.reactor.output",
    displayName: "High Output Reactor",
    slot: "reactor",
    massTons: 340,
    massHeight: 0.56,
    powerOutputMw: 320,
    powerDrawMw: 0,
    heatOutput: 105,
    heatDissipation: 20,
    armorRating: 0.18,
    structure: 460,
    actuatorCapacity: 0,
    mobilityScale: 0.96,
    turnScale: 0.96,
    ammunitionVolume: 0,
    moduleSlots: 1,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 1_430_000,
    silhouette: { heightScale: 1, bulk: 1.16, shoulderRatio: 1 },
    tradeoff: "Powers anything and produces more heat than most cooling can shed.",
    description: "The reason a build needs a radiator plant rather than plating.",
  },
  {
    id: "part.reactor.cold",
    displayName: "Cold Running Reactor",
    slot: "reactor",
    massTons: 280,
    massHeight: 0.57,
    powerOutputMw: 200,
    powerDrawMw: 0,
    heatOutput: 22,
    heatDissipation: 48,
    armorRating: 0.22,
    structure: 400,
    actuatorCapacity: 0,
    mobilityScale: 0.98,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 1_160_000,
    silhouette: { heightScale: 1, bulk: 1.06, shoulderRatio: 1 },
    tradeoff: "Barely warm, heavier than it looks, and opens no modules.",
    description: "Sheds more than it makes. The answer to a build that keeps overheating.",
  },

  // ============================= armour ===================================
  {
    id: "part.armor.plate",
    displayName: "Composite Plate",
    slot: "armor",
    massTons: 300,
    massHeight: 0.6,
    powerOutputMw: 0,
    powerDrawMw: 4,
    heatOutput: 0,
    heatDissipation: 26,
    armorRating: 0.3,
    structure: 620,
    actuatorCapacity: 0,
    mobilityScale: 0.94,
    turnScale: 0.94,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 350_000,
    silhouette: { heightScale: 1, bulk: 1.1, shoulderRatio: 1.04 },
    tradeoff: "Stops things and slows you down.",
    description: "Layered plate over everything that matters.",
  },
  {
    id: "part.armor.radiator",
    displayName: "Radiator Skin",
    slot: "armor",
    massTons: 180,
    massHeight: 0.62,
    powerOutputMw: 0,
    powerDrawMw: 12,
    heatOutput: 0,
    heatDissipation: 135,
    armorRating: 0.1,
    structure: 280,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 1,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 650_000,
    silhouette: { heightScale: 1, bulk: 1.04, shoulderRatio: 1.1 },
    tradeoff: "Sheds enormous heat and stops almost nothing.",
    description: "Fins instead of plate. The only way to run a high output reactor hard.",
  },
  {
    id: "part.armor.ablative",
    displayName: "Ablative Layers",
    slot: "armor",
    massTons: 420,
    massHeight: 0.58,
    powerOutputMw: 0,
    powerDrawMw: 6,
    heatOutput: 0,
    heatDissipation: 22,
    armorRating: 0.46,
    structure: 900,
    actuatorCapacity: 0,
    mobilityScale: 0.84,
    turnScale: 0.82,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 1_080_000,
    silhouette: { heightScale: 1, bulk: 1.26, shoulderRatio: 1.08 },
    tradeoff: "The toughest thing you can bolt on, and it makes the machine ponderous.",
    description: "Layers meant to be destroyed. Heavy enough to change how the machine walks.",
  },

  // ============================ movement ==================================
  {
    id: "part.movement.standard",
    displayName: "Standard Drive",
    slot: "movement",
    massTons: 90,
    massHeight: 0.35,
    powerOutputMw: 0,
    powerDrawMw: 16,
    heatOutput: 6,
    heatDissipation: 8,
    armorRating: 0.1,
    structure: 160,
    actuatorCapacity: 200,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: ["hip.standard", "hip.wide"],
    requires: ["hip.standard", "hip.wide"],
    cost: 230_000,
    silhouette: { heightScale: 1, bulk: 1, shoulderRatio: 1 },
    tradeoff: "Fits everything and improves nothing.",
    description: "The drive package that comes with the legs.",
  },
  {
    id: "part.movement.booster",
    displayName: "Booster Package",
    slot: "movement",
    massTons: 150,
    massHeight: 0.45,
    powerOutputMw: 0,
    powerDrawMw: 54,
    heatOutput: 34,
    heatDissipation: 0,
    armorRating: 0.06,
    structure: 140,
    actuatorCapacity: 0,
    mobilityScale: 1.22,
    turnScale: 1.06,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: ["hip.standard"],
    requires: ["hip.standard"],
    cost: 850_000,
    silhouette: { heightScale: 1.02, bulk: 1.08, shoulderRatio: 1.12 },
    tradeoff: "Fastest thing on the pad, drinks power, and will not bolt to wide hips.",
    description: "Thrusters at the hip and shoulder. Refuses siege legs outright.",
  },
  {
    id: "part.movement.stabiliser",
    displayName: "Stabiliser Rig",
    slot: "movement",
    massTons: 210,
    massHeight: 0.3,
    powerOutputMw: 0,
    powerDrawMw: 22,
    heatOutput: 8,
    heatDissipation: 10,
    armorRating: 0.14,
    structure: 260,
    actuatorCapacity: 700,
    mobilityScale: 0.94,
    turnScale: 0.9,
    ammunitionVolume: 0,
    moduleSlots: 1,
    hardpoints: 0,
    provides: ["hip.standard", "hip.wide"],
    requires: ["hip.standard", "hip.wide"],
    cost: 560_000,
    silhouette: { heightScale: 0.98, bulk: 1.14, shoulderRatio: 1 },
    tradeoff: "Makes a top-heavy build stand up, at the cost of every kind of speed.",
    description: "Gyros and counterweights low down. The fix for a machine that keeps falling.",
  },

  // ============================ weapons ===================================
  {
    id: "part.weapon.cannon",
    displayName: "Rotary Cannon Mount",
    slot: "weapon",
    massTons: 120,
    massHeight: 0.7,
    powerOutputMw: 0,
    powerDrawMw: 30,
    heatOutput: 26,
    heatDissipation: 0,
    armorRating: 0,
    structure: 120,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: -280,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: ["mount.standard"],
    cost: 370_000,
    silhouette: { heightScale: 1, bulk: 1.04, shoulderRatio: 1.06 },
    tradeoff: "Eats magazine faster than any torso can carry.",
    description: "Sustained fire, and the ammunition problem that comes with it.",
  },
  {
    id: "part.weapon.plasma",
    displayName: "Plasma Caster Mount",
    slot: "weapon",
    massTons: 160,
    massHeight: 0.72,
    powerOutputMw: 0,
    powerDrawMw: 78,
    heatOutput: 62,
    heatDissipation: 0,
    armorRating: 0,
    structure: 140,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: ["mount.heavy"],
    cost: 1_010_000,
    silhouette: { heightScale: 1, bulk: 1.08, shoulderRatio: 1.12 },
    tradeoff: "No ammunition to run out of, and it will cook the machine carrying it.",
    description: "Needs a heavy mount, a big reactor and somewhere for the heat to go.",
  },
  {
    id: "part.weapon.chainsword",
    displayName: "Chain Sword Mount",
    slot: "weapon",
    massTons: 90,
    massHeight: 0.68,
    powerOutputMw: 0,
    powerDrawMw: 18,
    heatOutput: 12,
    heatDissipation: 0,
    armorRating: 0,
    structure: 110,
    actuatorCapacity: 0,
    mobilityScale: 1,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: ["mount.standard"],
    cost: 290_000,
    silhouette: { heightScale: 1, bulk: 1.02, shoulderRatio: 1.02 },
    tradeoff: "Cheap and cool and only works at arm's length.",
    description: "Nothing to reload and nowhere to hide behind.",
  },

  // =========================== abilities ==================================
  {
    id: "part.ability.overdrive",
    displayName: "Overdrive Coupling",
    slot: "ability",
    massTons: 60,
    massHeight: 0.55,
    powerOutputMw: 0,
    powerDrawMw: 44,
    heatOutput: 40,
    heatDissipation: 0,
    armorRating: 0,
    structure: 60,
    actuatorCapacity: 0,
    mobilityScale: 1.06,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 540_000,
    silhouette: { heightScale: 1, bulk: 1.02, shoulderRatio: 1 },
    tradeoff: "Everything moves faster and everything runs hotter.",
    description: "Lets the reactor push past its rating, and makes the heat somebody else's problem.",
  },
  {
    id: "part.ability.vent",
    displayName: "Emergency Vent",
    slot: "ability",
    massTons: 80,
    massHeight: 0.5,
    powerOutputMw: 0,
    powerDrawMw: 8,
    heatOutput: 0,
    heatDissipation: 42,
    armorRating: 0,
    structure: 70,
    actuatorCapacity: 0,
    mobilityScale: 0.98,
    turnScale: 1,
    ammunitionVolume: 0,
    moduleSlots: 0,
    hardpoints: 0,
    provides: [],
    requires: [],
    cost: 410_000,
    silhouette: { heightScale: 1, bulk: 1.04, shoulderRatio: 1 },
    tradeoff: "Buys back a great deal of heat and takes up a slot that could have been a weapon.",
    description: "Blows the heat out through the back. Loud, obvious and effective.",
  },

  // =========================== cosmetics ==================================
  {
    ...COSMETIC,
    id: "part.paint.slate",
    displayName: "Slate",
    slot: "paint",
    cost: 0,
    tradeoff: "None. It is paint.",
    description: "Grey, and nobody will ask about it.",
  },
  {
    ...COSMETIC,
    id: "part.paint.oxide",
    displayName: "Oxide Red",
    slot: "paint",
    cost: 0,
    tradeoff: "None. It is paint.",
    description: "The colour of a yard that ran out of primer.",
  },
  {
    ...COSMETIC,
    id: "part.paint.deep",
    displayName: "Deep Blue",
    slot: "paint",
    cost: 0,
    tradeoff: "None. It is paint.",
    description: "Almost black until the floodlights hit it.",
  },
  {
    ...COSMETIC,
    id: "part.markings.none",
    displayName: "Unmarked",
    slot: "markings",
    cost: 0,
    tradeoff: "None.",
    description: "Nothing stencilled anywhere.",
  },
  {
    ...COSMETIC,
    id: "part.markings.hazard",
    displayName: "Hazard Stripes",
    slot: "markings",
    cost: 0,
    tradeoff: "None.",
    description: "Diagonal bands on every edge somebody might walk into.",
  },
  {
    ...COSMETIC,
    id: "part.markings.serial",
    displayName: "Stencilled Serial",
    slot: "markings",
    cost: 0,
    tradeoff: "None.",
    description: "Large numbers on the shoulder and the shin.",
  },
  {
    ...COSMETIC,
    id: "part.emblem.none",
    displayName: "No Emblem",
    slot: "emblem",
    cost: 0,
    tradeoff: "None.",
    description: "Nobody has claimed it yet.",
  },
  {
    ...COSMETIC,
    id: "part.emblem.anchor",
    displayName: "Anchor",
    slot: "emblem",
    cost: 0,
    tradeoff: "None.",
    description: "For a machine that works the coast.",
  },
  {
    ...COSMETIC,
    id: "part.emblem.breach",
    displayName: "Breach",
    slot: "emblem",
    cost: 0,
    tradeoff: "None.",
    description: "A ring split down the middle.",
  },
];

export function validatePart(entry: PartDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("part.")) errors.push('id must start with "part."');
  if (!entry.id.startsWith(`part.${entry.slot}.`)) errors.push(`id must name its slot "${entry.slot}"`);
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (!PART_SLOTS.includes(entry.slot)) errors.push(`unknown slot "${entry.slot}"`);
  if (entry.massHeight < 0 || entry.massHeight > 1) errors.push("massHeight must be between 0 and 1");
  for (const key of [
    "massTons",
    "powerOutputMw",
    "powerDrawMw",
    "heatOutput",
    "heatDissipation",
    "structure",
    "actuatorCapacity",
    "moduleSlots",
    "hardpoints",
    "cost",
  ] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] < 0) errors.push(`${key} must be zero or above`);
  }
  if (entry.armorRating < 0 || entry.armorRating > 1) errors.push("armorRating must be between 0 and 1");
  for (const key of ["mobilityScale", "turnScale"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be above zero`);
  }
  for (const fitting of [...entry.provides, ...entry.requires]) {
    if (!FITTINGS.includes(fitting)) errors.push(`unknown fitting "${fitting}"`);
  }
  const structural = STRUCTURAL_SLOTS.includes(entry.slot);
  if (structural && entry.massTons <= 0) errors.push("a structural part must weigh something");
  if (!structural && entry.slot !== "weapon" && entry.slot !== "ability" && entry.massTons !== 0) {
    // A paint job that weighs something is a paint job with a balance effect,
    // which is exactly the kind of hidden tradeoff this catalogue refuses.
    errors.push("a cosmetic part must be weightless");
  }
  if (entry.tradeoff.trim().length === 0) errors.push("tradeoff is required");
  if (entry.description.trim().length === 0) errors.push("description is required");
  return errors;
}

export function createPartRegistry(): ContentRegistry<PartDefinition> {
  const registry = new ContentRegistry<PartDefinition>(validatePart);
  for (const entry of PARTS) registry.register(entry);
  return registry;
}

export const PART_DEFINITIONS = PARTS;

/** Every part that goes in one slot. */
export function partsForSlot(slot: PartSlot): readonly PartDefinition[] {
  return PARTS.filter((entry) => entry.slot === slot);
}

/** True when a slot holds exactly one part and a build must fill it. */
export function isRequiredSlot(slot: PartSlot): boolean {
  return STRUCTURAL_SLOTS.includes(slot);
}
