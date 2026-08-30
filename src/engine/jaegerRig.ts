import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  type Scene,
} from "@babylonjs/core";

/**
 * Gipsy Danger, built from parts.
 *
 * The original procedural placeholder for the flagship machine: a stylised
 * industrial-anime hero rig with a small armoured head, a broad layered torso
 * around a circular chest reactor, blue plate over dark joints, segmented
 * arms and legs, elbow thrusters, a plasma barrel on the left forearm and a
 * chain sword that deploys from the right. Inked edges on every panel give it
 * a drawn silhouette at fight distance.
 *
 * Orientation contract (docs/ORIENTATION.md): the pivot is on the sole plane,
 * +Y is up, the visor and the reactor face +Z. The root is identity; every
 * tilt lives on the `visual` node and is reported through `tilt`.
 *
 * Height drives every dimension, so the same builder makes a 68 m frame and
 * an 82 m frame. Sockets are plain transform nodes: a real GLB replaces the
 * rig through the resolver without touching gameplay.
 */

export type JaegerAttackKind =
  | "jab"
  | "cross"
  | "smash"
  | "spin"
  | "overhead"
  | "haymaker"
  | "launcher"
  | "shoulder"
  | "elbow"
  | "sword"
  | "purge"
  | "finisher"
  | "counter";

export type JaegerWeaponMode = "fists" | "sword" | "plasma";

export type JaegerRegion = "arm.L" | "arm.R" | "leg.L" | "leg.R" | "torso" | "reactor";

export interface JaegerRigPose {
  /** 0 to 1, from the locomotion. Distance covered decides the legs. */
  readonly stridePhase: number;
  readonly speedMps: number;
  readonly timeSeconds: number;
  readonly attack: {
    readonly phase: "windup" | "active" | "recover";
    readonly progress: number;
    readonly kind?: JaegerAttackKind;
  } | null;
  readonly guarding: boolean;
  /** 0 to 1: overall structure lost. */
  readonly damage: number;
  /** Which way the body is leaning: forward is +Z, lateral is +X. */
  readonly lean?: { readonly forward: number; readonly lateral: number };
  readonly dodge?: { readonly progress: number; readonly direction: "L" | "R" | "F" | "B" } | null;
  /** A tagged tilt: progress 1 is flat on the back; recovering runs it in reverse. */
  readonly knockdown?: { readonly progress: number; readonly recovering: boolean } | null;
  readonly grapple?: { readonly holding: boolean; readonly progress: number } | null;
  readonly weapon?: JaegerWeaponMode;
  /** 0 to 1 per region: darkens plate, then it flickers. */
  readonly regionDamage?: Partial<Record<JaegerRegion, number>>;
  /** Reactor glow and thruster light, 0 to 1. Drift Flow drives it. */
  readonly charge?: number;
  /** Booster output this frame, 0 to 1: dodges, sprints and the elbow rocket. */
  readonly boost?: number;
}

const DEFAULT_POSE: JaegerRigPose = {
  stridePhase: 0,
  speedMps: 0,
  timeSeconds: 0,
  attack: null,
  guarding: false,
  damage: 0,
  weapon: "fists",
};

/** Colours the flagship reads as. Painted plate, so the albedo sits below them. */
const PLATE_BLUE = Color3.FromHexString("#2d5f9c");
const PLATE_BLUE_DEEP = Color3.FromHexString("#1f3f6b");
const JOINT_DARK = Color3.FromHexString("#151b22");
const TRIM_STEEL = Color3.FromHexString("#8a9199");
const ACCENT_AMBER = Color3.FromHexString("#ffc247");
const REACTOR_CYAN = Color3.FromHexString("#66e0ff");
const VISOR_CYAN = Color3.FromHexString("#8fe3ff");
const THRUSTER_ORANGE = Color3.FromHexString("#ff9a3d");
const SWORD_STEEL = Color3.FromHexString("#c8d2da");

const EDGE_COLOUR = new Color4(0.02, 0.04, 0.07, 0.9);

export class JaegerRig {
  readonly root: TransformNode;
  /** All tagged tilts (knockdown, dodge lean) live here, under the identity root. */
  readonly visual: TransformNode;
  readonly sockets: Readonly<
    Record<
      | "head"
      | "chest"
      | "reactor"
      | "back"
      | "hand.L"
      | "hand.R"
      | "forearm.L"
      | "forearm.R"
      | "foot.L"
      | "foot.R"
      | "muzzle",
      TransformNode
    >
  >;
  /** Degrees of tagged tilt on the visual node this frame, for the validator. */
  tilt = 0;

  private readonly scene: Scene;
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly regionMaterials = new Map<JaegerRegion, StandardMaterial[]>();
  private readonly h: number;
  private readonly legLength: number;

  private readonly pelvis: TransformNode;
  private readonly torso: TransformNode;
  private readonly head: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly forearmL: TransformNode;
  private readonly forearmR: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly shinL: TransformNode;
  private readonly shinR: TransformNode;
  private readonly footL: TransformNode;
  private readonly footR: TransformNode;
  private readonly sword: Mesh;
  private readonly plasmaBarrel: Mesh;
  private readonly reactorCore: Mesh;
  private readonly reactorMaterial: StandardMaterial;
  private readonly visorMaterial: StandardMaterial;
  private readonly thrusterMaterial: StandardMaterial;
  private readonly plasmaMaterial: StandardMaterial;
  private readonly ventMaterials: StandardMaterial[] = [];

  private recoilKick = 0;
  private swordDeploy = 0;
  private plasmaDeploy = 0;
  private disposed = false;

  constructor(scene: Scene, heightMeters: number, name = "jaegerRig") {
    this.scene = scene;
    const h = heightMeters;
    this.h = h;
    this.root = new TransformNode(`${name}.root`, scene);
    this.visual = new TransformNode(`${name}.visual`, scene);
    this.visual.parent = this.root;

    const plate = this.material(`${name}.plate`, PLATE_BLUE, "torso");
    const plateDeep = this.material(`${name}.plateDeep`, PLATE_BLUE_DEEP, "torso");
    const joint = this.material(`${name}.joint`, JOINT_DARK);
    const trim = this.material(`${name}.trim`, TRIM_STEEL);
    const accent = this.material(`${name}.accent`, ACCENT_AMBER);
    accent.emissiveColor = ACCENT_AMBER.scale(0.2);
    this.reactorMaterial = this.material(`${name}.reactor`, REACTOR_CYAN);
    this.reactorMaterial.emissiveColor = REACTOR_CYAN.scale(0.9);
    this.visorMaterial = this.material(`${name}.visor`, VISOR_CYAN);
    this.visorMaterial.emissiveColor = VISOR_CYAN.scale(0.7);
    // Thruster nozzles are dark metal until they fire; the orange is emissive only.
    this.thrusterMaterial = this.material(`${name}.thruster`, JOINT_DARK);
    this.thrusterMaterial.emissiveColor = Color3.Black();
    this.plasmaMaterial = this.material(`${name}.plasma`, REACTOR_CYAN);
    this.plasmaMaterial.emissiveColor = Color3.Black();
    const swordMaterial = this.material(`${name}.sword`, SWORD_STEEL);
    swordMaterial.specularColor = new Color3(0.6, 0.65, 0.7);
    swordMaterial.specularPower = 48;

    // Proportions. Heroic: long legs, broad shoulders, small head.
    this.legLength = h * 0.47;
    const torsoHeight = h * 0.3;
    const shoulderWidth = h * 0.34;

    // Pelvis and hips.
    this.pelvis = new TransformNode(`${name}.pelvis`, scene);
    this.pelvis.parent = this.visual;
    this.pelvis.position.y = this.legLength;
    this.box(`${name}.hips`, h * 0.2, h * 0.08, h * 0.13, this.pelvis, plateDeep, 0, 0.01 * h, 0);
    this.box(`${name}.codpiece`, h * 0.1, h * 0.06, h * 0.05, this.pelvis, plate, 0, -0.01 * h, h * 0.07);
    this.box(`${name}.hipPlate.L`, h * 0.05, h * 0.09, h * 0.12, this.pelvis, plate, -h * 0.115, 0, 0);
    this.box(`${name}.hipPlate.R`, h * 0.05, h * 0.09, h * 0.12, this.pelvis, plate, h * 0.115, 0, 0);
    this.cylinder(`${name}.waist`, h * 0.065, h * 0.06, this.pelvis, joint, 0, h * 0.06, 0);

    // Torso: abdomen, broad chest, layered front plate, back pack.
    this.torso = new TransformNode(`${name}.torso`, scene);
    this.torso.parent = this.pelvis;
    this.torso.position.y = h * 0.08;
    this.box(
      `${name}.abdomen`,
      h * 0.15,
      torsoHeight * 0.4,
      h * 0.1,
      this.torso,
      joint,
      0,
      torsoHeight * 0.2,
      0,
    );
    this.box(
      `${name}.abdomenPlate`,
      h * 0.12,
      torsoHeight * 0.32,
      h * 0.03,
      this.torso,
      plateDeep,
      0,
      torsoHeight * 0.2,
      h * 0.06,
    );
    this.box(
      `${name}.chest`,
      h * 0.26,
      torsoHeight * 0.55,
      h * 0.15,
      this.torso,
      plate,
      0,
      torsoHeight * 0.66,
      0,
    );
    this.box(
      `${name}.chestPlate.L`,
      h * 0.1,
      torsoHeight * 0.4,
      h * 0.04,
      this.torso,
      plate,
      -h * 0.085,
      torsoHeight * 0.72,
      h * 0.085,
    );
    this.box(
      `${name}.chestPlate.R`,
      h * 0.1,
      torsoHeight * 0.4,
      h * 0.04,
      this.torso,
      plate,
      h * 0.085,
      torsoHeight * 0.72,
      h * 0.085,
    );
    this.box(
      `${name}.collar`,
      h * 0.2,
      torsoHeight * 0.12,
      h * 0.12,
      this.torso,
      trim,
      0,
      torsoHeight * 0.93,
      h * 0.02,
    );
    this.box(
      `${name}.backPack`,
      h * 0.2,
      torsoHeight * 0.5,
      h * 0.06,
      this.torso,
      plateDeep,
      0,
      torsoHeight * 0.62,
      -h * 0.095,
    );
    this.box(
      `${name}.spine`,
      h * 0.04,
      torsoHeight * 0.8,
      h * 0.03,
      this.torso,
      trim,
      0,
      torsoHeight * 0.5,
      -h * 0.125,
    );
    for (const side of [-1, 1] as const) {
      const vent = this.material(`${name}.vent.${side}`, JOINT_DARK);
      this.ventMaterials.push(vent);
      this.box(
        `${name}.vent.${side}`,
        h * 0.05,
        torsoHeight * 0.22,
        h * 0.03,
        this.torso,
        vent,
        side * h * 0.075,
        torsoHeight * 0.36,
        h * 0.075,
      );
      // Thrusters on the back: the boosters that read as orange when they fire.
      this.cylinder(
        `${name}.thruster.${side}`,
        h * 0.028,
        h * 0.07,
        this.torso,
        this.thrusterMaterial,
        side * h * 0.07,
        torsoHeight * 0.6,
        -h * 0.13,
        Math.PI / 2,
      );
      this.box(
        `${name}.stripe.${side}`,
        h * 0.012,
        torsoHeight * 0.3,
        h * 0.005,
        this.torso,
        accent,
        side * h * 0.12,
        torsoHeight * 0.7,
        h * 0.078,
      );
    }
    // The reactor: a ring around a glowing core, on the front of the chest.
    this.cylinder(
      `${name}.reactorRing`,
      h * 0.055,
      h * 0.03,
      this.torso,
      trim,
      0,
      torsoHeight * 0.66,
      h * 0.09,
      Math.PI / 2,
    );
    this.reactorCore = this.cylinder(
      `${name}.reactorCore`,
      h * 0.038,
      h * 0.035,
      this.torso,
      this.reactorMaterial,
      0,
      torsoHeight * 0.66,
      h * 0.098,
      Math.PI / 2,
    );

    // Head: small, armoured, with a visor slit and a sensor mast.
    this.head = new TransformNode(`${name}.head`, scene);
    this.head.parent = this.torso;
    this.head.position.y = torsoHeight + h * 0.005;
    this.cylinder(`${name}.neck`, h * 0.03, h * 0.03, this.head, joint, 0, -h * 0.005, 0);
    this.box(`${name}.helm`, h * 0.075, h * 0.065, h * 0.08, this.head, plate, 0, h * 0.035, 0);
    this.box(
      `${name}.visor`,
      h * 0.05,
      h * 0.014,
      h * 0.012,
      this.head,
      this.visorMaterial,
      0,
      h * 0.036,
      h * 0.042,
    );
    this.box(`${name}.jawGuard`, h * 0.06, h * 0.02, h * 0.03, this.head, joint, 0, h * 0.012, h * 0.03);
    this.box(`${name}.mast`, h * 0.008, h * 0.05, h * 0.008, this.head, trim, h * 0.03, h * 0.08, -h * 0.02);

    // Shoulders and arms.
    const shoulderY = torsoHeight * 0.82;
    this.armL = this.buildArm(
      name,
      -1,
      shoulderWidth * 0.5,
      shoulderY,
      plate,
      plateDeep,
      joint,
      trim,
      "arm.L",
    );
    this.armR = this.buildArm(
      name,
      1,
      shoulderWidth * 0.5,
      shoulderY,
      plate,
      plateDeep,
      joint,
      trim,
      "arm.R",
    );
    this.forearmL = this.armL
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".forearm")) as TransformNode;
    this.forearmR = this.armR
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".forearm")) as TransformNode;

    // The chain sword rides the right forearm and deploys down past the fist.
    this.sword = this.box(
      `${name}.sword`,
      h * 0.02,
      h * 0.3,
      h * 0.05,
      this.forearmR,
      swordMaterial,
      0,
      -h * 0.34,
      h * 0.01,
    );
    this.sword.scaling.y = 0.001;
    this.sword.isVisible = false;
    // The plasma caster barrel opens on the left forearm.
    this.plasmaBarrel = this.cylinder(
      `${name}.plasmaBarrel`,
      h * 0.022,
      h * 0.09,
      this.forearmL,
      this.plasmaMaterial,
      0,
      -h * 0.2,
      h * 0.035,
      Math.PI / 2,
    );
    this.plasmaBarrel.scaling.setAll(0.001);

    // Legs.
    this.legL = this.buildLeg(name, -1, plate, plateDeep, joint, trim, "leg.L");
    this.legR = this.buildLeg(name, 1, plate, plateDeep, joint, trim, "leg.R");
    this.shinL = this.legL
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".shin")) as TransformNode;
    this.shinR = this.legR
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".shin")) as TransformNode;
    this.footL = this.shinL
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".foot")) as TransformNode;
    this.footR = this.shinR
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".foot")) as TransformNode;

    // Sockets: plain nodes, +Z pointing the way the mounted thing points.
    const socket = (id: string, parent: TransformNode, x: number, y: number, z: number): TransformNode => {
      const node = new TransformNode(`${name}.socket.${id}`, scene);
      node.parent = parent;
      node.position.set(x, y, z);
      return node;
    };
    this.sockets = {
      head: socket("head", this.head, 0, h * 0.04, 0),
      chest: socket("chest", this.torso, 0, torsoHeight * 0.66, h * 0.09),
      reactor: socket("reactor", this.torso, 0, torsoHeight * 0.66, h * 0.12),
      back: socket("back", this.torso, 0, torsoHeight * 0.6, -h * 0.14),
      "hand.L": socket("hand.L", this.forearmL, 0, -h * 0.215, 0),
      "hand.R": socket("hand.R", this.forearmR, 0, -h * 0.215, 0),
      "forearm.L": socket("forearm.L", this.forearmL, 0, -h * 0.1, 0),
      "forearm.R": socket("forearm.R", this.forearmR, 0, -h * 0.1, 0),
      "foot.L": socket("foot.L", this.footL, 0, 0, 0),
      "foot.R": socket("foot.R", this.footR, 0, 0, 0),
      muzzle: socket("muzzle", this.forearmL, 0, -h * 0.2, h * 0.08),
    };

    this.update(DEFAULT_POSE, 0);
  }

  /** The front marker for the validator: the reactor, which faces +Z. */
  get frontMarker(): TransformNode {
    return this.sockets.reactor;
  }

  get heightMeters(): number {
    return this.h;
  }

  /** A kick from a hit or a footfall; decays on its own. */
  addRecoil(strength: number): void {
    if (!Number.isFinite(strength)) return;
    this.recoilKick = Math.min(1.2, this.recoilKick + Math.max(0, strength));
  }

  /** Inked edges on or off, for the low preset. */
  setInk(on: boolean): void {
    for (const mesh of this.meshes) {
      if (on) {
        mesh.enableEdgesRendering(0.99);
        mesh.edgesWidth = this.h * 0.22;
        mesh.edgesColor = EDGE_COLOUR;
      } else {
        mesh.disableEdgesRendering();
      }
    }
  }

  allMeshes(): readonly Mesh[] {
    return this.meshes;
  }

  update(pose: Partial<JaegerRigPose>, deltaSeconds = 1 / 60): void {
    if (this.disposed) return;
    const p: JaegerRigPose = { ...DEFAULT_POSE, ...pose };
    const h = this.h;
    const t = p.timeSeconds;
    const dt = Math.max(0, deltaSeconds);

    // Locomotion: legs from the stride phase, arms against them, torso ahead
    // of the hips. Swing scales with speed and saturates at a run.
    const phase = p.stridePhase * Math.PI * 2;
    const speedFraction = Math.min(1, p.speedMps / 30);
    const swing = Math.min(0.7, speedFraction * 0.7);
    const sprinting = p.speedMps > 22;
    const armSwing = swing * 0.8;
    // A limb hanging down swings forward (+Z) with a negative rotation.x.
    this.legL.rotation.x = -Math.sin(phase) * swing;
    this.legR.rotation.x = Math.sin(phase) * swing;
    // Knees bend on the back swing, when the foot is lifting, and stay straight
    // on the planted half so the sole reads as planted rather than skating.
    this.shinL.rotation.x = Math.max(0, Math.sin(phase)) * swing * 1.3;
    this.shinR.rotation.x = Math.max(0, -Math.sin(phase)) * swing * 1.3;
    this.footL.rotation.x = -this.shinL.rotation.x * 0.5;
    this.footR.rotation.x = -this.shinR.rotation.x * 0.5;
    // Pelvis rises a little at the crossing of the legs; the settle lives in the view.
    this.pelvis.position.y = this.legLength + Math.abs(Math.sin(phase)) * swing * h * 0.01;
    this.pelvis.rotation.y = Math.sin(phase) * swing * 0.1;

    let armLx = Math.sin(phase) * armSwing;
    let armRx = -Math.sin(phase) * armSwing;
    let armLz = 0.12;
    let armRz = -0.12;
    let armLy = 0;
    let armRy = 0;
    let foreLx = -0.25 - swing * 0.5;
    let foreRx = -0.25 - swing * 0.5;
    let torsoX = (sprinting ? 0.22 : 0.06) * speedFraction + (p.lean?.forward ?? 0) * 0.25;
    let torsoY = Math.sin(phase) * swing * 0.12;
    const torsoZ = -(p.lean?.lateral ?? 0) * 0.18;
    let headX = -torsoX * 0.6;
    let headY = 0;

    // Attacks. Each kind is a pose the arms and torso travel through; the
    // arena decides when it lands, the rig only shows the commitment.
    const attack = p.attack;
    if (attack) {
      const k = attack.kind ?? "jab";
      const q = clamp(attack.progress, 0, 1);
      const ease = q * q * (3 - 2 * q);
      const windup = attack.phase === "windup" ? ease : attack.phase === "active" ? 1 : 1 - ease;
      const strike = attack.phase === "active" ? ease : attack.phase === "recover" ? 1 - ease : 0;
      const rightHanded = k !== "cross";
      if (k === "jab" || k === "cross" || k === "counter") {
        const back = 0.55 * windup - 2.05 * strike;
        const fold = -1.5 * windup + 1.3 * strike;
        if (rightHanded) {
          armRx = back;
          foreRx = fold;
          torsoY = -0.3 * windup + 0.55 * strike;
        } else {
          armLx = back;
          foreLx = fold;
          torsoY = 0.3 * windup - 0.55 * strike;
        }
        torsoX += 0.1 * strike;
      } else if (k === "smash" || k === "elbow") {
        armLx = 0.4 * windup - 1.9 * strike;
        armRx = 0.4 * windup - 1.9 * strike;
        foreLx = -1.3 * windup + (k === "elbow" ? -0.3 : 1.1) * strike;
        foreRx = -1.3 * windup + (k === "elbow" ? -0.3 : 1.1) * strike;
        torsoX += -0.15 * windup + 0.35 * strike;
      } else if (k === "overhead") {
        armLx = -2.9 * windup + 1.7 * strike;
        armRx = -2.9 * windup + 1.7 * strike;
        foreLx = -0.4 * windup;
        foreRx = -0.4 * windup;
        torsoX += -0.2 * windup + 0.45 * strike;
      } else if (k === "haymaker") {
        armRx = 0.3 * windup - 1.7 * strike;
        armRz = -1.3 * windup + 1.2 * strike;
        foreRx = -0.9 * windup + 0.6 * strike;
        torsoY = -0.6 * windup + 0.9 * strike;
        torsoX += 0.12 * strike;
      } else if (k === "spin") {
        armLx = -1.5;
        armRx = -1.5;
        armLz = 0.9;
        armRz = -0.9;
        torsoY = -1.1 * windup + 2.2 * strike;
      } else if (k === "launcher") {
        armRx = 0.7 * windup - 2.6 * strike;
        foreRx = -1.0 * windup + 0.4 * strike;
        torsoX += 0.25 * windup - 0.3 * strike;
        torsoY = -0.25 * windup + 0.35 * strike;
      } else if (k === "shoulder") {
        armLx = -0.9 * (windup + strike);
        armLy = 0.5 * (windup + strike);
        foreLx = -1.2;
        torsoY = 0.5 * windup + 0.3 * strike;
        torsoX += 0.15 * windup + 0.35 * strike;
      } else if (k === "sword") {
        armRx = -1.55;
        armRy = -1.1 * windup + 1.3 * strike;
        foreRx = -0.2;
        torsoY = -0.5 * windup + 0.8 * strike;
        torsoX += 0.1 * strike;
      } else if (k === "purge") {
        armLz = 1.15 * (windup + strike);
        armRz = -1.15 * (windup + strike);
        armLx = -0.5 * (windup + strike);
        armRx = -0.5 * (windup + strike);
        torsoX += -0.2 * (windup + strike);
      } else if (k === "finisher") {
        armLx = -1.6 * (windup + strike * 0.2);
        armRx = -1.2 * windup - 0.6 * strike;
        foreLx = -0.1;
        foreRx = -1.0 * windup + 0.8 * strike;
        torsoX += 0.05 * windup + 0.25 * strike;
      }
    }

    if (p.guarding && !attack) {
      armLx = -1.25;
      armRx = -1.25;
      armLy = 0.55;
      armRy = -0.55;
      foreLx = -1.6;
      foreRx = -1.6;
      torsoX += 0.08;
      headX = 0.1;
    }

    if (p.grapple?.holding) {
      const g = clamp(p.grapple.progress, 0, 1);
      armLx = -1.55;
      armRx = -1.55;
      armLy = 0.35;
      armRy = -0.35;
      foreLx = -0.5 + 0.3 * g;
      foreRx = -0.5 + 0.3 * g;
      torsoX += 0.2 + 0.1 * g;
    }

    // Recoil kicks the torso back and decays; damage slumps it forward and
    // makes the reactor gutter.
    this.recoilKick = Math.max(0, this.recoilKick - dt * 4);
    torsoX += -this.recoilKick * 0.28 + p.damage * 0.1;
    headY += Math.sin(t * 0.7) * 0.03;

    this.torso.rotation.set(torsoX, torsoY, torsoZ);
    this.head.rotation.set(headX, headY, 0);
    this.armL.rotation.set(armLx, armLy, armLz);
    this.armR.rotation.set(armRx, armRy, armRz);
    this.forearmL.rotation.x = foreLx;
    this.forearmR.rotation.x = foreRx;

    // Dodge lean and knockdown are the tagged tilts on the visual node.
    let tiltX = 0;
    let tiltZ = 0;
    let lift = 0;
    if (p.dodge) {
      const d = Math.sin(clamp(p.dodge.progress, 0, 1) * Math.PI) * 0.16;
      if (p.dodge.direction === "L") tiltZ = d;
      else if (p.dodge.direction === "R") tiltZ = -d;
      else if (p.dodge.direction === "F") tiltX = d;
      else tiltX = -d;
    }
    if (p.knockdown) {
      const k = clamp(p.knockdown.progress, 0, 1);
      const eased = k * k * (3 - 2 * k);
      // Flat on the back: the top of the body goes to -Z, feet stay put.
      tiltX = -1.42 * eased;
      lift = h * 0.06 * eased;
      this.legL.rotation.x = -0.35 * eased;
      this.legR.rotation.x = -0.25 * eased;
      this.armL.rotation.x = -0.6 * eased;
      this.armR.rotation.x = -0.5 * eased;
    }
    this.visual.rotation.set(tiltX, 0, tiltZ);
    this.visual.position.y = lift;
    this.tilt = (Math.hypot(tiltX, tiltZ) * 180) / Math.PI;

    // Weapons deploy with their own short transitions, never popping.
    const weapon = p.weapon ?? "fists";
    this.swordDeploy = approach(this.swordDeploy, weapon === "sword" ? 1 : 0, dt * 5);
    this.plasmaDeploy = approach(this.plasmaDeploy, weapon === "plasma" ? 1 : 0, dt * 6);
    this.sword.isVisible = this.swordDeploy > 0.01;
    this.sword.scaling.y = Math.max(0.001, this.swordDeploy);
    this.sword.position.y = -h * 0.19 - this.swordDeploy * h * 0.15;
    const barrel = Math.max(0.001, this.plasmaDeploy);
    this.plasmaBarrel.scaling.set(barrel, barrel, barrel);
    this.plasmaMaterial.emissiveColor = REACTOR_CYAN.scale(this.plasmaDeploy * 0.8);

    // Reactor and thrusters: the two lights the machine carries.
    const charge = clamp(p.charge ?? 0, 0, 1);
    const gutter = p.damage > 0.5 ? 0.55 + 0.45 * Math.abs(Math.sin(t * 11)) : 1;
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.4);
    this.reactorMaterial.emissiveColor = REACTOR_CYAN.scale(
      (0.7 + charge * 0.5) * pulse * gutter * (1 - p.damage * 0.35),
    );
    const boost = clamp(p.boost ?? 0, 0, 1) + (sprinting ? 0.35 : 0);
    this.thrusterMaterial.emissiveColor = THRUSTER_ORANGE.scale(Math.min(1, boost));
    for (const vent of this.ventMaterials)
      vent.emissiveColor = THRUSTER_ORANGE.scale(Math.min(1, boost) * 0.35);

    // Region damage: plate darkens, then flickers at the scar.
    const regions = p.regionDamage ?? {};
    for (const [region, materials] of this.regionMaterials) {
      const amount = clamp(regions[region] ?? 0, 0, 1);
      const flicker = amount > 0.6 ? 0.5 + 0.5 * Math.abs(Math.sin(t * 13 + region.length)) : 0;
      for (const material of materials) {
        const base = material.metadata as { base: Color3 } | undefined;
        if (!base) continue;
        material.diffuseColor = base.base.scale(0.62 * (1 - amount * 0.45));
        material.emissiveColor = THRUSTER_ORANGE.scale(flicker * amount * 0.35);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.dispose();
    for (const material of this.materials) material.dispose();
    this.root.dispose();
  }

  private buildArm(
    name: string,
    side: 1 | -1,
    shoulderX: number,
    shoulderY: number,
    plate: StandardMaterial,
    plateDeep: StandardMaterial,
    joint: StandardMaterial,
    trim: StandardMaterial,
    region: JaegerRegion,
  ): TransformNode {
    const h = this.h;
    const suffix = side === 1 ? "R" : "L";
    const armPlate = this.material(`${name}.arm.${suffix}.plate`, PLATE_BLUE, region);
    const arm = new TransformNode(`${name}.arm.${suffix}`, this.scene);
    arm.parent = this.torso;
    arm.position.set(side * shoulderX, shoulderY, 0);
    const upperLen = h * 0.2;
    const forearmLen = h * 0.21;
    // Pauldron: a big shoulder block with a raised rim, the widest thing on the body.
    this.box(
      `${name}.pauldron.${suffix}`,
      h * 0.11,
      h * 0.09,
      h * 0.12,
      arm,
      armPlate,
      side * h * 0.01,
      h * 0.02,
      0,
    );
    this.box(
      `${name}.pauldronRim.${suffix}`,
      h * 0.12,
      h * 0.02,
      h * 0.13,
      arm,
      trim,
      side * h * 0.01,
      h * 0.065,
      0,
    );
    this.cylinder(
      `${name}.shoulderJoint.${suffix}`,
      h * 0.045,
      h * 0.06,
      arm,
      joint,
      0,
      0,
      0,
      0,
      Math.PI / 2,
    );
    this.box(
      `${name}.upperArm.${suffix}`,
      h * 0.075,
      upperLen,
      h * 0.08,
      arm,
      armPlate,
      0,
      -upperLen * 0.5,
      0,
    );
    this.box(
      `${name}.upperArmInner.${suffix}`,
      h * 0.05,
      upperLen * 0.9,
      h * 0.05,
      arm,
      joint,
      0,
      -upperLen * 0.5,
      0,
    );
    const forearm = new TransformNode(`${name}.arm.${suffix}.forearm`, this.scene);
    forearm.parent = arm;
    forearm.position.y = -upperLen;
    this.cylinder(`${name}.elbow.${suffix}`, h * 0.04, h * 0.09, forearm, joint, 0, 0, 0, 0, Math.PI / 2);
    // Elbow rocket housing: a thruster block behind the elbow.
    this.box(
      `${name}.elbowRocket.${suffix}`,
      h * 0.05,
      h * 0.06,
      h * 0.05,
      forearm,
      plateDeep,
      0,
      -h * 0.01,
      -h * 0.05,
    );
    this.cylinder(
      `${name}.elbowNozzle.${suffix}`,
      h * 0.018,
      h * 0.03,
      forearm,
      this.thrusterMaterial,
      0,
      -h * 0.01,
      -h * 0.078,
      Math.PI / 2,
    );
    this.box(
      `${name}.gauntlet.${suffix}`,
      h * 0.085,
      forearmLen * 0.75,
      h * 0.09,
      forearm,
      armPlate,
      0,
      -forearmLen * 0.45,
      0,
    );
    this.box(
      `${name}.gauntletPlate.${suffix}`,
      h * 0.06,
      forearmLen * 0.5,
      h * 0.02,
      forearm,
      plate,
      0,
      -forearmLen * 0.4,
      h * 0.05,
    );
    this.box(
      `${name}.fist.${suffix}`,
      h * 0.07,
      h * 0.075,
      h * 0.075,
      forearm,
      joint,
      0,
      -forearmLen - h * 0.015,
      h * 0.005,
    );
    this.box(
      `${name}.knuckles.${suffix}`,
      h * 0.075,
      h * 0.03,
      h * 0.02,
      forearm,
      trim,
      0,
      -forearmLen - h * 0.03,
      h * 0.04,
    );
    return arm;
  }

  private buildLeg(
    name: string,
    side: 1 | -1,
    plate: StandardMaterial,
    plateDeep: StandardMaterial,
    joint: StandardMaterial,
    trim: StandardMaterial,
    region: JaegerRegion,
  ): TransformNode {
    const h = this.h;
    const suffix = side === 1 ? "R" : "L";
    const legPlate = this.material(`${name}.leg.${suffix}.plate`, PLATE_BLUE, region);
    const leg = new TransformNode(`${name}.leg.${suffix}`, this.scene);
    leg.parent = this.pelvis;
    leg.position.set(side * h * 0.075, 0, 0);
    const thighLen = this.legLength * 0.5;
    const shinLen = this.legLength * 0.5;
    this.cylinder(`${name}.hipJoint.${suffix}`, h * 0.045, h * 0.07, leg, joint, 0, 0, 0, 0, Math.PI / 2);
    this.box(`${name}.thigh.${suffix}`, h * 0.09, thighLen, h * 0.1, leg, legPlate, 0, -thighLen * 0.5, 0);
    this.box(
      `${name}.thighPlate.${suffix}`,
      h * 0.07,
      thighLen * 0.7,
      h * 0.025,
      leg,
      plate,
      0,
      -thighLen * 0.45,
      h * 0.06,
    );
    const shin = new TransformNode(`${name}.leg.${suffix}.shin`, this.scene);
    shin.parent = leg;
    shin.position.y = -thighLen;
    this.cylinder(`${name}.knee.${suffix}`, h * 0.045, h * 0.1, shin, joint, 0, 0, 0, 0, Math.PI / 2);
    this.box(`${name}.kneeCap.${suffix}`, h * 0.06, h * 0.05, h * 0.03, shin, trim, 0, 0, h * 0.055);
    this.box(`${name}.shin.${suffix}`, h * 0.085, shinLen, h * 0.095, shin, legPlate, 0, -shinLen * 0.5, 0);
    this.box(
      `${name}.shinGuard.${suffix}`,
      h * 0.07,
      shinLen * 0.75,
      h * 0.025,
      shin,
      plateDeep,
      0,
      -shinLen * 0.5,
      h * 0.058,
    );
    const foot = new TransformNode(`${name}.leg.${suffix}.foot`, this.scene);
    foot.parent = shin;
    foot.position.y = -shinLen;
    // The sole sits at exactly rig y = 0: pelvis height is the leg length.
    this.box(`${name}.foot.${suffix}`, h * 0.1, h * 0.035, h * 0.15, foot, joint, 0, h * 0.0175, h * 0.02);
    this.box(`${name}.toePlate.${suffix}`, h * 0.09, h * 0.03, h * 0.05, foot, plate, 0, h * 0.04, h * 0.075);
    this.box(
      `${name}.heel.${suffix}`,
      h * 0.08,
      h * 0.03,
      h * 0.04,
      foot,
      plateDeep,
      0,
      h * 0.04,
      -h * 0.045,
    );
    return leg;
  }

  private material(name: string, colour: Color3, region?: JaegerRegion): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = colour.scale(0.62);
    material.specularColor = new Color3(0.14, 0.15, 0.17);
    material.specularPower = 28;
    material.metadata = { base: colour };
    this.materials.push(material);
    if (region) {
      const list = this.regionMaterials.get(region) ?? [];
      list.push(material);
      this.regionMaterials.set(region, list);
    }
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
    // Never a pick target: the camera's obstruction ray must pass through the body it follows.
    mesh.isPickable = false;
    mesh.enableEdgesRendering(0.99);
    mesh.edgesWidth = this.h * 0.22;
    mesh.edgesColor = EDGE_COLOUR;
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
      { diameter: radius * 2, height, tessellation: 14 },
      this.scene,
    );
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotX;
    mesh.rotation.z = rotZ;
    mesh.material = material;
    mesh.isPickable = false;
    this.meshes.push(mesh);
    return mesh;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  if (value > target) return Math.max(target, value - rate);
  return value;
}
