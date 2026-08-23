import { describe, expect, it } from "vitest";
import {
  DEPTH_ZONES,
  FLOATING_SUBMERSION,
  MAX_WAVE_AMPLITUDE_METERS,
  STANDABLE_DEPTH_FRACTION,
  WATER_STATES,
  audioEnvironmentFor,
  buoyantForceNewtons,
  classifyWaterState,
  depthZoneFor,
  resolveFeetHeight,
  sampleWaveHeight,
  sampleWaveVelocity,
  submergedVolumeFor,
  validateWaterContext,
  waveAmplitudeFor,
  waveFieldCoordinates,
} from "../../src/world/ocean";

const CALM = { windSpeedMps: 2, windDirectionDeg: 40 };
const STORM = { windSpeedMps: 28, windDirectionDeg: 210 };

describe("depth zones", () => {
  it("orders from shallow to deep and always resolves", () => {
    for (let index = 1; index < DEPTH_ZONES.length; index += 1) {
      const previous = DEPTH_ZONES[index - 1];
      const current = DEPTH_ZONES[index];
      expect(current?.maxDepthMeters).toBeGreaterThan(previous?.maxDepthMeters ?? 0);
      // Deeper is darker and you can see less.
      expect(current?.visibilityMeters).toBeLessThanOrEqual(previous?.visibilityMeters ?? Infinity);
      expect(current?.darkness).toBeGreaterThanOrEqual(previous?.darkness ?? 0);
    }
    expect(depthZoneFor(0).id).toBe("shoreline");
    expect(depthZoneFor(1e9).id).toBe("abyssal");
  });

  it("stops being standable once it is deeper than a Jaeger is tall", () => {
    expect(depthZoneFor(30).standable).toBe(true);
    expect(depthZoneFor(500).standable).toBe(false);
  });
});

describe("wave sampling", () => {
  it("is a pure function of its arguments", () => {
    const options = { east: 120, north: -430, timeSeconds: 88, ...CALM };
    const first = sampleWaveHeight(options);
    sampleWaveHeight({ ...options, timeSeconds: 500 });
    expect(sampleWaveHeight(options)).toBe(first);
  });

  it("moves with time", () => {
    const options = { east: 0, north: 0, ...STORM };
    const a = sampleWaveHeight({ ...options, timeSeconds: 0 });
    const b = sampleWaveHeight({ ...options, timeSeconds: 3 });
    expect(a).not.toBeCloseTo(b, 3);
  });

  it("stays inside the amplitude the wind justifies", () => {
    for (const wind of [0, 5, 15, 40, 120]) {
      const amplitude = waveAmplitudeFor(wind);
      expect(amplitude).toBeLessThanOrEqual(MAX_WAVE_AMPLITUDE_METERS);
      for (let x = 0; x < 800; x += 37) {
        const height = sampleWaveHeight({
          east: x,
          north: x * 0.6,
          timeSeconds: x * 0.1,
          windSpeedMps: wind,
          windDirectionDeg: 15,
        });
        expect(Math.abs(height)).toBeLessThanOrEqual(amplitude + 1e-9);
      }
    }
  });

  it("makes a storm sea taller than a calm one", () => {
    expect(waveAmplitudeFor(30)).toBeGreaterThan(waveAmplitudeFor(2) * 4);
  });

  it("still moves on a windless day rather than going flat", () => {
    expect(waveAmplitudeFor(0)).toBeGreaterThan(0);
  });

  it("keeps the same sea level and the same ceiling when octaves are dropped", () => {
    // What must not change with quality is where the water sits and how high it
    // can reach. A single octave is a pure sine, so it spends *more* of its time
    // away from zero than three partly cancelling octaves do; that is detail
    // changing, not the sea moving, and asserting on mean absolute height would
    // wrongly call it a regression.
    const amplitude = waveAmplitudeFor(STORM.windSpeedMps);
    let fullMean = 0;
    let coarseMean = 0;
    let coarsePeak = 0;
    let samples = 0;

    for (let x = 0; x < 8_000; x += 7) {
      const options = { east: x, north: x * 0.37, timeSeconds: 12, ...STORM };
      fullMean += sampleWaveHeight(options);
      const coarse = sampleWaveHeight({ ...options, octaves: 1 });
      coarseMean += coarse;
      coarsePeak = Math.max(coarsePeak, Math.abs(coarse));
      samples += 1;
    }

    // Both average out to sea level.
    expect(Math.abs(fullMean / samples)).toBeLessThan(amplitude * 0.05);
    expect(Math.abs(coarseMean / samples)).toBeLessThan(amplitude * 0.05);
    // And neither can exceed the amplitude the wind justifies.
    expect(coarsePeak).toBeLessThanOrEqual(amplitude + 1e-9);
  });

  it("reports vertical surface velocity", () => {
    const options = { east: 10, north: 20, timeSeconds: 5, ...STORM };
    const velocity = sampleWaveVelocity(options);
    expect(Number.isFinite(velocity)).toBe(true);
    // A calm sea moves slower than a storm one.
    const calm = Math.abs(sampleWaveVelocity({ ...options, ...CALM }));
    expect(Math.abs(velocity)).toBeGreaterThan(calm);
  });

  it("uses globe-fixed coordinates so the sea does not move when the origin does", () => {
    const a = waveFieldCoordinates(22.3193, 114.1694);
    const b = waveFieldCoordinates(22.3193, 114.1694);
    expect(a).toEqual(b);
    // Moving north increases the north coordinate.
    expect(waveFieldCoordinates(23, 114.1694).north).toBeGreaterThan(a.north);
  });
});

describe("water state", () => {
  const JAEGER = 75;

  function situation(groundHeight: number, waterHeight: number, feetHeight: number) {
    return classifyWaterState({
      groundHeightMeters: groundHeight,
      waterHeightMeters: waterHeight,
      entityHeightMeters: JAEGER,
      feetHeightMeters: feetHeight,
    });
  }

  it("names every state it can report", () => {
    expect([...WATER_STATES]).toEqual(["dry", "wading", "surface-combat", "swimming", "underwater"]);
  });

  it("is dry on land above the water", () => {
    expect(situation(120, 0, 120).state).toBe("dry");
    expect(situation(120, 0, 120).depthMeters).toBe(0);
  });

  it("wades in the shallows", () => {
    // Ten metres of water on a seventy-five metre body: ankle deep.
    const wading = situation(-10, 0, -10);
    expect(wading.state).toBe("wading");
    expect(wading.grounded).toBe(true);
    expect(wading.submergedFraction).toBeCloseTo(10 / 75, 3);
  });

  it("fights at the surface when standing chest deep", () => {
    const standing = situation(-50, 0, -50);
    expect(standing.state).toBe("surface-combat");
    expect(standing.grounded).toBe(true);
    expect(standing.eyesSubmerged).toBe(false);
  });

  it("swims when its feet leave the bottom", () => {
    // Floating over the deep: the seabed is far below.
    const floating = situation(-400, 0, -JAEGER * FLOATING_SUBMERSION);
    expect(floating.state).toBe("swimming");
    expect(floating.grounded).toBe(false);
  });

  it("goes underwater once its eyes are below the surface", () => {
    const under = situation(-200, 0, -120);
    expect(under.state).toBe("underwater");
    expect(under.eyesSubmerged).toBe(true);
  });

  it("moves through every state as the ground drops away", () => {
    const seen: string[] = [];
    for (const ground of [50, -10, -50, -400, -400]) {
      const feet = resolveFeetHeight({
        groundHeightMeters: ground,
        waterHeightMeters: 0,
        entityHeightMeters: JAEGER,
        diving: ground === -400 && seen.includes("swimming"),
      });
      seen.push(situation(ground, 0, feet).state);
    }
    expect(seen).toEqual(["dry", "wading", "surface-combat", "swimming", "underwater"]);
  });

  it("rejects a nonsensical context rather than reporting a state for it", () => {
    expect(() =>
      classifyWaterState({
        groundHeightMeters: Number.NaN,
        waterHeightMeters: 0,
        entityHeightMeters: 10,
        feetHeightMeters: 0,
      }),
    ).toThrow(/must be a finite number/);
    expect(
      validateWaterContext({
        groundHeightMeters: 0,
        waterHeightMeters: 0,
        entityHeightMeters: 0,
        feetHeightMeters: 0,
      }).join(" "),
    ).toMatch(/entityHeightMeters must be positive/);
  });
});

describe("standing, wading and floating", () => {
  const JAEGER = 75;

  it("stands on dry ground", () => {
    expect(
      resolveFeetHeight({ groundHeightMeters: 90, waterHeightMeters: 0, entityHeightMeters: JAEGER }),
    ).toBe(90);
  });

  it("stands on the bottom while the water is shallower than it is tall", () => {
    const depth = JAEGER * STANDABLE_DEPTH_FRACTION - 1;
    expect(
      resolveFeetHeight({ groundHeightMeters: -depth, waterHeightMeters: 0, entityHeightMeters: JAEGER }),
    ).toBe(-depth);
  });

  it("floats once the water is deeper than it can stand in", () => {
    const feet = resolveFeetHeight({
      groundHeightMeters: -400,
      waterHeightMeters: 3,
      entityHeightMeters: JAEGER,
    });
    expect(feet).toBeCloseTo(3 - JAEGER * FLOATING_SUBMERSION, 6);
  });

  it("walks the bottom when deliberately diving", () => {
    expect(
      resolveFeetHeight({
        groundHeightMeters: -400,
        waterHeightMeters: 0,
        entityHeightMeters: JAEGER,
        diving: true,
      }),
    ).toBe(-400);
  });
});

describe("buoyancy hook", () => {
  it("scales with submerged volume", () => {
    expect(buoyantForceNewtons(0)).toBe(0);
    expect(buoyantForceNewtons(2)).toBeCloseTo(buoyantForceNewtons(1) * 2, 6);
    // A cubic metre of sea water weighs about a tonne, so it pushes back with
    // about ten kilonewtons.
    expect(buoyantForceNewtons(1)).toBeGreaterThan(9_000);
    expect(buoyantForceNewtons(1)).toBeLessThan(11_000);
  });

  it("refuses a negative volume", () => {
    expect(() => buoyantForceNewtons(-1)).toThrow(/non-negative finite number/);
  });

  it("derives a submerged volume from a water situation", () => {
    const situation = classifyWaterState({
      groundHeightMeters: -50,
      waterHeightMeters: 0,
      entityHeightMeters: 75,
      feetHeightMeters: -50,
    });
    const volume = submergedVolumeFor(situation, 100, 75);
    expect(volume).toBeGreaterThan(0);
    expect(volume).toBeCloseTo(100 * 75 * situation.submergedFraction, 6);
    expect(() => submergedVolumeFor(situation, 0, 75)).toThrow(/must both be positive/);
  });
});

describe("audio environment", () => {
  function at(groundHeight: number, feetHeight: number) {
    return classifyWaterState({
      groundHeightMeters: groundHeight,
      waterHeightMeters: 0,
      entityHeightMeters: 75,
      feetHeightMeters: feetHeight,
    });
  }

  it("keeps full bandwidth above the water", () => {
    const surface = audioEnvironmentFor(at(100, 100), 5, 0);
    expect(surface.state).toBe("surface");
    expect(surface.lowPassHz).toBeGreaterThan(15_000);
    expect(surface.waterMix).toBe(0);
  });

  it("cuts the highs underwater rather than just turning the volume down", () => {
    const under = audioEnvironmentFor(at(-300, -200), 5, 0);
    expect(under.state).toBe("underwater");
    expect(under.lowPassHz).toBeLessThan(1_000);
    expect(under.waterMix).toBe(1);
    // Not simply quieter: an underwater bed is still clearly audible.
    expect(under.ambientLevel).toBeGreaterThan(0.4);
  });

  it("has a partial state for a body half in the water", () => {
    const partial = audioEnvironmentFor(at(-30, -30), 5, 0);
    expect(partial.state).toBe("partial");
    expect(partial.waterMix).toBeGreaterThan(0);
    expect(partial.waterMix).toBeLessThan(1);
  });

  it("gets louder with wind and rain above the surface", () => {
    const calm = audioEnvironmentFor(at(100, 100), 0, 0);
    const gale = audioEnvironmentFor(at(100, 100), 25, 1);
    expect(gale.ambientLevel).toBeGreaterThan(calm.ambientLevel);
  });
});
