import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, type Scene } from "@babylonjs/core";
import { PALETTE_TOKENS, SURFACE_STYLES } from "../data/styleGuide";

/**
 * A machine with a body.
 *
 * The single grey box is gone. This builds an articulated humanoid from
 * primitive parts: a pelvis and torso with an emissive reactor core, a
 * helmeted head with a visor strip, layered shoulder pauldrons, jointed arms
 * ending in fists, jointed legs with broad feet, and joint collars where the
 * limbs meet so the articulation reads as engineered rather than floating.
 *
 * It is a *rig*, not a model: everything is parameterised by height and driven
 * by a pose each frame, so the same builder serves the piloted machine, the
 * title composition, and any machine that needs a body until a real GLB
 * arrives through the resolver, which still replaces it.
 *
 * The animation rules give it mass. The walk swings from the hips with the
 * torso leading into speed, arms counter-swing, everything eases, and nothing
 * snaps. Attacks pull back before they extend. Recoil is a decaying kick,
 * strongest at the torso. Damage drops the posture and makes the core gutter.
 */

export interface JaegerRigPose {
  /** 0 to 1 through the stride cycle. */
  readonly stridePhase: number;
  /** Metres per second over the ground. Drives swing amplitude and lean. */
  readonly speedMps: number;
  /** Seconds of world time, for idle breathing. */
  readonly timeSeconds: number;
  /** The active attack, if any. */
  readonly attack: { readonly phase: "windup" | "active" | "recover"; readonly progress: number } | null;
  readonly guarding: boolean;
  /** 0 to 1 of structure lost. Posture and the core respond. */
  readonly damage: number;
}

const IDLE_POSE: JaegerRigPose = {
  stridePhase: 0,
  speedMps: 0,
  timeSeconds: 0,
  attack: null,
  guarding: false,
  damage: 0,
};

function hex(id: string, fallback: string): Color3 {
  return Color3.FromHexString(PALETTE_TOKENS.find((token) => token.id === id)?.hex ?? fallback);
}

export class JaegerRig {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];

  private readonly pelvis: TransformNode;
  private readonly torso: TransformNode;
  private readonly head: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly forearmL: TransformNode;
  private readonly forearmR: TransformNode;
  private readonly thighL: TransformNode;
  private readonly thighR: TransformNode;
  private readonly shinL: TransformNode;
  private readonly shinR: TransformNode;
  private core: StandardMaterial | null = null;

  /** Decaying recoil, fed by hits and burned down every update. */
  private recoilKick = 0;
  private disposed = false;

  constructor(scene: Scene, heightMeters: number, name = "jaegerRig") {
    this.scene = scene;
    this.root = new TransformNode(`${name}.root`, scene);
    const h = heightMeters;

    // Proportions in fractions of height: legs about half, torso a third.
    const legLength = h * 0.5;
    const torsoHeight = h * 0.3;
    this.legLength = legLength;

    const steel = this.material(`${name}.armour`, hex("style.steel", "#5f6a72"));
    const dark = this.material(`${name}.joint`, hex("style.ink", "#0a1016"));
    const warm = this.material(`${name}.accent`, hex("style.warning-amber", "#ffc247"));
    warm.emissiveColor = hex("style.warning-amber", "#ffc247").scale(0.25);
    const core = this.material(`${name}.core`, hex("style.plasma", "#66e0ff"));
    core.emissiveColor = hex("style.plasma", "#66e0ff").scale(0.9);
    this.core = core;
    const visor = this.material(`${name}.visor`, hex("style.sky-cool", "#7fd6ff"));
    visor.emissiveColor = hex("style.sky-cool", "#7fd6ff").scale(0.7);

    // ------------------------------- pelvis -------------------------------
    this.pelvis = new TransformNode(`${name}.pelvis`, scene);
    this.pelvis.parent = this.root;
    this.pelvis.position.y = legLength;
    this.box(`${name}.hips`, h * 0.2, h * 0.08, h * 0.12, this.pelvis, steel, 0, h * 0.02, 0);
    this.cylinder(`${name}.waist`, h * 0.07, h * 0.15, this.pelvis, dark, 0, h * 0.07, 0);

    // ------------------------------- torso --------------------------------
    this.torso = new TransformNode(`${name}.torsoNode`, scene);
    this.torso.parent = this.pelvis;
    this.torso.position.y = h * 0.09;
    // Chest broadens toward the shoulders: two stacked masses, not one slab.
    this.box(
      `${name}.abdomen`,
      h * 0.16,
      torsoHeight * 0.45,
      h * 0.1,
      this.torso,
      dark,
      0,
      torsoHeight * 0.22,
      0,
    );
    this.box(
      `${name}.chest`,
      h * 0.24,
      torsoHeight * 0.55,
      h * 0.13,
      this.torso,
      steel,
      0,
      torsoHeight * 0.68,
      0,
    );
    this.box(
      `${name}.chestPlate`,
      h * 0.18,
      torsoHeight * 0.4,
      h * 0.02,
      this.torso,
      steel,
      0,
      torsoHeight * 0.7,
      -h * 0.075,
    );
    // The reactor core: the one thing on the body that glows by right.
    this.cylinder(
      `${name}.reactor`,
      h * 0.03,
      h * 0.055,
      this.torso,
      core,
      0,
      torsoHeight * 0.68,
      -h * 0.085,
      Math.PI / 2,
    );
    // Intake vents flanking the chest, warm-striped.
    this.box(
      `${name}.ventL`,
      h * 0.02,
      torsoHeight * 0.3,
      h * 0.06,
      this.torso,
      warm,
      -h * 0.13,
      torsoHeight * 0.72,
      0,
    );
    this.box(
      `${name}.ventR`,
      h * 0.02,
      torsoHeight * 0.3,
      h * 0.06,
      this.torso,
      warm,
      h * 0.13,
      torsoHeight * 0.72,
      0,
    );

    // -------------------------------- head --------------------------------
    this.head = new TransformNode(`${name}.headNode`, scene);
    this.head.parent = this.torso;
    this.head.position.y = torsoHeight + h * 0.01;
    this.box(`${name}.helm`, h * 0.09, h * 0.08, h * 0.09, this.head, steel, 0, h * 0.035, 0);
    this.box(`${name}.visor`, h * 0.07, h * 0.02, h * 0.012, this.head, visor, 0, h * 0.035, -h * 0.045);

    // ------------------------------- arms ---------------------------------
    const shoulderY = torsoHeight * 0.85;
    const shoulderX = h * 0.16;
    const upperLen = h * 0.2;
    const forearmLen = h * 0.2;
    const buildArm = (side: 1 | -1): { arm: TransformNode; forearm: TransformNode } => {
      const tag = side === 1 ? "R" : "L";
      const arm = new TransformNode(`${name}.arm${tag}`, scene);
      arm.parent = this.torso;
      arm.position.set(side * shoulderX, shoulderY, 0);
      // Pauldron sits on the shoulder joint, oversized the way the film
      // machines wear them; the collar makes the joint read as a bearing.
      this.box(
        `${name}.pauldron${tag}`,
        h * 0.1,
        h * 0.07,
        h * 0.11,
        arm,
        steel,
        side * h * 0.02,
        h * 0.02,
        0,
      );
      this.cylinder(`${name}.shoulderJoint${tag}`, h * 0.035, h * 0.06, arm, dark, 0, 0, 0, 0, Math.PI / 2);
      this.box(
        `${name}.upperArm${tag}`,
        h * 0.055,
        upperLen,
        h * 0.055,
        arm,
        dark,
        side * h * 0.01,
        -upperLen * 0.55,
        0,
      );

      const forearm = new TransformNode(`${name}.forearm${tag}`, scene);
      forearm.parent = arm;
      forearm.position.y = -upperLen;
      this.cylinder(`${name}.elbow${tag}`, h * 0.03, h * 0.07, forearm, dark, 0, 0, 0, 0, Math.PI / 2);
      // The forearm is armoured heavier than the upper arm: it is the weapon.
      this.box(
        `${name}.forearmShell${tag}`,
        h * 0.075,
        forearmLen * 0.8,
        h * 0.075,
        forearm,
        steel,
        0,
        -forearmLen * 0.45,
        0,
      );
      this.box(
        `${name}.fist${tag}`,
        h * 0.065,
        h * 0.06,
        h * 0.07,
        forearm,
        dark,
        0,
        -forearmLen * 0.95,
        -h * 0.005,
      );
      return { arm, forearm };
    };
    ({ arm: this.armR, forearm: this.forearmR } = buildArm(1));
    ({ arm: this.armL, forearm: this.forearmL } = buildArm(-1));

    // ------------------------------- legs ---------------------------------
    const hipX = h * 0.07;
    const thighLen = legLength * 0.5;
    const shinLen = legLength * 0.5;
    const buildLeg = (side: 1 | -1): { thigh: TransformNode; shin: TransformNode } => {
      const tag = side === 1 ? "R" : "L";
      const thigh = new TransformNode(`${name}.thigh${tag}`, scene);
      thigh.parent = this.pelvis;
      thigh.position.set(side * hipX, 0, 0);
      this.cylinder(`${name}.hipJoint${tag}`, h * 0.035, h * 0.07, thigh, dark, 0, 0, 0, 0, Math.PI / 2);
      this.box(
        `${name}.thighShell${tag}`,
        h * 0.085,
        thighLen * 0.85,
        h * 0.09,
        thigh,
        steel,
        0,
        -thighLen * 0.5,
        0,
      );

      const shin = new TransformNode(`${name}.shin${tag}`, scene);
      shin.parent = thigh;
      shin.position.y = -thighLen;
      this.cylinder(`${name}.knee${tag}`, h * 0.03, h * 0.08, shin, dark, 0, 0, 0, 0, Math.PI / 2);
      // Calf broadens downward: these legs carry a building.
      this.box(
        `${name}.shinShell${tag}`,
        h * 0.095,
        shinLen * 0.8,
        h * 0.1,
        shin,
        steel,
        0,
        -shinLen * 0.45,
        h * 0.005,
      );
      this.box(`${name}.foot${tag}`, h * 0.1, h * 0.035, h * 0.16, shin, dark, 0, -shinLen * 0.98, -h * 0.03);
      return { thigh, shin };
    };
    ({ thigh: this.thighR, shin: this.shinR } = buildLeg(1));
    ({ thigh: this.thighL, shin: this.shinL } = buildLeg(-1));
  }

  /** All the rig's meshes, for pickability, shadows and disposal checks. */
  allMeshes(): readonly Mesh[] {
    return this.meshes;
  }

  /** A hit landed. The kick decays over the next few frames. */
  addRecoil(strength: number): void {
    this.recoilKick = Math.min(1.2, this.recoilKick + Math.max(0, strength));
  }

  /** Drives the whole body from one pose. Call once per frame. */
  update(pose: Partial<JaegerRigPose>, deltaSeconds = 1 / 60): void {
    if (this.disposed) return;
    const p = { ...IDLE_POSE, ...pose };
    const phase = p.stridePhase * Math.PI * 2;
    // Swing amplitude follows speed and saturates: a sprint is a longer
    // stride, not a cartoon windmill.
    const swing = Math.min(0.55, (p.speedMps / 9) * 0.55);
    const idle = Math.sin(p.timeSeconds * 0.9) * 0.012;

    // Legs: thighs alternate, shins bend on the back-swing only.
    this.thighL.rotation.x = Math.sin(phase) * swing;
    this.thighR.rotation.x = Math.sin(phase + Math.PI) * swing;
    this.shinL.rotation.x = Math.max(0, Math.sin(phase + Math.PI * 0.5)) * swing * 0.9;
    this.shinR.rotation.x = Math.max(0, Math.sin(phase + Math.PI * 1.5)) * swing * 0.9;

    // The pelvis bobs twice per stride and the torso leads into the motion.
    this.pelvis.position.y = this.legLength + Math.abs(Math.sin(phase)) * swing * 0.6;
    const damageSlump = p.damage * 0.12;
    this.torso.rotation.x = -swing * 0.35 - damageSlump + idle + this.recoilKick * 0.3;
    this.torso.rotation.y = Math.sin(phase) * swing * 0.12;

    // Arms counter-swing in locomotion, and fight when asked to.
    const armSwingL = Math.sin(phase + Math.PI) * swing * 0.8;
    const armSwingR = Math.sin(phase) * swing * 0.8;
    if (p.attack) {
      const t = Math.min(1, Math.max(0, p.attack.progress));
      if (p.attack.phase === "windup") {
        // Pull back and coil: the anticipation is the mass.
        this.armR.rotation.x = 0.6 * t;
        this.forearmR.rotation.x = -1.2 * t;
        this.torso.rotation.y = -0.25 * t;
      } else if (p.attack.phase === "active") {
        // Extend through the target, torso rotating into the blow.
        this.armR.rotation.x = 0.6 - 2.0 * t;
        this.forearmR.rotation.x = -1.2 + 1.1 * t;
        this.torso.rotation.y = -0.25 + 0.5 * t;
      } else {
        this.armR.rotation.x = -1.4 + 1.4 * t;
        this.forearmR.rotation.x = -0.1 * (1 - t);
        this.torso.rotation.y = 0.25 * (1 - t);
      }
      this.armL.rotation.x = armSwingL * 0.4 - 0.2;
    } else if (p.guarding) {
      // Forearms up and crossed in front of the core.
      this.armL.rotation.x = -1.5;
      this.armR.rotation.x = -1.5;
      this.forearmL.rotation.x = -1.1;
      this.forearmR.rotation.x = -1.1;
    } else {
      this.armL.rotation.x = armSwingL;
      this.armR.rotation.x = armSwingR;
      this.forearmL.rotation.x = -0.25 - Math.max(0, armSwingL) * 0.4;
      this.forearmR.rotation.x = -0.25 - Math.max(0, armSwingR) * 0.4;
    }

    // The head keeps its own counsel: level against the torso, damage aside.
    this.head.rotation.x = -this.torso.rotation.x * 0.6;

    // Recoil burns down; the core gutters once the structure is going.
    this.recoilKick = Math.max(0, this.recoilKick - deltaSeconds * 4);
    if (this.core) {
      const gutter = p.damage > 0.5 ? 0.5 + 0.5 * Math.abs(Math.sin(p.timeSeconds * 11)) : 1;
      this.core.emissiveColor = hex("style.plasma", "#66e0ff").scale(0.9 * gutter * (1 - p.damage * 0.4));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.dispose();
    for (const material of this.materials) material.dispose();
    this.meshes.length = 0;
    this.materials.length = 0;
    this.core = null;
    this.root.dispose();
  }

  private legLength = 0;

  private material(name: string, colour: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    // Painted plate under a full sun: the palette colour is what the surface
    // reads as, not what it reflects, so the albedo sits well below it.
    material.diffuseColor = colour.scale(0.62);
    // The roughness floor from the style guide, as specular restraint: these
    // surfaces are painted plate, never chrome.
    const shine = Math.max(0, 1 - SURFACE_STYLES.machine.roughnessFloor);
    material.specularColor = new Color3(shine * 0.3, shine * 0.3, shine * 0.32);
    this.materials.push(material);
    return material;
  }

  private box(
    name: string,
    width: number,
    height: number,
    depth: number,
    parent: TransformNode,
    material: StandardMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.isPickable = false;
    // Never a pick target: the camera's obstruction ray must pass through the body it follows.
    mesh.isPickable = false;
    this.meshes.push(mesh);
    return mesh;
  }

  private cylinder(
    name: string,
    radius: number,
    height: number,
    parent: TransformNode,
    material: StandardMaterial,
    x: number,
    y: number,
    z: number,
    rotX = 0,
    rotZ = 0,
  ): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      name,
      { diameter: radius * 2, height, tessellation: 12 },
      this.scene,
    );
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotX;
    mesh.rotation.z = rotZ;
    mesh.material = material;
    mesh.isPickable = false;
    // Never a pick target: the camera's obstruction ray must pass through the body it follows.
    mesh.isPickable = false;
    this.meshes.push(mesh);
    return mesh;
  }
}
