import { FixedStepClock, FIXED_STEP_MS } from "./clock";
import type { SimulationKernel } from "./kernel";

/**
 * Longest render delta the loop will believe. A backgrounded tab reports one
 * enormous delta on return; feeding that straight into the accumulator queues
 * thousands of catch-up ticks, each slowing the next frame — the spiral of
 * death. Simulation time is allowed to fall behind wall clock instead.
 */
export const MAX_FRAME_DELTA_MS = 250;

export const TIME_SCALE_PRESETS = [0.25, 0.5, 1, 2] as const;

export class SimulationLoop {
  private readonly clock: FixedStepClock;
  private paused = false;
  private scale = 1;
  private pendingSingleSteps = 0;

  constructor(
    private readonly kernel: SimulationKernel,
    clock: FixedStepClock = new FixedStepClock(FIXED_STEP_MS),
  ) {
    this.clock = clock;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get timeScale(): number {
    return this.scale;
  }

  set timeScale(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`timeScale must be a positive finite number, got ${value}`);
    }
    this.scale = value;
  }

  get interpolationAlpha(): number {
    return this.clock.interpolationAlpha;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  /** Queues exactly one tick, executed on the next `advance` even while paused. */
  requestSingleStep(): void {
    this.pendingSingleSteps += 1;
  }

  /**
   * Converts a render-frame delta into zero or more fixed simulation ticks.
   * Returns how many ticks ran.
   */
  advance(renderDeltaMs: number): number {
    if (this.pendingSingleSteps > 0) {
      const steps = this.pendingSingleSteps;
      this.pendingSingleSteps = 0;
      for (let i = 0; i < steps; i += 1) this.kernel.step();
      return steps;
    }

    if (this.paused) return 0;

    const safeDelta = Math.min(Math.max(0, renderDeltaMs), MAX_FRAME_DELTA_MS);
    return this.clock.tick(safeDelta * this.scale, () => this.kernel.step());
  }
}
