import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  StandardMaterial,
  Texture,
  Vector3,
  type Camera,
  type Scene,
} from "@babylonjs/core";
import type { EnvironmentSample } from "../world/environment";
import type { QualityPreset, Telegraph } from "../data/quality";

/**
 * Rain, snow, spray, lightning and cloud.
 *
 * Every emitter is capacity-capped at construction from the active quality
 * preset, so "more weather" can never mean "more particles than the budget
 * allows". Intensity changes the emit rate, never the ceiling.
 *
 * The rule the presets encode is enforced here: lowering quality removes detail,
 * never information. Rain gets thinner but never disappears while it is raining,
 * and the lightning flash is drawn at every level including Low, because it is
 * the telegraph that says a strike happened.
 *
 * Owns one texture, three particle systems, one light and one mesh, and releases
 * all of them in dispose().
 */

/** Particles are split across emitters by share of the budget. */
const RAIN_BUDGET_SHARE = 0.6;
const SNOW_BUDGET_SHARE = 0.25;
const SPRAY_BUDGET_SHARE = 0.15;

/** Emitter box around the camera, metres. */
const EMITTER_HALF_WIDTH = 90;
const EMITTER_HEIGHT = 110;

const CLOUD_ALTITUDE_METERS = 900;
const CLOUD_DIAMETER_METERS = 6_000;

export interface WeatherViewOptions {
  readonly scene: Scene;
  readonly quality: QualityPreset;
}

export interface WeatherViewStats {
  readonly activeParticles: number;
  readonly particleCapacity: number;
  readonly rainRate: number;
  readonly snowRate: number;
  readonly sprayRate: number;
  readonly cloudVisible: boolean;
  readonly telegraphs: readonly Telegraph[];
}

/**
 * A soft round dot, drawn rather than loaded. The project ships no image files,
 * and a procedural sprite keeps it that way.
 */
function buildParticleTexture(scene: Scene): DynamicTexture {
  const size = 32;
  const texture = new DynamicTexture("weather.particle", { width: size, height: size }, scene, false);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.65)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  texture.update();
  texture.hasAlpha = true;
  return texture;
}

export class WeatherView {
  private readonly scene: Scene;
  private readonly texture: DynamicTexture;
  private readonly rain: ParticleSystem;
  private readonly snow: ParticleSystem;
  private readonly spray: ParticleSystem;
  private readonly lightning: PointLight;
  private readonly cloud: Mesh;
  private readonly cloudMaterial: StandardMaterial;
  private readonly emitterAnchor: Mesh;
  private quality: QualityPreset;
  private disposed = false;

  constructor(options: WeatherViewOptions) {
    this.scene = options.scene;
    this.quality = options.quality;
    this.texture = buildParticleTexture(this.scene);

    // Emitters ride an invisible anchor rather than the camera itself, so the
    // camera can be swapped without every system needing to be told.
    this.emitterAnchor = MeshBuilder.CreateBox("weather.anchor", { size: 0.01 }, this.scene);
    this.emitterAnchor.isVisible = false;
    this.emitterAnchor.isPickable = false;

    this.rain = this.buildPrecipitation(
      "weather.rain",
      Math.floor(this.quality.maxParticles * RAIN_BUDGET_SHARE),
      // Sized to be legible rather than to scale. A real raindrop is a couple of
      // millimetres and would be invisible at any camera distance this game
      // uses; rain the player cannot see is rain that fails as a telegraph.
      { minLifeTime: 0.5, maxLifeTime: 0.9, minSize: 1.1, maxSize: 2.2, gravity: -320 },
      new Color4(0.72, 0.82, 0.95, 0.8),
    );
    this.snow = this.buildPrecipitation(
      "weather.snow",
      Math.floor(this.quality.maxParticles * SNOW_BUDGET_SHARE),
      { minLifeTime: 2.4, maxLifeTime: 4, minSize: 1.6, maxSize: 3.2, gravity: -18 },
      new Color4(0.96, 0.98, 1, 0.9),
    );
    this.spray = this.buildPrecipitation(
      "weather.spray",
      Math.floor(this.quality.maxParticles * SPRAY_BUDGET_SHARE),
      { minLifeTime: 0.7, maxLifeTime: 1.4, minSize: 2.4, maxSize: 5.5, gravity: -46 },
      new Color4(0.88, 0.94, 0.98, 0.7),
    );
    // Spray comes up off the water rather than down out of the sky.
    this.spray.direction1 = new Vector3(-6, 14, -6);
    this.spray.direction2 = new Vector3(6, 26, 6);
    this.spray.minEmitBox = new Vector3(-EMITTER_HALF_WIDTH, 0, -EMITTER_HALF_WIDTH);
    this.spray.maxEmitBox = new Vector3(EMITTER_HALF_WIDTH, 2, EMITTER_HALF_WIDTH);

    this.lightning = new PointLight("weather.lightning", new Vector3(0, 400, 0), this.scene);
    this.lightning.diffuse = new Color3(0.85, 0.9, 1);
    this.lightning.intensity = 0;
    this.lightning.range = 12_000;

    this.cloudMaterial = new StandardMaterial("weather.cloud", this.scene);
    this.cloudMaterial.diffuseColor = new Color3(0.6, 0.62, 0.66);
    this.cloudMaterial.specularColor = Color3.Black();
    this.cloudMaterial.emissiveColor = new Color3(0.12, 0.13, 0.15);
    this.cloudMaterial.alpha = 0;
    this.cloudMaterial.backFaceCulling = false;
    this.cloud = MeshBuilder.CreateDisc(
      "weather.cloudLayer",
      { radius: CLOUD_DIAMETER_METERS / 2, tessellation: 24 },
      this.scene,
    );
    this.cloud.rotation.x = -Math.PI / 2;
    this.cloud.material = this.cloudMaterial;
    this.cloud.isPickable = false;
    this.cloud.setEnabled(false);
  }

  private buildPrecipitation(
    name: string,
    capacity: number,
    shape: {
      minLifeTime: number;
      maxLifeTime: number;
      minSize: number;
      maxSize: number;
      gravity: number;
    },
    colour: Color4,
  ): ParticleSystem {
    // Capacity is fixed for the life of the system in Babylon, which is why a
    // quality change rebuilds this view rather than adjusting it in place.
    const system = new ParticleSystem(name, Math.max(1, capacity), this.scene);
    system.particleTexture = this.texture;
    system.emitter = this.emitterAnchor;
    system.minEmitBox = new Vector3(-EMITTER_HALF_WIDTH, EMITTER_HEIGHT, -EMITTER_HALF_WIDTH);
    system.maxEmitBox = new Vector3(EMITTER_HALF_WIDTH, EMITTER_HEIGHT, EMITTER_HALF_WIDTH);
    system.color1 = colour;
    system.color2 = colour;
    system.colorDead = new Color4(colour.r, colour.g, colour.b, 0);
    system.minLifeTime = shape.minLifeTime;
    system.maxLifeTime = shape.maxLifeTime;
    system.minSize = shape.minSize;
    system.maxSize = shape.maxSize;
    system.gravity = new Vector3(0, shape.gravity, 0);
    system.direction1 = new Vector3(0, -1, 0);
    system.direction2 = new Vector3(0, -1, 0);
    system.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    system.emitRate = 0;
    system.start();
    return system;
  }

  setQuality(quality: QualityPreset): void {
    // Only the fields that can change in place are touched here; capacity cannot,
    // so bootstrap rebuilds the view when the preset changes.
    this.quality = quality;
  }

  get particleCapacity(): number {
    return this.rain.getCapacity() + this.snow.getCapacity() + this.spray.getCapacity();
  }

  /**
   * Applies a sample. Rain and snow are mutually exclusive because precipitation
   * is either frozen or it is not; running both would double the particle spend
   * for a state that cannot physically happen.
   */
  update(sample: EnvironmentSample, camera: Camera | null): void {
    if (this.disposed) return;

    if (camera) {
      this.emitterAnchor.position.copyFrom(camera.position);
      this.cloud.position.set(camera.position.x, CLOUD_ALTITUDE_METERS, camera.position.z);
      this.lightning.position.set(camera.position.x, 600, camera.position.z);
    }

    const weather = sample.weather;
    const underwater = sample.water.eyesSubmerged;
    // Nothing falls on you underwater, and drawing it there is worse than useless.
    const fallRate = underwater ? 0 : weather.precipitation * this.quality.particleRatePerSecond;

    this.rain.emitRate = weather.frozenPrecipitation ? 0 : fallRate;
    this.snow.emitRate = weather.frozenPrecipitation ? fallRate : 0;

    // Wind blows precipitation sideways, which is the readable difference
    // between rain and a storm.
    const windRad = (weather.windDirectionDeg * Math.PI) / 180;
    const drift = weather.windSpeedMps * 0.8;
    const driftX = Math.sin(windRad) * drift;
    const driftZ = Math.cos(windRad) * drift;
    for (const system of [this.rain, this.snow]) {
      system.direction1 = new Vector3(driftX - 1, -12, driftZ - 1);
      system.direction2 = new Vector3(driftX + 1, -18, driftZ + 1);
    }

    // Spray marks where water is being disturbed: a required telegraph, so it is
    // rate-limited by quality but never switched off while it applies.
    const sprayActive = !underwater && sample.water.state !== "dry";
    this.spray.emitRate = sprayActive
      ? Math.max(12, this.quality.particleRatePerSecond * 0.2 * Math.min(1, sample.waveAmplitudeMeters / 6))
      : 0;

    // Lightning is drawn at every quality level, Low included.
    this.lightning.intensity = weather.lightningFlash * 6;

    const cloudVisible = this.quality.reflections !== "none" && weather.cloudCover > 0.15 && !underwater;
    this.cloud.setEnabled(cloudVisible);
    this.cloudMaterial.alpha = cloudVisible ? Math.min(0.55, weather.cloudCover * 0.6) : 0;
  }

  stats(): WeatherViewStats {
    return {
      activeParticles: this.rain.getActiveCount() + this.snow.getActiveCount() + this.spray.getActiveCount(),
      particleCapacity: this.particleCapacity,
      rainRate: this.rain.emitRate,
      snowRate: this.snow.emitRate,
      sprayRate: this.spray.emitRate,
      cloudVisible: this.cloud.isEnabled(),
      telegraphs: this.quality.telegraphs,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const system of [this.rain, this.snow, this.spray]) {
      system.stop();
      system.dispose();
    }
    this.lightning.dispose();
    this.cloud.dispose();
    this.cloudMaterial.dispose();
    this.emitterAnchor.dispose();
    this.texture.dispose();
  }
}

/** Re-exported so callers can keep the Texture import local to this module. */
export type { Texture };
