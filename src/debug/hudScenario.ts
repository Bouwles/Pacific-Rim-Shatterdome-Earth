import { buildHud, type HudInput, type HudModel } from "../ui/hudModel";
import {
  COLOUR_VISION_PRESETS,
  SEVERITIES,
  SEVERITY_TOKENS,
  TEXT_SCALES,
  type Severity,
} from "../ui/hudTokens";
import {
  MIN_HUD_OPACITY,
  criticalRemainsVisible,
  defaultPresentation,
  motionIsBounded,
  styleFor,
  type PresentationSettings,
} from "../ui/presentation";

/**
 * The interface, put under pressure.
 *
 * What this proves: that critical state survives every combination of display
 * settings a player can choose, that the instruments move because systems moved
 * and not because time passed, and that no severity ever depends on colour
 * alone to be told apart from another.
 *
 * Pure and deterministic. No renderer, no clock, no world.
 */

/** Conditions a fight can be fought in, and what they do to legibility. */
export const VIEWING_CONDITIONS = ["clear", "rain", "fog", "darkness", "underwater", "glare"] as const;
export type ViewingCondition = (typeof VIEWING_CONDITIONS)[number];

/** How much contrast the world itself leaves for the interface, 0 to 1. */
export const CONDITION_CONTRAST: Readonly<Record<ViewingCondition, number>> = {
  clear: 1,
  rain: 0.72,
  fog: 0.55,
  darkness: 0.6,
  underwater: 0.48,
  glare: 0.4,
};

/** A fight going badly, so there is something worth reading. */
export function pressureInput(overrides: Partial<HudInput> = {}): HudInput {
  return {
    machine: {
      integrity: 0.31,
      components: [
        { id: "component.conn-pod", name: "Conn-Pod", fraction: 0.82, offline: false },
        { id: "component.torso", name: "Torso", fraction: 0.44, offline: false },
        { id: "component.arm.left", name: "Left arm", fraction: 0.12, offline: false },
        { id: "component.leg.right", name: "Right leg", fraction: 0, offline: true },
      ],
      stamina: 34,
      staminaMax: 100,
      heat: 91,
      overheated: false,
      reactorLoad: 0.93,
      driftStability: 0.38,
      ...overrides.machine,
    },
    // Written as a whole rather than spread, because spreading an override of
    // null over an object leaves the object: "no target" has to mean no target.
    target:
      "target" in overrides
        ? (overrides.target ?? null)
        : {
            name: "Category IV",
            distanceMeters: 62,
            lockedOn: true,
            aimZoneId: "head",
            zones: [
              { id: "head", health: 220, maxHealth: 600 },
              { id: "torso", health: 900, maxHealth: 1_400 },
              { id: "core", health: 120, maxHealth: 800 },
            ],
          },
    weapons: overrides.weapons ?? [
      {
        id: "weapon.rotary-cannon",
        displayName: "Rotary cannon",
        magazine: 0,
        magazineSize: 240,
        feed: "rounds",
        reserve: 0,
        ready: false,
        reloading: false,
      },
      {
        id: "weapon.plasma-caster",
        displayName: "Plasma caster",
        magazine: 0,
        magazineSize: 0,
        feed: "heat",
        reserve: 0,
        ready: true,
        reloading: false,
      },
    ],
    navigation: {
      headingDeg: 214,
      speedMps: 6.4,
      depthMeters: 12,
      submerged: false,
      ...overrides.navigation,
    },
    conditions: { weather: "storm", visibility: 0.44, ...overrides.conditions },
    // The nullable fields are checked for presence rather than coalesced, for
    // the same reason the target is: `??` treats an explicit null as absent, so
    // "the radio is quiet" would silently become "the radio said something".
    squadOrder: "squadOrder" in overrides ? overrides.squadOrder! : "Defend area",
    objective: overrides.objective ?? "Hold the waterfront",
    citySafety: overrides.citySafety ?? 0.42,
    abilities: overrides.abilities ?? [{ name: "Overdrive", state: "ready" }],
    radio: "radio" in overrides ? overrides.radio! : "LOCCENT: second contact inbound.",
  };
}

/** A quiet moment, so the minimal case can be checked too. */
export function calmInput(): HudInput {
  return pressureInput({
    machine: {
      integrity: 1,
      components: [
        { id: "component.conn-pod", name: "Conn-Pod", fraction: 1, offline: false },
        { id: "component.torso", name: "Torso", fraction: 1, offline: false },
      ],
      stamina: 100,
      staminaMax: 100,
      heat: 4,
      overheated: false,
      reactorLoad: 0.2,
      driftStability: 0.96,
    },
    target: null,
    citySafety: 1,
    conditions: { weather: "clear", visibility: 1 },
    radio: null,
    // A loaded machine, so a quiet moment is genuinely quiet. Inheriting the
    // dry cannon from the pressure case would have made "minimal" untestable.
    weapons: [
      {
        id: "weapon.rotary-cannon",
        displayName: "Rotary cannon",
        magazine: 240,
        magazineSize: 240,
        feed: "rounds",
        reserve: 480,
        ready: true,
        reloading: false,
      },
    ],
  });
}

export interface LegibilityRow {
  readonly condition: ViewingCondition;
  readonly settings: string;
  /** Critical alerts still on screen. */
  readonly criticalShown: number;
  /** True when nothing critical was faded, shrunk or hidden. */
  readonly criticalIntact: boolean;
  /** Weakest contrast any critical element ends up with. */
  readonly worstCriticalContrast: number;
}

/**
 * Every condition against every reasonable settings combination.
 *
 * The acceptance item is that critical combat state stays readable in rain,
 * fog, darkness, water and bright effects. This runs the model under all of
 * them and reports whether anything critical was ever lost.
 */
export function legibilitySweep(): readonly LegibilityRow[] {
  const rows: LegibilityRow[] = [];
  const settingsMatrix: readonly { readonly name: string; readonly settings: PresentationSettings }[] = [
    { name: "default", settings: defaultPresentation() },
    { name: "faded", settings: { ...defaultPresentation(), hudOpacity: MIN_HUD_OPACITY } },
    { name: "small text", settings: { ...defaultPresentation(), textScale: TEXT_SCALES[0]! } },
    { name: "high contrast", settings: { ...defaultPresentation(), highContrast: true } },
    { name: "reduced motion", settings: { ...defaultPresentation(), reducedMotion: true } },
    ...COLOUR_VISION_PRESETS.map((preset) => ({
      name: `colour vision ${preset}`,
      settings: { ...defaultPresentation(), colourVision: preset },
    })),
    {
      name: "everything at once",
      settings: {
        hudOpacity: MIN_HUD_OPACITY,
        textScale: TEXT_SCALES[0]!,
        highContrast: true,
        colourVision: "tritanopia" as const,
        subtitles: false,
        reducedMotion: true,
        shakeScale: 0,
      },
    },
  ];

  const model = buildHud(pressureInput());
  const criticals = model.alerts.filter((alert) => alert.severity === "critical");

  for (const condition of VIEWING_CONDITIONS) {
    for (const entry of settingsMatrix) {
      const style = styleFor("critical", entry.settings);
      // What the world leaves for the interface, multiplied by what the player
      // asked for. The critical layer ignores opacity, so this is the honest
      // worst case rather than an optimistic one.
      const contrast = CONDITION_CONTRAST[condition] * style.opacity;
      rows.push({
        condition,
        settings: entry.name,
        criticalShown: criticals.length,
        criticalIntact: criticalRemainsVisible(entry.settings) && motionIsBounded(entry.settings),
        worstCriticalContrast: Math.round(contrast * 1000) / 1000,
      });
    }
  }
  return rows;
}

export interface InstrumentTrace {
  readonly instrument: string;
  /** Reading before the system changed. */
  readonly before: string;
  /** Reading after the system changed. */
  readonly after: string;
  readonly moved: boolean;
}

/**
 * Instruments against a changing machine.
 *
 * The acceptance item is that a cockpit indicator changes because a system
 * changed rather than because a loop is playing. This reads every instrument,
 * changes exactly one authoritative value, and reads them again: the ones tied
 * to that value move and the rest do not.
 */
export function instrumentTrace(): readonly InstrumentTrace[] {
  const calm = calmInput();
  const before = buildHud(calm);
  // Exactly one change, to exactly one system: the reactor is now overloaded.
  // Everything else is the same object, so any instrument that moves moved
  // because of the reactor and nothing else.
  const after = buildHud({ ...calm, machine: { ...calm.machine, reactorLoad: 0.97 } });

  return before.instruments.map((instrument) => {
    const later = after.instruments.find((entry) => entry.id === instrument.id);
    return {
      instrument: instrument.id,
      before: instrument.value,
      after: later?.value ?? "missing",
      moved: later?.value !== instrument.value,
    };
  });
}

/**
 * Whether the same reading is told apart without colour.
 *
 * Two severities that share a glyph and a border weight would be
 * indistinguishable in grey, and this reports it rather than assuming it does
 * not happen.
 */
export function shapeDistinctness(): {
  readonly severities: number;
  readonly distinctGlyphs: number;
  readonly distinctBorders: number;
  readonly colourFree: boolean;
} {
  const glyphs = new Set(SEVERITIES.map((severity) => SEVERITY_TOKENS[severity].glyph));
  const borders = new Set(SEVERITIES.map((severity) => SEVERITY_TOKENS[severity].borderWidth));
  return {
    severities: SEVERITIES.length,
    distinctGlyphs: glyphs.size,
    distinctBorders: borders.size,
    colourFree: glyphs.size === SEVERITIES.length,
  };
}

/** What the HUD says at rest, so "minimal" can be measured rather than claimed. */
export function quietVersusLoud(): {
  readonly quietAlerts: number;
  readonly loudAlerts: number;
  readonly quietBusy: boolean;
  readonly loudTop: string | null;
} {
  const quiet: HudModel = buildHud(calmInput());
  const loud: HudModel = buildHud(pressureInput());
  return {
    quietAlerts: quiet.alerts.length,
    loudAlerts: loud.alerts.length,
    quietBusy: quiet.busy,
    loudTop: loud.topAlert?.label ?? null,
  };
}

/** The severity a reading of a given fraction produces, for the documentation. */
export function severityLadder(): readonly { readonly fraction: number; readonly severity: Severity }[] {
  const model = (fraction: number) =>
    buildHud(
      pressureInput({
        machine: {
          ...calmInput().machine,
          components: [{ id: "component.torso", name: "Torso", fraction, offline: false }],
        },
      }),
    ).components[0]!.severity;
  return [0, 0.1, 0.3, 0.5, 0.8, 1].map((fraction) => ({ fraction, severity: model(fraction) }));
}
