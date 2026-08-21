import { describe, expect, it } from "vitest";
import { FloatingOrigin, rebaseLocal } from "../../src/world/floatingOrigin";
import { geo, localToGeo, surfaceDistanceMeters, type GeoPosition } from "../../src/world/coordinates";

const HONG_KONG = geo(22.3193, 114.1694);

function makeOrigin(thresholdMeters = 2000): FloatingOrigin {
  return new FloatingOrigin({ anchor: HONG_KONG, thresholdMeters });
}

describe("floating origin basics", () => {
  it("starts at its anchor with the anchor at the local origin", () => {
    const origin = makeOrigin();
    const local = origin.toLocal(HONG_KONG);
    expect(Math.hypot(local.east, local.north, local.up)).toBeLessThan(1e-6);
    expect(origin.rebases).toBe(0);
  });

  it("round-trips a local position back to the same global one", () => {
    const origin = makeOrigin();
    const target = origin.toGeo({ east: 750, north: -320, up: 40 });
    const back = origin.toLocal(target);
    expect(back.east).toBeCloseTo(750, 6);
    expect(back.north).toBeCloseTo(-320, 6);
    expect(back.up).toBeCloseTo(40, 6);
  });

  it("rejects a threshold that is not a positive number", () => {
    expect(() => new FloatingOrigin({ anchor: HONG_KONG, thresholdMeters: 0 })).toThrow(/positive/);
    expect(() => new FloatingOrigin({ anchor: HONG_KONG, thresholdMeters: -5 })).toThrow(/positive/);
    expect(() => new FloatingOrigin({ anchor: HONG_KONG, thresholdMeters: Number.NaN })).toThrow(/finite/);
  });
});

describe("rebasing", () => {
  it("holds the anchor until the threshold is crossed", () => {
    const origin = makeOrigin(2000);
    const inside = origin.toGeo({ east: 1500, north: 0, up: 0 });

    expect(origin.needsRebase(inside)).toBe(false);
    expect(origin.update(inside)).toBeNull();
    expect(origin.rebases).toBe(0);
    expect(origin.anchor).toEqual(HONG_KONG);
  });

  it("rebases once the threshold is crossed and reports the shift", () => {
    const origin = makeOrigin(2000);
    const beyond = origin.toGeo({ east: 2500, north: 0, up: 0 });

    const event = origin.update(beyond);
    expect(event).not.toBeNull();
    expect(origin.rebases).toBe(1);
    expect(event?.shift.east).toBeCloseTo(2500, 3);
    expect(event?.distanceMeters).toBeGreaterThanOrEqual(2000);
  });

  it("leaves the moving object exactly where it was in world terms", () => {
    const origin = makeOrigin(2000);
    const target = origin.toGeo({ east: 3000, north: 1200, up: 0 });

    const event = origin.update(target);
    expect(event).not.toBeNull();

    // The whole point: the position on the globe is untouched by a rebase.
    const afterLocal = origin.toLocal(target);
    expect(Math.hypot(afterLocal.east, afterLocal.north)).toBeLessThan(1e-6);
    expect(surfaceDistanceMeters(origin.toGeo(afterLocal), target)).toBeLessThan(1e-6);
  });

  it("shifts a bystander by exactly the amount the renderer is told to apply", () => {
    const origin = makeOrigin(2000);
    // A second object sitting still while the player walks away from it.
    const bystander = origin.toGeo({ east: 100, north: 50, up: 0 });
    const bystanderBefore = origin.toLocal(bystander);

    const walker = origin.toGeo({ east: 4000, north: 0, up: 0 });
    const event = origin.update(walker);
    expect(event).not.toBeNull();

    const predicted = rebaseLocal(bystanderBefore, event!);
    const actual = origin.toLocal(bystander);

    // If these disagreed, every cached node would pop by the difference.
    expect(predicted.east).toBeCloseTo(actual.east, 3);
    expect(predicted.north).toBeCloseTo(actual.north, 3);
    expect(predicted.up).toBeCloseTo(actual.up, 3);
  });

  it("keeps local coordinates small across a long walk, which is why it exists", () => {
    const origin = makeOrigin(2000);
    let position: GeoPosition = HONG_KONG;
    let worstMagnitude = 0;

    // Walk 60 km east in 500 m steps, rebasing as needed.
    for (let step = 0; step < 120; step += 1) {
      position = localToGeo(origin.anchor, {
        ...origin.toLocal(position),
        east: origin.toLocal(position).east + 500,
      });
      origin.update(position);
      const local = origin.toLocal(position);
      worstMagnitude = Math.max(worstMagnitude, Math.hypot(local.east, local.north));
    }

    expect(origin.rebases).toBeGreaterThan(10);
    // Without rebasing this would have reached 60,000 and started to wobble.
    expect(worstMagnitude).toBeLessThan(2600);
  });

  it("forces a rebase for a teleport even when the threshold was not reached", () => {
    const origin = makeOrigin(100_000);
    const nearby = origin.toGeo({ east: 10, north: 0, up: 0 });

    expect(origin.needsRebase(nearby)).toBe(false);
    const event = origin.forceRebase(nearby);
    expect(origin.rebases).toBe(1);
    expect(event.shift.east).toBeCloseTo(10, 6);
  });

  it("normalises the anchor so a wrapped longitude cannot creep in", () => {
    const origin = new FloatingOrigin({ anchor: geo(0, 190) });
    expect(origin.anchor.longitudeDeg).toBeCloseTo(-170, 9);
  });
});
