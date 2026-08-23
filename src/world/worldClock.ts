import { FIXED_STEP_MS } from "../simulation/clock";

/**
 * The world clock.
 *
 * Time advances with simulation ticks, never with wall clock. That is what makes
 * a save reproduce the same sky, the same weather and the same tide it was
 * written under: the clock is a pure function of how many ticks have been
 * simulated, and pausing the simulation pauses the sun.
 *
 * Like the rest of `src/world/**` this module uses trigonometry, which the
 * kernel is forbidden from doing. The determinism boundary recorded in
 * TECH_DECISIONS.md applies here for the same reason: there is no way to place
 * the sun without it.
 */

export const WORLD_CLOCK_SCHEMA_VERSION = 1;

/**
 * One tick is one in-game second, which makes a day 86,400 ticks and 24 real
 * minutes at the fixed step. Chosen so the arithmetic is legible in a debug
 * readout rather than being a tuning constant nobody can hold in their head.
 */
export const DEFAULT_DAY_LENGTH_TICKS = 86_400;
export const SECONDS_PER_TICK = FIXED_STEP_MS / 1000;

/** Days in the modelled year. No leap years: the game has no calendar that would notice. */
export const DAYS_PER_YEAR = 365;
/** Synodic month, days. Drives the moon phase. */
export const LUNAR_CYCLE_DAYS = 29.530_588;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
/** Earth's axial tilt, degrees. What gives the model seasons at all. */
const AXIAL_TILT_DEG = 23.44;

export interface WorldClockSnapshot {
  readonly schemaVersion: number;
  readonly elapsedTicks: number;
  readonly dayLengthTicks: number;
}

export interface WorldClockOptions {
  readonly dayLengthTicks?: number;
  readonly startTicks?: number;
}

export class WorldClock {
  private ticks: number;
  private readonly dayLength: number;

  constructor(options: WorldClockOptions = {}) {
    const dayLength = options.dayLengthTicks ?? DEFAULT_DAY_LENGTH_TICKS;
    if (!Number.isInteger(dayLength) || dayLength <= 0) {
      throw new Error(`World day length must be a positive integer number of ticks, got ${dayLength}`);
    }
    const start = options.startTicks ?? 0;
    if (!Number.isInteger(start) || start < 0) {
      throw new Error(`World clock start must be a non-negative integer tick, got ${start}`);
    }
    this.dayLength = dayLength;
    this.ticks = start;
  }

  /** Advances by whole ticks. Rejects fractions so the clock cannot drift off the tick grid. */
  advance(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(`World clock advances by whole non-negative ticks, got ${ticks}`);
    }
    this.ticks += ticks;
  }

  /** Jumps to an absolute tick. Used by debug controls and by save restore. */
  setTicks(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(`World clock tick must be a non-negative integer, got ${ticks}`);
    }
    this.ticks = ticks;
  }

  /** Moves to the next occurrence of a fraction of the day, never backwards. */
  skipToDayFraction(fraction: number): void {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) {
      throw new Error(`Day fraction must be within [0, 1), got ${fraction}`);
    }
    const target = Math.round(fraction * this.dayLength);
    const intoDay = this.ticks % this.dayLength;
    const delta = target > intoDay ? target - intoDay : this.dayLength - intoDay + target;
    this.ticks += delta;
  }

  get elapsedTicks(): number {
    return this.ticks;
  }

  get dayLengthTicks(): number {
    return this.dayLength;
  }

  /** Whole days elapsed since the world began. */
  get dayNumber(): number {
    return Math.floor(this.ticks / this.dayLength);
  }

  /** Position within the current day, 0 at midnight, 0.5 at noon. */
  get dayFraction(): number {
    return (this.ticks % this.dayLength) / this.dayLength;
  }

  get dayOfYear(): number {
    return this.dayNumber % DAYS_PER_YEAR;
  }

  /** Clock time as `HH:MM`, for readouts only. */
  get timeOfDayLabel(): string {
    const totalMinutes = Math.floor(this.dayFraction * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  serialize(): WorldClockSnapshot {
    return {
      schemaVersion: WORLD_CLOCK_SCHEMA_VERSION,
      elapsedTicks: this.ticks,
      dayLengthTicks: this.dayLength,
    };
  }

  restore(snapshot: WorldClockSnapshot): void {
    const errors = validateWorldClockSnapshot(snapshot);
    if (errors.length > 0) throw new Error(`Invalid world clock snapshot: ${errors.join("; ")}`);
    this.ticks = snapshot.elapsedTicks;
  }
}

export function validateWorldClockSnapshot(snapshot: WorldClockSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== WORLD_CLOCK_SCHEMA_VERSION) {
    errors.push(
      `clock schemaVersion ${snapshot.schemaVersion} is not supported (expected ${WORLD_CLOCK_SCHEMA_VERSION})`,
    );
  }
  if (!Number.isInteger(snapshot.elapsedTicks) || snapshot.elapsedTicks < 0) {
    errors.push("clock.elapsedTicks must be a non-negative integer");
  }
  if (!Number.isInteger(snapshot.dayLengthTicks) || snapshot.dayLengthTicks <= 0) {
    errors.push("clock.dayLengthTicks must be a positive integer");
  }
  return errors;
}

/** Where a celestial body sits in the sky, and how much light it is contributing. */
export interface CelestialBody {
  /** Degrees above the horizon. Negative means below it. */
  readonly elevationDeg: number;
  /** Degrees clockwise from north. */
  readonly azimuthDeg: number;
  /** 0 to 1. Zero whenever the body is below the horizon. */
  readonly illumination: number;
}

/**
 * Solar declination for a day of the year.
 *
 * The standard cosine approximation. It assumes a circular orbit and ignores the
 * equation of time, so it is wrong by a few minutes against a real almanac. That
 * is well inside what a game needs from "the sun is lower in winter", and the
 * inaccuracy is stated rather than hidden.
 */
export function solarDeclinationDeg(dayOfYear: number): number {
  return AXIAL_TILT_DEG * Math.sin(((2 * Math.PI) / DAYS_PER_YEAR) * (dayOfYear - 81));
}

function bodyPosition(latitudeDeg: number, declinationDeg: number, hourAngleDeg: number): CelestialBody {
  const lat = latitudeDeg * DEG_TO_RAD;
  const dec = declinationDeg * DEG_TO_RAD;
  const hour = hourAngleDeg * DEG_TO_RAD;

  const sinElevation = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hour);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinElevation)));
  const azimuth = Math.atan2(
    -Math.sin(hour) * Math.cos(dec),
    Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(hour),
  );

  return {
    elevationDeg: elevation * RAD_TO_DEG,
    azimuthDeg: (azimuth * RAD_TO_DEG + 360) % 360,
    illumination: 0,
  };
}

/**
 * Twilight ramp.
 *
 * Light does not stop at the horizon: civil twilight runs to about six degrees
 * below it, and cutting light off at zero elevation makes sunset a hard switch
 * rather than a dusk.
 */
const CIVIL_TWILIGHT_DEG = -6;

function daylightFraction(elevationDeg: number): number {
  if (elevationDeg <= CIVIL_TWILIGHT_DEG) return 0;
  if (elevationDeg >= 12) return 1;
  const t = (elevationDeg - CIVIL_TWILIGHT_DEG) / (12 - CIVIL_TWILIGHT_DEG);
  return t * t * (3 - 2 * t);
}

export function sunAt(dayFraction: number, dayOfYear: number, latitudeDeg: number): CelestialBody {
  const declination = solarDeclinationDeg(dayOfYear);
  // Solar hour angle: zero at local noon, fifteen degrees per hour either side.
  const hourAngle = (dayFraction * 24 - 12) * 15;
  const position = bodyPosition(latitudeDeg, declination, hourAngle);
  return { ...position, illumination: daylightFraction(position.elevationDeg) };
}

/** 0 at new moon, 0.5 at full moon, approaching 1 back at new. */
export function moonPhase(dayNumber: number): number {
  return (((dayNumber % LUNAR_CYCLE_DAYS) + LUNAR_CYCLE_DAYS) % LUNAR_CYCLE_DAYS) / LUNAR_CYCLE_DAYS;
}

/** Lit fraction of the moon's disc, 0 at new and 1 at full. */
export function moonIlluminatedFraction(dayNumber: number): number {
  return (1 - Math.cos(2 * Math.PI * moonPhase(dayNumber))) / 2;
}

/**
 * The moon, trailing the sun by its phase angle. A full moon therefore rises as
 * the sun sets, which is the property that matters for a night that is sometimes
 * navigable and sometimes not.
 */
export function moonAt(
  dayFraction: number,
  dayOfYear: number,
  dayNumber: number,
  latitudeDeg: number,
): CelestialBody {
  const phase = moonPhase(dayNumber);
  // Declination tracks the sun at new moon and opposes it at full, because that
  // is where in the sky the moon has to be for those phases to happen at all.
  const declination = solarDeclinationDeg(dayOfYear) * Math.cos(2 * Math.PI * phase) * 0.9;
  // The moon lags the sun by its phase angle: it rises later each night, so its
  // hour angle is the sun's minus the phase, not plus. With the sign the other
  // way round the full moon sat 87 degrees below the horizon at midnight.
  const hourAngle = (dayFraction * 24 - 12) * 15 - phase * 360;
  const position = bodyPosition(latitudeDeg, declination, (((hourAngle % 360) + 540) % 360) - 180);
  const above = daylightFraction(position.elevationDeg);
  return { ...position, illumination: above * moonIlluminatedFraction(dayNumber) };
}

/**
 * Ambient light level from 0 to 1, before weather.
 *
 * Moonlight is scaled hard: a full moon is roughly a four hundred thousandth of
 * daylight in reality, but a night that dark is unplayable, so it is raised to a
 * usable floor deliberately rather than by accident.
 */
export const MOONLIGHT_CONTRIBUTION = 0.18;

export function clearSkyLightLevel(sun: CelestialBody, moon: CelestialBody): number {
  return Math.min(1, sun.illumination + moon.illumination * MOONLIGHT_CONTRIBUTION);
}
