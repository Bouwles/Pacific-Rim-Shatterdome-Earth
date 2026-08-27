import { describe, expect, it } from "vitest";
import { proveAccessibility, runVfxStress, styleReport } from "../../src/debug/vfxScenario";
import { CALM_ACCESSIBILITY, ImpactDirector } from "../../src/vfx/impactLanguage";
import { IMPACT_GRAMMAR } from "../../src/data/styleGuide";
import type { CombatEvent } from "../../src/combat/arena";

function hit(damage: number, type: CombatEvent["type"] = "hit"): CombatEvent {
  return {
    tick: 0,
    type,
    actorId: "jaeger",
    targetId: "kaiju",
    moveId: null,
    volumeId: null,
    zoneId: null,
    damage,
    reaction: null,
    contact: null,
    reason: null,
    damageKind: "impact",
  };
}

describe("the stress run", () => {
  for (const level of ["low", "medium", "high", "cinematic"] as const) {
    const result = runVfxStress(level);

    it(`returns to baseline after a hundred finisher rounds on ${level}`, () => {
      expect(result.endedAtBaseline).toBe(true);
      expect(result.spawned).toBeGreaterThan(100);
    });

    it(`never exceeds the catalogue's worst case on ${level}`, () => {
      expect(result.peakParticles).toBeLessThanOrEqual(result.worstCase);
    });

    it(`refuses the excess rather than growing on ${level}`, () => {
      expect(result.refusedAtCeiling).toBeGreaterThan(0);
    });
  }

  it("is deterministic: the same stress twice agrees exactly", () => {
    expect(runVfxStress("high")).toEqual(runVfxStress("high"));
  });
});

describe("the quality ladder", () => {
  const report = styleReport();

  it("has a valid guide and a monotonic particle ladder", () => {
    expect(report.guideErrors).toEqual([]);
    expect(report.ladderMonotonic).toBe(true);
  });

  it("keeps Low cheap and Cinematic expensive, in that order", () => {
    const particles = report.particleLadder.map((entry) => entry.particles);
    expect(particles[0]!).toBeLessThan(particles[particles.length - 1]!);
  });
});

describe("impact language", () => {
  it("freezes on a heavy hit and not on a light one", () => {
    const director = new ImpactDirector("high");
    const heavy = director.advance(0.016, [hit(80)]);
    expect(heavy.freezeSecondsLeft).toBeGreaterThan(0);
    const quiet = new ImpactDirector("high").advance(0.016, [hit(5)]);
    expect(quiet.freezeSecondsLeft).toBe(0);
  });

  it("caps freezes per rolling second, so hits never strobe", () => {
    const director = new ImpactDirector("high");
    let freezes = 0;
    for (let index = 0; index < 8; index += 1) {
      const frame = director.advance(0.05, [hit(90)]);
      if (frame.freezeSecondsLeft > 0.05) freezes += 1;
    }
    expect(freezes).toBeLessThanOrEqual(IMPACT_GRAMMAR.high.maxFreezesPerSecond + 1);
  });

  it("gives the finisher the only long hold", () => {
    const ordinary = new ImpactDirector("high").advance(0.016, [hit(80)]);
    const finisher = new ImpactDirector("high").advance(0.016, [hit(0, "finisher-ended")]);
    expect(finisher.freezeSecondsLeft).toBeGreaterThan(ordinary.freezeSecondsLeft);
    expect(finisher.freezeSecondsLeft).toBeLessThanOrEqual(0.3);
  });

  it("asks for the effects the event earned", () => {
    const frame = new ImpactDirector("high").advance(0.016, [hit(90, "zone-destroyed")]);
    expect(frame.requests).toEqual(expect.arrayContaining(["kaiju-blue", "debris-burst"]));
  });

  it("decays pose exaggeration back to one rather than holding it", () => {
    const director = new ImpactDirector("cinematic");
    const first = director.advance(0.016, [hit(90)]);
    expect(first.poseScale).toBeGreaterThan(1);
    let last = first.poseScale;
    for (let step = 0; step < 20; step += 1) last = director.advance(0.1, []).poseScale;
    expect(last).toBe(1);
  });

  it("never freezes the simulation, only the render clock", () => {
    // The director consumes events after the arena counted them; the proof is
    // structural, but the frame also never reports anything but presentation.
    const frame = new ImpactDirector("high").advance(0.016, [hit(90)]);
    expect(Object.keys(frame).sort()).toEqual([
      "chromaticPx",
      "freezeSecondsLeft",
      "impulseMeters",
      "poseScale",
      "requests",
      "speedLines",
    ]);
  });
});

describe("accessibility, proven rather than promised", () => {
  const proof = proveAccessibility();

  it("reduced motion produces zero freezes from events that froze before", () => {
    expect(proof.freezesAllowed).toBeGreaterThan(0);
    expect(proof.freezesReduced).toBe(0);
  });

  it("zero shake produces zero impulse from the same hits", () => {
    expect(proof.impulseFull).toBeGreaterThan(0);
    expect(proof.impulseZero).toBe(0);
  });

  it("the chromatic toggle removes chromatic alone", () => {
    expect(proof.chromaticOn).toBeGreaterThan(0);
    expect(proof.chromaticOff).toBe(0);
  });

  it("reduced motion removes the speed lines too", () => {
    expect(proof.speedLinesReduced).toBe(0);
  });

  it("the flash gate is queryable before anything is drawn", () => {
    const director = new ImpactDirector("high", { ...CALM_ACCESSIBILITY, noFlashes: true });
    expect(director.allowsFlashes()).toBe(false);
  });
});
