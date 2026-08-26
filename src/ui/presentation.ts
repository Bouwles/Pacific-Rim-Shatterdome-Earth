import {
  COLOUR_VISION_PRESETS,
  MAX_MOTION_MS,
  TEXT_SCALES,
  motionDuration,
  severityColour,
  type ColourVisionPreset,
  type Severity,
  type TextScale,
} from "./hudTokens";

/**
 * How the player wants to be shown things.
 *
 * Every setting here changes presentation and nothing else. None of them makes
 * the game easier or harder, none of them changes a simulation value, and a
 * test asserts that the same fight produces the same outcome whatever these are
 * set to.
 *
 * The rule that matters: **no setting may hide something critical.** HUD opacity
 * has a floor, text has a minimum size, and the critical layer ignores opacity
 * entirely. Somebody who turns the interface down to get a clean picture still
 * gets told their reactor is failing.
 *
 * Serializable and pure. No Babylon, no DOM.
 */

export const PRESENTATION_SCHEMA_VERSION = 1;

/** The least the ordinary HUD may fade to. Below this it stops being readable. */
export const MIN_HUD_OPACITY = 0.35;

export interface PresentationSettings {
  /** 0.35 to 1. Applies to everything except the critical layer. */
  readonly hudOpacity: number;
  readonly textScale: TextScale;
  readonly highContrast: boolean;
  readonly colourVision: ColourVisionPreset;
  /** Spoken lines and radio traffic shown as text. */
  readonly subtitles: boolean;
  /** Every animation duration becomes zero. */
  readonly reducedMotion: boolean;
  /** Screen shake, 0 to 1 of the authored amount. */
  readonly shakeScale: number;
}

export function defaultPresentation(): PresentationSettings {
  return {
    hudOpacity: 1,
    textScale: 1,
    highContrast: false,
    colourVision: "standard",
    subtitles: true,
    reducedMotion: false,
    shakeScale: 1,
  };
}

export function validatePresentation(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["presentation settings must be an object"];
  const settings = value as Record<string, unknown>;
  const errors: string[] = [];

  const opacity = settings["hudOpacity"];
  if (typeof opacity !== "number" || !Number.isFinite(opacity)) errors.push("hudOpacity must be a number");
  else if (opacity < MIN_HUD_OPACITY || opacity > 1) {
    errors.push(`hudOpacity must be between ${MIN_HUD_OPACITY} and 1`);
  }

  if (!TEXT_SCALES.includes(settings["textScale"] as TextScale)) errors.push("unknown textScale");
  if (typeof settings["highContrast"] !== "boolean") errors.push("highContrast must be a boolean");
  if (!COLOUR_VISION_PRESETS.includes(settings["colourVision"] as ColourVisionPreset)) {
    errors.push("unknown colourVision preset");
  }
  if (typeof settings["subtitles"] !== "boolean") errors.push("subtitles must be a boolean");
  if (typeof settings["reducedMotion"] !== "boolean") errors.push("reducedMotion must be a boolean");

  const shake = settings["shakeScale"];
  if (typeof shake !== "number" || !Number.isFinite(shake) || shake < 0 || shake > 1) {
    errors.push("shakeScale must be between 0 and 1");
  }
  return errors;
}

/**
 * Puts a settings object back inside its limits rather than refusing it.
 *
 * A saved file with an opacity of zero is a file that would hide the interface,
 * so it is clamped to the floor instead of rejected. Presentation should never
 * be the reason a save will not load.
 */
export function normalisePresentation(
  value: Partial<PresentationSettings> | undefined,
): PresentationSettings {
  const base = defaultPresentation();
  if (!value) return base;
  const textScale = TEXT_SCALES.includes(value.textScale as TextScale)
    ? (value.textScale as TextScale)
    : base.textScale;
  return {
    hudOpacity: clamp(value.hudOpacity ?? base.hudOpacity, MIN_HUD_OPACITY, 1),
    textScale,
    highContrast: value.highContrast ?? base.highContrast,
    colourVision: COLOUR_VISION_PRESETS.includes(value.colourVision as ColourVisionPreset)
      ? (value.colourVision as ColourVisionPreset)
      : base.colourVision,
    subtitles: value.subtitles ?? base.subtitles,
    reducedMotion: value.reducedMotion ?? base.reducedMotion,
    shakeScale: clamp(value.shakeScale ?? base.shakeScale, 0, 1),
  };
}

/** What one layer of the interface should actually be drawn with. */
export interface LayerStyle {
  readonly opacity: number;
  readonly colour: string;
  readonly fontScale: number;
  /** Milliseconds a change at this layer may animate for. */
  readonly motionMs: number;
  /** True when the layer may pulse for attention. */
  readonly mayPulse: boolean;
}

/**
 * How a thing of a given severity should be drawn.
 *
 * The critical layer ignores opacity entirely. That is the whole point: a
 * player can fade the interface as far as it goes and still be told the reactor
 * is going, because turning the display down is a request for a cleaner picture
 * rather than a request to be kept in the dark.
 */
export function styleFor(severity: Severity, settings: PresentationSettings): LayerStyle {
  const critical = severity === "critical";
  return {
    opacity: critical ? 1 : settings.hudOpacity,
    colour: severityColour(severity, {
      highContrast: settings.highContrast,
      colourVision: settings.colourVision,
    }),
    fontScale: settings.textScale * (critical ? 1.1 : 1),
    motionMs: critical
      ? motionDuration("attention", settings.reducedMotion)
      : motionDuration("quick", settings.reducedMotion),
    mayPulse: critical && !settings.reducedMotion,
  };
}

/**
 * Whether the interface would still show something under these settings.
 *
 * Used by the test that proves no combination of settings can hide a critical
 * warning, which is the failure mode this milestone is written against.
 */
export function criticalRemainsVisible(settings: PresentationSettings): boolean {
  const style = styleFor("critical", settings);
  return style.opacity >= 1 && style.fontScale >= 0.9;
}

/** Every animation is inside the ceiling, and zero when motion was reduced. */
export function motionIsBounded(settings: PresentationSettings): boolean {
  const durations = (["critical", "warning", "caution", "info", "nominal"] as const).map(
    (severity) => styleFor(severity, settings).motionMs,
  );
  if (settings.reducedMotion) return durations.every((duration) => duration === 0);
  return durations.every((duration) => duration <= MAX_MOTION_MS);
}

/** Screen shake after the player's own scaling. Never above the authored value. */
export function shakeFor(authored: number, settings: PresentationSettings): number {
  if (settings.reducedMotion) return 0;
  return Math.max(0, authored * settings.shakeScale);
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, value));
}
