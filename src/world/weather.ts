import { createSeededRng, hashStringToSeed } from "../simulation/rng";

/**
 * Weather.
 *
 * Weather is a deterministic function of the world seed, the region, and the
 * tick. It is not simulated forward from an initial condition, because that
 * would make the sky depend on how the session happened to be played rather
 * than on the world it is playing. Two sessions on one seed see the same storm
 * arrive at the same minute.
 *
 * The one exception is wetness, which genuinely is history: ground stays wet
 * after rain stops. That is the only weather value carried in a save.
 *
 * No Babylon, no DOM. Everything here is arithmetic over plain data, and the
 * climate profile is injected rather than imported, so the world layer never
 * depends on the content layer (see TECH_DECISIONS.md for the cycle this rule
 * exists to prevent).
 */

export const WEATHER_SCHEMA_VERSION = 1;

export const WEATHER_KINDS = ["clear", "cloudy", "rain", "storm", "fog", "snow"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/**
 * How long one weather front holds before the next takes over: six in-game
 * hours. Slots are fixed length so the front covering any tick is a direct
 * lookup rather than a walk from the beginning of the world.
 */
export const FRONT_SLOT_TICKS = 21_600;
/** Fraction of a slot spent crossfading into the next front. */
const TRANSITION_FRACTION = 0.25;
/** How often lightning is rolled during a storm, in ticks. */
const STRIKE_WINDOW_TICKS = 180;
/** How long a strike stays visible. */
const FLASH_DURATION_TICKS = 30;

/** What one weather kind does to the world, at full intensity. */
export interface WeatherKindProfile {
  readonly cloudCover: number;
  readonly precipitation: number;
  readonly fogDensity: number;
  readonly windMultiplier: number;
  readonly lightningChance: number;
  /** Metres of visibility at full intensity, before the clear-air baseline. */
  readonly visibilityMeters: number;
  readonly temperatureOffsetC: number;
  /** True when precipitation falls as snow rather than rain. */
  readonly frozen: boolean;
}

/**
 * Per-kind effects, held as a table so adding a weather kind is a row rather
 * than a branch. Every field is read by blending, never by name comparison.
 */
export const WEATHER_KIND_PROFILES: Readonly<Record<WeatherKind, WeatherKindProfile>> = {
  clear: {
    cloudCover: 0.05,
    precipitation: 0,
    fogDensity: 0,
    windMultiplier: 0.4,
    lightningChance: 0,
    visibilityMeters: 20_000,
    temperatureOffsetC: 2,
    frozen: false,
  },
  cloudy: {
    cloudCover: 0.65,
    precipitation: 0,
    fogDensity: 0.02,
    windMultiplier: 0.7,
    lightningChance: 0,
    visibilityMeters: 14_000,
    temperatureOffsetC: 0,
    frozen: false,
  },
  rain: {
    cloudCover: 0.85,
    precipitation: 0.6,
    fogDensity: 0.06,
    windMultiplier: 1,
    lightningChance: 0.01,
    visibilityMeters: 4_000,
    temperatureOffsetC: -2,
    frozen: false,
  },
  storm: {
    cloudCover: 1,
    precipitation: 1,
    fogDensity: 0.1,
    windMultiplier: 2.2,
    lightningChance: 0.28,
    visibilityMeters: 1_500,
    temperatureOffsetC: -4,
    frozen: false,
  },
  fog: {
    cloudCover: 0.5,
    precipitation: 0,
    fogDensity: 0.55,
    windMultiplier: 0.15,
    lightningChance: 0,
    visibilityMeters: 350,
    temperatureOffsetC: -1,
    frozen: false,
  },
  snow: {
    cloudCover: 0.9,
    precipitation: 0.7,
    fogDensity: 0.14,
    windMultiplier: 0.9,
    lightningChance: 0,
    visibilityMeters: 1_800,
    temperatureOffsetC: -8,
    frozen: true,
  },
};

/** A region's climate expressed as what weather it can produce. Supplied by the content layer. */
export interface ClimateWeatherProfile {
  readonly id: string;
  /** Relative likelihood per kind. Need not sum to one; zero excludes a kind entirely. */
  readonly weights: Readonly<Record<WeatherKind, number>>;
  readonly baseTemperatureC: number;
  /** Peak-to-trough temperature swing across a day. */
  readonly dailySwingC: number;
  /** Typical wind at a multiplier of one, metres per second. */
  readonly baseWindMps: number;
}

export function validateClimateWeatherProfile(profile: ClimateWeatherProfile): string[] {
  const errors: string[] = [];
  if (!profile.id) errors.push("id required");
  let total = 0;
  for (const kind of WEATHER_KINDS) {
    const weight = profile.weights[kind];
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push(`weights.${kind} must be a non-negative finite number`);
      continue;
    }
    total += weight;
  }
  // A profile that can produce nothing would silently freeze the sky on whatever
  // the fallback happened to be, so it is refused at registration instead.
  if (total <= 0) errors.push("weights must include at least one kind with a positive weight");
  for (const key of ["baseTemperatureC", "dailySwingC", "baseWindMps"] as const) {
    if (!Number.isFinite(profile[key])) errors.push(`${key} must be a finite number`);
  }
  if (profile.baseWindMps < 0) errors.push("baseWindMps must not be negative");
  if (profile.dailySwingC < 0) errors.push("dailySwingC must not be negative");
  return errors;
}

/** One scheduled front. Derived from the seed and slot index, never stored. */
export interface WeatherFront {
  readonly slot: number;
  readonly kind: WeatherKind;
  /** 0 to 1. Scales everything the kind profile declares. */
  readonly intensity: number;
  readonly windDirectionDeg: number;
  readonly startTick: number;
  readonly endTick: number;
}

/** Everything the rest of the game is allowed to know about the weather right now. */
export interface WeatherState {
  readonly kind: WeatherKind;
  /** The front being blended toward, equal to `kind` outside a transition. */
  readonly nextKind: WeatherKind;
  /** 0 during steady weather, rising to 1 at the moment the next front takes over. */
  readonly transition: number;
  readonly intensity: number;
  readonly cloudCover: number;
  readonly precipitation: number;
  readonly frozenPrecipitation: boolean;
  readonly fogDensity: number;
  readonly windSpeedMps: number;
  readonly windDirectionDeg: number;
  readonly temperatureC: number;
  /** Surface wetness, 0 dry to 1 saturated. The only weather value that is history. */
  readonly wetness: number;
  readonly visibilityMeters: number;
  /** 0 except in the moments after a strike. */
  readonly lightningFlash: number;
  readonly lastStrikeTick: number | null;
}

export interface WeatherSnapshot {
  readonly schemaVersion: number;
  readonly wetness: number;
}

export interface WeatherSystemOptions {
  readonly seed: number;
  readonly profile: ClimateWeatherProfile;
  readonly slotTicks?: number;
}

/** Rate at which rain saturates the ground, per tick at full precipitation. */
const WETTING_PER_TICK = 1 / 900;
/** Rate at which it dries in full sun. */
const DRYING_PER_TICK = 1 / 5_400;

function weightedKind(profile: ClimateWeatherProfile, roll: number): WeatherKind {
  let total = 0;
  for (const kind of WEATHER_KINDS) total += profile.weights[kind];
  let cursor = roll * total;
  for (const kind of WEATHER_KINDS) {
    cursor -= profile.weights[kind];
    if (cursor <= 0) return kind;
  }
  // Only reachable through floating-point slack at the very top of the range.
  return "clear";
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Shortest-way-round interpolation between two compass bearings. Interpolating
 * the raw numbers would send a wind swinging from 350 to 10 degrees the long way
 * around, through south.
 */
export function lerpDegrees(a: number, b: number, t: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + delta * t) % 360) + 360) % 360;
}

export class WeatherSystem {
  private readonly seed: number;
  private profile: ClimateWeatherProfile;
  private readonly slotTicks: number;
  private wetnessValue = 0;
  private lastTick = 0;

  constructor(options: WeatherSystemOptions) {
    const errors = validateClimateWeatherProfile(options.profile);
    if (errors.length > 0) {
      throw new Error(`Invalid climate weather profile "${options.profile.id}": ${errors.join("; ")}`);
    }
    const slotTicks = options.slotTicks ?? FRONT_SLOT_TICKS;
    if (!Number.isInteger(slotTicks) || slotTicks <= 0) {
      throw new Error(`Weather slot length must be a positive integer, got ${slotTicks}`);
    }
    if (!Number.isFinite(options.seed)) {
      throw new Error(`Weather seed must be a finite number, got ${options.seed}`);
    }
    this.seed = options.seed;
    this.profile = options.profile;
    this.slotTicks = slotTicks;
  }

  get climateId(): string {
    return this.profile.id;
  }

  /**
   * Switches climate, which is what happens when the player deploys somewhere
   * else. Wetness carries across rather than resetting: it describes the player
   * and the ground under them, and a per-region wetness record would be state
   * nothing currently reads.
   */
  setProfile(profile: ClimateWeatherProfile): void {
    const errors = validateClimateWeatherProfile(profile);
    if (errors.length > 0) {
      throw new Error(`Invalid climate weather profile "${profile.id}": ${errors.join("; ")}`);
    }
    this.profile = profile;
  }

  get wetness(): number {
    return this.wetnessValue;
  }

  /** The front occupying a slot. Pure: the same seed and slot always give the same front. */
  frontForSlot(slot: number): WeatherFront {
    const rng = createSeededRng((this.seed ^ hashStringToSeed(`weather.${this.profile.id}.${slot}`)) >>> 0);
    const kind = weightedKind(this.profile, rng());
    // Intensity is biased upward rather than uniform: a front that barely
    // registers is indistinguishable from the clear weather around it.
    const intensity = 0.35 + rng() * 0.65;
    return {
      slot,
      kind,
      intensity,
      windDirectionDeg: rng() * 360,
      startTick: slot * this.slotTicks,
      endTick: (slot + 1) * this.slotTicks,
    };
  }

  frontAt(tick: number): WeatherFront {
    return this.frontForSlot(Math.floor(tick / this.slotTicks));
  }

  /**
   * Advances wetness to `tick`. Everything else about the weather is derived, so
   * this is the only call that carries state forward, and it is idempotent for a
   * tick it has already reached.
   */
  update(tick: number, lightLevel: number): void {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error(`Weather update needs a non-negative integer tick, got ${tick}`);
    }
    if (tick <= this.lastTick) {
      this.lastTick = tick;
      return;
    }
    // Bounded so a long pause or a time skip cannot cost an unbounded loop; the
    // clamp saturates or dries fully either way, which is the correct outcome.
    const elapsed = Math.min(tick - this.lastTick, this.slotTicks);
    const state = this.sampleWithoutWetness(tick);
    const wetting = state.precipitation * WETTING_PER_TICK * elapsed;
    const drying = DRYING_PER_TICK * elapsed * (0.25 + lightLevel * 0.75) * (1 - state.cloudCover * 0.5);
    this.wetnessValue = Math.min(1, Math.max(0, this.wetnessValue + wetting - drying));
    this.lastTick = tick;
  }

  /**
   * Lightning is rolled per window rather than per tick, so a strike is a
   * discrete event with a position in time that both the renderer and gameplay
   * can agree on without either of them owning it.
   */
  private strikeTickAt(tick: number, lightningChance: number): number | null {
    if (lightningChance <= 0) return null;
    const window = Math.floor(tick / STRIKE_WINDOW_TICKS);
    const rng = createSeededRng((this.seed ^ hashStringToSeed(`lightning.${window}`)) >>> 0);
    if (rng() >= lightningChance) return null;
    return window * STRIKE_WINDOW_TICKS + Math.floor(rng() * STRIKE_WINDOW_TICKS);
  }

  private sampleWithoutWetness(tick: number): Omit<WeatherState, "wetness"> {
    const slot = Math.floor(tick / this.slotTicks);
    const current = this.frontForSlot(slot);
    const next = this.frontForSlot(slot + 1);

    const withinSlot = (tick % this.slotTicks) / this.slotTicks;
    const blend =
      withinSlot <= 1 - TRANSITION_FRACTION
        ? 0
        : smoothstep((withinSlot - (1 - TRANSITION_FRACTION)) / TRANSITION_FRACTION);

    const a = WEATHER_KIND_PROFILES[current.kind];
    const b = WEATHER_KIND_PROFILES[next.kind];
    const intensity = lerp(current.intensity, next.intensity, blend);

    const mix = (pick: (p: WeatherKindProfile) => number): number =>
      lerp(pick(a), pick(b), blend) * intensity;

    const cloudCover = Math.min(
      1,
      mix((p) => p.cloudCover),
    );
    const precipitation = Math.min(
      1,
      mix((p) => p.precipitation),
    );
    const fogDensity = Math.min(
      1,
      mix((p) => p.fogDensity),
    );
    const windSpeedMps = this.profile.baseWindMps * mix((p) => p.windMultiplier);
    const lightningChance = mix((p) => p.lightningChance);

    // Visibility blends toward the worse of the two kinds by its own weight, so
    // a clearing storm brightens rather than snapping.
    const clearVisibility = WEATHER_KIND_PROFILES.clear.visibilityMeters;
    const kindVisibility = lerp(a.visibilityMeters, b.visibilityMeters, blend);
    const visibilityMeters = Math.max(50, lerp(clearVisibility, kindVisibility, intensity));

    const strikeTick = this.strikeTickAt(tick, lightningChance);
    const sinceStrike = strikeTick !== null && tick >= strikeTick ? tick - strikeTick : Infinity;
    const lightningFlash = sinceStrike < FLASH_DURATION_TICKS ? 1 - sinceStrike / FLASH_DURATION_TICKS : 0;

    return {
      kind: current.kind,
      nextKind: next.kind,
      transition: blend,
      intensity,
      cloudCover,
      precipitation,
      frozenPrecipitation: blend < 0.5 ? a.frozen : b.frozen,
      fogDensity,
      windSpeedMps,
      windDirectionDeg: lerpDegrees(current.windDirectionDeg, next.windDirectionDeg, blend),
      temperatureC: 0,
      visibilityMeters,
      lightningFlash,
      lastStrikeTick: strikeTick !== null && sinceStrike < FLASH_DURATION_TICKS ? strikeTick : null,
    };
  }

  /** The full weather state at a tick, including the day/night temperature swing. */
  sample(tick: number, dayFraction: number): WeatherState {
    const base = this.sampleWithoutWetness(tick);
    const a = WEATHER_KIND_PROFILES[base.kind];
    const b = WEATHER_KIND_PROFILES[base.nextKind];
    const offset = lerp(a.temperatureOffsetC, b.temperatureOffsetC, base.transition) * base.intensity;
    // Coldest before dawn, warmest mid-afternoon, which is a quarter day later
    // than solar noon.
    const swing = -Math.cos((dayFraction - 0.1) * 2 * Math.PI) * (this.profile.dailySwingC / 2);
    return {
      ...base,
      temperatureC: this.profile.baseTemperatureC + swing + offset,
      wetness: this.wetnessValue,
    };
  }

  serialize(): WeatherSnapshot {
    return { schemaVersion: WEATHER_SCHEMA_VERSION, wetness: this.wetnessValue };
  }

  restore(snapshot: WeatherSnapshot, tick: number): void {
    const errors = validateWeatherSnapshot(snapshot);
    if (errors.length > 0) throw new Error(`Invalid weather snapshot: ${errors.join("; ")}`);
    this.wetnessValue = snapshot.wetness;
    this.lastTick = tick;
  }
}

export function validateWeatherSnapshot(snapshot: WeatherSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== WEATHER_SCHEMA_VERSION) {
    errors.push(
      `weather schemaVersion ${snapshot.schemaVersion} is not supported (expected ${WEATHER_SCHEMA_VERSION})`,
    );
  }
  if (!Number.isFinite(snapshot.wetness) || snapshot.wetness < 0 || snapshot.wetness > 1) {
    errors.push("weather.wetness must be within [0, 1]");
  }
  return errors;
}
