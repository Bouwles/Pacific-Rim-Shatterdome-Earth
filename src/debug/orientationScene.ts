import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CreatureRig, type CreatureAttackKind } from "../engine/creatureRig";
import { JaegerRig, type JaegerAttackKind } from "../engine/jaegerRig";
import { validateOrientation, type OrientationReport } from "../engine/orientation";
import type { BootScene } from "../engine/scene";

/**
 * The orientation test scene (`?scene=orientation`).
 *
 * A flat plane, labelled world axes, front/back/left/right markers, a
 * turntable camera, both procedural rigs and a pose cycle that walks every
 * animation the fight uses. The validator runs every frame and its verdict
 * is written on screen. Behind the debug toggle: socket markers, the arena's
 * zone spheres as hit-volume overlays, and the hierarchy bounds.
 */

interface PoseStep {
  readonly label: string;
  readonly jaeger: Parameters<JaegerRig["update"]>[0];
  readonly creature: Parameters<CreatureRig["update"]>[0];
  readonly seconds: number;
}

const JAEGER_ATTACKS: readonly JaegerAttackKind[] = [
  "jab",
  "cross",
  "smash",
  "spin",
  "overhead",
  "haymaker",
  "launcher",
  "shoulder",
  "elbow",
  "sword",
  "purge",
  "finisher",
  "counter",
];
const CREATURE_ATTACKS: readonly CreatureAttackKind[] = [
  "claw.L",
  "claw.R",
  "blade.sweep",
  "blade.down",
  "charge",
  "bite",
  "shove",
  "tail",
];

function buildSteps(): PoseStep[] {
  const steps: PoseStep[] = [
    { label: "Neutral", jaeger: {}, creature: {}, seconds: 3 },
    { label: "Walk", jaeger: { speedMps: 12 }, creature: { speedMps: 6 }, seconds: 3 },
    { label: "Sprint", jaeger: { speedMps: 30, boost: 0.6 }, creature: { speedMps: 14 }, seconds: 3 },
    {
      label: "Dodge left",
      jaeger: { dodge: { progress: 0.5, direction: "L" }, boost: 1 },
      creature: { flinch: 0.4 },
      seconds: 1.5,
    },
    {
      label: "Dodge right",
      jaeger: { dodge: { progress: 0.5, direction: "R" }, boost: 1 },
      creature: {},
      seconds: 1.5,
    },
    {
      label: "Guard",
      jaeger: { guarding: true },
      creature: { windup: 0.4, attackKind: "claw.R" },
      seconds: 2,
    },
  ];
  for (const kind of JAEGER_ATTACKS) {
    for (const phase of ["windup", "active", "recover"] as const) {
      steps.push({
        label: `${kind} ${phase}`,
        jaeger: {
          attack: { phase, progress: 0.6, kind },
          weapon: kind === "sword" ? "sword" : kind === "finisher" ? "plasma" : "fists",
        },
        creature: {},
        seconds: 0.8,
      });
    }
  }
  for (const kind of CREATURE_ATTACKS) {
    steps.push({
      label: `Knifehead ${kind} windup`,
      jaeger: { guarding: true },
      creature: { windup: 1, attackKind: kind },
      seconds: 1,
    });
    steps.push({
      label: `Knifehead ${kind} strike`,
      jaeger: { guarding: true },
      creature: { striking: 1, attackKind: kind },
      seconds: 0.8,
    });
  }
  steps.push({
    label: "Grapple",
    jaeger: { grapple: { holding: true, progress: 0.6 } },
    creature: { stagger: 1 },
    seconds: 2,
  });
  steps.push({
    label: "Knockdown",
    jaeger: { knockdown: { progress: 1, recovering: false } },
    creature: { knockdown: 1 },
    seconds: 2,
  });
  steps.push({
    label: "Recovery",
    jaeger: { knockdown: { progress: 0.4, recovering: true } },
    creature: { knockdown: 0.4 },
    seconds: 1.5,
  });
  steps.push({
    label: "Armour off",
    jaeger: { regionDamage: { "arm.L": 0.8, torso: 0.5 } },
    creature: {
      regions: {
        torso: { armor: 0, wound: 0.7, severed: false },
        head: { armor: 0.3, wound: 0.2, severed: false },
      },
    },
    seconds: 2.5,
  });
  return steps;
}

export interface OrientationSceneHandle {
  dispose(): void;
}

export function openOrientationScene(
  boot: BootScene,
  uiRoot: HTMLElement,
  debug: boolean,
): OrientationSceneHandle {
  const scene: Scene = boot.scene;
  boot.jaegerPlaceholder.setEnabled(false);
  boot.ground.setEnabled(false);
  // Anything the title composition left in the scene stays out of the record.
  const hiddenTitle = scene.meshes.filter((mesh) => mesh.name.startsWith("title.") && mesh.isEnabled());
  for (const mesh of hiddenTitle) mesh.setEnabled(false);
  const savedClear = scene.clearColor.clone();
  scene.clearColor = new Color4(0.08, 0.1, 0.13, 1);
  scene.fogMode = Scene.FOGMODE_NONE;
  scene.ambientColor = new Color3(0.35, 0.37, 0.4);
  boot.sun.intensity = 1.6;

  const disposables: { dispose(): void }[] = [];
  const material = (name: string, colour: Color3, emissive = 0): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = colour;
    m.emissiveColor = colour.scale(emissive);
    m.specularColor = Color3.Black();
    disposables.push(m);
    return m;
  };

  // Ground: a plane with a grid so distance and foot placement read.
  const ground = MeshBuilder.CreateGround(
    "orient.ground",
    { width: 600, height: 600, subdivisions: 30 },
    scene,
  );
  const groundTexture = new DynamicTexture("orient.grid", { width: 1024, height: 1024 }, scene, false);
  const context = groundTexture.getContext();
  context.fillStyle = "#1e2429";
  context.fillRect(0, 0, 1024, 1024);
  context.strokeStyle = "#39434c";
  context.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 64) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i, 1024);
    context.stroke();
    context.beginPath();
    context.moveTo(0, i);
    context.lineTo(1024, i);
    context.stroke();
  }
  groundTexture.update();
  const groundMaterial = new StandardMaterial("orient.groundMaterial", scene);
  groundMaterial.diffuseTexture = groundTexture;
  groundMaterial.specularColor = Color3.Black();
  ground.material = groundMaterial;
  disposables.push(groundTexture, groundMaterial, ground);

  // World axes: X red, Y green, Z blue, with labels at the tips.
  const label = (text: string, colour: string, position: Vector3, size = 24): void => {
    const plane = MeshBuilder.CreatePlane(`orient.label.${text}`, { size }, scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position.copyFrom(position);
    const texture = new DynamicTexture(
      `orient.labelTexture.${text}`,
      { width: 256, height: 128 },
      scene,
      false,
    );
    texture.drawText(text, null, null, "bold 64px sans-serif", colour, "transparent", true);
    texture.hasAlpha = true;
    const m = new StandardMaterial(`orient.labelMaterial.${text}`, scene);
    m.diffuseTexture = texture;
    m.emissiveColor = Color3.White();
    m.backFaceCulling = false;
    m.disableLighting = true;
    plane.material = m;
    disposables.push(texture, m, plane);
  };
  const axis = (name: string, direction: Vector3, colour: Color3, text: string): void => {
    const length = 120;
    const shaft = MeshBuilder.CreateCylinder(
      `orient.axis.${name}`,
      { diameter: 2.5, height: length, tessellation: 8 },
      scene,
    );
    shaft.material = material(`orient.axisMaterial.${name}`, colour, 0.6);
    shaft.position = direction.scale(length / 2);
    // Aim the cylinder (built along +Y) at the direction.
    if (direction.x !== 0) shaft.rotation.z = -Math.PI / 2;
    if (direction.z !== 0) shaft.rotation.x = Math.PI / 2;
    const tip = MeshBuilder.CreateCylinder(
      `orient.tip.${name}`,
      { diameterTop: 0, diameterBottom: 8, height: 14, tessellation: 8 },
      scene,
    );
    tip.material = shaft.material;
    tip.position = direction.scale(length + 7);
    tip.rotation.copyFrom(shaft.rotation);
    disposables.push(shaft, tip);
    label(text, colour.toHexString(), direction.scale(length + 24), 30);
  };
  axis("x", new Vector3(1, 0, 0), new Color3(0.95, 0.25, 0.25), "+X east / right");
  axis("y", new Vector3(0, 1, 0), new Color3(0.3, 0.9, 0.35), "+Y up");
  axis("z", new Vector3(0, 0, 1), new Color3(0.3, 0.55, 1), "+Z north / forward");

  // Front, back, left, right markers on the ground around the machine.
  const markerMaterial = material("orient.marker", new Color3(0.9, 0.75, 0.3), 0.5);
  for (const [text, x, z] of [
    ["FRONT", 0, 120],
    ["BACK", 0, -120],
    ["RIGHT", 120, 0],
    ["LEFT", -120, 0],
  ] as const) {
    const post = MeshBuilder.CreateBox(`orient.post.${text}`, { width: 4, height: 12, depth: 4 }, scene);
    post.position.set(x, 6, z);
    post.material = markerMaterial;
    disposables.push(post);
    label(text, "#f0c860", new Vector3(x, 22, z), 26);
  }

  // The rigs, side by side, both facing +Z (yaw 0).
  const jaegerRoot = new TransformNode("orient.jaeger", scene);
  jaegerRoot.position.set(-50, 0, 0);
  const jaeger = new JaegerRig(scene, 75, "orient.jaegerRig");
  jaeger.root.parent = jaegerRoot;
  const creatureRoot = new TransformNode("orient.creature", scene);
  creatureRoot.position.set(60, 0, 0);
  const creature = new CreatureRig(scene, 85, "orient.creatureRig");
  creature.root.parent = creatureRoot;
  disposables.push(jaeger, creature, jaegerRoot, creatureRoot);

  // Turntable camera.
  const camera = boot.camera;
  const savedAlpha = camera.alpha;
  const savedBeta = camera.beta;
  const savedRadius = camera.radius;
  const savedTarget = camera.target.clone();
  camera.setTarget(new Vector3(5, 38, 0));
  camera.radius = 230;
  camera.beta = 1.38;
  camera.alpha = Math.PI / 2;
  // `?view=front|back|left|right&zoom=1&pose=N` frames a still for the record.
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "back") camera.alpha = -Math.PI / 2;
  else if (view === "left") camera.alpha = Math.PI;
  else if (view === "right") camera.alpha = 0;
  if (params.has("zoom")) {
    // The target first: setTarget keeps the eye where it is and recomputes
    // the angles, so the angles are written after it.
    camera.setTarget(new Vector3(-50, 36, 0));
    camera.radius = 150;
    camera.beta = 1.42;
    camera.alpha =
      view === "back" ? -Math.PI / 2 : view === "left" ? Math.PI : view === "right" ? 0 : Math.PI / 2;
  }
  camera.lowerRadiusLimit = 40;
  camera.upperRadiusLimit = 800;
  camera.attachControl(scene.getEngine().getRenderingCanvas(), true);

  // Debug overlays: sockets, zone spheres, bounds. Off unless toggled.
  const overlayMaterial = material("orient.overlay", new Color3(0.2, 0.9, 0.9), 0.9);
  overlayMaterial.alpha = 0.35;
  overlayMaterial.wireframe = true;
  const overlays: Mesh[] = [];
  const socketMarkers: { readonly mesh: Mesh; readonly node: TransformNode }[] = [];
  for (const [id, node] of Object.entries(jaeger.sockets)) {
    const marker = MeshBuilder.CreateSphere(`orient.socket.${id}`, { diameter: 3, segments: 6 }, scene);
    marker.material = material(`orient.socketMaterial.${id}`, new Color3(1, 0.5, 0.2), 0.9);
    marker.isVisible = false;
    socketMarkers.push({ mesh: marker, node });
    disposables.push(marker);
  }
  const boundsBox = MeshBuilder.CreateBox("orient.bounds", { size: 1 }, scene);
  boundsBox.material = overlayMaterial;
  boundsBox.isVisible = false;
  disposables.push(boundsBox);
  overlays.push(boundsBox);

  // Panel.
  const panel = document.createElement("div");
  panel.className = "op orientation";
  panel.dataset["screen"] = "orientation";
  panel.style.cssText =
    "position:absolute;left:16px;top:16px;padding:12px 14px;background:rgba(8,12,18,0.82);color:#dfe7ee;font:12px/1.5 monospace;border:1px solid rgba(255,255,255,0.12);max-width:420px;z-index:5";
  const title = document.createElement("div");
  title.textContent = "Orientation test scene";
  title.style.cssText = "font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px";
  const stepLine = document.createElement("div");
  stepLine.dataset["field"] = "orientation-step";
  const verdict = document.createElement("div");
  verdict.dataset["field"] = "orientation-verdict";
  verdict.style.whiteSpace = "pre-wrap";
  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px";
  const button = (text: string, action: string, onClick: () => void): HTMLButtonElement => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = text;
    node.dataset["action"] = action;
    node.style.cssText =
      "font:11px monospace;padding:4px 8px;background:#1c2630;color:#dfe7ee;border:1px solid #3a4652;cursor:pointer";
    node.addEventListener("click", onClick);
    controls.append(node);
    return node;
  };
  const steps = buildSteps();
  let stepIndex = Math.max(0, Math.min(buildSteps().length - 1, Number(params.get("pose") ?? 0) || 0));
  let stepClock = 0;
  let paused = params.has("pose");
  let turning = !view;
  let showOverlays = false;
  button("Pause cycle", "pause", () => (paused = !paused));
  button("Next pose", "next", () => {
    stepIndex = (stepIndex + 1) % steps.length;
    stepClock = 0;
  });
  button("Turntable", "turntable", () => (turning = !turning));
  if (debug) button("Overlays", "overlays", () => (showOverlays = !showOverlays));
  panel.append(title, stepLine, verdict, controls);
  uiRoot.append(panel);

  let elapsed = 0;
  let lastReport: { jaeger: OrientationReport; creature: OrientationReport } | null = null;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    elapsed += dt;
    if (!paused) {
      stepClock += dt;
      const current = steps[stepIndex];
      if (current && stepClock >= current.seconds) {
        stepIndex = (stepIndex + 1) % steps.length;
        stepClock = 0;
      }
    }
    const step = steps[stepIndex] ?? steps[0]!;
    const stride = (elapsed * ((step.jaeger.speedMps ?? 0) / 30)) % 1;
    jaeger.update({ timeSeconds: elapsed, stridePhase: stride, ...step.jaeger }, dt);
    creature.update({ timeSeconds: elapsed, ...step.creature }, dt);
    if (turning) camera.alpha += dt * 0.35;

    const jaegerReport = validateOrientation({
      label: "Gipsy Danger",
      root: jaeger.root,
      frontMarker: jaeger.frontMarker,
      heightMeters: 75,
      groundY: 0,
      taggedTiltDeg: jaeger.tilt,
    });
    const creatureReport = validateOrientation({
      label: "Knifehead",
      root: creature.root,
      frontMarker: creature.frontMarker,
      heightMeters: 85,
      groundY: 0,
      taggedTiltDeg: creature.tilt,
    });
    lastReport = { jaeger: jaegerReport, creature: creatureReport };
    stepLine.textContent = `Pose ${stepIndex + 1}/${steps.length}: ${step.label}`;
    const line = (report: OrientationReport): string =>
      `${report.subject}: ${report.ok ? "PASS" : "FAIL"} up ${report.upDot.toFixed(2)} front +${report.frontOffset.toFixed(2)}h feet ${report.boundsMinY.toFixed(1)} m top ${report.boundsMaxY.toFixed(1)} m${report.problems.length ? "\n  " + report.problems.join("\n  ") : ""}`;
    verdict.textContent = `${line(jaegerReport)}\n${line(creatureReport)}`;
    verdict.style.color = jaegerReport.ok && creatureReport.ok ? "#9fe0b8" : "#ff8a80";

    for (const marker of socketMarkers) {
      marker.mesh.isVisible = showOverlays;
      if (showOverlays) marker.mesh.position.copyFrom(marker.node.getAbsolutePosition());
    }
    boundsBox.isVisible = showOverlays;
    if (showOverlays) {
      const bounds = jaeger.root.getHierarchyBoundingVectors(true);
      boundsBox.position = bounds.min.add(bounds.max).scale(0.5);
      boundsBox.scaling = bounds.max.subtract(bounds.min);
    }
  });

  return {
    dispose: () => {
      scene.onBeforeRenderObservable.remove(observer);
      panel.remove();
      for (const item of disposables) item.dispose();
      scene.clearColor = savedClear;
      camera.alpha = savedAlpha;
      camera.beta = savedBeta;
      camera.radius = savedRadius;
      camera.setTarget(savedTarget);
      boot.jaegerPlaceholder.setEnabled(true);
      boot.ground.setEnabled(true);
      for (const mesh of hiddenTitle) mesh.setEnabled(true);
      void lastReport;
    },
  };
}
