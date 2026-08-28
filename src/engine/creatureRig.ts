import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, type Scene } from "@babylonjs/core";
import { PALETTE_TOKENS, SURFACE_STYLES } from "../data/styleGuide";

/**
 * A creature with anatomy.
 *
 * Hips, a long forward-tilted torso, a neck and head with a jaw that opens, two
 * heavy legs, two arms, a tail in segments that trails the body, a row of
 * dorsal plates, and bioluminescent veins along the flanks that brighten when
 * it commits to something. Overlapping masses rather than one capsule, so the
 * silhouette reads from any angle and the parts move against each other.
 *
 * Driven by a pose each frame: breathing when idle, a rearing windup with the
 * jaw open before an attack, a flinch when struck, a slump when it dies. The
 * same builder can serve any creature category with different proportions.
 */

export interface CreatureRigPose {
  readonly timeSeconds: number;
  readonly speedMps: number;
  /** The creature is winding up: rear, open the jaw, light the veins. */
  readonly windup: number;
  /** The creature is striking: lunge forward. */
  readonly striking: number;
  /** 0 to 1 of a flinch in progress, decaying. */
  readonly flinch: number;
  readonly damage: number;
  readonly defeated: boolean;
}

const IDLE: CreatureRigPose = {
  timeSeconds: 0,
  speedMps: 0,
  windup: 0,
  striking: 0,
  flinch: 0,
  damage: 0,
  defeated: false,
};

function hex(id: string, fallback: string): Color3 {
  return Color3.FromHexString(PALETTE_TOKENS.find((token) => token.id === id)?.hex ?? fallback);
}

export class CreatureRig {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly body: TransformNode;
  private readonly torso: TransformNode;
  private readonly neck: TransformNode;
  private readonly jaw: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly tail: TransformNode[] = [];
  private veins: StandardMaterial | null = null;
  private readonly baseTorsoScaleZ: number;
  private disposed = false;

  constructor(scene: Scene, heightMeters: number, name = "creatureRig") {
    this.scene = scene;
    this.root = new TransformNode(`${name}.root`, scene);
    const h = heightMeters;

    // Hide and plate sit above the ink so the body reads against a dark sky;
    // the albedo scale in material() brings them down under a full sun.
    const hide = this.material(`${name}.hide`, new Color3(0.44, 0.5, 0.45));
    const plate = this.material(`${name}.plate`, new Color3(0.26, 0.3, 0.28));
    const veins = this.material(`${name}.veins`, hex("style.kaiju-blue", "#39d2c0"));
    veins.emissiveColor = hex("style.kaiju-blue", "#39d2c0").scale(0.45);
    this.veins = veins;
    const eye = this.material(`${name}.eye`, hex("style.warning-amber", "#ffc247"));
    eye.emissiveColor = hex("style.warning-amber", "#ffc247").scale(0.8);

    // The body rides the hips; legs carry it at about 45 percent of height.
    this.body = new TransformNode(`${name}.body`, scene);
    this.body.parent = this.root;
    this.body.position.y = h * 0.45;

    // Torso: long, deep and tilted forward, the way a heavy biped carries mass.
    this.torso = new TransformNode(`${name}.torsoNode`, scene);
    this.torso.parent = this.body;
    this.torso.rotation.x = -0.35;
    this.baseTorsoScaleZ = 1;
    this.box(`${name}.hipsMass`, h * 0.28, h * 0.22, h * 0.3, this.torso, hide, 0, h * 0.04, h * 0.05);
    this.box(`${name}.chestMass`, h * 0.32, h * 0.26, h * 0.34, this.torso, hide, 0, h * 0.14, -h * 0.16);
    this.box(`${name}.shoulderMass`, h * 0.38, h * 0.16, h * 0.22, this.torso, plate, 0, h * 0.26, -h * 0.2);
    // Dorsal plates step down the spine.
    for (let index = 0; index < 5; index += 1) {
      const size = h * (0.11 - index * 0.012);
      const plateMesh = this.box(
        `${name}.dorsal${index}`,
        h * 0.03,
        size,
        size * 0.7,
        this.torso,
        plate,
        0,
        h * 0.3 - index * h * 0.02,
        -h * 0.22 + index * h * 0.1,
      );
      plateMesh.rotation.x = 0.5;
    }
    // Veins along both flanks: the glow that says it is alive and what it is.
    for (const side of [-1, 1] as const) {
      const vein = this.box(
        `${name}.vein${side}`,
        h * 0.012,
        h * 0.06,
        h * 0.4,
        this.torso,
        veins,
        side * h * 0.165,
        h * 0.12,
        -h * 0.05,
      );
      vein.rotation.x = -0.1;
    }

    // Neck and head, with a jaw hinged at the front.
    this.neck = new TransformNode(`${name}.neck`, scene);
    this.neck.parent = this.torso;
    this.neck.position.set(0, h * 0.3, -h * 0.34);
    this.box(`${name}.neckMass`, h * 0.14, h * 0.13, h * 0.16, this.neck, hide, 0, 0.03 * h, -h * 0.06);
    this.box(`${name}.skull`, h * 0.18, h * 0.13, h * 0.22, this.neck, plate, 0, h * 0.05, -h * 0.2);
    this.box(`${name}.brow`, h * 0.2, h * 0.04, h * 0.1, this.neck, plate, 0, h * 0.12, -h * 0.18);
    for (const side of [-1, 1] as const) {
      this.box(
        `${name}.eye${side}`,
        h * 0.025,
        h * 0.02,
        h * 0.02,
        this.neck,
        eye,
        side * h * 0.07,
        h * 0.08,
        -h * 0.29,
      );
      this.box(
        `${name}.horn${side}`,
        h * 0.03,
        h * 0.12,
        h * 0.03,
        this.neck,
        plate,
        side * h * 0.08,
        h * 0.16,
        -h * 0.1,
      );
    }
    this.jaw = new TransformNode(`${name}.jawNode`, scene);
    this.jaw.parent = this.neck;
    this.jaw.position.set(0, h * 0.0, -h * 0.14);
    this.box(`${name}.jaw`, h * 0.15, h * 0.06, h * 0.18, this.jaw, hide, 0, -h * 0.03, -h * 0.08);

    // Legs: thick, digitigrade, with a broad foot.
    const buildLeg = (side: -1 | 1): TransformNode => {
      const leg = new TransformNode(`${name}.leg${side}`, scene);
      leg.parent = this.body;
      leg.position.set(side * h * 0.16, -h * 0.02, h * 0.06);
      this.box(`${name}.thigh${side}`, h * 0.13, h * 0.22, h * 0.18, leg, hide, 0, -h * 0.1, 0);
      this.box(`${name}.shin${side}`, h * 0.1, h * 0.22, h * 0.12, leg, hide, 0, -h * 0.3, -h * 0.04);
      this.box(`${name}.foot${side}`, h * 0.14, h * 0.05, h * 0.24, leg, plate, 0, -h * 0.43, -h * 0.08);
      return leg;
    };
    this.legL = buildLeg(-1);
    this.legR = buildLeg(1);

    // Arms: shorter than the legs, ending in claws.
    const buildArm = (side: -1 | 1): TransformNode => {
      const arm = new TransformNode(`${name}.arm${side}`, scene);
      arm.parent = this.torso;
      arm.position.set(side * h * 0.2, h * 0.22, -h * 0.22);
      this.box(`${name}.upperArm${side}`, h * 0.09, h * 0.2, h * 0.1, arm, hide, 0, -h * 0.1, 0);
      this.box(`${name}.forearm${side}`, h * 0.08, h * 0.18, h * 0.09, arm, hide, 0, -h * 0.27, -h * 0.03);
      this.box(`${name}.claw${side}`, h * 0.1, h * 0.05, h * 0.12, arm, plate, 0, -h * 0.38, -h * 0.07);
      return arm;
    };
    this.armL = buildArm(-1);
    this.armR = buildArm(1);

    // Tail: four segments, each hung off the last, tapering.
    let parent: TransformNode = this.torso;
    let z = h * 0.2;
    for (let index = 0; index < 4; index += 1) {
      const segment = new TransformNode(`${name}.tail${index}`, scene);
      segment.parent = parent;
      segment.position.set(0, index === 0 ? h * 0.06 : 0, z);
      const size = h * (0.14 - index * 0.025);
      this.box(`${name}.tailMass${index}`, size, size * 0.8, h * 0.22, segment, hide, 0, 0, h * 0.11);
      this.tail.push(segment);
      parent = segment;
      z = h * 0.22;
    }
  }

  allMeshes(): readonly Mesh[] {
    return this.meshes;
  }

  update(pose: Partial<CreatureRigPose>): void {
    if (this.disposed) return;
    const p = { ...IDLE, ...pose };
    const t = p.timeSeconds;

    if (p.defeated) {
      // Down on its side, jaw slack, lights out.
      this.root.rotation.z = Math.min(1.35, this.root.rotation.z + 0.04);
      this.body.position.y = Math.max(this.body.position.y - 0.5, 0.2 * this.body.position.y);
      this.jaw.rotation.x = 0.45;
      if (this.veins) this.veins.emissiveColor = hex("style.kaiju-blue", "#39d2c0").scale(0.08);
      return;
    }

    // Breathing: the chest swells, slower when calm, faster when hurt.
    const breathRate = 0.7 + p.damage * 0.9;
    const breath = 1 + Math.sin(t * breathRate * Math.PI * 2) * 0.025;
    this.torso.scaling.z = this.baseTorsoScaleZ * breath;
    this.torso.scaling.y = breath;

    // Walking: legs alternate, arms swing against them, tail lashes.
    const stride = Math.min(1, p.speedMps / 8);
    const gait = t * (2 + stride * 4);
    this.legL.rotation.x = Math.sin(gait) * 0.45 * stride;
    this.legR.rotation.x = Math.sin(gait + Math.PI) * 0.45 * stride;
    this.armL.rotation.x = Math.sin(gait + Math.PI) * 0.3 * stride - 0.3;
    this.armR.rotation.x = Math.sin(gait) * 0.3 * stride - 0.3;
    this.tail.forEach((segment, index) => {
      segment.rotation.y = Math.sin(t * 1.6 - index * 0.7) * (0.12 + stride * 0.15);
      segment.rotation.x = Math.sin(t * 0.9 - index * 0.5) * 0.05;
    });

    // Windup rears the body up and back and opens the jaw; the strike lunges.
    const rear = p.windup * 0.35 - p.striking * 0.3;
    this.torso.rotation.x = -0.35 + rear;
    this.neck.rotation.x = -p.windup * 0.4 + p.striking * 0.5;
    this.jaw.rotation.x = p.windup * 0.6 + p.striking * 0.35;
    this.armL.rotation.x += p.windup * -0.8 + p.striking * 1.4;
    this.armR.rotation.x += p.windup * -0.8 + p.striking * 1.4;

    // A flinch is a whole-body jolt back and a snap of the head.
    this.body.position.z = p.flinch * 3;
    this.neck.rotation.z = p.flinch * 0.25;

    if (this.veins) {
      const glow = 0.45 + p.windup * 0.8 + p.striking * 0.5 + Math.sin(t * 2.2) * 0.05;
      this.veins.emissiveColor = hex("style.kaiju-blue", "#39d2c0").scale(Math.min(1.4, glow));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.dispose();
    for (const material of this.materials) material.dispose();
    this.meshes.length = 0;
    this.materials.length = 0;
    this.veins = null;
    this.root.dispose();
  }

  private material(name: string, colour: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    // Painted plate under a full sun: the palette colour is what the surface
    // reads as, not what it reflects, so the albedo sits well below it.
    material.diffuseColor = colour.scale(0.62);
    const shine = Math.max(0, 1 - SURFACE_STYLES.creature.roughnessFloor);
    material.specularColor = new Color3(shine * 0.35, shine * 0.4, shine * 0.4);
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
}
