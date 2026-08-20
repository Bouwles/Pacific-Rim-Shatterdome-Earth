import { describe, expect, it } from "vitest";
import { createSeededRng, rngInt } from "../../src/simulation/rng";

describe("createSeededRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays within [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("rngInt", () => {
  it("stays within [min, max)", () => {
    const rng = createSeededRng(99);
    for (let i = 0; i < 500; i += 1) {
      const v = rngInt(rng, 3, 10);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("rejects an empty or inverted range", () => {
    const rng = createSeededRng(1);
    expect(() => rngInt(rng, 5, 5)).toThrow();
    expect(() => rngInt(rng, 5, 2)).toThrow();
  });
});
