import { WORLD_RADIUS_METERS } from "./coordinates";

/**
 * The ocean.
 *
 * Waves are a sampled field, not simulated bodies. `sampleWaveHeight` is a pure
 * function of position, time and wind, so gameplay, rendering and physics can
 * all ask the same question and get the same answer without any of them owning
 * the water. Simulating each wave as a rigid body is the failure mode this
 * design exists to avoid: it costs orders of magnitude more and buys nothing a
 * height field cannot express.
 *
 * Buoyancy is exposed as a pure force calculation rather than wired into a
 * solver, because no physics backend exists yet. When one arrives it consumes
 * these functions; nothing here needs to change to make that work.
 *
 * No Babylon, no DOM.
 */

export const SEA_LEVEL_METERS = 0;

/**
 * Wave-field coordinates for a position on the globe.
 *
 * An equirectangular projection, and deliberately not the floating-origin local
 * frame: local coordinates move every time the origin rebases, which would make
 * the whole sea jump sideways whenever the player walked two kilometres. These
 * are fixed to the planet, so a wave crest stays where it is no matter where the
 * camera has been.
 *
 * Distorted near the poles, which is where nothing floats anyway.
 */
export function waveFieldCoordinates(
  latitudeDeg: number,
  longitudeDeg: number,
): {
  readonly east: number;
  readonly north: number;
} {
  const latRad = (latitudeDeg * Math.PI) / 180;
  return {
    east: ((longitudeDeg * Math.PI) / 180) * WORLD_RADIUS_METERS * Math.cos(latRad),
    north: latRad * WORLD_RADIUS_METERS,
  };
}

/** Density of sea water, kg per cubic metre. Used by the buoyancy hook. */
export const WATER_DENSITY = 1_025;
export const GRAVITY_MPS2 = 9.81;

/**
 * Depth bands, shallowest first. `maxDepthMeters` is the bottom of each band and
 * the last is open ended, so a lookup always resolves.
 *
 * These are gameplay zones, not oceanography: they decide what can stand, what
 * must swim, how far light reaches, and how loud the surface is from below.
 */
export interface DepthZone {
  readonly id: string;
  readonly maxDepthMeters: number;
  /** How far you can see underwater in this band, metres. */
  readonly visibilityMeters: number;
  /** 0 to 1 tint applied to underwater fog; deeper is darker. */
  readonly darkness: number;
  /** True where a 75 m Jaeger can still plant its feet and fight. */
  readonly standable: boolean;
}

export const DEPTH_ZONES: readonly DepthZone[] = [
  { id: "shoreline", maxDepthMeters: 8, visibilityMeters: 60, darkness: 0.1, standable: true },
  { id: "shallows", maxDepthMeters: 40, visibilityMeters: 45, darkness: 0.25, standable: true },
  { id: "shelf", maxDepthMeters: 120, visibilityMeters: 30, darkness: 0.5, standable: true },
  { id: "deep", maxDepthMeters: 600, visibilityMeters: 14, darkness: 0.8, standable: false },
  {
    id: "abyssal",
    maxDepthMeters: Number.POSITIVE_INFINITY,
    visibilityMeters: 6,
    darkness: 1,
    standable: false,
  },
];

export function depthZoneFor(depthMeters: number): DepthZone {
  for (const zone of DEPTH_ZONES) {
    if (depthMeters <= zone.maxDepthMeters) return zone;
  }
  // Unreachable while the last band is open ended, but a lookup must always
  // resolve rather than return undefined into gameplay code.
  return DEPTH_ZONES[DEPTH_ZONES.length - 1] as DepthZone;
}

/**
 * Wave components. Three octaves of travelling sine, each shorter, steeper and
 * faster than the last. Enough for a readable sea surface and cheap enough to
 * evaluate per vertex and per query without a second thought.
 */
const WAVE_COMPONENTS: readonly {
  readonly wavelengthMeters: number;
  readonly amplitudeShare: number;
  readonly directionDeg: number;
  readonly speedMps: number;
}[] = [
  { wavelengthMeters: 210, amplitudeShare: 0.6, directionDeg: 0, speedMps: 11 },
  { wavelengthMeters: 96, amplitudeShare: 0.28, directionDeg: 37, speedMps: 7.5 },
  { wavelengthMeters: 43, amplitudeShare: 0.12, directionDeg: -58, speedMps: 4.5 },
];

/** Calm sea still moves. Wind adds to this rather than replacing it. */
const BASE_WAVE_AMPLITUDE_METERS = 0.6;
/** Metres of wave height added per metre per second of wind, before the cap. */
const WIND_WAVE_GAIN = 0.55;
export const MAX_WAVE_AMPLITUDE_METERS = 14;

/**
 * Significant wave amplitude for a wind speed. Capped, because an uncapped wind
 * term turns a storm into a wall of water taller than the Jaeger standing in it.
 */
export function waveAmplitudeFor(windSpeedMps: number, swellMultiplier = 1): number {
  const raw = (BASE_WAVE_AMPLITUDE_METERS + Math.max(0, windSpeedMps) * WIND_WAVE_GAIN) * swellMultiplier;
  return Math.min(MAX_WAVE_AMPLITUDE_METERS, raw);
}

export interface WaveSampleOptions {
  /** Local east metres. */
  readonly east: number;
  /** Local north metres. */
  readonly north: number;
  readonly timeSeconds: number;
  readonly windSpeedMps: number;
  readonly windDirectionDeg: number;
  /**
   * How many wave components to evaluate. Quality presets lower this; gameplay
   * queries always use the full set so physics never disagrees with itself.
   */
  readonly octaves?: number;
}

/**
 * Surface height above sea level at a point, in metres.
 *
 * Deterministic in every argument: no internal state, no random source, no wall
 * clock. Two callers a frame apart with the same time get the same answer.
 */
export function sampleWaveHeight(options: WaveSampleOptions): number {
  const amplitude = waveAmplitudeFor(options.windSpeedMps);
  const octaves = Math.min(WAVE_COMPONENTS.length, Math.max(1, options.octaves ?? WAVE_COMPONENTS.length));
  const windRad = (options.windDirectionDeg * Math.PI) / 180;

  let height = 0;
  let usedShare = 0;
  for (let index = 0; index < octaves; index += 1) {
    const component = WAVE_COMPONENTS[index];
    if (!component) continue;
    const angle = windRad + (component.directionDeg * Math.PI) / 180;
    const dirEast = Math.sin(angle);
    const dirNorth = Math.cos(angle);
    const k = (2 * Math.PI) / component.wavelengthMeters;
    const phase =
      k * (options.east * dirEast + options.north * dirNorth) - k * component.speedMps * options.timeSeconds;
    height += Math.sin(phase) * component.amplitudeShare;
    usedShare += component.amplitudeShare;
  }

  // Renormalised by the shares actually evaluated, so dropping octaves for
  // quality lowers detail without lowering the sea.
  return usedShare > 0 ? (height / usedShare) * amplitude : 0;
}

/** Vertical velocity of the surface, metres per second. Drives spray and slam damage later. */
export function sampleWaveVelocity(options: WaveSampleOptions, deltaSeconds = 0.05): number {
  const now = sampleWaveHeight(options);
  const next = sampleWaveHeight({ ...options, timeSeconds: options.timeSeconds + deltaSeconds });
  return (next - now) / deltaSeconds;
}

export const WATER_STATES = ["dry", "wading", "surface-combat", "swimming", "underwater"] as const;
export type WaterState = (typeof WATER_STATES)[number];

export interface WaterContext {
  /** Ground height at the entity's position, metres relative to sea level. */
  readonly groundHeightMeters: number;
  /** Water surface height including waves, metres relative to sea level. */
  readonly waterHeightMeters: number;
  /** Height of the entity standing upright, metres. */
  readonly entityHeightMeters: number;
  /** Where the entity's feet are, metres relative to sea level. */
  readonly feetHeightMeters: number;
  /** Fraction of entity height at which its eyes sit. */
  readonly eyeFraction?: number;
}

export interface WaterSituation {
  readonly state: WaterState;
  /** 0 to 1 of the entity's height below the surface. */
  readonly submergedFraction: number;
  /** Water depth at this position, metres. Zero on dry land. */
  readonly depthMeters: number;
  readonly zone: DepthZone;
  /** True when the entity's feet are on the bottom rather than in open water. */
  readonly grounded: boolean;
  /** True when the entity's eyes are below the surface. */
  readonly eyesSubmerged: boolean;
}

/**
 * Fraction of entity height that must be underwater before wading becomes
 * fighting in water rather than walking through it.
 */
const SURFACE_COMBAT_SUBMERSION = 0.55;
const DEFAULT_EYE_FRACTION = 0.92;
/** Tolerance for "feet are on the bottom", metres. */
const GROUNDED_TOLERANCE_METERS = 0.5;

/**
 * Classifies how an entity is interacting with water.
 *
 * The distinction that matters is whether the feet are on the bottom. A Jaeger
 * standing chest-deep on the shelf is fighting, not swimming, and treating those
 * as the same state is what makes water feel like a different game rather than
 * the same game in a different place.
 */
export function classifyWaterState(context: WaterContext): WaterSituation {
  const errors = validateWaterContext(context);
  if (errors.length > 0) throw new Error(`Cannot classify water state: ${errors.join("; ")}`);

  const depthMeters = Math.max(0, context.waterHeightMeters - context.groundHeightMeters);
  const zone = depthZoneFor(depthMeters);
  const submergedMeters = Math.max(0, context.waterHeightMeters - context.feetHeightMeters);
  const submergedFraction = Math.min(1, submergedMeters / context.entityHeightMeters);
  const grounded = context.feetHeightMeters - context.groundHeightMeters <= GROUNDED_TOLERANCE_METERS;
  const eyeHeight =
    context.feetHeightMeters + context.entityHeightMeters * (context.eyeFraction ?? DEFAULT_EYE_FRACTION);
  const eyesSubmerged = eyeHeight < context.waterHeightMeters;

  const state: WaterState = eyesSubmerged
    ? "underwater"
    : submergedFraction <= 0
      ? "dry"
      : !grounded
        ? "swimming"
        : submergedFraction >= SURFACE_COMBAT_SUBMERSION
          ? "surface-combat"
          : "wading";

  return { state, submergedFraction, depthMeters, zone, grounded, eyesSubmerged };
}

export function validateWaterContext(context: WaterContext): string[] {
  const errors: string[] = [];
  for (const key of [
    "groundHeightMeters",
    "waterHeightMeters",
    "entityHeightMeters",
    "feetHeightMeters",
  ] as const) {
    if (!Number.isFinite(context[key])) errors.push(`${key} must be a finite number`);
  }
  if (context.entityHeightMeters <= 0) errors.push("entityHeightMeters must be positive");
  const eye = context.eyeFraction;
  if (eye !== undefined && (!Number.isFinite(eye) || eye <= 0 || eye > 1)) {
    errors.push("eyeFraction must be within (0, 1]");
  }
  return errors;
}

/** Fraction of its own height a body can stand in before it must float. */
export const STANDABLE_DEPTH_FRACTION = 0.8;
/** How deep a floating body sits when it is not standing on anything. */
export const FLOATING_SUBMERSION = 0.12;

export interface FeetHeightOptions {
  readonly groundHeightMeters: number;
  readonly waterHeightMeters: number;
  readonly entityHeightMeters: number;
  /** True when the body is deliberately going under rather than floating. */
  readonly diving?: boolean;
}

/**
 * Where a body's feet end up, given the ground and the water above it.
 *
 * Three cases, and the middle one is the one that matters: a 75 m Jaeger in 5 m
 * of water stands in it. Floating whenever the ground is below sea level would
 * have it bobbing in the shallows, and standing whenever there is ground would
 * have it walking the abyssal plain. The switch is depth against its own height.
 */
export function resolveFeetHeight(options: FeetHeightOptions): number {
  const { groundHeightMeters, waterHeightMeters, entityHeightMeters } = options;
  if (groundHeightMeters >= SEA_LEVEL_METERS) return groundHeightMeters;

  const depth = SEA_LEVEL_METERS - groundHeightMeters;
  const standable = depth <= entityHeightMeters * STANDABLE_DEPTH_FRACTION;
  if (standable || options.diving === true) return groundHeightMeters;
  return waterHeightMeters - entityHeightMeters * FLOATING_SUBMERSION;
}

/**
 * Upward buoyant force in newtons for a submerged volume.
 *
 * A hook, not a system. Nothing calls it in anger yet because no physics backend
 * is wired; it is exported, tested and ready rather than stubbed, so wiring it
 * later is a call site rather than a design.
 */
export function buoyantForceNewtons(submergedVolumeCubicMeters: number): number {
  if (!Number.isFinite(submergedVolumeCubicMeters) || submergedVolumeCubicMeters < 0) {
    throw new Error(
      `Submerged volume must be a non-negative finite number, got ${submergedVolumeCubicMeters}`,
    );
  }
  return submergedVolumeCubicMeters * WATER_DENSITY * GRAVITY_MPS2;
}

/**
 * Rough submerged volume for an upright box-like body. Deliberately crude: a
 * real hull needs a real mesh, and pretending otherwise would be a fake system.
 */
export function submergedVolumeFor(
  situation: WaterSituation,
  footprintAreaSquareMeters: number,
  entityHeightMeters: number,
): number {
  if (footprintAreaSquareMeters <= 0 || entityHeightMeters <= 0) {
    throw new Error("Footprint area and entity height must both be positive");
  }
  return footprintAreaSquareMeters * entityHeightMeters * situation.submergedFraction;
}

/**
 * How the world sounds from where the listener is.
 *
 * Underwater is not quieter, it is filtered: high frequencies vanish and
 * everything above the surface becomes muffled. Expressing that as a cutoff plus
 * a wet mix keeps the decision in the world layer, where gameplay can read it,
 * rather than inside an audio graph nothing else can see.
 */
export interface AudioEnvironment {
  readonly state: "surface" | "partial" | "underwater";
  /** Low-pass cutoff in hertz applied to the whole mix. */
  readonly lowPassHz: number;
  /** 0 to 1 overall level for ambient beds. */
  readonly ambientLevel: number;
  /** 0 to 1 how much of the ambient bed should be the water loop. */
  readonly waterMix: number;
}

const SURFACE_CUTOFF_HZ = 20_000;
const UNDERWATER_CUTOFF_HZ = 480;

export function audioEnvironmentFor(
  situation: WaterSituation,
  windSpeedMps: number,
  rain: number,
): AudioEnvironment {
  const wind = Math.min(1, Math.max(0, windSpeedMps) / 25);
  if (situation.eyesSubmerged) {
    return {
      state: "underwater",
      lowPassHz: UNDERWATER_CUTOFF_HZ,
      ambientLevel: 0.5 + situation.zone.darkness * 0.2,
      waterMix: 1,
    };
  }
  if (situation.submergedFraction > 0) {
    // Partly in: the surface is right at the listener, which is the loudest and
    // least filtered place water ever is.
    const blend = Math.min(1, situation.submergedFraction / SURFACE_COMBAT_SUBMERSION);
    return {
      state: "partial",
      lowPassHz: SURFACE_CUTOFF_HZ - (SURFACE_CUTOFF_HZ - UNDERWATER_CUTOFF_HZ) * blend * 0.45,
      ambientLevel: 0.55 + wind * 0.3 + rain * 0.15,
      waterMix: 0.4 + blend * 0.4,
    };
  }
  return {
    state: "surface",
    lowPassHz: SURFACE_CUTOFF_HZ,
    ambientLevel: 0.3 + wind * 0.45 + rain * 0.25,
    waterMix: 0,
  };
}
