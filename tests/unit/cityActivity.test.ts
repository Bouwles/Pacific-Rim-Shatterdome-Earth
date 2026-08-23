import { describe, expect, it } from "vitest";
import {
  ALERT_LEVELS,
  ALERT_PROFILES,
  CITY_ACTIVITY_SCHEMA_VERSION,
  advanceAlert,
  diurnalActivity,
  initialAlertState,
  instanceCountFor,
  sampleActivity,
  setAlertLevel,
  validateActivityInputs,
  validateAlertState,
  type ActivityInputs,
  type AlertLevel,
  type CityAlertState,
} from "../../src/world/cityActivity";

/** Far enough past the level change that the response has fully arrived. */
const SETTLED_TICK = 5_000;

function inputs(overrides: Partial<ActivityInputs> = {}): ActivityInputs {
  return {
    districtId: "waterfront",
    populationDensityThousands: 28,
    coastal: true,
    alert: initialAlertState(),
    tick: SETTLED_TICK,
    dayFraction: 0.5,
    precipitation: 0,
    windSpeedMps: 4,
    integrity: 1,
    ...overrides,
  };
}

function atLevel(level: AlertLevel, evacuationProgress = 0): CityAlertState {
  return { ...initialAlertState(), level, evacuationProgress };
}

describe("alert state", () => {
  it("starts calm with nobody evacuated", () => {
    const state = initialAlertState();
    expect(state.level).toBe("calm");
    expect(state.evacuationProgress).toBe(0);
    expect(validateAlertState(state)).toEqual([]);
  });

  it("restarts the clock only when the level actually changes", () => {
    const state = setAlertLevel(initialAlertState(), "warning", 400);
    expect(state.sinceTick).toBe(400);
    // Setting the same level again must not reset the ramp under the city.
    expect(setAlertLevel(state, "warning", 900)).toBe(state);
    expect(setAlertLevel(state, "attack", 900).sinceTick).toBe(900);
  });

  it("refuses an unknown level or a fractional tick", () => {
    expect(() => setAlertLevel(initialAlertState(), "panic" as AlertLevel, 0)).toThrow(/Unknown alert level/);
    expect(() => setAlertLevel(initialAlertState(), "warning", 1.5)).toThrow(/non-negative integer/);
    expect(() => advanceAlert(initialAlertState(), -1)).toThrow(/whole non-negative ticks/);
  });

  it("evacuates while warning and attacking, and never during calm", () => {
    expect(advanceAlert(atLevel("calm"), 20_000).evacuationProgress).toBe(0);
    expect(advanceAlert(atLevel("warning"), 7_200).evacuationProgress).toBeGreaterThan(0);
    // Attack clears people faster than a warning does.
    const warned = advanceAlert(atLevel("warning"), 5_400).evacuationProgress;
    const attacked = advanceAlert(atLevel("attack"), 5_400).evacuationProgress;
    expect(attacked).toBeGreaterThan(warned);
  });

  it("repopulates during recovery rather than staying empty forever", () => {
    const cleared = atLevel("recovery", 1);
    const after = advanceAlert(cleared, 21_600);
    expect(after.evacuationProgress).toBeLessThan(1);
    expect(after.evacuationProgress).toBeGreaterThanOrEqual(0);
  });

  it("keeps progress inside its range however long it runs", () => {
    let state = atLevel("attack");
    for (let step = 0; step < 60; step += 1) state = advanceAlert(state, 5_000);
    expect(state.evacuationProgress).toBe(1);

    let back = atLevel("recovery", 1);
    for (let step = 0; step < 60; step += 1) back = advanceAlert(back, 5_000);
    expect(back.evacuationProgress).toBe(0);
  });

  it("rejects a state it does not understand", () => {
    expect(
      validateAlertState({ ...initialAlertState(), schemaVersion: CITY_ACTIVITY_SCHEMA_VERSION + 1 }).join(
        " ",
      ),
    ).toMatch(/not supported/);
    expect(validateAlertState({ ...initialAlertState(), evacuationProgress: 2 }).join(" ")).toMatch(
      /within \[0, 1\]/,
    );
    expect(validateAlertState({ ...initialAlertState(), level: "boom" as AlertLevel }).join(" ")).toMatch(
      /alert level must be one of/,
    );
  });
});

describe("alert profiles", () => {
  it("defines every level", () => {
    for (const level of ALERT_LEVELS) expect(ALERT_PROFILES[level].level).toBe(level);
  });

  it("escalates military presence and empties the harbour as the alert rises", () => {
    expect(ALERT_PROFILES.attack.military).toBeGreaterThan(ALERT_PROFILES.warning.military);
    expect(ALERT_PROFILES.warning.military).toBeGreaterThan(ALERT_PROFILES.watch.military);
    expect(ALERT_PROFILES.watch.military).toBeGreaterThan(ALERT_PROFILES.calm.military);

    expect(ALERT_PROFILES.attack.shipping).toBeLessThan(ALERT_PROFILES.warning.shipping);
    expect(ALERT_PROFILES.warning.shipping).toBeLessThan(ALERT_PROFILES.calm.shipping);
  });

  it("sounds sirens only when there is something to warn about", () => {
    expect(ALERT_PROFILES.calm.sirenIntensity).toBe(0);
    expect(ALERT_PROFILES.watch.sirenIntensity).toBe(0);
    expect(ALERT_PROFILES.warning.sirenIntensity).toBeGreaterThan(0);
    expect(ALERT_PROFILES.attack.sirenIntensity).toBe(1);
  });

  it("puts more traffic on the roads during a warning than during calm", () => {
    // Everyone is leaving at once, which is busier than an ordinary afternoon.
    expect(ALERT_PROFILES.warning.vehicle).toBeGreaterThan(ALERT_PROFILES.calm.vehicle);
    // By the time it is an attack the roads are empty again.
    expect(ALERT_PROFILES.attack.vehicle).toBeLessThan(ALERT_PROFILES.calm.vehicle);
  });
});

describe("activity sampling", () => {
  it("is busiest at midday and quietest overnight", () => {
    const noon = sampleActivity(inputs({ dayFraction: 0.5 })).civilianDensity;
    const night = sampleActivity(inputs({ dayFraction: 0.05 })).civilianDensity;
    expect(noon).toBeGreaterThan(night * 2);
    expect(diurnalActivity(0.5)).toBeGreaterThan(diurnalActivity(0.03));
  });

  it("has a morning and an evening peak rather than one hump", () => {
    const morning = diurnalActivity(0.34);
    const midday = diurnalActivity(0.53);
    const evening = diurnalActivity(0.73);
    expect(morning).toBeGreaterThan(midday * 0.9);
    expect(evening).toBeGreaterThan(midday * 0.9);
  });

  it("empties the streets as the alert rises", () => {
    const calm = sampleActivity(inputs({ alert: atLevel("calm") })).civilianDensity;
    const warning = sampleActivity(inputs({ alert: atLevel("warning") })).civilianDensity;
    const attack = sampleActivity(inputs({ alert: atLevel("attack") })).civilianDensity;
    expect(warning).toBeLessThan(calm);
    expect(attack).toBeLessThan(warning);
  });

  it("clears the harbour and thickens the military at the same time", () => {
    const calm = sampleActivity(inputs({ alert: atLevel("calm") }));
    const attack = sampleActivity(inputs({ alert: atLevel("attack") }));
    expect(attack.shippingDensity).toBeLessThan(calm.shippingDensity);
    expect(attack.militaryDensity).toBeGreaterThan(calm.militaryDensity);
    expect(attack.sirens).toBe(true);
    expect(calm.sirens).toBe(false);
  });

  it("gives an inland district no shipping at all", () => {
    expect(sampleActivity(inputs({ coastal: false })).shippingDensity).toBe(0);
    expect(sampleActivity(inputs({ coastal: true })).shippingDensity).toBeGreaterThan(0);
  });

  it("ramps rather than switching the instant the level changes", () => {
    const alert = setAlertLevel(initialAlertState(), "attack", 1_000);
    const immediate = sampleActivity(inputs({ alert, tick: 1_000 }));
    const settled = sampleActivity(inputs({ alert, tick: 1_000 + SETTLED_TICK }));
    // Sirens and streets both take a moment to respond.
    expect(immediate.sirenIntensity).toBeLessThan(settled.sirenIntensity);
    expect(immediate.civilianDensity).toBeGreaterThan(settled.civilianDensity);
  });

  it("empties further as the evacuation progresses", () => {
    const early = sampleActivity(inputs({ alert: atLevel("warning", 0.1) })).civilianDensity;
    const late = sampleActivity(inputs({ alert: atLevel("warning", 0.9) })).civilianDensity;
    expect(late).toBeLessThan(early);
  });

  it("peaks evacuation flow in the middle rather than at the ends", () => {
    const start = sampleActivity(inputs({ alert: atLevel("warning", 0) })).evacuationFlow;
    const middle = sampleActivity(inputs({ alert: atLevel("warning", 0.5) })).evacuationFlow;
    const end = sampleActivity(inputs({ alert: atLevel("warning", 1) })).evacuationFlow;
    expect(middle).toBeGreaterThan(start);
    expect(middle).toBeGreaterThan(end);
    // Nobody is moving before it starts or after it finishes.
    expect(start).toBeCloseTo(0, 6);
    expect(end).toBeCloseTo(0, 6);
  });

  it("keeps people indoors in the rain and small craft in harbour in a gale", () => {
    const fair = sampleActivity(inputs());
    const wet = sampleActivity(inputs({ precipitation: 1 }));
    const gale = sampleActivity(inputs({ windSpeedMps: 30 }));
    expect(wet.civilianDensity).toBeLessThan(fair.civilianDensity);
    expect(gale.shippingDensity).toBeLessThan(fair.shippingDensity);
  });

  it("empties a levelled district whatever the hour says", () => {
    const intact = sampleActivity(inputs({ integrity: 1 })).civilianDensity;
    const ruined = sampleActivity(inputs({ integrity: 0 })).civilianDensity;
    expect(ruined).toBe(0);
    expect(intact).toBeGreaterThan(0);
  });

  it("scales with how dense the district is", () => {
    const slum = sampleActivity(inputs({ populationDensityThousands: 96 })).civilianDensity;
    const docks = sampleActivity(inputs({ populationDensityThousands: 4 })).civilianDensity;
    expect(slum).toBeGreaterThan(docks * 5);
  });

  it("keeps every channel inside its range", () => {
    for (const level of ALERT_LEVELS) {
      for (const progress of [0, 0.5, 1]) {
        for (const dayFraction of [0, 0.25, 0.5, 0.75]) {
          const sample = sampleActivity(
            inputs({ alert: atLevel(level, progress), dayFraction, precipitation: 0.5 }),
          );
          for (const key of [
            "civilianDensity",
            "vehicleDensity",
            "shippingDensity",
            "aircraftDensity",
            "militaryDensity",
            "evacuationFlow",
            "sirenIntensity",
          ] as const) {
            expect(sample[key], `${level} ${key}`).toBeGreaterThanOrEqual(0);
            expect(sample[key], `${level} ${key}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("describes itself without being used for branching", () => {
    const sample = sampleActivity(inputs({ alert: atLevel("attack", 0.6), integrity: 0.5 }));
    expect(sample.summary).toContain("attack");
    expect(sample.summary).toContain("60% evacuated");
    expect(sample.summary).toContain("50% damaged");
  });

  it("refuses inputs it cannot sample", () => {
    expect(validateActivityInputs(inputs({ dayFraction: 1 })).join(" ")).toMatch(/within \[0, 1\)/);
    expect(validateActivityInputs(inputs({ integrity: 2 })).join(" ")).toMatch(/within \[0, 1\]/);
    expect(() => sampleActivity(inputs({ districtId: "" }))).toThrow(/Cannot sample activity/);
  });
});

describe("instance counts", () => {
  it("turns a density into a bounded count", () => {
    expect(instanceCountFor(0, 100)).toBe(0);
    expect(instanceCountFor(1, 100)).toBe(100);
    expect(instanceCountFor(0.5, 100)).toBe(50);
    expect(instanceCountFor(2, 100)).toBe(100);
  });

  it("never rounds a living district down to nothing", () => {
    // A district that is nearly empty must still show it is not entirely empty.
    expect(instanceCountFor(0.001, 100)).toBe(1);
  });

  it("returns nothing for a nonsensical budget", () => {
    expect(instanceCountFor(0.5, 0)).toBe(0);
    expect(instanceCountFor(0.5, -10)).toBe(0);
    expect(instanceCountFor(Number.NaN, 100)).toBe(0);
  });
});
