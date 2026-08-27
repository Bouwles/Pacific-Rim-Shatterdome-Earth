import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * The look, written down as numbers rather than remembered as taste.
 *
 * The brief is anime-influenced without going flat: industrial materials keep
 * their roughness and their mass, weather keeps its weight, and the stylisation
 * lives in edges, emission, palette discipline and impact language rather than
 * in cel-shading everything into plastic. This file is where those choices are
 * stated so that a renderer reads them and a test can hold them.
 *
 * Two decisions worth recording, because they were made against the obvious
 * alternative:
 *
 * **Edges are rim accents, not post-process outlines.** A screen-space outline
 * pass on a 75 metre machine viewed from 400 metres shimmers: the silhouette is
 * hundreds of long, nearly parallel edges, and a one-pixel line over them
 * crawls with every camera step. A fresnel rim accent is computed per pixel on
 * the surface itself, so it is stable at any distance and any size, and it
 * reads as the same ink line an outline would have given. True edge rendering
 * is reserved for the two presets whose geometry budget can afford it, and only
 * on hard-surface plates where the lines are long and straight.
 *
 * **Impact frames are short and count-limited.** The freeze is what sells a
 * heavy hit, and it stops selling anything the third time it happens in a
 * second. The guide caps how long and how often, and the accessibility settings
 * can take it to zero without the fight changing.
 *
 * No Babylon, no DOM. Numbers and names only.
 */

/** The palette, named by job rather than by colour. */
export interface PaletteToken extends RegistryEntry {
  readonly id: string;
  /** Hex, lowercase, with the hash. */
  readonly hex: string;
  /** What it is for, so nothing picks a colour for no reason. */
  readonly role: string;
  /**
   * True for colours that must survive every accessibility setting.
   *
   * Warning colours are information, not decoration: the intense-colour toggle
   * mutes everything else and leaves these alone.
   */
  readonly warning: boolean;
}

const PALETTE: readonly PaletteToken[] = [
  { id: "style.ink", hex: "#0a1016", role: "Edge accents and the darkest shadow.", warning: false },
  { id: "style.steel", hex: "#5f6a72", role: "Machine plate mid-tone. Rough, never glossy.", warning: false },
  {
    id: "style.steel-warm",
    hex: "#8a7f6a",
    role: "Weathered plate, rust streaks, worn paint.",
    warning: false,
  },
  { id: "style.sky-cool", hex: "#7fd6ff", role: "Rim light, interface glow, drift blue.", warning: false },
  { id: "style.plasma", hex: "#66e0ff", role: "Plasma weapons and reactor emission.", warning: false },
  {
    id: "style.kaiju-blue",
    hex: "#39d2c0",
    role: "Kaiju blood. Luminous, toxic, unmistakable.",
    warning: false,
  },
  { id: "style.fire", hex: "#ff9a3d", role: "Sparks, muzzle flash, burning fuel.", warning: false },
  {
    id: "style.warning-red",
    hex: "#ff5a48",
    role: "Damage, critical alerts, finisher openings.",
    warning: true,
  },
  { id: "style.warning-amber", hex: "#ffc247", role: "Caution states and heat warnings.", warning: true },
  { id: "style.night-sea", hex: "#0e2233", role: "Deep water and storm sky base.", warning: false },
];

export function validatePaletteToken(entry: PaletteToken): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("style.")) errors.push('palette ids start with "style."');
  if (!/^#[0-9a-f]{6}$/.test(entry.hex)) errors.push(`${entry.id}: hex must be #rrggbb lowercase`);
  if (entry.role.trim().length < 8) errors.push(`${entry.id}: a colour must say what it is for`);
  return errors;
}

export function createPaletteRegistry(): ContentRegistry<PaletteToken> {
  const registry = new ContentRegistry<PaletteToken>(validatePaletteToken);
  for (const token of PALETTE) registry.register(token);
  return registry;
}

export const PALETTE_TOKENS = PALETTE;

/**
 * Surface treatment per material family.
 *
 * Roughness floors are the "do not go flat" rule as a number: no machine plate
 * may render shinier than its floor, whatever the stylisation does, because a
 * mirror-smooth Jaeger reads as a toy.
 */
export interface SurfaceStyle {
  /** Minimum roughness. 1 is fully matte. */
  readonly roughnessFloor: number;
  /** Rim accent strength, 0 to 1. The ink-line substitute. */
  readonly rimStrength: number;
  /** Rim tightness exponent. Higher is a thinner line. */
  readonly rimPower: number;
  /** Emission ceiling, 0 to 1, for the parts that glow. */
  readonly emissionCeiling: number;
}

export const SURFACE_STYLES: Readonly<Record<"machine" | "creature" | "city" | "terrain", SurfaceStyle>> = {
  // Rough plate with a tight cool rim: the machine keeps its mass and gains
  // its ink line.
  machine: { roughnessFloor: 0.55, rimStrength: 0.55, rimPower: 3.2, emissionCeiling: 0.65 },
  // Wetter and softer than the machine, with the rim doing more work because
  // the surface is organic and the silhouette matters more than the plate.
  creature: { roughnessFloor: 0.4, rimStrength: 0.7, rimPower: 2.4, emissionCeiling: 0.8 },
  // Buildings get almost no rim: a whole skyline of ink lines is noise.
  city: { roughnessFloor: 0.6, rimStrength: 0.15, rimPower: 4, emissionCeiling: 0.5 },
  terrain: { roughnessFloor: 0.7, rimStrength: 0, rimPower: 1, emissionCeiling: 0.2 },
};

/** Where true edge lines are allowed, per quality level. */
export interface EdgeTreatment {
  /** True when edge rendering is on at all. */
  readonly edges: boolean;
  /** Line width in world units. Wide enough to survive distance. */
  readonly widthWorld: number;
  /** Only meshes at least this tall get lines. Small props never do. */
  readonly minHeightMeters: number;
}

export const EDGE_TREATMENTS: Readonly<Record<"low" | "medium" | "high" | "cinematic", EdgeTreatment>> = {
  // Low and Medium keep the rim accent only. The silhouette survives because
  // the rim is per-pixel; what is dropped is the extra geometry pass.
  low: { edges: false, widthWorld: 0, minHeightMeters: Infinity },
  medium: { edges: false, widthWorld: 0, minHeightMeters: Infinity },
  high: { edges: true, widthWorld: 0.35, minHeightMeters: 20 },
  cinematic: { edges: true, widthWorld: 0.5, minHeightMeters: 12 },
};

/**
 * Impact language: what a heavy hit is allowed to do to time and the camera.
 *
 * Everything here is a ceiling the accessibility settings scale down, never a
 * floor. `freeze` stops the *render* clock, not the simulation: the arena keeps
 * counting, which is why a freeze can never change a fight.
 */
export interface ImpactGrammar {
  /** Milliseconds the frame holds on a heavy hit. */
  readonly freezeMs: number;
  /** Milliseconds on a finisher beat, the only place a long hold is earned. */
  readonly finisherFreezeMs: number;
  /** Most freezes allowed in any rolling second. Past it, hits land unfrozen. */
  readonly maxFreezesPerSecond: number;
  /** Camera impulse metres at full shake, before the player's own scale. */
  readonly impulseMeters: number;
  /** Pose exaggeration: how far a reaction pose is pushed past its animation. */
  readonly poseExaggeration: number;
  /** Chromatic offset in pixels. Restrained means barely there. */
  readonly chromaticPx: number;
  /** Speed lines drawn on a dash or a heavy swing. Zero on Low. */
  readonly speedLines: number;
}

export const IMPACT_GRAMMAR: Readonly<Record<"low" | "medium" | "high" | "cinematic", ImpactGrammar>> = {
  low: {
    freezeMs: 40,
    finisherFreezeMs: 90,
    maxFreezesPerSecond: 2,
    impulseMeters: 0.5,
    poseExaggeration: 1.08,
    chromaticPx: 0,
    speedLines: 0,
  },
  medium: {
    freezeMs: 55,
    finisherFreezeMs: 130,
    maxFreezesPerSecond: 2,
    impulseMeters: 0.7,
    poseExaggeration: 1.12,
    chromaticPx: 0,
    speedLines: 8,
  },
  high: {
    freezeMs: 70,
    finisherFreezeMs: 180,
    maxFreezesPerSecond: 3,
    impulseMeters: 0.9,
    poseExaggeration: 1.16,
    chromaticPx: 1.5,
    speedLines: 14,
  },
  cinematic: {
    freezeMs: 85,
    finisherFreezeMs: 240,
    maxFreezesPerSecond: 3,
    impulseMeters: 1.1,
    poseExaggeration: 1.2,
    chromaticPx: 2.5,
    speedLines: 20,
  },
};

/** The whole guide validates: floors under ceilings, freezes bounded, lines sane. */
export function validateStyleGuide(): string[] {
  const errors: string[] = [];
  for (const [name, surface] of Object.entries(SURFACE_STYLES)) {
    if (surface.roughnessFloor < 0.3) {
      errors.push(`${name}: a roughness floor under 0.3 is the flat look the brief refuses`);
    }
    if (surface.rimStrength < 0 || surface.rimStrength > 1) errors.push(`${name}: rim out of range`);
    if (surface.emissionCeiling > 1) errors.push(`${name}: emission past 1 blooms into mush`);
  }
  for (const [level, grammar] of Object.entries(IMPACT_GRAMMAR)) {
    if (grammar.freezeMs > 100) {
      errors.push(`${level}: an ordinary freeze past 100 ms reads as a hitch, not a hit`);
    }
    if (grammar.finisherFreezeMs > 300) errors.push(`${level}: finisher freeze past 300 ms is a pause`);
    if (grammar.chromaticPx > 3) errors.push(`${level}: chromatic past 3 px stops being restrained`);
    if (grammar.maxFreezesPerSecond > 3) errors.push(`${level}: more than 3 freezes a second is strobing`);
  }
  return errors;
}
