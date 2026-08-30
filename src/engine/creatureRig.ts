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
 * Knifehead, built from parts.
 *
 * A forward-leaning heavy biped: a long blade crest on a low skull, massive
 * forelimbs that reach the ground, a thick armoured torso with dorsal plates,
 * digitigrade legs and a lashing tail. Wet organic material with the veins
 * lit from inside. Every combat region (head, arms, torso, legs, tail) owns
 * its own plates, so armour can crack, come off and expose the tissue under
 * it, and a severed limb goes dark.
 *
 * Orientation contract (docs/ORIENTATION.md): pivot on the sole plane, +Y up,
 * the jaw and the crest at +Z, the tail at -Z. Every tilt is on `visual` and
 * reported through `tilt`.
 */

export type CreatureRegion = "head" | "arm.L" | "arm.R" | "torso" | "leg.L" | "leg.R" | "tail";

export type CreatureAttackKind =
  "claw.L" | "claw.R" | "blade.sweep" | "blade.down" | "charge" | "bite" | "shove" | "tail";

export interface CreatureRegionState {
  /** 0 to 1: plate left. At zero the plates are off and the tissue shows. */
  readonly armor: number;
  /** 0 to 1: how much of the tissue under it is open. */
  readonly wound: number;
  readonly severed: boolean;
}

export interface CreatureRigPose {
  readonly timeSeconds: number;
  readonly speedMps: number;
  /** 0 to 1: coiling before a strike. */
  readonly windup: number;
  /** 0 to 1: the strike itself. */
  readonly striking: number;
  readonly attackKind?: CreatureAttackKind;
  /** 0 to 1: a hit just landed on it. */
  readonly flinch: number;
  /** 0 to 1: overall health lost. */
  readonly damage: number;
  readonly defeated: boolean;
  /** 0 to 1: reeling, off balance. */
  readonly stagger?: number;
  /** Tagged tilt: 1 is on its side. */
  readonly knockdown?: number;
  /** 0 to 1: how much of the body is below the water line. */
  readonly submerged?: number;
  readonly regions?: Partial<Record<CreatureRegion, CreatureRegionState>>;
}

const DEFAULT_POSE: CreatureRigPose = {
  timeSeconds: 0,
  speedMps: 0,
  windup: 0,
  striking: 0,
  flinch: 0,
  damage: 0,
  defeated: false,
};

const HIDE = new Color3(0.2, 0.26, 0.24);
const PLATE = new Color3(0.09, 0.12, 0.11);
const CREST = new Color3(0.3, 0.32, 0.28);
const TISSUE = new Color3(0.4, 0.16, 0.22);
const VEIN = Color3.FromHexString("#39d2c0");
const WOUND_GLOW = Color3.FromHexString("#4fe8ff");
const EYE = Color3.FromHexString("#ffc247");
const EDGE_COLOUR = new Color4(0.01, 0.03, 0.03, 0.85);

interface RegionParts {
  readonly plates: Mesh[];
  readonly plateMaterials: StandardMaterial[];
  readonly tissue: Mesh[];
  readonly tissueMaterials: StandardMaterial[];
  readonly limb: Mesh[];
}

export class CreatureRig {
  readonly root: TransformNode;
  readonly visual: TransformNode;
  tilt = 0;

  private readonly scene: Scene;
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly regions = new Map<CreatureRegion, RegionParts>();
  private readonly h: number;
  private readonly body: TransformNode;
  private readonly torso: TransformNode;
  private readonly neck: TransformNode;
  private readonly skull: TransformNode;
  private readonly jaw: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly foreL: TransformNode;
  private readonly foreR: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly shinL: TransformNode;
  private readonly shinR: TransformNode;
  private readonly footL: TransformNode;
  private readonly footR: TransformNode;
  private readonly tail: TransformNode[] = [];
  private readonly veinMaterial: StandardMaterial;
  private readonly eyeMaterial: StandardMaterial;
  private readonly jawSocket: TransformNode;
  private readonly chestSocket: TransformNode;
  private disposed = false;
  private topple = 0;

  constructor(scene: Scene, heightMeters: number, name = "creatureRig") {
    this.scene = scene;
    const h = heightMeters;
    this.h = h;
    this.root = new TransformNode(`${name}.root`, scene);
    this.visual = new TransformNode(`${name}.visual`, scene);
    this.visual.parent = this.root;

    const hide = this.material(`${name}.hide`, HIDE, 0.5);
    const crest = this.material(`${name}.crest`, CREST, 0.35);
    this.veinMaterial = this.material(`${name}.veins`, VEIN, 0.1);
    this.veinMaterial.emissiveColor = VEIN.scale(0.45);
    this.eyeMaterial = this.material(`${name}.eye`, EYE, 0.1);
    this.eyeMaterial.emissiveColor = EYE.scale(0.8);

    for (const region of ["head", "arm.L", "arm.R", "torso", "leg.L", "leg.R", "tail"] as const) {
      this.regions.set(region, { plates: [], plateMaterials: [], tissue: [], tissueMaterials: [], limb: [] });
    }

    // Body carriage: the hips sit at 0.42 h and the torso leans forward so
    // the head is low and the crest points at the machine.
    this.body = new TransformNode(`${name}.body`, scene);
    this.body.parent = this.visual;
    this.body.position.y = h * 0.44;
    this.torso = new TransformNode(`${name}.torso`, scene);
    this.torso.parent = this.body;
    this.torso.rotation.x = 0.32;

    const torsoParts = this.regions.get("torso")!;
    torsoParts.limb.push(
      this.box(`${name}.hipsMass`, h * 0.3, h * 0.22, h * 0.3, this.torso, hide, 0, 0, 0),
      this.box(`${name}.chestMass`, h * 0.36, h * 0.28, h * 0.36, this.torso, hide, 0, h * 0.06, h * 0.17),
      this.box(`${name}.shoulderMass`, h * 0.42, h * 0.16, h * 0.24, this.torso, hide, 0, h * 0.2, h * 0.18),
    );
    // Armour: a belly plate and a chest plate on the front, dorsal plates on
    // the spine; the tissue under the chest plate glows when it is off.
    this.plate("torso", `${name}.chestPlate`, h * 0.3, h * 0.24, h * 0.06, this.torso, 0, h * 0.08, h * 0.36);
    this.plate(
      "torso",
      `${name}.bellyPlate`,
      h * 0.24,
      h * 0.16,
      h * 0.05,
      this.torso,
      0,
      -h * 0.05,
      h * 0.17,
    );
    this.tissue(
      "torso",
      `${name}.chestTissue`,
      h * 0.24,
      h * 0.18,
      h * 0.04,
      this.torso,
      0,
      h * 0.08,
      h * 0.35,
    );
    for (let i = 0; i < 6; i += 1) {
      const size = h * (0.1 - i * 0.011);
      this.plate(
        "torso",
        `${name}.dorsal.${i}`,
        size * 0.7,
        size,
        size * 0.5,
        this.torso,
        0,
        h * 0.3 - i * h * 0.02,
        h * 0.16 - i * h * 0.09,
        -0.5,
      );
    }
    for (const side of [-1, 1] as const) {
      const vein = this.box(
        `${name}.vein.${side}`,
        h * 0.014,
        h * 0.08,
        h * 0.42,
        this.torso,
        this.veinMaterial,
        side * h * 0.18,
        h * 0.04,
        h * 0.05,
      );
      vein.disableEdgesRendering();
    }

    // Neck, skull, the blade crest, the jaw.
    this.neck = new TransformNode(`${name}.neck`, scene);
    this.neck.parent = this.torso;
    this.neck.position.set(0, h * 0.22, h * 0.34);
    const headParts = this.regions.get("head")!;
    headParts.limb.push(
      this.box(`${name}.neckMass`, h * 0.16, h * 0.14, h * 0.2, this.neck, hide, 0, 0, h * 0.06),
    );
    this.skull = new TransformNode(`${name}.skull`, scene);
    this.skull.parent = this.neck;
    this.skull.position.set(0, h * 0.02, h * 0.16);
    headParts.limb.push(
      this.box(`${name}.skullMass`, h * 0.2, h * 0.13, h * 0.26, this.skull, hide, 0, 0, h * 0.06),
    );
    // The crest: a long tapered blade running forward and up from the brow.
    const blade = this.box(
      `${name}.crest`,
      h * 0.05,
      h * 0.09,
      h * 0.56,
      this.skull,
      crest,
      0,
      h * 0.1,
      h * 0.28,
    );
    blade.rotation.x = -0.32;
    blade.scaling.x = 0.8;
    headParts.plates.push(blade);
    headParts.plateMaterials.push(crest);
    const keel = this.box(
      `${name}.crestKeel`,
      h * 0.03,
      h * 0.05,
      h * 0.4,
      this.skull,
      crest,
      0,
      h * 0.06,
      h * 0.26,
    );
    keel.rotation.x = -0.32;
    headParts.plates.push(keel);
    this.plate("head", `${name}.browPlate`, h * 0.22, h * 0.06, h * 0.14, this.skull, 0, h * 0.075, h * 0.06);
    this.tissue(
      "head",
      `${name}.browTissue`,
      h * 0.18,
      h * 0.04,
      h * 0.1,
      this.skull,
      0,
      h * 0.075,
      h * 0.06,
    );
    for (const side of [-1, 1] as const) {
      const eye = this.box(
        `${name}.eye.${side}`,
        h * 0.025,
        h * 0.02,
        h * 0.02,
        this.skull,
        this.eyeMaterial,
        side * h * 0.085,
        h * 0.03,
        h * 0.16,
      );
      eye.disableEdgesRendering();
      headParts.limb.push(eye);
    }
    this.jaw = new TransformNode(`${name}.jaw`, scene);
    this.jaw.parent = this.skull;
    this.jaw.position.set(0, -h * 0.05, h * 0.04);
    headParts.limb.push(
      this.box(`${name}.jawMass`, h * 0.16, h * 0.06, h * 0.22, this.jaw, hide, 0, -h * 0.02, h * 0.1),
    );
    headParts.limb.push(
      this.box(`${name}.teeth`, h * 0.14, h * 0.02, h * 0.16, this.jaw, crest, 0, h * 0.015, h * 0.11),
    );
    this.jawSocket = new TransformNode(`${name}.socket.jaw`, scene);
    this.jawSocket.parent = this.jaw;
    this.jawSocket.position.set(0, 0, h * 0.2);
    // The chest plate is the front marker: the jaw swings during attacks, the chest does not.
    this.chestSocket = new TransformNode(`${name}.socket.chest`, scene);
    this.chestSocket.parent = this.torso;
    this.chestSocket.position.set(0, h * 0.08, h * 0.4);

    // Forelimbs: shoulder high on the chest, reaching the ground ahead.
    this.armL = this.buildArm(name, -1, hide);
    this.armR = this.buildArm(name, 1, hide);
    this.foreL = this.armL
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".fore")) as TransformNode;
    this.foreR = this.armR
      .getChildTransformNodes(true)
      .find((node) => node.name.endsWith(".fore")) as TransformNode;

    // Legs: digitigrade, thick, with three toes forward.
    this.legL = this.buildLeg(name, -1, hide);
    this.legR = this.buildLeg(name, 1, hide);
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

    // Tail: five segments off the hips, back along -Z, tapering.
    let parent: TransformNode = this.torso;
    let z = -h * 0.14;
    const tailParts = this.regions.get("tail")!;
    for (let i = 0; i < 5; i += 1) {
      const segment = new TransformNode(`${name}.tail.${i}`, scene);
      segment.parent = parent;
      segment.position.set(0, i === 0 ? -h * 0.02 : 0, z);
      const size = h * (0.13 - i * 0.02);
      tailParts.limb.push(
        this.box(`${name}.tailMass.${i}`, size, size * 0.8, h * 0.2, segment, hide, 0, 0, -h * 0.1),
      );
      if (i < 3)
        this.plate(
          "tail",
          `${name}.tailPlate.${i}`,
          size * 0.5,
          size * 0.3,
          h * 0.16,
          segment,
          0,
          size * 0.45,
          -h * 0.1,
        );
      this.tail.push(segment);
      parent = segment;
      z = -h * 0.19;
    }

    this.update(DEFAULT_POSE, 0);
  }

  /** The front marker for the validator: the chest plate, which faces +Z whatever the head does. */
  get frontMarker(): TransformNode {
    return this.chestSocket;
  }

  /** Where the bite lands and the roar comes from. */
  get jawMarker(): TransformNode {
    return this.jawSocket;
  }

  get heightMeters(): number {
    return this.h;
  }

  allMeshes(): readonly Mesh[] {
    return this.meshes;
  }

  setInk(on: boolean): void {
    for (const mesh of this.meshes) {
      if (on) {
        mesh.enableEdgesRendering(0.99);
        mesh.edgesWidth = this.h * 0.2;
        mesh.edgesColor = EDGE_COLOUR;
      } else mesh.disableEdgesRendering();
    }
  }

  update(pose: Partial<CreatureRigPose>, deltaSeconds = 1 / 60): void {
    if (this.disposed) return;
    const p: CreatureRigPose = { ...DEFAULT_POSE, ...pose };
    const h = this.h;
    const t = p.timeSeconds;
    const dt = Math.max(0, deltaSeconds);

    // Defeat: a tagged topple onto the side, veins going dark. Nothing above
    // the visual node moves.
    if (p.defeated) {
      this.topple = Math.min(1, this.topple + dt * 0.6);
      const eased = this.topple * this.topple * (3 - 2 * this.topple);
      this.visual.rotation.set(0.15 * eased, 0, 1.3 * eased);
      this.visual.position.y = h * 0.05 * eased;
      this.tilt = (Math.hypot(this.visual.rotation.x, this.visual.rotation.z) * 180) / Math.PI;
      this.jaw.rotation.x = 0.45;
      this.veinMaterial.emissiveColor = VEIN.scale(0.08 + 0.3 * (1 - eased));
      return;
    }

    // Breathing, faster when hurt.
    const breath = Math.sin(t * (0.7 + p.damage * 0.9));
    this.torso.scaling.set(1, 1 + breath * 0.02, 1 + breath * 0.025);

    // Gait: four limbs, the forelimbs a half cycle against the legs.
    const stride = Math.min(1, p.speedMps / 12);
    const gait = t * (2 + stride * 4.5);
    const legSwing = 0.5 * stride;
    this.legL.rotation.x = -Math.sin(gait) * legSwing;
    this.legR.rotation.x = Math.sin(gait) * legSwing;
    this.shinL.rotation.x = Math.max(0, Math.sin(gait)) * legSwing * 1.4;
    this.shinR.rotation.x = Math.max(0, -Math.sin(gait)) * legSwing * 1.4;
    // Feet stay level with the ground whatever the leg above them does.
    this.footL.rotation.x = -(this.legL.rotation.x + this.shinL.rotation.x);
    this.footR.rotation.x = -(this.legR.rotation.x + this.shinR.rotation.x);
    this.body.position.y =
      h * 0.44 + Math.abs(Math.sin(gait)) * stride * h * 0.012 - (p.submerged ?? 0) * h * 0.3;
    let armLx = Math.sin(gait + Math.PI) * 0.35 * stride - 0.35;
    let armRx = Math.sin(gait) * 0.35 * stride - 0.35;
    let armLz = 0.25;
    let armRz = -0.25;
    let foreLx = -0.35;
    let foreRx = -0.35;
    let torsoX = 0.32 - stride * 0.08;
    let torsoY = Math.sin(gait) * stride * 0.06;
    let neckX = 0;
    let neckY = 0;
    let jawOpen = 0.08;

    // Attacks: each kind is a silhouette the creature commits to. Anticipation
    // is big and slow so it can be read; the strike is fast.
    const w = clamp(p.windup, 0, 1);
    const s = clamp(p.striking, 0, 1);
    const kind = p.attackKind ?? "claw.R";
    if (w > 0 || s > 0) {
      if (kind === "claw.L" || kind === "claw.R") {
        const left = kind === "claw.L";
        const raise = -2.3 * w + 1.6 * s;
        if (left) {
          armLx = -0.35 + raise;
          armLz = 0.25 + 0.5 * w - 0.6 * s;
          foreLx = -0.35 - 0.6 * w + 0.9 * s;
        } else {
          armRx = -0.35 + raise;
          armRz = -0.25 - 0.5 * w + 0.6 * s;
          foreRx = -0.35 - 0.6 * w + 0.9 * s;
        }
        torsoY = (left ? 1 : -1) * (0.3 * w - 0.45 * s);
        torsoX += -0.12 * w + 0.2 * s;
      } else if (kind === "blade.sweep") {
        neckY = -1.0 * w + 1.9 * s;
        neckX = -0.2 * w + 0.1 * s;
        torsoY = -0.4 * w + 0.7 * s;
        armLx -= 0.3 * w;
        armRx -= 0.3 * w;
      } else if (kind === "blade.down") {
        neckX = -0.9 * w + 0.4 * s;
        torsoX += -0.3 * w + 0.1 * s;
        armLx -= 0.6 * w - 0.4 * s;
        armRx -= 0.6 * w - 0.4 * s;
        jawOpen = 0.3 * w;
      } else if (kind === "charge") {
        torsoX += 0.22 * (w + s);
        neckX = 0.35 * w + 0.15 * s;
        armLx = -1.2 * (w + s * 0.6);
        armRx = -1.2 * (w + s * 0.6);
        armLz = 0.6 * w;
        armRz = -0.6 * w;
      } else if (kind === "bite") {
        neckX = -0.5 * w + 0.35 * s;
        jawOpen = 0.9 * w + 0.4 * s;
        torsoX += -0.1 * w + 0.25 * s;
      } else if (kind === "shove") {
        armLx = -0.9 * w - 0.9 * s;
        armRx = -0.9 * w - 0.9 * s;
        armLz = 0.9 * w;
        armRz = -0.9 * w;
        torsoX += -0.2 * w + 0.3 * s;
      } else if (kind === "tail") {
        torsoY = 0.5 * w - 1.1 * s;
      }
    }

    // Flinch is a jolt backwards, along -Z; stagger is a sway on the visual node.
    const flinch = clamp(p.flinch, 0, 1);
    this.body.position.z = -flinch * h * 0.04;
    neckX += flinch * 0.25;
    const stagger = clamp(p.stagger ?? 0, 0, 1);
    const knock = clamp(p.knockdown ?? 0, 0, 1);
    const knockEased = knock * knock * (3 - 2 * knock);
    const sway = Math.sin(t * 5.5) * stagger * 0.07;
    this.visual.rotation.set(-0.15 * knockEased, 0, sway + 1.25 * knockEased);
    this.visual.position.y = h * 0.02 * knockEased;
    this.tilt = (Math.hypot(this.visual.rotation.x, this.visual.rotation.z) * 180) / Math.PI;

    this.torso.rotation.set(torsoX, torsoY, 0);
    this.neck.rotation.set(neckX, neckY, 0);
    this.jaw.rotation.x = jawOpen;
    this.armL.rotation.set(armLx, 0, armLz);
    this.armR.rotation.set(armRx, 0, armRz);
    this.foreL.rotation.x = foreLx;
    this.foreR.rotation.x = foreRx;
    for (let i = 0; i < this.tail.length; i += 1) {
      const segment = this.tail[i];
      if (!segment) continue;
      const lash = kind === "tail" ? s * 1.4 - w * 0.6 : 0;
      segment.rotation.y = Math.sin(t * 1.6 - i * 0.7) * (0.1 + stride * 0.15) + lash * (0.3 + i * 0.15);
      segment.rotation.x = Math.sin(t * 1.1 - i * 0.5) * 0.05;
    }

    // Veins brighten with intent; the eyes hold steady.
    const glow = Math.min(1.4, 0.45 + w * 0.8 + s * 0.5 + Math.sin(t * 2.2) * 0.05);
    this.veinMaterial.emissiveColor = VEIN.scale(glow);

    // Regions: plates crack (glow through the seams), come off, tissue opens.
    const regions = p.regions ?? {};
    for (const [region, parts] of this.regions) {
      const state = regions[region] ?? { armor: 1, wound: 0, severed: false };
      const crack = 1 - clamp(state.armor, 0, 1);
      for (const material of parts.plateMaterials) {
        material.emissiveColor = WOUND_GLOW.scale(
          crack * 0.35 * (0.7 + 0.3 * Math.sin(t * 6 + region.length)),
        );
      }
      const off = state.armor <= 0.001;
      for (const plateMesh of parts.plates) plateMesh.isVisible = !off && !state.severed;
      for (let i = 0; i < parts.tissue.length; i += 1) {
        const tissue = parts.tissue[i];
        const material = parts.tissueMaterials[i];
        if (!tissue || !material) continue;
        tissue.isVisible = off && !state.severed;
        material.emissiveColor = WOUND_GLOW.scale(
          0.35 + clamp(state.wound, 0, 1) * 0.6 * (0.7 + 0.3 * Math.sin(t * 9)),
        );
      }
      for (const limb of parts.limb) limb.isVisible = !state.severed;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.dispose();
    for (const material of this.materials) material.dispose();
    this.root.dispose();
  }

  private buildArm(name: string, side: 1 | -1, hide: StandardMaterial): TransformNode {
    const h = this.h;
    const suffix = side === 1 ? "R" : "L";
    const region: CreatureRegion = side === 1 ? "arm.R" : "arm.L";
    const parts = this.regions.get(region)!;
    const arm = new TransformNode(`${name}.arm.${suffix}`, this.scene);
    arm.parent = this.torso;
    arm.position.set(side * h * 0.24, h * 0.2, h * 0.2);
    const upper = h * 0.22;
    const fore = h * 0.2;
    parts.limb.push(
      this.box(`${name}.upperArm.${suffix}`, h * 0.13, upper, h * 0.14, arm, hide, 0, -upper * 0.5, 0),
    );
    this.plate(
      region,
      `${name}.shoulderPlate.${suffix}`,
      h * 0.16,
      h * 0.1,
      h * 0.16,
      arm,
      side * h * 0.01,
      h * 0.03,
      0,
    );
    this.plate(
      region,
      `${name}.upperArmPlate.${suffix}`,
      h * 0.06,
      upper * 0.6,
      h * 0.14,
      arm,
      side * h * 0.075,
      -upper * 0.4,
      0,
    );
    this.tissue(
      region,
      `${name}.upperArmTissue.${suffix}`,
      h * 0.05,
      upper * 0.5,
      h * 0.12,
      arm,
      side * h * 0.075,
      -upper * 0.4,
      0,
    );
    const forearm = new TransformNode(`${name}.arm.${suffix}.fore`, this.scene);
    forearm.parent = arm;
    forearm.position.y = -upper;
    parts.limb.push(
      this.box(`${name}.forearm.${suffix}`, h * 0.11, fore, h * 0.12, forearm, hide, 0, -fore * 0.5, 0),
    );
    // Claws: three wedges forward of the hand.
    for (let i = -1; i <= 1; i += 1) {
      const claw = this.box(
        `${name}.claw.${suffix}.${i}`,
        h * 0.025,
        h * 0.03,
        h * 0.11,
        forearm,
        hide,
        i * h * 0.035,
        -fore,
        h * 0.07,
      );
      claw.rotation.x = -0.35;
      parts.limb.push(claw);
    }
    return arm;
  }

  private buildLeg(name: string, side: 1 | -1, hide: StandardMaterial): TransformNode {
    const h = this.h;
    const suffix = side === 1 ? "R" : "L";
    const region: CreatureRegion = side === 1 ? "leg.R" : "leg.L";
    const parts = this.regions.get(region)!;
    const leg = new TransformNode(`${name}.leg.${suffix}`, this.scene);
    leg.parent = this.body;
    leg.position.set(side * h * 0.15, 0, 0);
    // Thigh angles forward, shin back, foot forward: digitigrade, and the
    // sole lands on y = 0 of the root.
    const thigh = h * 0.24;
    const shin = h * 0.2;
    parts.limb.push(
      this.box(`${name}.thigh.${suffix}`, h * 0.15, thigh, h * 0.18, leg, hide, 0, -thigh * 0.5, h * 0.02),
    );
    this.plate(
      region,
      `${name}.thighPlate.${suffix}`,
      h * 0.08,
      thigh * 0.6,
      h * 0.16,
      leg,
      side * h * 0.085,
      -thigh * 0.4,
      h * 0.02,
    );
    this.tissue(
      region,
      `${name}.thighTissue.${suffix}`,
      h * 0.06,
      thigh * 0.5,
      h * 0.14,
      leg,
      side * h * 0.085,
      -thigh * 0.4,
      h * 0.02,
    );
    const shinNode = new TransformNode(`${name}.leg.${suffix}.shin`, this.scene);
    shinNode.parent = leg;
    shinNode.position.y = -thigh;
    parts.limb.push(
      this.box(`${name}.shin.${suffix}`, h * 0.11, shin, h * 0.13, shinNode, hide, 0, -shin * 0.5, -h * 0.02),
    );
    const foot = new TransformNode(`${name}.leg.${suffix}.foot`, this.scene);
    foot.parent = shinNode;
    foot.position.y = -shin;
    parts.limb.push(
      this.box(`${name}.foot.${suffix}`, h * 0.14, h * 0.05, h * 0.22, foot, hide, 0, h * 0.025, h * 0.05),
    );
    for (let i = -1; i <= 1; i += 1) {
      parts.limb.push(
        this.box(
          `${name}.toe.${suffix}.${i}`,
          h * 0.03,
          h * 0.03,
          h * 0.08,
          foot,
          hide,
          i * h * 0.045,
          h * 0.015,
          h * 0.19,
        ),
      );
    }
    return leg;
  }

  private plate(
    region: CreatureRegion,
    name: string,
    width: number,
    height: number,
    depth: number,
    parent: TransformNode,
    x: number,
    y: number,
    z: number,
    rotX = 0,
  ): Mesh {
    const material = this.material(`${name}.material`, PLATE, 0.45);
    const mesh = this.box(name, width, height, depth, parent, material, x, y, z);
    mesh.rotation.x = rotX;
    const parts = this.regions.get(region)!;
    parts.plates.push(mesh);
    parts.plateMaterials.push(material);
    return mesh;
  }

  private tissue(
    region: CreatureRegion,
    name: string,
    width: number,
    height: number,
    depth: number,
    parent: TransformNode,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const material = this.material(`${name}.material`, TISSUE, 0.6);
    material.emissiveColor = WOUND_GLOW.scale(0.35);
    const mesh = this.box(name, width, height, depth, parent, material, x, y, z);
    mesh.isVisible = false;
    mesh.disableEdgesRendering();
    const parts = this.regions.get(region)!;
    parts.tissue.push(mesh);
    parts.tissueMaterials.push(material);
    return mesh;
  }

  private material(name: string, colour: Color3, wet: number): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = colour.scale(0.62);
    // Wet organic surfaces: a tight, bright specular that reads as slick.
    material.specularColor = new Color3(0.35 * wet + 0.1, 0.4 * wet + 0.1, 0.4 * wet + 0.1);
    material.specularPower = 24 + wet * 40;
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
    mesh.enableEdgesRendering(0.99);
    mesh.edgesWidth = this.h * 0.2;
    mesh.edgesColor = EDGE_COLOUR;
    this.meshes.push(mesh);
    return mesh;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
