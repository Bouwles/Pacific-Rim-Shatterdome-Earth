import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Scene,
  Vector3,
  type DirectionalLight as DirectionalLightType,
} from "@babylonjs/core";
import type { EnvironmentSample } from "../world/environment";
import type { QualityPreset } from "../data/quality";

/**
 * Sky, sun, moon and fog.
 *
 * Reads the same `EnvironmentSample` gameplay reads and decides only how it
 * looks. It never computes weather or time itself, so what the player sees and
 * what an AI can see cannot disagree.
 *
 * It drives the boot scene's existing sun rather than creating one, and owns
 * exactly two lights of its own: a moon and an ambient fill. Everything it
 * creates is released in dispose().
 */

/** Degrees below which the sun reddens. */
const HORIZON_REDDENING_DEG = 12;

const DAY_ZENITH = new Color3(0.42, 0.6, 0.85);
const DAY_HORIZON = new Color3(0.66, 0.76, 0.86);
const DUSK = new Color3(0.5, 0.3, 0.26);
const NIGHT = new Color3(0.03, 0.05, 0.1);
const OVERCAST = new Color3(0.44, 0.47, 0.5);
const SUN_WARM = new Color3(1, 0.72, 0.48);
const SUN_WHITE = new Color3(1, 0.97, 0.9);
const MOON_COLOUR = new Color3(0.62, 0.7, 0.92);
const UNDERWATER_TINT = new Color3(0.06, 0.22, 0.32);

/**
 * Solves exp2 fog density from a visibility distance: exp(-(d*V)^2) = 0.05 at
 * V metres gives d = sqrt(3)/V.
 */
const EXP2_FOG_CONSTANT = Math.sqrt(3);

/** Peak intensity of the sun light at midday, clear sky. */
const SUN_PEAK_INTENSITY = 2.4;
const MOON_PEAK_INTENSITY = 0.55;

export interface SkyViewOptions {
  readonly scene: Scene;
  /** The scene's existing sun, driven rather than replaced. */
  readonly sun: DirectionalLightType;
  /** Rebuilds the scene's shadow map at a new size. Owned by the boot scene. */
  setShadowMapSize(size: number): void;
  readonly quality: QualityPreset;
}

function mix(a: Color3, b: Color3, t: number): Color3 {
  const clamped = Math.min(1, Math.max(0, t));
  return new Color3(a.r + (b.r - a.r) * clamped, a.g + (b.g - a.g) * clamped, a.b + (b.b - a.b) * clamped);
}

/**
 * Converts a compass bearing and elevation into the direction light travels,
 * which is from the body toward the ground, hence the negations.
 */
export function celestialDirection(elevationDeg: number, azimuthDeg: number): Vector3 {
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return new Vector3(
    -horizontal * Math.sin(azimuth),
    -Math.sin(elevation),
    -horizontal * Math.cos(azimuth),
  ).normalize();
}

/** The sky colour for a sample, before underwater. Exported so tests can assert it directly. */
export function skyColourFor(sample: EnvironmentSample): Color3 {
  const elevation = sample.sun.elevationDeg;
  // Day fades to dusk across the last twelve degrees, then dusk to night.
  const dayness = Math.min(1, Math.max(0, (elevation + 6) / (HORIZON_REDDENING_DEG + 6)));
  const daylit = mix(DAY_HORIZON, DAY_ZENITH, Math.min(1, Math.max(0, elevation / 55)));
  const lit = mix(DUSK, daylit, dayness);
  const base = mix(NIGHT, lit, Math.min(1, sample.sun.illumination * 1.6 + 0.08));
  const overcast = mix(
    base,
    OVERCAST.scale(0.35 + sample.lightLevel * 0.65),
    sample.weather.cloudCover * 0.8,
  );
  return sample.weather.lightningFlash > 0
    ? mix(overcast, new Color3(0.85, 0.88, 1), sample.weather.lightningFlash * 0.7)
    : overcast;
}

export class SkyView {
  private readonly scene: Scene;
  private readonly sun: DirectionalLightType;
  private readonly setShadowMapSize: (size: number) => void;
  private readonly moon: DirectionalLight;
  private readonly ambient: HemisphericLight;
  private readonly originalClearColor: Color4;
  private readonly originalSunIntensity: number;
  private quality: QualityPreset;
  private disposed = false;

  constructor(options: SkyViewOptions) {
    this.scene = options.scene;
    this.sun = options.sun;
    this.setShadowMapSize = options.setShadowMapSize;
    this.quality = options.quality;
    this.originalClearColor = this.scene.clearColor.clone();
    this.originalSunIntensity = this.sun.intensity;

    this.moon = new DirectionalLight("sky.moon", new Vector3(0, -1, 0), this.scene);
    this.moon.diffuse = MOON_COLOUR;
    this.moon.intensity = 0;

    this.ambient = new HemisphericLight("sky.ambient", new Vector3(0, 1, 0), this.scene);
    this.ambient.intensity = 0.4;

    this.setShadowMapSize(this.quality.shadowMapSize);
  }

  setQuality(quality: QualityPreset): void {
    if (quality.shadowMapSize !== this.quality.shadowMapSize) {
      this.setShadowMapSize(quality.shadowMapSize);
    }
    this.quality = quality;
  }

  /** Applies a sample to the scene. Cheap enough to call every frame. */
  update(sample: EnvironmentSample): void {
    if (this.disposed) return;

    this.sun.direction = celestialDirection(sample.sun.elevationDeg, sample.sun.azimuthDeg);
    const sunWarmth = Math.min(1, Math.max(0, 1 - sample.sun.elevationDeg / HORIZON_REDDENING_DEG));
    this.sun.diffuse = mix(SUN_WHITE, SUN_WARM, sunWarmth);
    this.sun.intensity = SUN_PEAK_INTENSITY * sample.sun.illumination * (1 - sample.weather.cloudCover * 0.7);

    this.moon.direction = celestialDirection(sample.moon.elevationDeg, sample.moon.azimuthDeg);
    this.moon.intensity =
      MOON_PEAK_INTENSITY * sample.moon.illumination * (1 - sample.weather.cloudCover * 0.8);

    // Ambient never reaches zero: a night with no fill is a black screen, which
    // is not the same thing as a dark night.
    this.ambient.intensity = 0.12 + sample.lightLevel * 0.55 + sample.weather.lightningFlash * 0.5;

    const underwater = sample.water.eyesSubmerged;
    const sky = skyColourFor(sample);
    const colour = underwater
      ? mix(UNDERWATER_TINT, UNDERWATER_TINT.scale(0.25), sample.water.zone.darkness)
      : sky;
    this.scene.clearColor = new Color4(colour.r, colour.g, colour.b, 1);

    this.applyFog(sample, colour, underwater);
  }

  /**
   * Fog does two jobs here: it is the visual half of the visibility number
   * gameplay already uses, and underwater it is the only thing that makes depth
   * readable. Density is derived from the same metres of visibility an AI reads,
   * so the two can never drift apart.
   */
  private applyFog(sample: EnvironmentSample, colour: Color3, underwater: boolean): void {
    const visibility = underwater ? sample.water.zone.visibilityMeters : sample.effects.visibilityMeters;

    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = underwater ? colour : mix(colour, OVERCAST, sample.weather.fogDensity * 0.5);
    // Exp2 fog is exp(-(density * distance)^2), so "95 percent obscured at the
    // visibility distance" solves to density = sqrt(3) / visibility. Using 3
    // instead of sqrt(3) squares the exponent and fogs the scene out to flat
    // colour well before the distance an AI is told it can see.
    this.scene.fogDensity = (EXP2_FOG_CONSTANT / Math.max(20, visibility)) * this.quality.fogQuality;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.fogMode = Scene.FOGMODE_NONE;
    this.scene.clearColor = this.originalClearColor;
    this.sun.intensity = this.originalSunIntensity;
    this.sun.diffuse = Color3.White();
    this.moon.dispose();
    this.ambient.dispose();
  }
}
