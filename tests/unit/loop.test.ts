import { describe, expect, it } from "vitest";
import { FIXED_STEP_MS } from "../../src/simulation/clock";
import { SimulationKernel } from "../../src/simulation/kernel";
import { MAX_FRAME_DELTA_MS, SimulationLoop } from "../../src/simulation/loop";

function makeLoop() {
  const kernel = new SimulationKernel({ seed: 1 });
  return { kernel, loop: new SimulationLoop(kernel) };
}

describe("SimulationLoop transport controls", () => {
  it("runs ticks from render deltas while running", () => {
    const { kernel, loop } = makeLoop();
    expect(loop.advance(FIXED_STEP_MS)).toBe(1);
    expect(kernel.tick).toBe(1);
  });

  it("runs no ticks while paused, and resumes cleanly", () => {
    const { kernel, loop } = makeLoop();
    loop.pause();
    expect(loop.isPaused).toBe(true);
    expect(loop.advance(FIXED_STEP_MS * 4)).toBe(0);
    expect(kernel.tick).toBe(0);

    loop.resume();
    expect(loop.advance(FIXED_STEP_MS)).toBe(1);
    expect(kernel.tick).toBe(1);
  });

  it("single-steps exactly one tick while paused", () => {
    const { kernel, loop } = makeLoop();
    loop.pause();

    loop.requestSingleStep();
    expect(loop.advance(0)).toBe(1);
    expect(kernel.tick).toBe(1);

    // The request is consumed, not sticky.
    expect(loop.advance(FIXED_STEP_MS * 10)).toBe(0);
    expect(kernel.tick).toBe(1);
  });

  it("slow motion runs fewer ticks per render second than normal speed", () => {
    const normal = makeLoop();
    const slow = makeLoop();
    slow.loop.timeScale = 0.25;

    for (let frame = 0; frame < 60; frame += 1) {
      normal.loop.advance(FIXED_STEP_MS);
      slow.loop.advance(FIXED_STEP_MS);
    }

    expect(slow.kernel.tick).toBeGreaterThan(0);
    expect(slow.kernel.tick).toBeLessThan(normal.kernel.tick);
  });

  it("fast forward runs more ticks per render second than normal speed", () => {
    const normal = makeLoop();
    const fast = makeLoop();
    fast.loop.timeScale = 2;

    for (let frame = 0; frame < 60; frame += 1) {
      normal.loop.advance(FIXED_STEP_MS);
      fast.loop.advance(FIXED_STEP_MS);
    }

    expect(fast.kernel.tick).toBeGreaterThan(normal.kernel.tick);
  });

  it("rejects a non-positive or non-finite time scale", () => {
    const { loop } = makeLoop();
    expect(() => (loop.timeScale = 0)).toThrow(/positive/);
    expect(() => (loop.timeScale = -1)).toThrow(/positive/);
    expect(() => (loop.timeScale = Number.NaN)).toThrow(/positive/);
  });

  it("togglePause flips run state", () => {
    const { loop } = makeLoop();
    loop.togglePause();
    expect(loop.isPaused).toBe(true);
    loop.togglePause();
    expect(loop.isPaused).toBe(false);
  });
});

describe("SimulationLoop catch-up safety", () => {
  it("caps the work from one enormous delta after tab suspension", () => {
    const { kernel, loop } = makeLoop();
    // Ten minutes of wall clock, as a returning background tab reports it.
    const steps = loop.advance(600_000);
    expect(steps).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_DELTA_MS / FIXED_STEP_MS));
    expect(kernel.tick).toBe(steps);
  });

  it("does not spiral: the frame after a huge delta costs a normal number of ticks", () => {
    const { loop } = makeLoop();
    loop.advance(600_000);

    const followUp = loop.advance(FIXED_STEP_MS);
    expect(followUp).toBeLessThanOrEqual(2);
  });

  it("stays bounded across repeated suspensions", () => {
    const { kernel, loop } = makeLoop();
    for (let i = 0; i < 10; i += 1) loop.advance(600_000);
    // Without a cap this would be ~360,000 ticks.
    expect(kernel.tick).toBeLessThan(200);
  });

  it("ignores negative deltas rather than rewinding", () => {
    const { kernel, loop } = makeLoop();
    expect(loop.advance(-1000)).toBe(0);
    expect(kernel.tick).toBe(0);
  });
});
