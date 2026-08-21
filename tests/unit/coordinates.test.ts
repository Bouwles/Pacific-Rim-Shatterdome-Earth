import { describe, expect, it } from "vitest";
import {
  EARTH_SCALE,
  WORLD_RADIUS_METERS,
  ecefToGeo,
  geo,
  geoToEcef,
  geoToLocal,
  localToGeo,
  normalizeGeo,
  normalizeLongitude,
  straightDistanceMeters,
  surfaceDistanceMeters,
  validateGeoPosition,
} from "../../src/world/coordinates";

const HONG_KONG = geo(22.3193, 114.1694);
const SYDNEY = geo(-33.8688, 151.2093);
const TOKYO = geo(35.6762, 139.6503);
const ANCHORAGE = geo(61.2181, -149.9003);
const MANILA = geo(14.5995, 120.9842);
const ALL = [HONG_KONG, SYDNEY, TOKYO, ANCHORAGE, MANILA];

/** Tightest bound the round trip must hold to, in metres. */
const ROUND_TRIP_TOLERANCE_METERS = 1e-6;

describe("geodetic and ECEF round trips", () => {
  it("returns the same position after a geo to ECEF to geo cycle", () => {
    for (const position of ALL) {
      const back = ecefToGeo(geoToEcef(position));
      expect(back.latitudeDeg).toBeCloseTo(position.latitudeDeg, 9);
      expect(back.longitudeDeg).toBeCloseTo(position.longitudeDeg, 9);
      expect(back.altitudeMeters).toBeCloseTo(position.altitudeMeters, 6);
    }
  });

  it("preserves altitude through the cycle", () => {
    const raised = geo(22.3193, 114.1694, 1234.5);
    const back = ecefToGeo(geoToEcef(raised));
    expect(back.altitudeMeters).toBeCloseTo(1234.5, 6);
  });

  it("places the poles and the equator where they belong", () => {
    expect(geoToEcef(geo(90, 0)).y).toBeCloseTo(WORLD_RADIUS_METERS, 6);
    expect(geoToEcef(geo(-90, 0)).y).toBeCloseTo(-WORLD_RADIUS_METERS, 6);
    expect(geoToEcef(geo(0, 0)).x).toBeCloseTo(WORLD_RADIUS_METERS, 6);
    expect(geoToEcef(geo(0, 90)).z).toBeCloseTo(WORLD_RADIUS_METERS, 6);
  });
});

describe("tangent plane round trips", () => {
  it("puts the anchor itself at the local origin", () => {
    for (const anchor of ALL) {
      const local = geoToLocal(anchor, anchor);
      expect(Math.hypot(local.east, local.north, local.up)).toBeLessThan(ROUND_TRIP_TOLERANCE_METERS);
    }
  });

  it("bounds conversion error over a grid of nearby offsets", () => {
    let worstError = 0;
    for (const anchor of ALL) {
      for (const east of [-2000, -500, 0, 500, 2000]) {
        for (const north of [-2000, -500, 0, 500, 2000]) {
          for (const up of [0, 250]) {
            const target = localToGeo(anchor, { east, north, up });
            const back = geoToLocal(anchor, target);
            worstError = Math.max(worstError, Math.hypot(back.east - east, back.north - north, back.up - up));
          }
        }
      }
    }
    // Sub-micron over the whole active bubble: far below anything gameplay can see.
    expect(worstError).toBeLessThan(ROUND_TRIP_TOLERANCE_METERS);
  });

  it("keeps error bounded even far outside the active bubble", () => {
    const target = localToGeo(HONG_KONG, { east: 60_000, north: -40_000, up: 900 });
    const back = geoToLocal(HONG_KONG, target);
    expect(Math.hypot(back.east - 60_000, back.north + 40_000, back.up - 900)).toBeLessThan(1e-4);
  });

  it("orients east, north and up the way their names claim", () => {
    const anchor = geo(0, 0);
    // A point slightly further east must have positive east and near-zero north.
    const east = geoToLocal(anchor, geo(0, 0.01));
    expect(east.east).toBeGreaterThan(0);
    expect(Math.abs(east.north)).toBeLessThan(1);

    const north = geoToLocal(anchor, geo(0.01, 0));
    expect(north.north).toBeGreaterThan(0);
    expect(Math.abs(north.east)).toBeLessThan(1);

    const up = geoToLocal(anchor, geo(0, 0, 500));
    expect(up.up).toBeCloseTo(500, 6);
  });

  it("survives the date line without a discontinuity", () => {
    const west = geo(0, 179.999);
    const east = geo(0, -179.999);
    // Two points a fraction of a degree apart must stay a short distance apart.
    expect(surfaceDistanceMeters(west, east)).toBeLessThan(1000);
    const local = geoToLocal(west, east);
    expect(Math.abs(local.east)).toBeLessThan(1000);
  });

  it("survives working right at a pole", () => {
    const anchor = geo(89.999, 0);
    const target = localToGeo(anchor, { east: 100, north: 100, up: 0 });
    const back = geoToLocal(anchor, target);
    expect(back.east).toBeCloseTo(100, 4);
    expect(back.north).toBeCloseTo(100, 4);
  });
});

describe("distances", () => {
  it("scales with the miniature globe rather than the real one", () => {
    // Hong Kong to Tokyo is about 2,890 km on the real Earth.
    const realKm = 2890;
    const measuredKm = surfaceDistanceMeters(HONG_KONG, TOKYO) / 1000;
    expect(measuredKm).toBeGreaterThan(realKm * EARTH_SCALE * 0.9);
    expect(measuredKm).toBeLessThan(realKm * EARTH_SCALE * 1.1);
  });

  it("is zero for a position against itself and symmetric between two", () => {
    expect(surfaceDistanceMeters(TOKYO, TOKYO)).toBeCloseTo(0, 9);
    expect(surfaceDistanceMeters(TOKYO, SYDNEY)).toBeCloseTo(surfaceDistanceMeters(SYDNEY, TOKYO), 6);
  });

  it("reports antipodes as half the circumference", () => {
    const half = Math.PI * WORLD_RADIUS_METERS;
    expect(surfaceDistanceMeters(geo(0, 0), geo(0, 180))).toBeCloseTo(half, 3);
  });

  it("cuts through the globe for straight-line distance", () => {
    // A chord is always shorter than the arc it subtends, except at zero.
    expect(straightDistanceMeters(HONG_KONG, SYDNEY)).toBeLessThan(surfaceDistanceMeters(HONG_KONG, SYDNEY));
  });
});

describe("normalisation and validation", () => {
  it("wraps longitude into a single continuous range", () => {
    expect(normalizeLongitude(190)).toBeCloseTo(-170, 9);
    expect(normalizeLongitude(-190)).toBeCloseTo(170, 9);
    expect(normalizeLongitude(540)).toBeCloseTo(180 - 360, 9);
    expect(normalizeLongitude(45)).toBeCloseTo(45, 9);
  });

  it("clamps latitude rather than wrapping it", () => {
    expect(normalizeGeo(geo(120, 0)).latitudeDeg).toBe(90);
    expect(normalizeGeo(geo(-120, 0)).latitudeDeg).toBe(-90);
  });

  it("rejects out-of-range and non-finite values with an actionable message", () => {
    expect(validateGeoPosition(geo(91, 0)).join(" ")).toMatch(/latitudeDeg/);
    expect(validateGeoPosition(geo(0, 181)).join(" ")).toMatch(/longitudeDeg/);
    expect(validateGeoPosition(geo(0, 0, Number.NaN)).join(" ")).toMatch(/altitudeMeters/);
    expect(validateGeoPosition(HONG_KONG)).toEqual([]);
  });
});
