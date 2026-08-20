import { describe, expect, it } from "vitest";
import { FixedStepClock, FIXED_STEP_MS } from "../../src/simulation/clock";

describe("FixedStepClock", () => {
  it("fires one step per accumulated fixed interval", () => {
    const clock = new FixedStepClock(FIXED_STEP_MS);
    const stepIndices: number[] = [];
    const steps = clock.tick(FIXED_STEP_MS, (i) => stepIndices.push(i));
    expect(steps).toBe(1);
    expect(stepIndices).toEqual([0]);
  });

  it("fires multiple steps when delta exceeds one interval", () => {
    const clock = new FixedStepClock(FIXED_STEP_MS);
    const stepIndices: number[] = [];
    const steps = clock.tick(FIXED_STEP_MS * 3, (i) => stepIndices.push(i));
    expect(steps).toBe(3);
    expect(stepIndices).toEqual([0, 1, 2]);
  });

  it("carries leftover time into interpolationAlpha", () => {
    const clock = new FixedStepClock(FIXED_STEP_MS);
    clock.tick(FIXED_STEP_MS * 1.5, () => {});
    expect(clock.interpolationAlpha).toBeCloseTo(0.5, 5);
  });

  it("clamps runaway deltas instead of queuing an unbounded catch-up burst", () => {
    const clock = new FixedStepClock(FIXED_STEP_MS, 5);
    let calls = 0;
    const steps = clock.tick(FIXED_STEP_MS * 1000, () => {
      calls += 1;
    });
    expect(steps).toBe(5);
    expect(calls).toBe(5);
    expect(clock.interpolationAlpha).toBeLessThanOrEqual(1);
  });

  it("advances totalSteps across multiple ticks and stays deterministic", () => {
    const clock = new FixedStepClock(FIXED_STEP_MS);
    for (let i = 0; i < 10; i += 1) clock.tick(FIXED_STEP_MS, () => {});
    expect(clock.totalSteps).toBe(10);
  });

  it("rejects a non-positive step size", () => {
    expect(() => new FixedStepClock(0)).toThrow();
    expect(() => new FixedStepClock(-5)).toThrow();
  });
});
