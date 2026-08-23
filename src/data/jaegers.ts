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
  readonly description: string;
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
  description:
    "Light development stand-in. Shares the placeholder mesh; what makes it a different machine is its locomotion profile.",
});
