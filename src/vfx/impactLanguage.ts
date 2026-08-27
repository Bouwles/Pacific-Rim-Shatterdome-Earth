import { IMPACT_GRAMMAR, type ImpactGrammar } from "../data/styleGuide";
import type { QualityLevel } from "../data/quality";
import type { CombatEvent } from "../combat/arena";
import type { EffectKind } from "./effectsModel";

/**
 * What a hit is allowed to do to the screen.
 *
 * Combat events go in; freezes, camera impulses, pose pushes, chromatic
 * offsets, speed lines and effect requests come out, every one of them already
 * scaled by the quality preset and the player's accessibility settings. The
 * renderer applies what it is handed and decides nothing, which is what makes
 * "a flash can never ignore the settings" a property of the data flow rather
 * than a discipline.
 *
 * The freeze stops the render clock, never the simulation: the arena has
 * already counted the hit by the time this file hears about it, so no amount of
 * frozen frames can change a fight.
 *
 * Pure and clock-free. Time arrives as a delta.
 */

/** The accessibility toggles this director obeys. A slice of VfxSettings. */
export interface ImpactAccessibility {
  /** 0 to 1 on camera impulse. The pilot screen's existing shake scale. */
  readonly shakeScale: number;
  /** True kills freezes, exaggeration, chromatic and speed lines outright. */
  readonly reducedMotion: boolean;
  /** True kills everything the catalogue marks as a flash. */
  readonly noFlashes: boolean;
  /** True disables chromatic offset alone. */
  readonly noChromatic: boolean;
}

export const CALM_ACCESSIBILITY: ImpactAccessibility = {
  shakeScale: 1,
  reducedMotion: false,
  noFlashes: false,
  noChromatic: false,
};

/** One frame's worth of presentation, ready to apply. */
export interface ImpactFrame {
  /** Seconds the render clock still owes the current freeze. */
  readonly freezeSecondsLeft: number;
  /** Metres of camera impulse to apply this frame. */
  readonly impulseMeters: number;
  /** Scale on the current reaction pose. One when nothing is exaggerated. */
  readonly poseScale: number;
  /** Pixels of chromatic offset. Zero almost always. */
  readonly chromaticPx: number;
  /** Speed lines that should be visible right now. */
  readonly speedLines: number;
  /** Effects the events asked for this frame, for the pool to consider. */
  readonly requests: readonly EffectKind[];
}

/** Rows mapping an event to what it asks for. A table, never a switch. */
interface ImpactRule {
  readonly when: (event: CombatEvent) => boolean;
  /** Freeze weight, 0 for none, 1 for a full ordinary freeze. */
  readonly freeze: number;
  readonly impulse: number;
  readonly effects: readonly EffectKind[];
}

const RULES: readonly ImpactRule[] = [
  {
    // A heavy hit: real damage, on anybody. The core of the language.
    when: (event) => event.type === "hit" && event.damage >= 40,
    freeze: 1,
    impulse: 1,
    effects: ["sparks", "dust"],
  },
  {
    when: (event) => event.type === "hit" && event.damage > 0 && event.damage < 40,
    freeze: 0,
    impulse: 0.35,
    effects: ["sparks"],
  },
  {
    // Creature blood only when a zone actually breaks.
    when: (event) => event.type === "zone-destroyed",
    freeze: 1,
    impulse: 1,
    effects: ["kaiju-blue", "debris-burst"],
  },
  {
    when: (event) => event.type === "perfect-guard" || event.type === "parried",
    freeze: 0.6,
    impulse: 0.5,
    effects: ["sparks"],
  },
  {
    when: (event) => event.type === "finisher-beat",
    freeze: 0,
    impulse: 0.8,
    effects: ["finisher"],
  },
  {
    // The long hold is earned exactly once, when the sequence lands.
    when: (event) => event.type === "finisher-ended",
    freeze: 2,
    impulse: 1,
    effects: ["finisher", "kaiju-blue"],
  },
  {
    when: (event) => event.type === "guarded",
    freeze: 0,
    impulse: 0.25,
    effects: ["sparks"],
  },
];

export class ImpactDirector {
  private grammar: ImpactGrammar;
  private access: ImpactAccessibility;

  private freezeLeft = 0;
  private freezeBudgetWindow = 0;
  private freezesThisWindow = 0;
  private impulsePending = 0;
  private poseDecay = 0;
  private chromaticDecay = 0;
  private speedLineDecay = 0;

  constructor(level: QualityLevel, access: ImpactAccessibility = CALM_ACCESSIBILITY) {
    this.grammar = IMPACT_GRAMMAR[level];
    this.access = access;
  }

  setQuality(level: QualityLevel): void {
    this.grammar = IMPACT_GRAMMAR[level];
  }

  setAccessibility(access: ImpactAccessibility): void {
    this.access = access;
  }

  /**
   * Feeds one frame of events and time, and gets back what to show.
   *
   * The freeze cap is a rolling window: past `maxFreezesPerSecond`, further
   * hits land without a freeze rather than queueing one, because three queued
   * freezes are a slideshow.
   */
  advance(deltaSeconds: number, events: readonly CombatEvent[]): ImpactFrame {
    const step = Math.max(0, deltaSeconds);
    this.freezeLeft = Math.max(0, this.freezeLeft - step);
    this.freezeBudgetWindow += step;
    if (this.freezeBudgetWindow >= 1) {
      this.freezeBudgetWindow = 0;
      this.freezesThisWindow = 0;
    }
    this.impulsePending = 0;
    this.poseDecay = Math.max(0, this.poseDecay - step * 4);
    this.chromaticDecay = Math.max(0, this.chromaticDecay - step * 5);
    this.speedLineDecay = Math.max(0, this.speedLineDecay - step * 3);

    const requests: EffectKind[] = [];
    for (const event of events) {
      const rule = RULES.find((candidate) => candidate.when(event));
      if (!rule) continue;
      for (const effect of rule.effects) requests.push(effect);

      if (rule.freeze > 0 && !this.access.reducedMotion) {
        if (this.freezesThisWindow < this.grammar.maxFreezesPerSecond) {
          const base = rule.freeze >= 2 ? this.grammar.finisherFreezeMs : this.grammar.freezeMs;
          this.freezeLeft = Math.max(this.freezeLeft, (base * Math.min(rule.freeze, 1.001)) / 1000);
          this.freezesThisWindow += 1;
          this.poseDecay = 1;
          this.chromaticDecay = 1;
        }
      }
      this.impulsePending = Math.max(
        this.impulsePending,
        this.grammar.impulseMeters * rule.impulse * this.access.shakeScale,
      );
      if (rule.impulse >= 0.8) this.speedLineDecay = 1;
    }

    const reduced = this.access.reducedMotion;
    return {
      freezeSecondsLeft: reduced ? 0 : this.freezeLeft,
      impulseMeters: this.impulsePending,
      poseScale: reduced ? 1 : 1 + (this.grammar.poseExaggeration - 1) * this.poseDecay,
      chromaticPx: reduced || this.access.noChromatic ? 0 : this.grammar.chromaticPx * this.chromaticDecay,
      speedLines: reduced ? 0 : Math.round(this.grammar.speedLines * this.speedLineDecay),
      requests,
    };
  }

  /** Whether a flash-class effect may be shown at all right now. */
  allowsFlashes(): boolean {
    return !this.access.noFlashes;
  }
}
