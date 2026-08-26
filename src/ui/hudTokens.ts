/**
 * The vocabulary the interface is built from.
 *
 * One place that says what a warning looks like, how urgent it is, what shape
 * carries it, how long anything is allowed to move for, and how big text is.
 * Everything that draws reads these, so the interface stays one interface
 * rather than becoming a set of panels that each invented their own idea of red.
 *
 * Two rules this file exists to enforce.
 *
 * **Colour is never the only signal.** Every severity carries a distinct glyph
 * and a distinct border weight as well as a colour, so the display works for a
 * player who cannot separate red from amber, and works in a screenshot printed
 * in grey.
 *
 * **Motion is bounded and optional.** Nothing loops forever to look busy: a
 * token says how long a thing may move for, and reduced motion sets every one
 * of them to zero without changing what is on screen.
 *
 * No Babylon, no DOM. Values only.
 */

/** How much something matters. Ordered: the first is the most urgent. */
export const SEVERITIES = ["critical", "warning", "caution", "info", "nominal"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** What one severity looks like. Colour, and two things that are not colour. */
export interface SeverityToken {
  readonly id: Severity;
  /** Rank for sorting. Lower is more urgent. */
  readonly rank: number;
  /** Base colour, in the ordinary palette. */
  readonly colour: string;
  /** The same meaning in the high contrast palette. */
  readonly contrastColour: string;
  /**
   * A glyph carrying the same meaning as the colour.
   *
   * This is the accessibility rule made concrete: anything shown in a colour is
   * also shown as a shape, so the information survives a colour-blind player,
   * a grey print, and a bright sunlit screen.
   */
  readonly glyph: string;
  /** Border weight in pixels. A third channel, again not colour. */
  readonly borderWidth: number;
  /** Whether a warning at this level may pulse at all. */
  readonly mayPulse: boolean;
  /** What this level means, for the documentation and the tooltips. */
  readonly meaning: string;
}

export const SEVERITY_TOKENS: Readonly<Record<Severity, SeverityToken>> = {
  critical: {
    id: "critical",
    rank: 0,
    colour: "#ff6b5e",
    contrastColour: "#ff2f1c",
    glyph: "!!",
    borderWidth: 3,
    mayPulse: true,
    meaning: "Act now or lose the machine, the crew or the objective.",
  },
  warning: {
    id: "warning",
    rank: 1,
    colour: "#ffb454",
    contrastColour: "#ff9800",
    glyph: "!",
    borderWidth: 2,
    mayPulse: true,
    meaning: "Something is going wrong and will get worse if ignored.",
  },
  caution: {
    id: "caution",
    rank: 2,
    colour: "#e8d67a",
    contrastColour: "#ffe14d",
    glyph: "△",
    borderWidth: 2,
    mayPulse: false,
    meaning: "Worth knowing about. Not yet a problem.",
  },
  info: {
    id: "info",
    rank: 3,
    colour: "#7fd6ff",
    contrastColour: "#4fc3ff",
    glyph: "·",
    borderWidth: 1,
    mayPulse: false,
    meaning: "State the player asked to see.",
  },
  nominal: {
    id: "nominal",
    rank: 4,
    colour: "#8fdcae",
    contrastColour: "#41d68a",
    glyph: "✓",
    borderWidth: 1,
    mayPulse: false,
    meaning: "Working as it should.",
  },
};

/** Icons used across the interface. One meaning each, named for the meaning. */
export const ICON_TOKENS: Readonly<Record<string, string>> = {
  structure: "▣",
  reactor: "◈",
  heat: "▲",
  ammunition: "▤",
  ability: "◆",
  target: "◎",
  squad: "⬡",
  objective: "▶",
  civilians: "⌂",
  drift: "∞",
  depth: "▽",
  heading: "⌖",
  speed: "⇥",
  weather: "≈",
  radio: "◜",
  fault: "⨯",
};

/** How long anything is allowed to move, in milliseconds. */
export interface MotionToken {
  readonly id: string;
  readonly durationMs: number;
  /** What it is for, so nobody reaches for a duration at random. */
  readonly use: string;
}

export const MOTION_TOKENS: Readonly<Record<string, MotionToken>> = {
  instant: { id: "instant", durationMs: 0, use: "Anything safety critical. It is there or it is not." },
  quick: { id: "quick", durationMs: 90, use: "A value changing: a bar, a number, a fill." },
  settle: { id: "settle", durationMs: 180, use: "A panel appearing or a row reordering." },
  attention: { id: "attention", durationMs: 900, use: "One pulse of a critical warning. Never a loop." },
};

/** The longest anything may animate. Nothing in the interface may exceed this. */
export const MAX_MOTION_MS = 900;

/** Text sizes, as multipliers on the base. */
export const TEXT_SCALES = [0.9, 1, 1.15, 1.35] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/**
 * Colour vision presets.
 *
 * Each remaps the hues that carry meaning so two severities never collapse into
 * the same apparent colour. The glyphs make this a second line of defence
 * rather than the only one.
 */
export const COLOUR_VISION_PRESETS = ["standard", "protanopia", "deuteranopia", "tritanopia"] as const;
export type ColourVisionPreset = (typeof COLOUR_VISION_PRESETS)[number];

/** Severity colours under each preset. Ordered most urgent first. */
export const COLOUR_VISION_PALETTES: Readonly<
  Record<ColourVisionPreset, Readonly<Record<Severity, string>>>
> = {
  standard: {
    critical: "#ff6b5e",
    warning: "#ffb454",
    caution: "#e8d67a",
    info: "#7fd6ff",
    nominal: "#8fdcae",
  },
  // Red is unreliable, so urgency moves onto brightness and blue.
  protanopia: {
    critical: "#ffffff",
    warning: "#ffd24d",
    caution: "#d9c34a",
    info: "#5fb8ff",
    nominal: "#3f7fd6",
  },
  // Green is unreliable, so nominal moves off green and onto blue.
  deuteranopia: {
    critical: "#ffe5e0",
    warning: "#ffc247",
    caution: "#d8bd57",
    info: "#63bfff",
    nominal: "#4d8fe0",
  },
  // Blue and yellow are unreliable, so caution and info move apart on red.
  tritanopia: {
    critical: "#ff5a4d",
    warning: "#ff8f6b",
    caution: "#d98f8f",
    info: "#c0c0c0",
    nominal: "#6fd6a8",
  },
};

/**
 * The colour for a severity, given the player's settings.
 *
 * High contrast wins over a colour vision preset, because somebody who has
 * asked for high contrast has asked for the strongest separation available.
 */
export function severityColour(
  severity: Severity,
  options: { readonly highContrast?: boolean; readonly colourVision?: ColourVisionPreset } = {},
): string {
  if (options.highContrast) return SEVERITY_TOKENS[severity].contrastColour;
  const preset = options.colourVision ?? "standard";
  return COLOUR_VISION_PALETTES[preset][severity];
}

/** The glyph for an icon name, falling back to the fault mark. */
export function iconGlyph(name: string): string {
  return ICON_TOKENS[name] ?? ICON_TOKENS["fault"]!;
}

/** How long a thing may move for, given whether motion was reduced. */
export function motionDuration(token: keyof typeof MOTION_TOKENS, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return MOTION_TOKENS[token]?.durationMs ?? 0;
}

/**
 * Every token, as rows.
 *
 * Used by the documentation and by the test that asserts the set is coherent,
 * so the written record and the code cannot drift apart.
 */
export function tokenTable(): readonly {
  readonly kind: string;
  readonly id: string;
  readonly value: string;
  readonly meaning: string;
}[] {
  const rows: { kind: string; id: string; value: string; meaning: string }[] = [];
  for (const token of Object.values(SEVERITY_TOKENS)) {
    rows.push({
      kind: "severity",
      id: token.id,
      value: `${token.glyph} ${token.colour} ${token.borderWidth}px`,
      meaning: token.meaning,
    });
  }
  for (const [id, glyph] of Object.entries(ICON_TOKENS)) {
    rows.push({ kind: "icon", id, value: glyph, meaning: `Stands for ${id}.` });
  }
  for (const token of Object.values(MOTION_TOKENS)) {
    rows.push({ kind: "motion", id: token.id, value: `${token.durationMs} ms`, meaning: token.use });
  }
  return rows;
}
