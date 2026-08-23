import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALITY_LEVEL,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  REQUIRED_TELEGRAPHS,
  createQualityRegistry,
  resolveQualityLevel,
  validateQualityPreset,
  type QualityPreset,
} from "../../src/data/quality";

const registry = createQualityRegistry();

describe("quality presets", () => {
  it("registers one preset per level", () => {
    for (const level of QUALITY_LEVELS) expect(registry.has(level)).toBe(true);
    expect(registry.all()).toHaveLength(QUALITY_LEVELS.length);
  });

  it("gets cheaper at every lower level", () => {
    const ordered = QUALITY_LEVELS.map((level) => registry.getOrThrow(level));
    for (let index = 1; index < ordered.length; index += 1) {
      const lower = ordered[index - 1];
      const higher = ordered[index];
      if (!lower || !higher) continue;
      expect(higher.maxParticles).toBeGreaterThan(lower.maxParticles);
      expect(higher.particleRatePerSecond).toBeGreaterThan(lower.particleRatePerSecond);
      expect(higher.shadowMapSize).toBeGreaterThanOrEqual(lower.shadowMapSize);
      expect(higher.waterGridResolution).toBeGreaterThan(lower.waterGridResolution);
      expect(higher.animatedWaterSectors).toBeGreaterThanOrEqual(lower.animatedWaterSectors);
      expect(higher.waterWaveOctaves).toBeGreaterThanOrEqual(lower.waterWaveOctaves);
    }
  });

  it("turns shadows and reflections off at the bottom", () => {
    const low = registry.getOrThrow("low");
    expect(low.shadowMapSize).toBe(0);
    expect(low.reflections).toBe("none");
  });

  it("keeps every required telegraph at every level, Low included", () => {
    // The rule the whole table exists to enforce: lowering quality removes
    // detail, never information.
    for (const preset of QUALITY_PRESETS) {
      for (const telegraph of REQUIRED_TELEGRAPHS) {
        expect(preset.telegraphs, `${preset.id} dropped ${telegraph}`).toContain(telegraph);
      }
    }
  });

  it("refuses to register a preset that drops a telegraph", () => {
    const cheating: QualityPreset = {
      ...registry.getOrThrow("low"),
      id: "low",
      telegraphs: REQUIRED_TELEGRAPHS.filter((entry) => entry !== "lightning-flash"),
    };
    const errors = validateQualityPreset(cheating);
    expect(errors.join(" ")).toMatch(/missing lightning-flash/);
    expect(errors.join(" ")).toMatch(/remove detail, never information/);
  });

  it("keeps Low playable rather than blank", () => {
    const low = registry.getOrThrow("low");
    // Still enough particles to read rain, still a water surface that moves.
    expect(low.maxParticles).toBeGreaterThan(200);
    expect(low.particleRatePerSecond).toBeGreaterThan(100);
    expect(low.waterWaveOctaves).toBeGreaterThanOrEqual(1);
    expect(low.animatedWaterSectors).toBeGreaterThanOrEqual(1);
    expect(low.waterGridResolution).toBeGreaterThanOrEqual(3);
    // And fog is eased off, so Low is not blinded by cheap fog it cannot afford
    // to render nicely.
    expect(low.fogQuality).toBeLessThan(1);
  });

  it("rejects nonsensical budgets", () => {
    const base = registry.getOrThrow("high");
    expect(validateQualityPreset({ ...base, waterGridResolution: 2 }).join(" ")).toMatch(/at least 3/);
    expect(validateQualityPreset({ ...base, waterWaveOctaves: 0 }).join(" ")).toMatch(/at least 1/);
    expect(validateQualityPreset({ ...base, maxParticles: -1 }).join(" ")).toMatch(/non-negative/);
  });

  it("resolves a level from the URL and falls back to the default", () => {
    expect(resolveQualityLevel("?quality=low")).toBe("low");
    expect(resolveQualityLevel("?quality=cinematic")).toBe("cinematic");
    expect(resolveQualityLevel("?quality=ultra")).toBe(DEFAULT_QUALITY_LEVEL);
    expect(resolveQualityLevel("")).toBe(DEFAULT_QUALITY_LEVEL);
  });
});
