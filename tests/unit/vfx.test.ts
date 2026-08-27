import { describe, expect, it } from "vitest";
import {
  EDGE_TREATMENTS,
  IMPACT_GRAMMAR,
  PALETTE_TOKENS,
  SURFACE_STYLES,
  createPaletteRegistry,
  validatePaletteToken,
  validateStyleGuide,
} from "../../src/data/styleGuide";
import {
  EFFECT_DEFINITIONS,
  EFFECT_KINDS,
  EffectPoolLedger,
  createEffectRegistry,
  validateEffect,
  worstCaseParticles,
} from "../../src/vfx/effectsModel";
import {
  defaultVfxSettings,
  loadVfxSettings,
  memoryVfxStorage,
  normaliseVfxSettings,
  saveVfxSettings,
  validateVfxSettings,
} from "../../src/vfx/vfxSettings";
import { QUALITY_PRESETS } from "../../src/data/quality";

describe("the style guide", () => {
  it("holds its own rules", () => {
    expect(validateStyleGuide()).toEqual([]);
  });

  it("gives every colour a job, and validates the lot", () => {
    expect(createPaletteRegistry().all().length).toBe(PALETTE_TOKENS.length);
    for (const token of PALETTE_TOKENS) expect(validatePaletteToken(token)).toEqual([]);
  });

  it("refuses a colour with no stated job", () => {
    const token = { ...PALETTE_TOKENS[0]!, role: " " };
    expect(validatePaletteToken(token).join(" ")).toMatch(/must say what it is for/);
  });

  it("marks the warning colours, which survive every setting", () => {
    const warnings = PALETTE_TOKENS.filter((token) => token.warning);
    expect(warnings.map((token) => token.id)).toEqual(["style.warning-red", "style.warning-amber"]);
  });

  it("keeps every roughness floor above the flat look", () => {
    for (const style of Object.values(SURFACE_STYLES)) {
      expect(style.roughnessFloor).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("gives the machine a rim and the terrain none", () => {
    expect(SURFACE_STYLES.machine.rimStrength).toBeGreaterThan(0.3);
    expect(SURFACE_STYLES.terrain.rimStrength).toBe(0);
  });

  it("keeps true edge lines off Low and Medium, where they would shimmer", () => {
    expect(EDGE_TREATMENTS.low.edges).toBe(false);
    expect(EDGE_TREATMENTS.medium.edges).toBe(false);
    expect(EDGE_TREATMENTS.high.edges).toBe(true);
    expect(EDGE_TREATMENTS.high.minHeightMeters).toBeGreaterThan(10);
  });

  it("keeps every freeze short and every chromatic restrained", () => {
    for (const grammar of Object.values(IMPACT_GRAMMAR)) {
      expect(grammar.freezeMs).toBeLessThanOrEqual(100);
      expect(grammar.finisherFreezeMs).toBeLessThanOrEqual(300);
      expect(grammar.chromaticPx).toBeLessThanOrEqual(3);
      expect(grammar.maxFreezesPerSecond).toBeLessThanOrEqual(3);
    }
  });
});

describe("the effect catalogue", () => {
  it("has a definition for every kind, and they all validate", () => {
    expect(createEffectRegistry().all().length).toBe(EFFECT_KINDS.length);
    for (const effect of EFFECT_DEFINITIONS) expect(validateEffect(effect)).toEqual([]);
  });

  it("colours everything from the palette", () => {
    const paletteIds = new Set(PALETTE_TOKENS.map((token) => token.id));
    for (const effect of EFFECT_DEFINITIONS) expect(paletteIds.has(effect.paletteId)).toBe(true);
  });

  it("never lets a lower preset allow more than a higher one", () => {
    for (const effect of EFFECT_DEFINITIONS) {
      expect(effect.maxAlive.low).toBeLessThanOrEqual(effect.maxAlive.cinematic);
      expect(effect.particlesEach.low).toBeLessThanOrEqual(effect.particlesEach.cinematic);
    }
  });

  it("marks lightning, plasma, muzzle flash and finishers as flashes", () => {
    const flashes = EFFECT_DEFINITIONS.filter((effect) => effect.flash).map((effect) => effect.id);
    expect(flashes).toEqual(expect.arrayContaining(["lightning", "plasma", "muzzle-flash", "finisher"]));
  });

  it("has no speed lines at all on Low, by the style guide", () => {
    const lines = EFFECT_DEFINITIONS.find((effect) => effect.id === "speed-lines")!;
    expect(lines.maxAlive.low).toBe(0);
  });

  it("stays inside every quality preset's particle ceiling", () => {
    for (const preset of QUALITY_PRESETS) {
      // The whole catalogue firing at once must fit beside the weather budget.
      expect(worstCaseParticles(preset.id)).toBeLessThanOrEqual(preset.maxParticles);
    }
  });

  it("refuses an effect coloured outside the palette", () => {
    const rogue = { ...EFFECT_DEFINITIONS[0]!, paletteId: "hotpink" };
    expect(validateEffect(rogue).join(" ")).toMatch(/palette/);
  });
});

describe("the pool ledger", () => {
  it("grants up to the ceiling and refuses past it, counting the refusals", () => {
    const ledger = new EffectPoolLedger("low");
    const ceiling = EFFECT_DEFINITIONS.find((effect) => effect.id === "sparks")!.maxAlive.low;
    const granted: number[] = [];
    for (let index = 0; index < ceiling + 5; index += 1) {
      const id = ledger.request("sparks");
      if (id !== null) granted.push(id);
    }
    expect(granted).toHaveLength(ceiling);
    expect(ledger.counters().refusedAtCeiling).toBe(5);
  });

  it("returns capacity exactly once however often release is called", () => {
    const ledger = new EffectPoolLedger("high");
    const id = ledger.request("sparks")!;
    expect(ledger.release(id)).toBe(true);
    expect(ledger.release(id)).toBe(false);
    expect(ledger.aliveOf("sparks")).toBe(0);
  });

  it("ages bursts out and holds sustained effects until released by name", () => {
    const ledger = new EffectPoolLedger("high");
    ledger.request("sparks");
    const steam = ledger.request("steam")!;
    for (let step = 0; step < 10; step += 1) ledger.advance(0.5);
    expect(ledger.aliveOf("sparks")).toBe(0);
    expect(ledger.aliveOf("steam")).toBe(1);
    ledger.release(steam);
    expect(ledger.atBaseline()).toBe(true);
  });

  it("refuses everything at zero density, and counts it as a settings refusal", () => {
    const ledger = new EffectPoolLedger("high");
    ledger.setDensity(0);
    expect(ledger.request("sparks")).toBeNull();
    expect(ledger.counters().refusedBySettings).toBe(1);
    expect(ledger.counters().refusedAtCeiling).toBe(0);
  });

  it("scales the ceilings with the density setting", () => {
    const ledger = new EffectPoolLedger("cinematic");
    ledger.setDensity(0.5);
    const full = EFFECT_DEFINITIONS.find((effect) => effect.id === "sparks")!.maxAlive.cinematic;
    let granted = 0;
    for (let index = 0; index < full; index += 1) {
      if (ledger.request("sparks") !== null) granted += 1;
    }
    expect(granted).toBe(Math.floor(full * 0.5));
  });
});

describe("the effect settings", () => {
  it("round trips through storage", () => {
    const storage = memoryVfxStorage();
    const wanted = { ...defaultVfxSettings(), flashes: false, particleDensity: 0.4 };
    expect(saveVfxSettings(storage, wanted).ok).toBe(true);
    const loaded = loadVfxSettings(storage);
    expect(loaded.restored).toBe(true);
    expect(loaded.settings.flashes).toBe(false);
    expect(loaded.settings.particleDensity).toBeCloseTo(0.4, 5);
  });

  it("clamps a drifted value rather than refusing the lot", () => {
    const settings = normaliseVfxSettings({ shakeScale: 4, particleDensity: -1 });
    expect(settings.shakeScale).toBe(1);
    expect(settings.particleDensity).toBe(0);
    expect(validateVfxSettings(settings)).toEqual([]);
  });

  it("resets unreadable storage to the defaults with a note", () => {
    const storage = memoryVfxStorage();
    storage.setItem("shatterdome.vfx.v1", "{broken");
    const loaded = loadVfxSettings(storage);
    expect(loaded.restored).toBe(false);
    expect(loaded.settings).toEqual(defaultVfxSettings());
  });

  it("says so rather than throwing when the browser will not store", () => {
    expect(saveVfxSettings(null, defaultVfxSettings()).ok).toBe(false);
    expect(loadVfxSettings(null).restored).toBe(false);
  });
});
