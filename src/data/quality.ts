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
  "city-alert-state",
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
  /** Ceiling on city blocks drawn at once, across every destruction group. */
  readonly maxCityBlocks: number;
  /** Ceiling on pooled agent instances: vehicles, ships, aircraft and crowds combined. */
  readonly maxCityAgents: number;
  /** Destruction groups kept resident, nearest first. Beyond this the city fades out. */
  readonly maxCityGroups: number;
  /** Footstep decals kept on the ground behind a Jaeger. The oldest is reused. */
  readonly maxFootstepDecals: number;
  /**
   * Scale references drawn around a piloted machine: aircraft, birds, street
   * lights. These are how a player reads how big the thing they are driving is,
   * so the floor is high enough that Low still has some.
   */
  readonly maxScaleReferences: number;
  /**
   * Hard ceiling on live projectiles. The pool is allocated at this size and
   * never grows, so a barrage refuses rather than stuttering.
   */
  readonly maxProjectiles: number;
  /**
   * Ceiling on rigid debris bodies in the air and on the ground at once. The
   * pool is allocated at this size and never grows: a collapse that wants more
   * gets what is free and the shortfall is reported.
   */
  readonly maxDebrisBodies: number;
  /**
   * Staff instances drawn in the Shatterdome room the player is standing in.
   * Only the active room is ever populated, so this is a per-room ceiling rather
   * than a complex-wide one.
   */
  readonly maxInteriorStaff: number;
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
    maxCityBlocks: 260,
    maxCityAgents: 220,
    maxCityGroups: 30,
    maxInteriorStaff: 6,
    maxFootstepDecals: 12,
    maxScaleReferences: 24,
    maxProjectiles: 48,
    maxDebrisBodies: 60,
    telegraphs: [...REQUIRED_TELEGRAPHS],
    notes: "No shadows or reflections, one wave octave, a thinner city. Every telegraph is still drawn.",
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
    maxCityBlocks: 620,
    maxCityAgents: 620,
    maxCityGroups: 70,
    maxInteriorStaff: 14,
    maxFootstepDecals: 28,
    maxScaleReferences: 60,
    maxProjectiles: 96,
    maxDebrisBodies: 140,
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
    maxCityBlocks: 1200,
    maxCityAgents: 1500,
    maxCityGroups: 130,
    maxInteriorStaff: 26,
    maxFootstepDecals: 56,
    maxScaleReferences: 120,
    maxProjectiles: 180,
    maxDebrisBodies: 260,
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
    maxCityBlocks: 2200,
    maxCityAgents: 3600,
    maxCityGroups: 240,
    maxInteriorStaff: 40,
    maxFootstepDecals: 96,
    maxScaleReferences: 220,
    maxProjectiles: 320,
    maxDebrisBodies: 420,
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
    "maxCityBlocks",
    "maxCityAgents",
    "maxCityGroups",
    "maxInteriorStaff",
  ] as const) {
    const value = preset[key];
    if (!Number.isFinite(value) || value < 0) errors.push(`${key} must be a non-negative finite number`);
  }
  // A water sheet needs at least a quad, and an odd resolution keeps a vertex at
  // the sector centre where the player usually is.
  if (preset.waterGridResolution < 3) errors.push("waterGridResolution must be at least 3");
  if (preset.waterWaveOctaves < 1) errors.push("waterWaveOctaves must be at least 1");
  // A city with no blocks or no groups is not a lower quality city, it is an
  // absent one, and absence is information rather than detail.
  if (preset.maxCityBlocks < 1) errors.push("maxCityBlocks must be at least 1");
  if (preset.maxCityGroups < 1) errors.push("maxCityGroups must be at least 1");
  if (preset.maxInteriorStaff < 1) errors.push("maxInteriorStaff must be at least 1");
  // A machine with no scale references beside it is a machine with no scale.
  // That is information rather than detail, so no preset may drop it to nothing.
  if (preset.maxScaleReferences < 8) {
    errors.push("maxScaleReferences must be at least 8: scale is information, not detail");
  }
  if (preset.maxFootstepDecals < 4) errors.push("maxFootstepDecals must be at least 4");
  // A salvo weapon puts three rounds in the air at once and a rotary cannon
  // several a second. Fewer than this and a weapon silently stops working.
  if (preset.maxProjectiles < 24) errors.push("maxProjectiles must be at least 24");
  // A collapse that cannot throw a handful of chunks is not a collapse.
  if (preset.maxDebrisBodies < 32) errors.push("maxDebrisBodies must be at least 32");
  // An empty room is not a cheaper room, it is an abandoned one, and a complex
  // with nobody in it tells the player something false about the game.
  if (preset.maxInteriorStaff < 1) errors.push("maxInteriorStaff must be at least 1");

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
