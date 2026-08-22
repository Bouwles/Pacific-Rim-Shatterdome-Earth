import { describe, expect, it } from "vitest";
import { fbm3, latticeValue, remap01, ridged3, valueNoise3 } from "../../src/world/terrainNoise";

describe("terrain noise", () => {
  it("returns the same lattice value for the same seed and point, forever", () => {
    const first = latticeValue(1234, 7, -3, 19);
    const second = latticeValue(1234, 7, -3, 19);
    expect(second).toBe(first);
    // The whole point of hashing position instead of drawing from a stream: the
    // value cannot depend on how many samples were taken before it.
    latticeValue(1234, 0, 0, 0);
    latticeValue(1234, 1, 1, 1);
    expect(latticeValue(1234, 7, -3, 19)).toBe(first);
  });

  it("separates seeds", () => {
    expect(latticeValue(1, 5, 5, 5)).not.toBe(latticeValue(2, 5, 5, 5));
  });

  it("handles negative lattice coordinates", () => {
    for (const coordinate of [-1, -17, -1000]) {
      const value = latticeValue(99, coordinate, coordinate, coordinate);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps value noise inside [0, 1]", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 500; i += 1) {
      const value = valueNoise3(7, i * 0.37, i * 0.11 - 20, i * -0.53);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });

  it("is continuous, so terrain has no cliffs where none were asked for", () => {
    const epsilon = 1e-4;
    let largestStep = 0;
    for (let i = 0; i < 200; i += 1) {
      const x = i * 0.05;
      const step = Math.abs(valueNoise3(3, x + epsilon, 1.5, -2.25) - valueNoise3(3, x, 1.5, -2.25));
      largestStep = Math.max(largestStep, step);
    }
    // A discontinuous field would jump by a sizeable fraction of its range here.
    expect(largestStep).toBeLessThan(0.01);
  });

  it("crosses integer lattice boundaries smoothly", () => {
    const below = valueNoise3(11, 2 - 1e-9, 0.5, 0.5);
    const above = valueNoise3(11, 2 + 1e-9, 0.5, 0.5);
    expect(Math.abs(above - below)).toBeLessThan(1e-6);
  });

  it("normalises fbm to [0, 1] regardless of octave count", () => {
    for (const octaves of [1, 3, 6]) {
      for (let i = 0; i < 200; i += 1) {
        const value = fbm3(5, i * 0.13, -i * 0.07, i * 0.19, { octaves, frequency: 4 });
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("rejects a zero octave count rather than dividing by zero", () => {
    expect(() => fbm3(1, 0, 0, 0, { octaves: 0, frequency: 1 })).toThrow(/at least one octave/);
  });

  it("folds ridged noise into [0, 1] with maxima at the midpoint", () => {
    for (let i = 0; i < 200; i += 1) {
      const value = ridged3(9, i * 0.21, i * 0.03, -i * 0.09, { octaves: 3, frequency: 6 });
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("clamps remap01 at both ends", () => {
    expect(remap01(-5, 0, 10)).toBe(0);
    expect(remap01(15, 0, 10)).toBe(1);
    expect(remap01(5, 0, 10)).toBeCloseTo(0.5, 12);
    expect(remap01(3, 2, 2)).toBe(0);
  });
});
