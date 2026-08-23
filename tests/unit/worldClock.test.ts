import { describe, expect, it } from "vitest";
import {
  DAYS_PER_YEAR,
  DEFAULT_DAY_LENGTH_TICKS,
  WORLD_CLOCK_SCHEMA_VERSION,
  WorldClock,
  clearSkyLightLevel,
  moonAt,
  moonIlluminatedFraction,
  moonPhase,
  solarDeclinationDeg,
  sunAt,
  validateWorldClockSnapshot,
} from "../../src/world/worldClock";

describe("world clock", () => {
  it("starts at the beginning of day zero", () => {
    const clock = new WorldClock();
    expect(clock.elapsedTicks).toBe(0);
    expect(clock.dayNumber).toBe(0);
    expect(clock.dayFraction).toBe(0);
    expect(clock.timeOfDayLabel).toBe("00:00");
  });

  it("advances in whole ticks and rolls into the next day", () => {
    const clock = new WorldClock();
    clock.advance(DEFAULT_DAY_LENGTH_TICKS / 2);
    expect(clock.dayFraction).toBeCloseTo(0.5, 10);
    expect(clock.timeOfDayLabel).toBe("12:00");

    clock.advance(DEFAULT_DAY_LENGTH_TICKS / 2);
    expect(clock.dayNumber).toBe(1);
    expect(clock.dayFraction).toBe(0);
  });

  it("refuses fractional or negative advances so it cannot drift off the tick grid", () => {
    const clock = new WorldClock();
    expect(() => clock.advance(0.5)).toThrow(/whole non-negative ticks/);
    expect(() => clock.advance(-1)).toThrow(/whole non-negative ticks/);
    expect(() => clock.setTicks(1.5)).toThrow(/non-negative integer/);
  });

  it("rejects a nonsensical day length", () => {
    expect(() => new WorldClock({ dayLengthTicks: 0 })).toThrow(/positive integer/);
    expect(() => new WorldClock({ startTicks: -5 })).toThrow(/non-negative integer/);
  });

  it("skips forward to a time of day, never backwards", () => {
    const clock = new WorldClock();
    clock.advance(Math.round(DEFAULT_DAY_LENGTH_TICKS * 0.75));

    // 0.25 is behind us today, so the skip must land on tomorrow morning.
    clock.skipToDayFraction(0.25);
    expect(clock.dayNumber).toBe(1);
    expect(clock.dayFraction).toBeCloseTo(0.25, 6);
  });

  it("rejects a day fraction outside its range", () => {
    const clock = new WorldClock();
    expect(() => clock.skipToDayFraction(1)).toThrow(/within \[0, 1\)/);
    expect(() => clock.skipToDayFraction(-0.1)).toThrow(/within \[0, 1\)/);
  });

  it("round-trips through a snapshot", () => {
    const clock = new WorldClock();
    clock.advance(123_456);
    const snapshot = clock.serialize();

    const restored = new WorldClock();
    restored.restore(snapshot);
    expect(restored.elapsedTicks).toBe(123_456);
    expect(restored.timeOfDayLabel).toBe(clock.timeOfDayLabel);
  });

  it("rejects a snapshot from another schema version", () => {
    const clock = new WorldClock();
    expect(() =>
      clock.restore({ schemaVersion: WORLD_CLOCK_SCHEMA_VERSION + 1, elapsedTicks: 0, dayLengthTicks: 10 }),
    ).toThrow(/not supported/);
    expect(
      validateWorldClockSnapshot({
        schemaVersion: WORLD_CLOCK_SCHEMA_VERSION,
        elapsedTicks: -1,
        dayLengthTicks: 10,
      }),
    ).toContainEqual(expect.stringMatching(/non-negative integer/));
  });
});

describe("sun and moon", () => {
  it("puts the sun highest at noon and below the horizon at midnight", () => {
    const noon = sunAt(0.5, 172, 22.3193);
    const midnight = sunAt(0, 172, 22.3193);
    expect(noon.elevationDeg).toBeGreaterThan(60);
    expect(midnight.elevationDeg).toBeLessThan(0);
    expect(noon.illumination).toBeGreaterThan(0.9);
    expect(midnight.illumination).toBe(0);
  });

  it("gives seasons: the summer sun is higher than the winter sun at the same hour", () => {
    const latitude = 43.13;
    // Day 172 is around the June solstice; day 355 around December.
    const summer = sunAt(0.5, 172, latitude).elevationDeg;
    const winter = sunAt(0.5, 355, latitude).elevationDeg;
    expect(summer).toBeGreaterThan(winter + 30);
  });

  it("flips the seasons in the southern hemisphere", () => {
    const north = sunAt(0.5, 172, 43).elevationDeg - sunAt(0.5, 355, 43).elevationDeg;
    const south = sunAt(0.5, 172, -43).elevationDeg - sunAt(0.5, 355, -43).elevationDeg;
    expect(north).toBeGreaterThan(0);
    expect(south).toBeLessThan(0);
  });

  it("keeps the polar sun up all day at midsummer", () => {
    for (const fraction of [0, 0.25, 0.5, 0.75]) {
      expect(sunAt(fraction, 172, 85).elevationDeg).toBeGreaterThan(0);
    }
  });

  it("swings solar declination across the year within the axial tilt", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let day = 0; day < DAYS_PER_YEAR; day += 1) {
      const declination = solarDeclinationDeg(day);
      min = Math.min(min, declination);
      max = Math.max(max, declination);
    }
    expect(max).toBeGreaterThan(23);
    expect(min).toBeLessThan(-23);
    expect(max).toBeLessThanOrEqual(23.45);
  });

  it("keeps a little light after the sun sets rather than switching it off", () => {
    // Civil twilight: still lit a few degrees below the horizon.
    const justBelow = sunAt(0.5, 172, 22.3193);
    expect(justBelow.illumination).toBeGreaterThan(0);
    const deepNight = sunAt(0, 172, 22.3193);
    expect(deepNight.illumination).toBe(0);
  });

  it("cycles the moon through its phases", () => {
    expect(moonIlluminatedFraction(0)).toBeCloseTo(0, 5);
    // Half a synodic month later the moon is full.
    expect(moonIlluminatedFraction(14.765)).toBeGreaterThan(0.99);
    expect(moonPhase(0)).toBeCloseTo(0, 6);
    expect(moonPhase(29.530588)).toBeCloseTo(0, 4);
  });

  it("puts the full moon up when the sun is down", () => {
    // Fourteen and three quarter days in, the moon is full and opposite the sun.
    const midnight = moonAt(0, 172, 15, 22.3193);
    expect(midnight.elevationDeg).toBeGreaterThan(0);
    expect(midnight.illumination).toBeGreaterThan(0);
  });

  it("makes a moonlit night brighter than a new-moon night, but never like day", () => {
    const full = clearSkyLightLevel(sunAt(0, 172, 22.3), moonAt(0, 172, 15, 22.3));
    const none = clearSkyLightLevel(sunAt(0, 172, 22.3), moonAt(0, 172, 0, 22.3));
    const day = clearSkyLightLevel(sunAt(0.5, 172, 22.3), moonAt(0.5, 172, 15, 22.3));
    expect(full).toBeGreaterThan(none);
    expect(full).toBeLessThan(day * 0.5);
    expect(day).toBeCloseTo(1, 3);
  });
});
