/**
 * Civilian and military activity.
 *
 * This is a density field, not a crowd of agents. It answers "how much is moving
 * here, and of what kind" for a district, and the renderer turns that into a
 * bounded number of pooled instances. Nothing here knows how many vehicles exist
 * or where any individual one is, which is what keeps a city of ninety thousand
 * people to a handful of numbers.
 *
 * The failure mode this avoids is spawning thousands of full AI civilians. There
 * is no per-civilian state anywhere in this file, and there is nowhere for it to
 * live: a district is one `ActivitySample`.
 *
 * Authoritative and serializable. Alert level and evacuation progress are real
 * state that a save carries; everything else is derived from them plus the time,
 * the weather and the damage.
 *
 * No Babylon, no DOM.
 */

export const CITY_ACTIVITY_SCHEMA_VERSION = 1;

export const ALERT_LEVELS = ["calm", "watch", "warning", "attack", "recovery"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** What each alert level does, before time, weather and damage are applied. */
export interface AlertProfile {
  readonly level: AlertLevel;
  readonly displayName: string;
  /** Multipliers on the district's baseline activity. */
  readonly civilian: number;
  readonly vehicle: number;
  readonly shipping: number;
  readonly aircraft: number;
  readonly military: number;
  readonly sirenIntensity: number;
  /** Fraction of the population per tick that reaches a muster point. */
  readonly evacuationRatePerTick: number;
  /** True when civilians are actively being moved rather than going about their day. */
  readonly evacuating: boolean;
  readonly notes: string;
}

/**
 * A table rather than a branch. Adding an alert level is a row, and every
 * consumer reads the same numbers, so the sirens, the traffic and the shipping
 * cannot disagree about what "warning" means.
 */
export const ALERT_PROFILES: Readonly<Record<AlertLevel, AlertProfile>> = {
  calm: {
    level: "calm",
    displayName: "Calm",
    civilian: 1,
    vehicle: 1,
    shipping: 1,
    aircraft: 1,
    military: 0.15,
    sirenIntensity: 0,
    evacuationRatePerTick: 0,
    evacuating: false,
    notes: "Ordinary day. Military presence is a token patrol.",
  },
  watch: {
    level: "watch",
    displayName: "Watch",
    civilian: 0.85,
    vehicle: 0.9,
    shipping: 0.7,
    aircraft: 1.3,
    military: 0.55,
    sirenIntensity: 0,
    evacuationRatePerTick: 0,
    evacuating: false,
    notes: "Something is moving out there. Shipping thins, patrols thicken, nobody is told yet.",
  },
  warning: {
    level: "warning",
    displayName: "Warning",
    civilian: 0.55,
    vehicle: 1.35,
    shipping: 0.25,
    aircraft: 1.6,
    military: 1,
    sirenIntensity: 0.7,
    // Roughly a quarter of the population per in-game hour.
    evacuationRatePerTick: 1 / 14_400,
    evacuating: true,
    notes: "Sirens up, harbour cleared, and the roads busier than normal because everyone is on them.",
  },
  attack: {
    level: "attack",
    displayName: "Attack",
    civilian: 0.18,
    vehicle: 0.45,
    shipping: 0.05,
    aircraft: 0.9,
    military: 1.6,
    sirenIntensity: 1,
    evacuationRatePerTick: 1 / 5_400,
    evacuating: true,
    notes: "Streets emptying fast. What traffic is left is emergency traffic.",
  },
  recovery: {
    level: "recovery",
    displayName: "Recovery",
    civilian: 0.4,
    vehicle: 0.7,
    shipping: 0.45,
    aircraft: 0.6,
    military: 1.1,
    // Zero, not almost zero. The all clear is a thing that happens: a siren that
    // never quite stops is a siren nobody listens to.
    sirenIntensity: 0,
    // Negative: people return home rather than muster.
    evacuationRatePerTick: -1 / 21_600,
    evacuating: false,
    notes: "Sirens off, people coming back, military still everywhere clearing up.",
  },
};

/** Authoritative alert state for one region. Small, plain and saved. */
export interface CityAlertState {
  readonly schemaVersion: number;
  readonly level: AlertLevel;
  /** Tick the current level was entered. Drives ramps that depend on elapsed time. */
  readonly sinceTick: number;
  /** 0 nobody moved, 1 everyone who is going to be at a muster point is there. */
  readonly evacuationProgress: number;
}

export function initialAlertState(): CityAlertState {
  return {
    schemaVersion: CITY_ACTIVITY_SCHEMA_VERSION,
    level: "calm",
    sinceTick: 0,
    evacuationProgress: 0,
  };
}

export function validateAlertState(state: CityAlertState): string[] {
  const errors: string[] = [];
  if (state.schemaVersion !== CITY_ACTIVITY_SCHEMA_VERSION) {
    errors.push(
      `alert schemaVersion ${state.schemaVersion} is not supported ` +
        `(expected ${CITY_ACTIVITY_SCHEMA_VERSION})`,
    );
  }
  if (!ALERT_LEVELS.includes(state.level)) {
    errors.push(`alert level must be one of: ${ALERT_LEVELS.join(", ")}`);
  }
  if (!Number.isInteger(state.sinceTick) || state.sinceTick < 0) {
    errors.push("alert.sinceTick must be a non-negative integer");
  }
  if (
    !Number.isFinite(state.evacuationProgress) ||
    state.evacuationProgress < 0 ||
    state.evacuationProgress > 1
  ) {
    errors.push("alert.evacuationProgress must be within [0, 1]");
  }
  return errors;
}

/** Moves to a new alert level, restarting the clock only when the level changes. */
export function setAlertLevel(state: CityAlertState, level: AlertLevel, tick: number): CityAlertState {
  if (!ALERT_LEVELS.includes(level)) {
    throw new Error(`Unknown alert level "${level}". Known levels: ${ALERT_LEVELS.join(", ")}`);
  }
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(`Alert tick must be a non-negative integer, got ${tick}`);
  }
  if (state.level === level) return state;
  return { ...state, level, sinceTick: tick };
}

/**
 * Advances evacuation. Progress rises while a level is evacuating and falls back
 * during recovery, so a city that has been cleared repopulates rather than
 * staying empty forever.
 */
export function advanceAlert(state: CityAlertState, ticks: number): CityAlertState {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(`Alert advance needs whole non-negative ticks, got ${ticks}`);
  }
  if (ticks === 0) return state;
  const profile = ALERT_PROFILES[state.level];
  const next = state.evacuationProgress + profile.evacuationRatePerTick * ticks;
  return { ...state, evacuationProgress: Math.min(1, Math.max(0, next)) };
}

/** What a district looks like right now. Every field is 0 to 1 unless stated. */
export interface ActivitySample {
  readonly districtId: string;
  readonly alertLevel: AlertLevel;
  readonly civilianDensity: number;
  readonly vehicleDensity: number;
  readonly shippingDensity: number;
  readonly aircraftDensity: number;
  readonly militaryDensity: number;
  /** People actively moving toward a muster point. Peaks mid-evacuation. */
  readonly evacuationFlow: number;
  readonly sirenIntensity: number;
  readonly sirens: boolean;
  /** One line describing the state, for readouts. Never used for branching. */
  readonly summary: string;
}

export interface ActivityInputs {
  readonly districtId: string;
  /** People per square kilometre, in thousands. Sets the baseline. */
  readonly populationDensityThousands: number;
  /** True where shipping lanes reach this district. */
  readonly coastal: boolean;
  readonly alert: CityAlertState;
  readonly tick: number;
  /** 0 at midnight, 0.5 at noon. */
  readonly dayFraction: number;
  readonly precipitation: number;
  readonly windSpeedMps: number;
  /** 0 levelled, 1 untouched. */
  readonly integrity: number;
}

/** Population density at which a district counts as fully busy. */
const REFERENCE_DENSITY_THOUSANDS = 45;
/** How long after an alert change the response takes to arrive, in ticks. */
const RESPONSE_RAMP_TICKS = 900;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Diurnal curve. Two peaks, morning and evening, with a trough overnight; a
 * single sine would make three in the morning as busy as midday.
 */
export function diurnalActivity(dayFraction: number): number {
  const morning = Math.exp(-(((dayFraction - 0.34) / 0.09) ** 2));
  const evening = Math.exp(-(((dayFraction - 0.73) / 0.11) ** 2));
  const daytime = Math.exp(-(((dayFraction - 0.53) / 0.24) ** 2));
  return clamp01(0.12 + daytime * 0.55 + morning * 0.3 + evening * 0.35);
}

export function validateActivityInputs(inputs: ActivityInputs): string[] {
  const errors: string[] = [];
  if (!inputs.districtId) errors.push("districtId required");
  for (const key of ["populationDensityThousands", "precipitation", "windSpeedMps", "integrity"] as const) {
    if (!Number.isFinite(inputs[key]) || inputs[key] < 0) {
      errors.push(`${key} must be a non-negative finite number`);
    }
  }
  if (!Number.isFinite(inputs.dayFraction) || inputs.dayFraction < 0 || inputs.dayFraction >= 1) {
    errors.push("dayFraction must be within [0, 1)");
  }
  if (inputs.integrity > 1) errors.push("integrity must be within [0, 1]");
  errors.push(...validateAlertState(inputs.alert));
  return errors;
}

/**
 * Turns state into densities.
 *
 * Order matters and is deliberate: the district's own baseline first, then time
 * of day, then the alert, then evacuation, then weather, then damage. Damage is
 * last because a levelled district is empty whatever the hour says.
 */
export function sampleActivity(inputs: ActivityInputs): ActivitySample {
  const errors = validateActivityInputs(inputs);
  if (errors.length > 0) {
    throw new Error(`Cannot sample activity for "${inputs.districtId}": ${errors.join("; ")}`);
  }

  const profile = ALERT_PROFILES[inputs.alert.level];
  const baseline = clamp01(inputs.populationDensityThousands / REFERENCE_DENSITY_THOUSANDS);
  const timeOfDay = diurnalActivity(inputs.dayFraction);

  // The city does not switch state the instant the level does; sirens sound
  // before the streets change.
  const ramp = smoothstep((inputs.tick - inputs.alert.sinceTick) / RESPONSE_RAMP_TICKS);
  const blend = (calm: number, alerted: number): number => calm + (alerted - calm) * ramp;

  const evacuated = inputs.alert.evacuationProgress;
  const remaining = 1 - evacuated;

  // Weather keeps people indoors and small craft in harbour; wind matters more
  // to shipping and aircraft than to anyone on a street.
  const wetPenalty = 1 - inputs.precipitation * 0.45;
  const windPenalty = 1 - clamp01(inputs.windSpeedMps / 32) * 0.6;
  const damage = inputs.integrity;

  const civilianDensity = clamp01(
    baseline *
      timeOfDay *
      blend(1, profile.civilian) *
      (profile.evacuating ? remaining : 1) *
      wetPenalty *
      damage,
  );
  const vehicleDensity = clamp01(
    baseline *
      timeOfDay *
      blend(1, profile.vehicle) *
      (profile.evacuating ? 0.35 + remaining * 0.65 : 1) *
      wetPenalty *
      damage,
  );
  const shippingDensity = inputs.coastal
    ? clamp01(blend(1, profile.shipping) * windPenalty * (0.4 + timeOfDay * 0.6))
    : 0;
  const aircraftDensity = clamp01(blend(1, profile.aircraft) * windPenalty * 0.6);
  const militaryDensity = clamp01(blend(0.15, profile.military));

  // Flow peaks in the middle of an evacuation: nobody is moving before it starts
  // and nobody is left to move once it is done.
  const evacuationFlow = profile.evacuating ? clamp01(4 * evacuated * remaining) * ramp : 0;
  const sirenIntensity = clamp01(profile.sirenIntensity * ramp);

  return {
    districtId: inputs.districtId,
    alertLevel: inputs.alert.level,
    civilianDensity,
    vehicleDensity,
    shippingDensity,
    aircraftDensity,
    militaryDensity,
    evacuationFlow,
    sirenIntensity,
    sirens: sirenIntensity > 0.05,
    summary: describeActivity(inputs.alert.level, evacuated, civilianDensity, damage),
  };
}

function describeActivity(
  level: AlertLevel,
  evacuated: number,
  civilianDensity: number,
  integrity: number,
): string {
  const parts: string[] = [ALERT_PROFILES[level].displayName.toLowerCase()];
  if (evacuated > 0.02) parts.push(`${Math.round(evacuated * 100)}% evacuated`);
  if (integrity < 0.98) parts.push(`${Math.round((1 - integrity) * 100)}% damaged`);
  parts.push(
    civilianDensity < 0.05 ? "streets empty" : `${Math.round(civilianDensity * 100)}% street activity`,
  );
  return parts.join(", ");
}

/**
 * How many pooled instances a density is worth, given a budget.
 *
 * The only place density becomes a count. Rounding up from a non-zero density
 * guarantees at least one instance, so a district that is nearly empty still
 * shows that it is not entirely empty.
 */
export function instanceCountFor(density: number, budget: number): number {
  if (!Number.isFinite(density) || density <= 0) return 0;
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  return Math.max(1, Math.round(clamp01(density) * budget));
}
