import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Quality presets.
 *
 * Every preset is a budget, not a feeling. Each field is a number some system
 * reads directly, so turning quality down provably costs less rather than
 * looking like it might.
 *
 * The rule that shapes the whole table: **lowering quality may remove detail,
 * never information**. A player on Low must still see the lightning that
 * telegraphs a strike, the spray that marks where something entered the water,
 * and the fog that explains why they cannot see. Those are listed explicitly in
 * `essentialTelegraphs` and asserted present at every level, so a future tuning
 * pass cannot quietly delete one to buy frame time.
 */

export const QUALITY_LEVELS = ["low", "medium", "high", "cinematic"] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export const DEFAULT_QUALITY_LEVEL: QualityLevel = "high";

/**
 * Telegraphs that carry information a player needs to react. Every preset must
 * include all of them; the registry refuses one that does not.
 */
export const REQUIRED_TELEGRAPHS = [
  "lightning-flash",
  "water-entry-spray",
  "fog-visibility-cue",
  "wave-surface-motion",
] as const;
export type Telegraph = (typeof REQUIRED_TELEGRAPHS)[number];

export type ReflectionMode = "none" | "probe" | "planar";

export interface QualityPreset extends RegistryEntry {
  readonly id: QualityLevel;
  readonly displayName: string;
  /** Hard ceiling on live particles across every weather emitter combined. */
  readonly maxParticles: number;
  /** Particles emitted per second at full precipitation, before the ceiling. */
  readonly particleRatePerSecond: number;
  readonly reflections: ReflectionMode;
  /** Zero disables shadow mapping entirely. */
  readonly shadowMapSize: number;
  /** Vertices per edge of a streamed sector's water sheet. */
  readonly waterGridResolution: number;
  /** Wave octaves evaluated for rendering. Gameplay always uses all of them. */
  readonly waterWaveOctaves: number;
  /** How many sectors get animated water each frame, nearest first. */
  readonly animatedWaterSectors: number;
  /** Multiplier on scene fog density, so Low is not blinded by cheap fog. */
  readonly fogQuality: number;
  readonly telegraphs: readonly Telegraph[];
  readonly notes: string;
}

const PRESETS: readonly QualityPreset[] = [
  {
    id: "low",
    displayName: "Low",
    maxParticles: 600,
    particleRatePerSecond: 260,
    reflections: "none",
    shadowMapSize: 0,
    waterGridResolution: 5,
    waterWaveOctaves: 1,
    animatedWaterSectors: 1,
    fogQuality: 0.75,
    telegraphs: [...REQUIRED_TELEGRAPHS],
    notes: "No shadows or reflections, one wave octave. Every telegraph is still drawn.",
  },
  {
    id: "medium",
    displayName: "Medium",
    maxParticles: 2_000,
    particleRatePerSecond: 900,
    reflections: "probe",
    shadowMapSize: 1_024,
    waterGridResolution: 9,
    waterWaveOctaves: 2,
    animatedWaterSectors: 3,
    fogQuality: 0.9,
    telegraphs: [...REQUIRED_TELEGRAPHS],
    notes: "Shadows on, cheap reflections, two wave octaves.",
  },
  {
    id: "high",
    displayName: "High",
    maxParticles: 6_000,
    particleRatePerSecond: 2_600,
    reflections: "probe",
    shadowMapSize: 2_048,
    waterGridResolution: 17,
    waterWaveOctaves: 3,
    animatedWaterSectors: 5,
    fogQuality: 1,
    telegraphs: [...REQUIRED_TELEGRAPHS],
    notes: "The default. Full wave detail and a full-resolution shadow map.",
  },
  {
    id: "cinematic",
    displayName: "Cinematic",
    maxParticles: 16_000,
    particleRatePerSecond: 6_500,
    reflections: "planar",
    shadowMapSize: 4_096,
    waterGridResolution: 25,
    waterWaveOctaves: 3,
    animatedWaterSectors: 9,
    fogQuality: 1.15,
    telegraphs: [...REQUIRED_TELEGRAPHS],
    notes: "For capture rather than play. Not expected to hold 60 fps in a heavy fight.",
  },
];

export function validateQualityPreset(preset: QualityPreset): string[] {
  const errors: string[] = [];
  if (!QUALITY_LEVELS.includes(preset.id)) {
    errors.push(`id must be one of: ${QUALITY_LEVELS.join(", ")}`);
  }
  if (!preset.displayName) errors.push("displayName required");

  for (const key of [
    "maxParticles",
    "particleRatePerSecond",
    "shadowMapSize",
    "waterGridResolution",
    "waterWaveOctaves",
    "animatedWaterSectors",
    "fogQuality",
  ] as const) {
    const value = preset[key];
    if (!Number.isFinite(value) || value < 0) errors.push(`${key} must be a non-negative finite number`);
  }
  // A water sheet needs at least a quad, and an odd resolution keeps a vertex at
  // the sector centre where the player usually is.
  if (preset.waterGridResolution < 3) errors.push("waterGridResolution must be at least 3");
  if (preset.waterWaveOctaves < 1) errors.push("waterWaveOctaves must be at least 1");

  const missing = REQUIRED_TELEGRAPHS.filter((telegraph) => !preset.telegraphs.includes(telegraph));
  if (missing.length > 0) {
    errors.push(
      `telegraphs must include every required telegraph; missing ${missing.join(", ")}. ` +
        "Lowering quality may remove detail, never information.",
    );
  }
  return errors;
}

export function createQualityRegistry(): ContentRegistry<QualityPreset> {
  const registry = new ContentRegistry<QualityPreset>(validateQualityPreset);
  for (const preset of PRESETS) registry.register(preset);
  return registry;
}

export const QUALITY_PRESETS = PRESETS;

export function qualityPresetFor(
  registry: ContentRegistry<QualityPreset>,
  level: QualityLevel,
): QualityPreset {
  return registry.getOrThrow(level);
}

/** Reads a quality level from a URL query, falling back to the default. */
export function resolveQualityLevel(search: string): QualityLevel {
  const raw = new URLSearchParams(search).get("quality");
  const match = QUALITY_LEVELS.find((level) => level === raw);
  return match ?? DEFAULT_QUALITY_LEVEL;
}
