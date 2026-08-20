import {
  AbstractEngine,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

export interface BootScene {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly ground: ReturnType<typeof MeshBuilder.CreateGround>;
  readonly jaegerPlaceholder: ReturnType<typeof MeshBuilder.CreateBox>;
}

/**
 * Minimal but real scene: ground, reference-size Jaeger placeholder box, directional
 * light + shadow, sky color, orbit/debug camera. Everything here is disposed for free
 * when the owning Scene is disposed by the caller.
 */
export function buildBootScene(engine: AbstractEngine, canvas: HTMLCanvasElement): BootScene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.53, 0.66, 0.78, 1); // overcast daylight sky, not a neon void

  const camera = new ArcRotateCamera(
    "debugOrbitCamera",
    -Math.PI / 2,
    Math.PI / 2.6,
    110,
    new Vector3(0, 25, 0),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 10;
  camera.upperRadiusLimit = 300;
  camera.wheelPrecision = 30;

  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.3), scene);
  sun.intensity = 2.2;
  sun.position = new Vector3(20, 40, -20);

  const ground = MeshBuilder.CreateGround("shatterdomePad", { width: 60, height: 60 }, scene);
  const groundMat = new StandardMaterial("shatterdomePadMat", scene);
  groundMat.diffuseColor = new Color3(0.22, 0.24, 0.27);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
  ground.receiveShadows = true;

  // Reference-size Jaeger placeholder: roughly Mk-1 scale (≈75m tall), not a real design.
  const jaegerPlaceholder = MeshBuilder.CreateBox(
    "jaegerPlaceholder",
    { width: 12, height: 75, depth: 8 },
    scene,
  );
  jaegerPlaceholder.position.y = 37.5;
  const jaegerMat = new StandardMaterial("jaegerPlaceholderMat", scene);
  jaegerMat.diffuseColor = new Color3(0.35, 0.38, 0.42);
  jaegerPlaceholder.material = jaegerMat;

  const shadowGenerator = new ShadowGenerator(1024, sun);
  shadowGenerator.addShadowCaster(jaegerPlaceholder);
  shadowGenerator.usePoissonSampling = true;

  return { scene, camera, ground, jaegerPlaceholder };
}
