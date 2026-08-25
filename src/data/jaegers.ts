import { ContentRegistry } from "./registry";

export interface JaegerMassBudget {
  readonly massTons: number;
  readonly powerOutputMw: number;
  /** 0..1 fraction of reactor heat the cooling system can dissipate at sustained load. */
  readonly coolingCapacity: number;
}

/**
 * Everything the locomotion controller reads.
 *
 * One machine differs from another by these numbers and nothing else: the
 * controller has no idea which Jaeger it is driving, so a heavy tank and an
 * agile frame are the same code with a different row. Adding a chassis is a
 * registry entry, never a branch.
 */
export interface LocomotionProfile {
  /** Height in metres. Drives stride length, step-up reach and water states. */
  readonly heightMeters: number;
  /** Metres per second at a walk, and flat out. */
  readonly walkSpeedMps: number;
  readonly runSpeedMps: number;
  /** Sideways pace. Always slower than forward: nothing this heavy strafes well. */
  readonly strafeSpeedMps: number;
  /** Pace while guarding. Guard is a stance, not a stop. */
  readonly guardSpeedMps: number;
  /** Metres per second squared. Small numbers here are what mass feels like. */
  readonly accelerationMps2: number;
  readonly brakingMps2: number;
  /** Degrees per second the body may turn while moving, and while planted. */
  readonly turnRateDegPerSecond: number;
  readonly turnInPlaceRateDegPerSecond: number;
  /** Metres of ledge the machine steps over rather than stopping at. */
  readonly stepUpMeters: number;
  /** Slope it can climb. Steeper than this is a wall. */
  readonly maxSlopeDeg: number;
  /** Metres one full stride covers. Footfalls are spaced by distance, never by time. */
  readonly strideMeters: number;
  /** Booster burst: metres per second added, seconds of thrust, seconds to recharge. */
  readonly boosterImpulseMps: number;
  readonly boosterSeconds: number;
  readonly boosterRechargeSeconds: number;
  /** How hard a landing hits: metres per second of fall per unit of camera impulse. */
  readonly landingImpulseScale: number;
  /** Seconds spent getting back up. Heavier frames take longer. */
  readonly getUpSeconds: number;
}

export interface JaegerDefinition {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly markDesignation: string;
  readonly massBudget: JaegerMassBudget;
  /**
   * Asset manifest this machine is rendered from. The roster names a manifest id
   * and never a mesh, which is what makes a model swap a data change.
   */
  readonly assetId: string;
  /** Locomotion numbers. The controller is shared; only this differs per machine. */
  readonly locomotion: LocomotionProfile;
  /** Which yard built it. Names a registered manufacturer. */
  readonly manufacturerId: string;
  /** Technology generation. A Mark 1 is not a worse Mark 5, it is an older one. */
  readonly markGeneration: number;
  /** Where the design came from. Read by the market, never switched on. */
  readonly provenance: ChassisProvenance;
  /** What it is for. Drives which offers a yard puts up. */
  readonly role: ChassisRole;
  /** List price before any yard scaling or standing. */
  readonly listPrice: number;
  /** What it costs to keep on the pad, per day. */
  readonly upkeepPerDay: number;
  /** How it can be acquired at all. An empty list means it cannot be. */
  readonly acquisition: readonly AcquisitionPath[];
  /** Weapons that come fitted and are not sold separately. */
  readonly signatureEquipment: readonly string[];
  /** Upgrade tracks this chassis can be taken down. */
  readonly upgradeTracks: readonly UpgradeTrack[];
  /**
   * Honest performance ranges rather than one number.
   *
   * Each is a low and a high on a 0 to 1 scale, so a preview can show a band
   * and a tradeoff instead of reducing a machine to a power score.
   */
  readonly balance: ChassisBalance;
  readonly description: string;
}

export const CHASSIS_PROVENANCE = [
  "mass-production",
  "prototype",
  "refit",
  "salvage-rebuild",
  "legendary",
] as const;
export type ChassisProvenance = (typeof CHASSIS_PROVENANCE)[number];

export const CHASSIS_ROLES = ["brawler", "marksman", "guardian", "skirmisher", "siege"] as const;
export type ChassisRole = (typeof CHASSIS_ROLES)[number];

/**
 * How a machine can come to be owned.
 *
 * Purchase is the ordinary path. The others exist so that a milestone, a
 * research programme, a wreck or an archive can each put something on the pad
 * without the market being the only door.
 */
export const ACQUISITION_PATHS = [
  "purchase",
  "milestone-unlock",
  "research-manufacture",
  "recovery-rebuild",
  "legendary-archive",
  "special-event",
] as const;
export type AcquisitionPath = (typeof ACQUISITION_PATHS)[number];

export interface UpgradeTrack {
  readonly id: string;
  readonly displayName: string;
  /** How many steps the track has. Every chassis can finish every track it has. */
  readonly steps: number;
  /** What the track improves, in words. */
  readonly effect: string;
}

export interface ChassisBalance {
  /** Low and high of what it can do, 0 to 1. Never a single number. */
  readonly durability: readonly [number, number];
  readonly damage: readonly [number, number];
  readonly mobility: readonly [number, number];
  readonly range: readonly [number, number];
  /** What it gives up to be good at what it is good at. */
  readonly tradeoff: string;
}

function validateLocomotion(profile: LocomotionProfile | undefined): string[] {
  if (!profile) return ["locomotion profile required so the shared controller has numbers to run on"];
  const errors: string[] = [];
  const positive = [
    "heightMeters",
    "walkSpeedMps",
    "runSpeedMps",
    "strafeSpeedMps",
    "guardSpeedMps",
    "accelerationMps2",
    "brakingMps2",
    "turnRateDegPerSecond",
    "turnInPlaceRateDegPerSecond",
    "stepUpMeters",
    "maxSlopeDeg",
    "strideMeters",
    "boosterImpulseMps",
    "boosterSeconds",
    "boosterRechargeSeconds",
    "landingImpulseScale",
    "getUpSeconds",
  ] as const;
  for (const key of positive) {
    const value = profile[key];
    if (!Number.isFinite(value) || value <= 0) errors.push(`locomotion.${key} must be a positive number`);
  }
  if (profile.runSpeedMps <= profile.walkSpeedMps)
    errors.push("locomotion.runSpeedMps must exceed walkSpeedMps");
  if (profile.strafeSpeedMps > profile.walkSpeedMps)
    errors.push("locomotion.strafeSpeedMps must not exceed walkSpeedMps");
  if (profile.guardSpeedMps > profile.walkSpeedMps)
    errors.push("locomotion.guardSpeedMps must not exceed walkSpeedMps");
  // A machine that turns as fast while running as while planted has no weight to it.
  if (profile.turnRateDegPerSecond >= profile.turnInPlaceRateDegPerSecond) {
    errors.push("locomotion.turnRateDegPerSecond must be lower than turnInPlaceRateDegPerSecond");
  }
  if (profile.maxSlopeDeg >= 90) errors.push("locomotion.maxSlopeDeg must be under 90 degrees");
  // Stride is what spaces footfalls. A stride longer than the machine is tall
  // would put one foot down every two seconds at a walk.
  if (profile.strideMeters > profile.heightMeters) {
    errors.push("locomotion.strideMeters must not exceed heightMeters");
  }
  if (profile.stepUpMeters > profile.heightMeters * 0.25) {
    errors.push("locomotion.stepUpMeters must be at most a quarter of the machine's height");
  }
  return errors;
}

function validateJaeger(entry: JaegerDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id) errors.push("id required");
  if (!entry.name) errors.push("name required");
  if (!entry.manufacturer) errors.push("manufacturer required");
  if (entry.massBudget.massTons <= 0) errors.push("massBudget.massTons must be > 0");
  if (entry.massBudget.powerOutputMw <= 0) errors.push("massBudget.powerOutputMw must be > 0");
  if (entry.massBudget.coolingCapacity < 0 || entry.massBudget.coolingCapacity > 1) {
    errors.push("massBudget.coolingCapacity must be within [0, 1]");
  }
  // Without a manifest the bay would have nothing to stand in a berth, and the
  // failure would surface as an empty room rather than as a content error.
  if (!entry.assetId) errors.push("assetId required so the roster resolves to an asset manifest");
  errors.push(...validateLocomotion(entry.locomotion));

  // Market and ownership metadata. A chassis with no way of being acquired is a
  // chassis nobody can ever own, which is a content error rather than a design.
  if (!entry.manufacturerId.startsWith("maker.")) {
    errors.push('manufacturerId must name a registered manufacturer, starting "maker."');
  }
  if (!Number.isInteger(entry.markGeneration) || entry.markGeneration < 0) {
    errors.push("markGeneration must be a non-negative integer");
  }
  if (!CHASSIS_PROVENANCE.includes(entry.provenance)) {
    errors.push(`unknown provenance "${String(entry.provenance)}"`);
  }
  if (!CHASSIS_ROLES.includes(entry.role)) errors.push(`unknown role "${String(entry.role)}"`);
  if (!Number.isFinite(entry.upkeepPerDay) || entry.upkeepPerDay <= 0) {
    errors.push("upkeepPerDay must be above zero");
  }
  // A price only means something when somebody is selling it. A chassis that can
  // be bought must carry one; a research frame that nobody sells must not, or
  // the board would be able to quote a figure for something with no seller.
  const purchasable = entry.acquisition.includes("purchase");
  if (purchasable && (!Number.isFinite(entry.listPrice) || entry.listPrice <= 0)) {
    errors.push("listPrice must be above zero for anything that can be purchased");
  }
  if (!purchasable && entry.listPrice !== 0) {
    errors.push("listPrice must be zero for a chassis that cannot be purchased");
  }
  if (entry.acquisition.length === 0) {
    errors.push("a chassis needs at least one way of being acquired");
  }
  for (const path of entry.acquisition) {
    if (!ACQUISITION_PATHS.includes(path)) errors.push(`unknown acquisition path "${path}"`);
  }
  const trackIds = new Set<string>();
  for (const track of entry.upgradeTracks) {
    if (trackIds.has(track.id)) errors.push(`duplicate upgrade track "${track.id}"`);
    trackIds.add(track.id);
    if (!Number.isInteger(track.steps) || track.steps <= 0) {
      errors.push(`upgrade track "${track.id}" needs at least one step`);
    }
    if (!track.effect) errors.push(`upgrade track "${track.id}" must say what it does`);
  }
  // Ranges rather than one number, and a range has to be a range.
  for (const key of ["durability", "damage", "mobility", "range"] as const) {
    const [low, high] = entry.balance[key];
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 1) {
      errors.push(`balance.${key} must be two values within [0, 1]`);
    } else if (low > high) {
      errors.push(`balance.${key} is inverted: the low must not exceed the high`);
    }
  }
  if (!entry.balance.tradeoff) {
    errors.push("balance.tradeoff required: every machine gives something up");
  }
  return errors;
}

export const jaegerRegistry = new ContentRegistry<JaegerDefinition>(validateJaeger);

// Non-canon procedural placeholder — proves the registry/validation pattern before
// real Jaeger data exists. Replace/extend via CONTENT_REGISTRY.md, never by adding
// a switch-on-id branch in gameplay code.
jaegerRegistry.register({
  id: "placeholder-mk0",
  name: "Placeholder Sentinel",
  manufacturer: "Shatterdome Earth R&D (procedural placeholder)",
  markDesignation: "Mk-0 (development stand-in)",
  massBudget: { massTons: 1800, powerOutputMw: 220, coolingCapacity: 0.6 },
  assetId: "jaeger.placeholder-mk0",
  // The middle of the range: the frame every other profile is read against.
  locomotion: {
    heightMeters: 75,
    walkSpeedMps: 9,
    runSpeedMps: 17,
    strafeSpeedMps: 5.5,
    guardSpeedMps: 4.5,
    accelerationMps2: 3.4,
    brakingMps2: 4.6,
    turnRateDegPerSecond: 26,
    turnInPlaceRateDegPerSecond: 42,
    stepUpMeters: 9,
    maxSlopeDeg: 38,
    strideMeters: 27,
    boosterImpulseMps: 12,
    boosterSeconds: 0.9,
    boosterRechargeSeconds: 7,
    landingImpulseScale: 0.055,
    getUpSeconds: 3.2,
  },
  manufacturerId: "maker.tarrant-yards",
  markGeneration: 0,
  provenance: "mass-production",
  role: "brawler",
  listPrice: 4_200_000,
  upkeepPerDay: 9_500,
  acquisition: ["purchase", "milestone-unlock"],
  signatureEquipment: [],
  upgradeTracks: [
    {
      id: "track.frame",
      displayName: "Frame reinforcement",
      steps: 4,
      effect: "More structure per component.",
    },
    { id: "track.actuators", displayName: "Actuator tuning", steps: 3, effect: "Faster walk and turn." },
  ],
  balance: {
    durability: [0.45, 0.6],
    damage: [0.4, 0.55],
    mobility: [0.5, 0.65],
    range: [0.3, 0.45],
    tradeoff: "Middling at everything, which is what makes it the yardstick.",
  },
  description:
    "Development stand-in Jaeger used to exercise the content-registry pattern. Not a film or canon design.",
});

// A second stand-in so the bay has a roster to choose between rather than one
// machine and an empty berth. Also non-canon, also procedural.
jaegerRegistry.register({
  id: "heavy-mk4",
  name: "Placeholder Bulwark",
  manufacturer: "Shatterdome Earth R&D (procedural placeholder)",
  markDesignation: "Mk-4 (development stand-in)",
  massBudget: { massTons: 2450, powerOutputMw: 310, coolingCapacity: 0.72 },
  assetId: "jaeger.heavy-mk4",
  // The heavy tank end of the range: slower everywhere, steps higher, turns worse.
  locomotion: {
    heightMeters: 82,
    walkSpeedMps: 7.2,
    runSpeedMps: 12.5,
    strafeSpeedMps: 3.8,
    guardSpeedMps: 3.6,
    accelerationMps2: 2.1,
    brakingMps2: 3.2,
    turnRateDegPerSecond: 17,
    turnInPlaceRateDegPerSecond: 29,
    stepUpMeters: 11,
    maxSlopeDeg: 33,
    strideMeters: 30,
    boosterImpulseMps: 8,
    boosterSeconds: 0.7,
    boosterRechargeSeconds: 11,
    landingImpulseScale: 0.075,
    getUpSeconds: 4.6,
  },
  manufacturerId: "maker.novaya-kuznitsa",
  markGeneration: 4,
  provenance: "mass-production",
  role: "guardian",
  listPrice: 7_800_000,
  upkeepPerDay: 16_400,
  acquisition: ["purchase", "recovery-rebuild"],
  signatureEquipment: ["weapon.shoulder-mortar"],
  upgradeTracks: [
    {
      id: "track.plating",
      displayName: "Ablative plating",
      steps: 5,
      effect: "Armour that comes off before the frame does.",
    },
    {
      id: "track.reactor",
      displayName: "Reactor uprating",
      steps: 3,
      effect: "More power for sustained weapons.",
    },
  ],
  balance: {
    durability: [0.7, 0.9],
    damage: [0.5, 0.7],
    mobility: [0.2, 0.35],
    range: [0.4, 0.6],
    tradeoff: "It will outlast anything on the field and never catch anything that runs.",
  },
  description:
    "Heavier development stand-in, used to prove the roster and the berths are data rather than fixtures.",
});

// The agile end of the range. Same controller, different numbers: this entry
// exists so "works for a heavy tank and an agile frame" is something the tests
// can actually run rather than something the design claims.
jaegerRegistry.register({
  id: "agile-mk5",
  name: "Placeholder Harrier",
  manufacturer: "Shatterdome Earth R&D (procedural placeholder)",
  markDesignation: "Mk-5 (development stand-in)",
  massBudget: { massTons: 1420, powerOutputMw: 265, coolingCapacity: 0.55 },
  assetId: "jaeger.placeholder-mk0",
  locomotion: {
    heightMeters: 68,
    walkSpeedMps: 11,
    runSpeedMps: 23,
    strafeSpeedMps: 8.2,
    guardSpeedMps: 6.4,
    accelerationMps2: 5.6,
    brakingMps2: 6.8,
    turnRateDegPerSecond: 38,
    turnInPlaceRateDegPerSecond: 64,
    stepUpMeters: 8,
    maxSlopeDeg: 44,
    strideMeters: 22,
    boosterImpulseMps: 19,
    boosterSeconds: 1.2,
    boosterRechargeSeconds: 5,
    landingImpulseScale: 0.04,
    getUpSeconds: 2.1,
  },
  manufacturerId: "maker.hanjin-dynamics",
  markGeneration: 5,
  provenance: "mass-production",
  role: "skirmisher",
  listPrice: 6_600_000,
  upkeepPerDay: 12_800,
  acquisition: ["purchase", "research-manufacture"],
  signatureEquipment: ["weapon.rotary-cannon"],
  upgradeTracks: [
    {
      id: "track.thrusters",
      displayName: "Thruster package",
      steps: 4,
      effect: "Longer boosters and faster recovery.",
    },
    {
      id: "track.targeting",
      displayName: "Targeting suite",
      steps: 3,
      effect: "Tighter spread and faster locks.",
    },
  ],
  balance: {
    durability: [0.25, 0.4],
    damage: [0.45, 0.6],
    mobility: [0.75, 0.95],
    range: [0.55, 0.75],
    tradeoff: "Reaches the fight first and cannot afford to be in it for long.",
  },
  description:
    "Light development stand-in. Shares the placeholder mesh; what makes it a different machine is its locomotion profile.",
});

// An old machine that is still worth flying. Cheap to buy and to keep, slower
// than anything modern, and with the deepest upgrade tracks of anything on the
// board: an early Mark stays viable by being improved rather than by having
// numbers that quietly match the newest hull.
jaegerRegistry.register({
  id: "veteran-mk1",
  name: "Placeholder Ironclad",
  manufacturer: "Tarrant Yards",
  markDesignation: "Mk-1 (development stand-in)",
  massBudget: { massTons: 2100, powerOutputMw: 190, coolingCapacity: 0.5 },
  assetId: "jaeger.heavy-mk4",
  locomotion: {
    heightMeters: 72,
    walkSpeedMps: 7,
    runSpeedMps: 13,
    strafeSpeedMps: 4,
    guardSpeedMps: 3.6,
    accelerationMps2: 2.4,
    brakingMps2: 3.6,
    turnRateDegPerSecond: 18,
    turnInPlaceRateDegPerSecond: 30,
    stepUpMeters: 8,
    maxSlopeDeg: 34,
    strideMeters: 25,
    boosterImpulseMps: 7,
    boosterSeconds: 0.6,
    boosterRechargeSeconds: 11,
    landingImpulseScale: 0.07,
    getUpSeconds: 4.4,
  },
  manufacturerId: "maker.tarrant-yards",
  markGeneration: 1,
  provenance: "refit",
  role: "siege",
  listPrice: 2_900_000,
  upkeepPerDay: 6_200,
  acquisition: ["purchase", "recovery-rebuild", "legendary-archive"],
  signatureEquipment: ["weapon.chain-sword"],
  upgradeTracks: [
    {
      id: "track.frame",
      displayName: "Frame reinforcement",
      steps: 6,
      effect: "More structure per component.",
    },
    {
      id: "track.plating",
      displayName: "Ablative plating",
      steps: 5,
      effect: "Armour that comes off before the frame does.",
    },
    { id: "track.actuators", displayName: "Actuator tuning", steps: 5, effect: "Faster walk and turn." },
    {
      id: "track.reactor",
      displayName: "Reactor uprating",
      steps: 4,
      effect: "More power for sustained weapons.",
    },
  ],
  balance: {
    durability: [0.6, 0.95],
    damage: [0.55, 0.85],
    mobility: [0.15, 0.3],
    range: [0.25, 0.45],
    tradeoff: "Slow enough to be caught anywhere, and upgradeable further than anything newer.",
  },
  description:
    "An old machine kept in service by people who would rather rebuild than replace. Non-canon development stand-in.",
});

// Two machines nobody sells.
//
// These exist only at the end of a research programme, and the acquisition list
// says so: `research-manufacture` and nothing else. There is no price, because
// there is no seller. What they cost is the tree behind them and the rare
// components that tree makes buildable, which is what makes finishing a branch
// feel like it produced something rather than incremented something.
jaegerRegistry.register({
  id: "harmonic-mk1",
  name: "Placeholder Harmonic",
  manufacturer: "Shatterdome Earth R&D",
  markDesignation: "Mk-1 research frame (development stand-in)",
  massBudget: { massTons: 2400, powerOutputMw: 240, coolingCapacity: 0.62 },
  assetId: "jaeger.placeholder-mk0",
  locomotion: {
    heightMeters: 76,
    walkSpeedMps: 8.2,
    runSpeedMps: 15.5,
    strafeSpeedMps: 5.4,
    guardSpeedMps: 4.4,
    accelerationMps2: 3.1,
    brakingMps2: 4.2,
    turnRateDegPerSecond: 23,
    turnInPlaceRateDegPerSecond: 38,
    stepUpMeters: 9,
    maxSlopeDeg: 37,
    strideMeters: 26,
    boosterImpulseMps: 9,
    boosterSeconds: 0.8,
    boosterRechargeSeconds: 9,
    landingImpulseScale: 0.06,
    getUpSeconds: 3.8,
  },
  manufacturerId: "maker.tarrant-yards",
  markGeneration: 6,
  provenance: "prototype",
  role: "brawler",
  listPrice: 0,
  upkeepPerDay: 9_400,
  acquisition: ["research-manufacture"],
  signatureEquipment: ["weapon.harmonic-lance"],
  upgradeTracks: [
    {
      id: "track.harmonics",
      displayName: "Harmonic tuning",
      steps: 5,
      effect: "The lance works further into the cord before the plate reacts.",
    },
    {
      id: "track.laminate",
      displayName: "Laminate hull",
      steps: 4,
      effect: "Their plating, layered into ours.",
    },
    { id: "track.actuators", displayName: "Actuator tuning", steps: 4, effect: "Faster walk and turn." },
  ],
  balance: {
    durability: [0.5, 0.75],
    damage: [0.6, 0.9],
    mobility: [0.5, 0.7],
    range: [0.35, 0.6],
    tradeoff: "Built around one weapon. Take the lance off and it is an ordinary hull.",
  },
  description:
    "Materials, weapons and sensor work in one frame, assembled rather than bought. Non-canon development stand-in.",
});

jaegerRegistry.register({
  id: "leviathan-mk1",
  name: "Placeholder Leviathan",
  manufacturer: "Shatterdome Earth R&D",
  markDesignation: "Mk-1 core frame (development stand-in)",
  massBudget: { massTons: 3400, powerOutputMw: 340, coolingCapacity: 0.8 },
  assetId: "jaeger.heavy-mk4",
  locomotion: {
    heightMeters: 88,
    walkSpeedMps: 6.8,
    runSpeedMps: 12.4,
    strafeSpeedMps: 4.2,
    guardSpeedMps: 3.8,
    accelerationMps2: 2.2,
    brakingMps2: 3.4,
    turnRateDegPerSecond: 16,
    turnInPlaceRateDegPerSecond: 27,
    stepUpMeters: 11,
    maxSlopeDeg: 32,
    strideMeters: 31,
    boosterImpulseMps: 6,
    boosterSeconds: 0.5,
    boosterRechargeSeconds: 13,
    landingImpulseScale: 0.09,
    getUpSeconds: 5.2,
  },
  manufacturerId: "maker.tarrant-yards",
  markGeneration: 6,
  provenance: "legendary",
  role: "siege",
  listPrice: 0,
  upkeepPerDay: 15_800,
  acquisition: ["research-manufacture"],
  signatureEquipment: ["weapon.chain-sword", "weapon.harmonic-lance"],
  upgradeTracks: [
    {
      id: "track.core",
      displayName: "Core coupling",
      steps: 6,
      effect: "More out of the thing driving it, and more heat to deal with.",
    },
    {
      id: "track.laminate",
      displayName: "Laminate hull",
      steps: 5,
      effect: "Their plating, layered into ours.",
    },
    {
      id: "track.ablative",
      displayName: "Ablative shielding",
      steps: 4,
      effect: "Shielding meant to be destroyed instead of the frame.",
    },
    {
      id: "track.reactor",
      displayName: "Reactor uprating",
      steps: 5,
      effect: "More power for sustained weapons.",
    },
  ],
  balance: {
    durability: [0.8, 1],
    damage: [0.7, 0.95],
    mobility: [0.1, 0.25],
    range: [0.3, 0.55],
    tradeoff: "Driven by something that was alive. Expensive to keep and slow to bring anywhere.",
  },
  description: "The end of the tree: a hull built around a recovered core. Non-canon development stand-in.",
});
