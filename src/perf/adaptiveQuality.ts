import { QUALITY_LEVELS, type QualityLevel } from "../data/quality";
import { budgetFor } from "../data/perfBudgets";

/**
 * Quality that follows the machine, slowly and visibly.
 *
 * The rule set is small because every rule earns its place:
 *
 * **Down is reluctant, up is more reluctant.** A step down needs a sustained
 * run of over-budget frames, not one spike, because a spike is a shader
 * compile or a tab switch and reacting to it would make quality flap. A step
 * back up needs a much longer window of comfortable frames, because the worst
 * outcome is oscillation: down, up, down, each one a visible sector reload.
 *
 * **One step at a time, with a cooldown.** However bad the frames, the
 * controller moves one level and then holds long enough to see what that
 * bought. Dropping from cinematic to low in one judgement would be acting on
 * data the drop itself invalidates.
 *
 * **The player outranks it.** Choosing a level by hand pins that level and
 * turns the controller off until they hand control back. And whatever it
 * decides, it only ever recommends a *preset*: the simulation, the fight and
 * every telegraph are identical at every level, which is enforced where
 * presets are validated, not merely promised here.
 *
 * Pure and clock-free: frames arrive as durations, decisions come out as
 * recommendations. The caller applies them through the same applyQuality path
 * the settings panel uses.
 */

/** Consecutive over-budget frames before a step down. */
export const DOWN_AFTER_FRAMES = 90;
/** Consecutive comfortable frames before a step back up. */
export const UP_AFTER_FRAMES = 900;
/** Frames ignored after any change, so the change's own cost is not judged. */
export const COOLDOWN_FRAMES = 120;
/** A frame counts as comfortable only under this fraction of budget. */
export const COMFORT_FRACTION = 0.75;

export interface AdaptiveView {
  readonly enabled: boolean;
  readonly level: QualityLevel;
  /** Why the last change happened, in a sentence. */
  readonly lastChange: string;
  /** 0 to 1 toward the next step down. */
  readonly pressure: number;
  /** 0 to 1 toward the next step up. */
  readonly headroom: number;
}

export type AdaptiveDecision =
  { readonly kind: "hold" } | { readonly kind: "change"; readonly to: QualityLevel; readonly reason: string };

export class AdaptiveQuality {
  private enabled: boolean;
  private level: QualityLevel;
  private overStreak = 0;
  private comfortStreak = 0;
  private cooldown = 0;
  private lastChange = "";

  constructor(initial: QualityLevel, enabled = false) {
    this.level = initial;
    this.enabled = enabled;
  }

  /** The player's hand on the dial. Pins the level and stops the controller. */
  setManual(level: QualityLevel): void {
    this.level = level;
    this.enabled = false;
    this.overStreak = 0;
    this.comfortStreak = 0;
    this.lastChange = "Set by hand.";
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.overStreak = 0;
    this.comfortStreak = 0;
    this.cooldown = 0;
    if (enabled) this.lastChange = "Adaptive quality on.";
  }

  /** The applied level changed for another reason (a URL, a save). Follow it. */
  levelApplied(level: QualityLevel): void {
    this.level = level;
  }

  /**
   * Judges one frame. Returns a change at most once per cooldown window.
   *
   * The frame is judged against the *current* level's budget, so a machine
   * that only just fails High is asked to try Medium rather than punished
   * against a target it never promised.
   */
  frame(ms: number): AdaptiveDecision {
    if (!this.enabled) return { kind: "hold" };
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      return { kind: "hold" };
    }

    const budget = budgetFor(this.level);
    if (ms > budget.frameMs) {
      this.overStreak += 1;
      this.comfortStreak = 0;
    } else if (ms < budget.frameMs * COMFORT_FRACTION) {
      this.comfortStreak += 1;
      this.overStreak = 0;
    } else {
      // In between is fine where it is: neither pressure nor headroom.
      this.overStreak = 0;
      this.comfortStreak = 0;
    }

    const index = QUALITY_LEVELS.indexOf(this.level);
    if (this.overStreak >= DOWN_AFTER_FRAMES && index > 0) {
      const to = QUALITY_LEVELS[index - 1]!;
      this.applyDecision(to);
      this.lastChange = `Stepped down to ${to}: ${DOWN_AFTER_FRAMES} frames over ${budget.frameMs} ms.`;
      return { kind: "change", to, reason: this.lastChange };
    }
    if (this.comfortStreak >= UP_AFTER_FRAMES && index < QUALITY_LEVELS.length - 1) {
      const to = QUALITY_LEVELS[index + 1]!;
      this.applyDecision(to);
      this.lastChange = `Stepped up to ${to}: a stable window under ${Math.round(
        budget.frameMs * COMFORT_FRACTION,
      )} ms.`;
      return { kind: "change", to, reason: this.lastChange };
    }
    return { kind: "hold" };
  }

  view(): AdaptiveView {
    return {
      enabled: this.enabled,
      level: this.level,
      lastChange: this.lastChange,
      pressure: Math.min(1, this.overStreak / DOWN_AFTER_FRAMES),
      headroom: Math.min(1, this.comfortStreak / UP_AFTER_FRAMES),
    };
  }

  private applyDecision(to: QualityLevel): void {
    this.level = to;
    this.overStreak = 0;
    this.comfortStreak = 0;
    this.cooldown = COOLDOWN_FRAMES;
  }
}
