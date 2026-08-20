export const FIXED_STEP_MS = 1000 / 60;
const DEFAULT_MAX_SUBSTEPS = 5;
// Guards exact-multiple deltas (e.g. 3 * (1000/60)) from losing a step to float rounding.
const EPSILON_MS = 1e-9;

/**
 * Accumulator-pattern fixed step clock. Authoritative simulation ticks run at
 * a constant rate regardless of render framerate; rendering reads
 * `interpolationAlpha` to blend between the last two simulated states.
 */
export class FixedStepClock {
  private accumulatorMs = 0;
  private stepCount = 0;

  constructor(
    private readonly stepMs: number = FIXED_STEP_MS,
    private readonly maxSubSteps: number = DEFAULT_MAX_SUBSTEPS,
  ) {
    if (stepMs <= 0) throw new Error("stepMs must be > 0");
    if (maxSubSteps <= 0) throw new Error("maxSubSteps must be > 0");
  }

  /** Advances the accumulator by deltaMs, invoking onStep once per fixed step. Returns steps taken. */
  tick(deltaMs: number, onStep: (stepIndex: number) => void): number {
    this.accumulatorMs += Math.max(0, deltaMs);
    let steps = 0;
    while (this.accumulatorMs >= this.stepMs - EPSILON_MS && steps < this.maxSubSteps) {
      onStep(this.stepCount);
      this.stepCount += 1;
      this.accumulatorMs -= this.stepMs;
      steps += 1;
    }
    if (steps === this.maxSubSteps) {
      // A stalled tab/huge delta could otherwise queue an unbounded catch-up burst next tick.
      this.accumulatorMs = Math.min(this.accumulatorMs, this.stepMs);
    }
    return steps;
  }

  get interpolationAlpha(): number {
    return this.accumulatorMs / this.stepMs;
  }

  get totalSteps(): number {
    return this.stepCount;
  }
}
