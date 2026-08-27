import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityLevel } from "./quality";

/**
 * The performance contract, written as numbers a report can be held to.
 *
 * Quality presets (quality.ts) say what each level is allowed to *build*:
 * particle capacities, city ceilings, pool sizes. This file says what a frame
 * is allowed to *cost* once it is built, and on what hardware that promise is
 * made. The two are validated against each other, so a preset cannot quietly
 * outgrow its own frame budget.
 *
 * The hardware assumptions are stated because a budget without a machine is a
 * wish. Low is promised on integrated graphics from roughly 2018 onward;
 * Medium on entry discrete or strong integrated parts; High on a mid-range
 * discrete GPU; Cinematic on whatever is happy to spend the frames. All of it
 * assumes a desktop browser with WebGPU or WebGL2 and four hardware threads.
 *
 * Two numbers matter more than the averages, and the acceptance names them:
 * the long-frame threshold, because a smooth average full of 80 ms spikes is
 * a bad game that benchmarks well, and memory, because a frame budget met by
 * leaking is a countdown.
 */

export interface PerfBudget {
  readonly level: QualityLevel;
  /** What this promise is made on, in words. */
  readonly hardware: string;
  /** Frame time the level aims for, milliseconds. */
  readonly frameMs: number;
  /** A frame past this is a long frame and is captured with its breakdown. */
  readonly longFrameMs: number;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
  /** Live textures in the scene, render targets included. */
  readonly maxTextures: number;
  /** Shadow map edge, so the report can cross-check the preset. */
  readonly shadowMapSize: number;
  /** Rigid bodies simulated at once: debris plus projectiles. */
  readonly maxActiveBodies: number;
  /** AI-driven agents thinking at once: creatures, allies, city agents. */
  readonly maxAiAgents: number;
  /** Live particles, shared with the preset's own ceiling. */
  readonly maxParticles: number;
  /** Debris bodies, shared with the preset's pool size. */
  readonly maxDebris: number;
  /** Sustained audio voices, shared with the sound stage's cap. */
  readonly maxAudioVoices: number;
  /** Resident sector memory, megabytes: geometry, water sheets, city meshes. */
  readonly maxSectorMemoryMB: number;
}

export const PERF_BUDGETS: Readonly<Record<QualityLevel, PerfBudget>> = {
  low: {
    level: "low",
    hardware: "Integrated graphics from about 2018, four threads, WebGL2 or WebGPU.",
    frameMs: 33.3,
    longFrameMs: 80,
    maxDrawCalls: 220,
    maxTriangles: 900_000,
    maxTextures: 90,
    shadowMapSize: 0,
    maxActiveBodies: 108,
    maxAiAgents: 240,
    maxParticles: 600,
    maxDebris: 60,
    maxAudioVoices: 48,
    maxSectorMemoryMB: 180,
  },
  medium: {
    level: "medium",
    hardware: "Entry discrete or strong integrated graphics, four threads.",
    frameMs: 16.7,
    longFrameMs: 60,
    maxDrawCalls: 380,
    maxTriangles: 2_200_000,
    maxTextures: 140,
    shadowMapSize: 1024,
    maxActiveBodies: 236,
    maxAiAgents: 640,
    maxParticles: 2_000,
    maxDebris: 140,
    maxAudioVoices: 48,
    maxSectorMemoryMB: 320,
  },
  high: {
    level: "high",
    hardware: "Mid-range discrete GPU, six threads.",
    frameMs: 16.7,
    longFrameMs: 50,
    maxDrawCalls: 650,
    maxTriangles: 5_000_000,
    maxTextures: 220,
    shadowMapSize: 2048,
    maxActiveBodies: 440,
    maxAiAgents: 1_520,
    maxParticles: 6_000,
    maxDebris: 260,
    maxAudioVoices: 48,
    maxSectorMemoryMB: 560,
  },
  cinematic: {
    level: "cinematic",
    hardware: "Upper mid-range discrete GPU or better. Frames are for spending.",
    frameMs: 16.7,
    longFrameMs: 50,
    maxDrawCalls: 1_000,
    maxTriangles: 9_000_000,
    maxTextures: 320,
    shadowMapSize: 4096,
    maxActiveBodies: 740,
    maxAiAgents: 3_620,
    maxParticles: 16_000,
    maxDebris: 420,
    maxAudioVoices: 48,
    maxSectorMemoryMB: 900,
  },
};

/**
 * The contract's own consistency.
 *
 * The ladder must be monotonic, and where a budget names the same thing a
 * quality preset builds, the two must agree: a preset allowed to allocate more
 * debris than its budget simulates would be a promise broken at construction.
 */
export function validatePerfBudgets(): string[] {
  const errors: string[] = [];
  const order = QUALITY_LEVELS;

  for (let index = 1; index < order.length; index += 1) {
    const lower = PERF_BUDGETS[order[index - 1]!];
    const upper = PERF_BUDGETS[order[index]!];
    for (const key of [
      "maxDrawCalls",
      "maxTriangles",
      "maxTextures",
      "maxActiveBodies",
      "maxAiAgents",
      "maxParticles",
      "maxDebris",
      "maxSectorMemoryMB",
    ] as const) {
      if (lower[key] > upper[key]) {
        errors.push(`${lower.level} allows more ${key} than ${upper.level}: the ladder is inverted`);
      }
    }
    if (lower.longFrameMs < upper.longFrameMs) {
      errors.push(`${lower.level} tolerates shorter long frames than ${upper.level}`);
    }
  }

  for (const preset of QUALITY_PRESETS) {
    const budget = PERF_BUDGETS[preset.id];
    if (preset.maxParticles > budget.maxParticles) {
      errors.push(`${preset.id}: preset builds ${preset.maxParticles} particles over its budget`);
    }
    if (preset.maxDebrisBodies > budget.maxDebris) {
      errors.push(`${preset.id}: preset pools ${preset.maxDebrisBodies} debris over its budget`);
    }
    if (preset.shadowMapSize !== budget.shadowMapSize) {
      errors.push(`${preset.id}: preset shadow map ${preset.shadowMapSize} disagrees with the budget`);
    }
    if (preset.maxDebrisBodies + preset.maxProjectiles > budget.maxActiveBodies) {
      errors.push(`${preset.id}: debris plus projectiles exceed the active-body budget`);
    }
    if (preset.maxCityAgents > budget.maxAiAgents) {
      errors.push(`${preset.id}: city agents alone exceed the AI budget`);
    }
    if (budget.hardware.trim().length < 12) {
      errors.push(`${preset.id}: a budget must say what hardware it is promised on`);
    }
  }
  return errors;
}

export function budgetFor(level: QualityLevel): PerfBudget {
  return PERF_BUDGETS[level];
}
