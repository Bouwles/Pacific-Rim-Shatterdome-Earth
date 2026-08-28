import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Scene,
  SpotLight,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { BootScene } from "./scene";
import { JaegerRig } from "./jaegerRig";
import { PALETTE_TOKENS } from "../data/styleGuide";

/**
 * The title composition.
 *
 * A machine standing in a dark bay: one cold key light from high and behind
 * so the silhouette reads as a rim, a warm work lamp low and to the side so
 * the plate has a second colour on it, an amber beacon that turns slowly, fog
 * that eats the far walls, rain drifting through the light, and a camera that
 * drifts a few degrees a minute. Nothing here is interactive; it is the first
 * ten seconds, and the first ten seconds have to say what the game is.
 *
 * It borrows the boot scene rather than owning one, and puts back everything
 * it changed on dispose: clear colour, fog, the boot placeholder, the pad.
 */

const DRIFT_RADIANS_PER_SECOND = 0.035;

function hex(id: string, fallback: string): Color3 {
  return Color3.FromHexString(PALETTE_TOKENS.find((token) => token.id === id)?.hex ?? fallback);
}

export class TitleView {
  private readonly scene: Scene;
  private readonly boot: BootScene;
  private readonly rig: JaegerRig;
  private readonly key: SpotLight;
  private readonly lamp: PointLight;
  private readonly beacon: PointLight;
  private readonly rain: ParticleSystem;
  private readonly rainTexture: DynamicTexture;
  private readonly floor: Mesh;
  private readonly floorMaterial: StandardMaterial;
  private readonly gantry: Mesh[] = [];
  private readonly gantryMaterial: StandardMaterial;
  private readonly savedClear: Color4;
  private readonly savedFogMode: number;
  private readonly savedFogDensity: number;
  private readonly savedFogColor: Color3;
  private readonly savedSunIntensity: number;
  private readonly savedAmbient: Color3;
  private readonly savedAlpha: number;
  private readonly savedBeta: number;
  private readonly savedRadius: number;
  private elapsed = 0;
  private disposed = false;

  constructor(boot: BootScene) {
    this.boot = boot;
    this.scene = boot.scene;
    const scene = this.scene;

    this.savedClear = scene.clearColor.clone();
    this.savedFogMode = scene.fogMode;
    this.savedFogDensity = scene.fogDensity;
    this.savedFogColor = scene.fogColor.clone();
    this.savedSunIntensity = boot.sun.intensity;
    this.savedAmbient = scene.ambientColor.clone();
    this.savedAlpha = boot.camera.alpha;
    this.savedBeta = boot.camera.beta;
    this.savedRadius = boot.camera.radius;

    // A bay at night: near-black, with fog that closes the distance.
    scene.clearColor = new Color4(0.02, 0.03, 0.045, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0028;
    scene.fogColor = new Color3(0.03, 0.045, 0.06);
    boot.sun.intensity = 0.6;
    scene.ambientColor = new Color3(0.16, 0.18, 0.22);
    boot.jaegerPlaceholder.setEnabled(false);
    boot.ground.setEnabled(false);

    // Wet concrete pad, dark, with a faint specular so the lamp pools on it.
    this.floorMaterial = new StandardMaterial("title.floor", scene);
    this.floorMaterial.diffuseColor = new Color3(0.07, 0.08, 0.09);
    this.floorMaterial.specularColor = new Color3(0.18, 0.2, 0.22);
    this.floorMaterial.specularPower = 24;
    this.floorMaterial.ambientColor = new Color3(0.6, 0.7, 0.8);
    this.floor = MeshBuilder.CreateGround("title.pad", { width: 400, height: 400 }, scene);
    this.floor.material = this.floorMaterial;
    this.floor.receiveShadows = true;

    // The machine, standing, breathing.
    this.rig = new JaegerRig(scene, 75, "title.jaeger");
    this.rig.root.rotation.y = -0.9;

    // Gantry uprights either side and a beam above: the bay around the body.
    this.gantryMaterial = new StandardMaterial("title.gantry", scene);
    this.gantryMaterial.diffuseColor = new Color3(0.1, 0.11, 0.12);
    this.gantryMaterial.specularColor = Color3.Black();
    // Wide enough that the drifting camera never puts an upright across the body.
    for (const [x, z] of [
      [-84, 44],
      [84, 44],
      [-90, -40],
      [90, -40],
    ] as const) {
      const upright = MeshBuilder.CreateBox("title.upright", { width: 3, height: 110, depth: 3 }, scene);
      upright.position.set(x, 55, z);
      upright.material = this.gantryMaterial;
      this.gantry.push(upright);
    }
    const beam = MeshBuilder.CreateBox("title.beam", { width: 176, height: 3, depth: 90 }, scene);
    beam.position.set(0, 108, 4);
    beam.material = this.gantryMaterial;
    this.gantry.push(beam);

    // Cold key from high on the camera side, so the faces the camera sees
    // carry the cool colour and the tops read as a rim.
    this.key = new SpotLight(
      "title.key",
      new Vector3(70, 140, 60),
      new Vector3(-0.42, -0.84, -0.36),
      Math.PI / 2.2,
      3,
      scene,
    );
    this.key.diffuse = hex("style.sky-cool", "#7fd6ff").scale(0.85);
    this.key.intensity = 8;

    // Warm work lamp low on the other side: the second colour on the plate.
    this.lamp = new PointLight("title.lamp", new Vector3(-26, 20, -64), scene);
    this.lamp.diffuse = hex("style.warning-amber", "#ffc247");
    this.lamp.intensity = 3;
    this.lamp.range = 160;

    // The beacon sweeps: an intensity pulse plus a slow orbit.
    this.beacon = new PointLight("title.beacon", new Vector3(0, 100, 0), scene);
    this.beacon.diffuse = hex("style.warning-amber", "#ffc247");
    this.beacon.intensity = 0;
    this.beacon.range = 220;

    // Rain through the light. A few hundred particles, no more.
    this.rainTexture = new DynamicTexture("title.rainSprite", { width: 8, height: 32 }, scene, false);
    const context = this.rainTexture.getContext();
    const gradient = context.createLinearGradient(0, 0, 0, 32);
    gradient.addColorStop(0, "rgba(180,210,240,0)");
    gradient.addColorStop(0.5, "rgba(180,210,240,0.7)");
    gradient.addColorStop(1, "rgba(180,210,240,0)");
    context.fillStyle = gradient;
    context.fillRect(2, 0, 4, 32);
    this.rainTexture.update();
    this.rain = new ParticleSystem("title.rain", 500, scene);
    this.rain.particleTexture = this.rainTexture;
    this.rain.emitter = new Vector3(0, 120, 0);
    this.rain.minEmitBox = new Vector3(-90, 0, -90);
    this.rain.maxEmitBox = new Vector3(90, 10, 90);
    this.rain.color1 = new Color4(0.7, 0.8, 0.95, 0.5);
    this.rain.color2 = new Color4(0.6, 0.7, 0.9, 0.3);
    this.rain.colorDead = new Color4(0.5, 0.6, 0.8, 0);
    this.rain.minSize = 0.8;
    this.rain.maxSize = 1.6;
    this.rain.minLifeTime = 1.2;
    this.rain.maxLifeTime = 1.8;
    this.rain.emitRate = 260;
    this.rain.direction1 = new Vector3(-2, -90, -1);
    this.rain.direction2 = new Vector3(2, -110, 1);
    this.rain.gravity = new Vector3(0, -20, 0);
    this.rain.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.rain.start();

    // A low three-quarter view: the feet, the horizon line of the pad, the
    // head near the top third. Scale is in the framing, not the box size.
    // The machine sits right of centre so the menu owns the left third.
    boot.camera.setTarget(new Vector3(-17, 36, -14));
    boot.camera.alpha = -Math.PI / 2 + 0.7;
    boot.camera.beta = Math.PI / 2.15;
    boot.camera.radius = 150;
  }

  /** One frame of drift. */
  update(deltaSeconds: number): void {
    if (this.disposed) return;
    this.elapsed += deltaSeconds;
    this.boot.camera.alpha += DRIFT_RADIANS_PER_SECOND * deltaSeconds;
    this.rig.update({ timeSeconds: this.elapsed, speedMps: 0 }, deltaSeconds);
    // The beacon: one slow revolution, brightest as it passes the machine.
    const sweep = (this.elapsed * 0.6) % (Math.PI * 2);
    this.beacon.position.set(Math.cos(sweep) * 70, 98, Math.sin(sweep) * 70);
    this.beacon.intensity = 0.3 + 0.9 * Math.max(0, Math.cos(sweep - 2.2));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rain.stop();
    this.rain.dispose();
    this.rainTexture.dispose();
    this.key.dispose();
    this.lamp.dispose();
    this.beacon.dispose();
    this.rig.dispose();
    for (const mesh of this.gantry) mesh.dispose();
    this.gantryMaterial.dispose();
    this.floor.dispose();
    this.floorMaterial.dispose();

    const scene = this.scene;
    scene.clearColor = this.savedClear;
    scene.fogMode = this.savedFogMode;
    scene.fogDensity = this.savedFogDensity;
    scene.fogColor = this.savedFogColor;
    this.boot.sun.intensity = this.savedSunIntensity;
    scene.ambientColor = this.savedAmbient;
    this.boot.jaegerPlaceholder.setEnabled(true);
    this.boot.ground.setEnabled(true);
    this.boot.camera.alpha = this.savedAlpha;
    this.boot.camera.beta = this.savedBeta;
    this.boot.camera.radius = this.savedRadius;
    this.boot.camera.setTarget(new Vector3(0, 25, 0));
  }
}
