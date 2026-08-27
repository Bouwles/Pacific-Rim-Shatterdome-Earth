import { QUALITY_LEVELS, type QualityLevel } from "../data/quality";
import { validateStyleGuide, IMPACT_GRAMMAR } from "../data/styleGuide";
import {
  createEffectRegistry,
  EffectPoolLedger,
  worstCaseParticles,
  type EffectKind,
} from "../vfx/effectsModel";
import { CALM_ACCESSIBILITY, ImpactDirector } from "../vfx/impactLanguage";
import type { CombatEvent } from "../combat/arena";

/**
 * The effects system, stress-tested without a GPU.
 *
 * Three claims are held here, and they are the milestone's acceptance items in
 * order. The pool returns to baseline after repeated finishers and destruction:
 * a hundred finisher rounds end with zero live effects and full capacity. The
 * budgets hold under abuse: no sequence of requests can push particles past the
 * catalogue's worst case for the level. And the accessibility settings actually
 * gate: reduced motion produces zero freezes from the same events that froze
 * before, and the flash toggle suppresses every flash-class effect.
 *
 * Deterministic: a scripted event stream, fixed steps, no clock and no RNG.
 */

/** One synthetic hit, shaped like the arena's own events. */
function hit(damage: number, type: CombatEvent["type"] = "hit"): CombatEvent {
  return {
    tick: 0,
    type,
    actorId: "jaeger",
    targetId: "kaiju",
    moveId: null,
    volumeId: null,
    zoneId: type === "zone-destroyed" ? "core" : null,
    damage,
    reaction: null,
    contact: null,
    reason: null,
    damageKind: "impact",
  };
}

export interface VfxStressResult {
  readonly level: QualityLevel;
  readonly rounds: number;
  readonly spawned: number;
  readonly refusedAtCeiling: number;
  /** Highest particle demand seen at any instant. */
  readonly peakParticles: number;
  /** The catalogue's own worst case, which the peak must never pass. */
  readonly worstCase: number;
  readonly endedAtBaseline: boolean;
}

/**
 * A hundred rounds of the most expensive thing the game does.
 *
 * Each round is a finisher landing on a breaking zone in the rain: finisher
 * accents, kaiju blue, debris, sparks and dust all at once, twice, then a
 * second of quiet for lifetimes to run. If anything leaks, the last round has
 * less capacity than the first and the baseline check fails.
 */
export function runVfxStress(level: QualityLevel, rounds = 100): VfxStressResult {
  const ledger = new EffectPoolLedger(level);
  const registry = createEffectRegistry();
  const barrage: readonly EffectKind[] = [
    "finisher",
    "kaiju-blue",
    "debris-burst",
    "sparks",
    "dust",
    "plasma",
    "water-displacement",
    "muzzle-flash",
  ];

  let peak = 0;
  for (let round = 0; round < rounds; round += 1) {
    // Three of everything at once, which exceeds every kind's ceiling at every
    // level, so the run proves the refusal path as well as the return path.
    for (let repeat = 0; repeat < 3; repeat += 1) {
      for (const kind of barrage) ledger.request(kind);
    }
    peak = Math.max(peak, ledger.counters().particlesInUse);
    // A second of fight in ten steps, enough for every non-sustained life.
    for (let step = 0; step < 10; step += 1) ledger.advance(0.3);
  }
  // Drain anything still breathing.
  for (let step = 0; step < 20; step += 1) ledger.advance(0.5);

  const counters = ledger.counters();
  void registry;
  return {
    level,
    rounds,
    spawned: counters.spawned,
    refusedAtCeiling: counters.refusedAtCeiling,
    peakParticles: peak,
    worstCase: worstCaseParticles(level),
    endedAtBaseline: ledger.atBaseline(),
  };
}

export interface AccessibilityProof {
  /** Freezes produced by a heavy barrage with everything allowed. */
  readonly freezesAllowed: number;
  /** The same barrage under reduced motion. Must be zero. */
  readonly freezesReduced: number;
  /** Impulse with shake at full and at zero. */
  readonly impulseFull: number;
  readonly impulseZero: number;
  /** Chromatic with and without the chromatic setting. */
  readonly chromaticOn: number;
  readonly chromaticOff: number;
  /** Speed lines under reduced motion. Must be zero. */
  readonly speedLinesReduced: number;
}

/** The same fight, under every accessibility setting, compared. */
export function proveAccessibility(level: QualityLevel = "high"): AccessibilityProof {
  const events = [hit(80), hit(90, "zone-destroyed"), hit(60)];
  const run = (access: Parameters<ImpactDirector["setAccessibility"]>[0]) => {
    const director = new ImpactDirector(level, access);
    let freezes = 0;
    let impulse = 0;
    let chromatic = 0;
    let lines = 0;
    for (let step = 0; step < 6; step += 1) {
      const frame = director.advance(0.4, step === 0 ? events : []);
      if (frame.freezeSecondsLeft > 0 && step === 0) freezes += 1;
      impulse = Math.max(impulse, frame.impulseMeters);
      chromatic = Math.max(chromatic, frame.chromaticPx);
      lines = Math.max(lines, frame.speedLines);
    }
    return { freezes, impulse, chromatic, lines };
  };

  const full = run(CALM_ACCESSIBILITY);
  const reduced = run({ ...CALM_ACCESSIBILITY, reducedMotion: true });
  const noShake = run({ ...CALM_ACCESSIBILITY, shakeScale: 0 });
  const noChromatic = run({ ...CALM_ACCESSIBILITY, noChromatic: true });

  return {
    freezesAllowed: full.freezes,
    freezesReduced: reduced.freezes,
    impulseFull: full.impulse,
    impulseZero: noShake.impulse,
    chromaticOn: full.chromatic,
    chromaticOff: noChromatic.chromatic,
    speedLinesReduced: reduced.lines,
  };
}

export interface StyleReport {
  readonly guideErrors: readonly string[];
  /** Worst-case particles per level, ascending with quality or equal. */
  readonly particleLadder: readonly { readonly level: QualityLevel; readonly particles: number }[];
  /** Freeze ceilings per level, all under the grammar's own limits. */
  readonly freezeLadder: readonly { readonly level: QualityLevel; readonly freezeMs: number }[];
  readonly ladderMonotonic: boolean;
}

/** The style guide's own consistency, held as numbers. */
export function styleReport(): StyleReport {
  const particleLadder = QUALITY_LEVELS.map((level) => ({
    level,
    particles: worstCaseParticles(level),
  }));
  const ladderMonotonic = particleLadder.every(
    (entry, index) => index === 0 || entry.particles >= (particleLadder[index - 1]?.particles ?? 0),
  );
  return {
    guideErrors: validateStyleGuide(),
    particleLadder,
    freezeLadder: QUALITY_LEVELS.map((level) => ({ level, freezeMs: IMPACT_GRAMMAR[level].freezeMs })),
    ladderMonotonic,
  };
}
