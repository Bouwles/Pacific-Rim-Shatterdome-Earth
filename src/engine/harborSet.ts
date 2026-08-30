import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  SpotLight,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import type { PlacedProp, PropLibrary } from "../assets/props";

/**
 * The Anchorage harbour set.
 *
 * What the showcase fight is fought in front of: a docked ship on the quay,
 * two cranes, a container yard, fuel tanks, floodlight poles with real
 * sodium light, sweeping searchlights, emergency beacons, barriers at the
 * arena edge, and military silhouettes in the distance. Built from the CC0
 * kits where a piece exists and from inked primitives where it does not, in
 * one cold palette: navy, steel, ice cyan, sodium amber, a little red.
 *
 * Four of the pieces are combat anchors: a grapple thrown into one slams
 * the creature into it and the piece comes apart.
 */

export interface HarborAnchor {
  readonly id: string;
  readonly kind: "crane" | "warehouse" | "containers" | "ship" | "tanks" | "water";
  readonly label: string;
  readonly east: number;
  readonly north: number;
  readonly radiusMeters: number;
  used: boolean;
  destroy: () => void;
}

export interface HarborSetOptions {
  readonly scene: Scene;
  readonly props: PropLibrary;
  /** Where the machine stands at arrival, local metres. */
  readonly east: number;
  readonly north: number;
  /** Bearing toward the sea from the arrival point. */
  readonly seawardBearingDeg: number;
  readonly groundHeight: (east: number, north: number) => number | null;
  /** Called when a piece comes apart, for debris and sound. */
  readonly onDestroy: (east: number, up: number, north: number) => void;
  /** Lights are the expensive part; low quality gets fewer. */
  readonly lightBudget: number;
}

const NAVY = Color3.FromHexString("#16233a");
const STEEL = Color3.FromHexString("#5c6670");
const STEEL_DARK = Color3.FromHexString("#2a323b");
const RUST = Color3.FromHexString("#7a3b2a");
const CONTAINER_BLUE = Color3.FromHexString("#1f4f8a");
const SODIUM = Color3.FromHexString("#ffb347");
const ICE = Color3.FromHexString("#9fe3ff");
const RED = Color3.FromHexString("#ff3b3b");
const EDGE = new Color4(0.02, 0.04, 0.06, 0.85);

export class HarborSet {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly textures: DynamicTexture[] = [];
  private readonly lights: SpotLight[] = [];
  private readonly placed: PlacedProp[] = [];
  private readonly searchlights: { node: TransformNode; rate: number; phase: number }[] = [];
  private readonly beacons: { material: StandardMaterial; phase: number }[] = [];
  private readonly anchorList: HarborAnchor[] = [];
  private elapsed = 0;
  private disposed = false;

  constructor(private readonly options: HarborSetOptions) {
    this.scene = options.scene;
    this.root = new TransformNode("harbor.root", this.scene);
    const seaward = (options.seawardBearingDeg * Math.PI) / 180;
    const forwardEast = Math.sin(seaward);
    const forwardNorth = Math.cos(seaward);
    const rightEast = Math.cos(seaward);
    const rightNorth = -Math.sin(seaward);
    // Local frame helpers: `along` toward the sea, `across` to the right of it.
    const at = (along: number, across: number): { east: number; north: number; up: number } => {
      const east = options.east + forwardEast * along + rightEast * across;
      const north = options.north + forwardNorth * along + rightNorth * across;
      return { east, north, up: options.groundHeight(east, north) ?? 0 };
    };
    const yawFacingSea = options.seawardBearingDeg;

    const navy = this.material("harbor.navy", NAVY, 0.35);
    const steel = this.material("harbor.steel", STEEL, 0.3);
    const steelDark = this.material("harbor.steelDark", STEEL_DARK, 0.25);
    const rust = this.material("harbor.rust", RUST, 0.15);
    const containerBlue = this.material("harbor.containerBlue", CONTAINER_BLUE, 0.2);
    const sodium = this.material("harbor.sodium", SODIUM, 0);
    sodium.emissiveColor = SODIUM.scale(0.9);
    const ice = this.material("harbor.ice", ICE, 0);
    ice.emissiveColor = ICE.scale(0.7);

    // The quay: a dark asphalt apron with painted lanes under the whole fight,
    // seated just above the terrain so the ground reads as a harbour rather
    // than a plane, and a band of frost and ice along the water's edge.
    const quayAt = at(-20, 0);
    const quay = MeshBuilder.CreateGround(
      "harbor.quay",
      { width: 900, height: 620, subdivisions: 4 },
      this.scene,
    );
    quay.position.set(quayAt.east, quayAt.up + 0.35, quayAt.north);
    quay.rotation.y = (yawFacingSea * Math.PI) / 180;
    const quayTexture = new DynamicTexture(
      "harbor.quayTexture",
      { width: 1024, height: 1024 },
      this.scene,
      true,
    );
    const context = quayTexture.getContext();
    context.fillStyle = "#1d2229";
    context.fillRect(0, 0, 1024, 1024);
    context.strokeStyle = "rgba(255, 196, 80, 0.55)";
    context.lineWidth = 6;
    context.setLineDash([48, 36]);
    for (let i = 1; i < 6; i += 1) {
      context.beginPath();
      context.moveTo(0, i * 170);
      context.lineTo(1024, i * 170);
      context.stroke();
    }
    context.setLineDash([]);
    context.strokeStyle = "rgba(230, 236, 240, 0.35)";
    context.lineWidth = 10;
    for (let i = 1; i < 4; i += 1) {
      context.beginPath();
      context.moveTo(i * 256, 0);
      context.lineTo(i * 256, 1024);
      context.stroke();
    }
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let i = 0; i < 40; i += 1) {
      context.fillRect((i * 173) % 1024, (i * 389) % 1024, 90, 24);
    }
    quayTexture.update();
    const quayMaterial = new StandardMaterial("harbor.quayMaterial", this.scene);
    quayMaterial.diffuseTexture = quayTexture;
    quayMaterial.specularColor = new Color3(0.12, 0.13, 0.15);
    quayMaterial.specularPower = 12;
    quay.material = quayMaterial;
    quay.receiveShadows = true;
    quay.isPickable = false;
    this.materials.push(quayMaterial);
    this.meshes.push(quay);
    this.textures.push(quayTexture);
    const iceAt = at(150, 0);
    const iceSheet = MeshBuilder.CreateGround(
      "harbor.iceSheet",
      { width: 900, height: 70, subdivisions: 2 },
      this.scene,
    );
    iceSheet.position.set(iceAt.east, Math.max(iceAt.up, -0.5) + 0.6, iceAt.north);
    iceSheet.rotation.y = (yawFacingSea * Math.PI) / 180;
    const iceMaterial = new StandardMaterial("harbor.iceMaterial", this.scene);
    iceMaterial.diffuseColor = new Color3(0.72, 0.8, 0.86);
    iceMaterial.specularColor = new Color3(0.5, 0.55, 0.6);
    iceMaterial.specularPower = 48;
    iceMaterial.alpha = 0.85;
    iceSheet.material = iceMaterial;
    iceSheet.isPickable = false;
    this.materials.push(iceMaterial);
    this.meshes.push(iceSheet);
    for (let i = 0; i < 6; i += 1) {
      const bank = at(-250 + i * 90, 210);
      const snow = this.box(
        `harbor.snowbank.${i}`,
        60,
        4,
        14,
        this.root,
        steel,
        bank.east,
        bank.up + 2,
        bank.north,
      );
      snow.material = iceMaterial;
      snow.disableEdgesRendering();
    }

    // Warehouses: long sheds with sawtooth roofs, two sizes, lit doors.
    const sheds = [
      { at: at(-150, -120), length: 150, width: 60, height: 32, yaw: 0 },
      { at: at(-210, 40), length: 110, width: 50, height: 26, yaw: 90 },
      { at: at(-90, 230), length: 130, width: 56, height: 30, yaw: 0 },
      { at: at(20, -240), length: 100, width: 46, height: 24, yaw: 90 },
    ];
    for (const [i, shed] of sheds.entries()) {
      const node = new TransformNode(`harbor.shed.${i}`, this.scene);
      node.parent = this.root;
      node.position.set(shed.at.east, shed.at.up, shed.at.north);
      node.rotation.y = ((yawFacingSea + shed.yaw) * Math.PI) / 180;
      this.box(
        `harbor.shed.body.${i}`,
        shed.length,
        shed.height,
        shed.width,
        node,
        i % 2 === 0 ? steel : navy,
        0,
        shed.height / 2,
        0,
      );
      for (let r = 0; r < 4; r += 1) {
        const ridge = this.box(
          `harbor.shed.roof.${i}.${r}`,
          shed.length * 0.92,
          6,
          shed.width / 4.5,
          node,
          steelDark,
          0,
          shed.height + 3,
          -shed.width / 2 + (r + 0.5) * (shed.width / 4),
        );
        ridge.rotation.x = 0.35;
      }
      this.box(`harbor.shed.trim.${i}`, shed.length, 2, shed.width + 2, node, rust, 0, shed.height * 0.35, 0);
      const door = this.box(
        `harbor.shed.door.${i}`,
        18,
        14,
        1,
        node,
        sodium,
        shed.length * 0.25,
        7,
        shed.width / 2 + 0.6,
      );
      door.disableEdgesRendering();
    }

    // The docked ship: a long hull at the quay, seaward-left of the arrival,
    // its deck lights on. The first anchor.
    const shipAt = at(120, -150);
    const ship = new TransformNode("harbor.ship", this.scene);
    ship.parent = this.root;
    ship.position.set(shipAt.east, Math.max(shipAt.up, -2) + 2, shipAt.north);
    ship.rotation.y = ((yawFacingSea + 90) * Math.PI) / 180;
    this.box("harbor.ship.hull", 190, 26, 36, ship, navy, 0, 13, 0);
    this.box("harbor.ship.deck", 186, 3, 34, ship, steelDark, 0, 27, 0);
    this.box("harbor.ship.house", 34, 22, 26, ship, steel, -55, 39, 0);
    this.box("harbor.ship.bridge", 30, 8, 22, ship, steel, -55, 54, 0);
    this.cylinder("harbor.ship.funnel", 4, 16, ship, steelDark, -68, 66, 0);
    for (let i = 0; i < 5; i += 1)
      this.box(`harbor.ship.hatch.${i}`, 22, 4, 20, ship, steelDark, 60 - i * 26, 30, 0);
    for (let i = 0; i < 6; i += 1) {
      const lamp = this.box(`harbor.ship.lamp.${i}`, 1.2, 1.2, 1.2, ship, sodium, 80 - i * 30, 31, 16);
      lamp.disableEdgesRendering();
    }
    this.anchorList.push(this.anchor("ship", "ship", "Hull", shipAt.east, shipAt.north, 70, [ship]));

    // Cranes: kit pieces on the quay either side, tall enough to read as the
    // skyline's teeth. The nearer one is an anchor.
    const craneA = at(60, 120);
    const craneB = at(40, -60);
    this.place("factory", "crane", craneA, yawFacingSea, { width: 44, height: 78, depth: 44 });
    this.place("factory", "crane", craneB, yawFacingSea + 180, { width: 40, height: 70, depth: 40 });
    this.anchorList.push(this.anchor("crane", "crane", "Crane", craneA.east, craneA.north, 40, []));

    // Container yard: stacks of kit boxes in the palette, an anchor.
    const yardAt = at(-40, 150);
    const yardNode = new TransformNode("harbor.yard", this.scene);
    yardNode.parent = this.root;
    yardNode.position.set(yardAt.east, yardAt.up, yardAt.north);
    yardNode.rotation.y = (yawFacingSea * Math.PI) / 180;
    const palette = [containerBlue, rust, steel, navy];
    let index = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const stack = 1 + ((row + column) % 3);
        for (let level = 0; level < stack; level += 1) {
          const material = palette[index % palette.length] ?? steel;
          index += 1;
          this.box(
            `harbor.container.${row}.${column}.${level}`,
            24,
            9,
            12,
            yardNode,
            material,
            column * 27 - 40,
            4.5 + level * 9.2,
            row * 15 - 15,
          );
        }
      }
    }
    this.anchorList.push(
      this.anchor("containers", "containers", "Container stack", yardAt.east, yardAt.north, 50, [yardNode]),
    );

    // Fuel tanks: three cylinders inland-right, with a bund wall. An anchor.
    const tanksAt = at(-130, 110);
    const tankNode = new TransformNode("harbor.tanks", this.scene);
    tankNode.parent = this.root;
    tankNode.position.set(tanksAt.east, tanksAt.up, tanksAt.north);
    for (let i = 0; i < 3; i += 1) {
      this.cylinder(`harbor.tank.${i}`, 17, 24, tankNode, steel, i * 44 - 44, 12, 0);
      this.cylinder(`harbor.tank.cap.${i}`, 17.5, 2, tankNode, steelDark, i * 44 - 44, 25, 0);
    }
    this.box("harbor.tank.bund", 150, 4, 60, tankNode, steelDark, 0, 2, 0);
    this.anchorList.push(
      this.anchor("tanks", "tanks", "Fuel tanks", tanksAt.east, tanksAt.north, 60, [tankNode]),
    );

    // Floodlight poles along the quay, some of them lit for real.
    const poles = [at(70, -90), at(70, 20), at(70, 80), at(-20, -120), at(-30, 60), at(-90, 20)];
    let lit = 0;
    for (const [i, pole] of poles.entries()) {
      // A slim mast: pole, crossbar, two lamp heads. The light itself is real.
      this.cylinder(`harbor.mast.${i}`, 0.9, 24, this.root, steelDark, pole.east, pole.up + 12, pole.north);
      this.box(
        `harbor.mast.bar.${i}`,
        7,
        0.6,
        0.6,
        this.root,
        steelDark,
        pole.east,
        pole.up + 23.4,
        pole.north,
      );
      if (lit < options.lightBudget) {
        const light = new SpotLight(
          `harbor.flood.${i}`,
          new Vector3(pole.east, pole.up + 23, pole.north),
          new Vector3(0.15, -1, 0.1),
          Math.PI / 2.2,
          6,
          this.scene,
        );
        light.diffuse = SODIUM;
        light.specular = SODIUM.scale(0.3);
        light.intensity = 900;
        light.range = 220;
        this.lights.push(light);
        lit += 1;
      }
      const head = this.box(
        `harbor.flood.head.${i}`,
        2.4,
        0.8,
        1.4,
        this.root,
        sodium,
        pole.east,
        pole.up + 23.5,
        pole.north,
      );
      head.disableEdgesRendering();
    }

    // Searchlights: two cones sweeping from towers, cold light through the snow.
    for (const [i, towerAt] of [at(30, -200), at(-160, -40)].entries()) {
      const tower = this.box(
        `harbor.tower.${i}`,
        8,
        40,
        8,
        this.root,
        steelDark,
        towerAt.east,
        towerAt.up + 20,
        towerAt.north,
      );
      void tower;
      const pivot = new TransformNode(`harbor.search.${i}`, this.scene);
      pivot.parent = this.root;
      pivot.position.set(towerAt.east, towerAt.up + 42, towerAt.north);
      const beam = MeshBuilder.CreateCylinder(
        `harbor.beam.${i}`,
        { diameterTop: 60, diameterBottom: 2, height: 420, tessellation: 12 },
        this.scene,
      );
      beam.parent = pivot;
      beam.position.set(0, 0, 210);
      beam.rotation.x = Math.PI / 2;
      const beamMaterial = new StandardMaterial(`harbor.beamMaterial.${i}`, this.scene);
      beamMaterial.emissiveColor = ICE.scale(0.5);
      beamMaterial.diffuseColor = Color3.Black();
      beamMaterial.alpha = 0.08;
      beamMaterial.disableLighting = true;
      beamMaterial.backFaceCulling = false;
      this.materials.push(beamMaterial);
      beam.material = beamMaterial;
      beam.isPickable = false;
      this.meshes.push(beam);
      pivot.rotation.x = -0.28;
      this.searchlights.push({ node: pivot, rate: 0.22 + i * 0.09, phase: i * 2.1 });
    }

    // Beacons: red blinkers on the tallest pieces.
    for (const [i, spot] of [at(60, 120), at(40, -60), at(120, -150), at(-130, 110)].entries()) {
      const material = this.material(`harbor.beacon.${i}`, RED, 0);
      const beacon = this.box(
        `harbor.beacon.${i}`,
        2,
        2,
        2,
        this.root,
        material,
        spot.east,
        spot.up + (i < 2 ? 80 : 70),
        spot.north,
      );
      beacon.disableEdgesRendering();
      this.beacons.push({ material, phase: i * 0.7 });
    }

    // Barriers at the inland edge and military silhouettes past them.
    for (let i = 0; i < 10; i += 1) {
      const barrier = at(-260, -180 + i * 40);
      this.place("roads", "construction-barrier", barrier, yawFacingSea, { width: 14, height: 5, depth: 3 });
    }
    for (let i = 0; i < 4; i += 1) {
      const truck = at(-300, -120 + i * 70);
      const node = new TransformNode(`harbor.truck.${i}`, this.scene);
      node.parent = this.root;
      node.position.set(truck.east, truck.up, truck.north);
      node.rotation.y = ((yawFacingSea + 90) * Math.PI) / 180;
      this.box(`harbor.truck.body.${i}`, 18, 6, 7, node, steelDark, 0, 3, 0);
      this.box(`harbor.truck.cab.${i}`, 6, 5, 7, node, steelDark, 11, 2.5, 0);
      const lamp = this.box(`harbor.truck.lamp.${i}`, 1, 1, 1, node, i % 2 === 0 ? ice : sodium, 0, 6.8, 0);
      lamp.disableEdgesRendering();
    }
  }

  anchors(): readonly HarborAnchor[] {
    return this.anchorList;
  }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    this.elapsed += deltaSeconds;
    for (const search of this.searchlights) {
      search.node.rotation.y = Math.sin(this.elapsed * search.rate + search.phase) * 1.1;
    }
    for (const beacon of this.beacons) {
      const on = (this.elapsed * 1.6 + beacon.phase) % 1 < 0.18;
      beacon.material.emissiveColor = RED.scale(on ? 1 : 0.05);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const light of this.lights) light.dispose();
    for (const prop of this.placed) prop.dispose();
    for (const mesh of this.meshes) mesh.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.root.dispose();
  }

  private anchor(
    id: string,
    kind: HarborAnchor["kind"],
    label: string,
    east: number,
    north: number,
    radiusMeters: number,
    nodes: TransformNode[],
  ): HarborAnchor {
    const anchor: HarborAnchor = {
      id,
      kind,
      label,
      east,
      north,
      radiusMeters,
      used: false,
      destroy: () => {
        // The piece comes apart: what is left is a slumped, tilted version of it.
        for (const node of nodes) {
          node.rotation.z += 0.35;
          node.rotation.x -= 0.2;
          node.position.y -= 6;
          node.scaling.y = 0.55;
        }
        for (const prop of this.placed) {
          if (Math.hypot(prop.root.position.x - east, prop.root.position.z - north) < radiusMeters) {
            prop.root.rotation.z += 0.5;
            prop.root.position.y -= 10;
          }
        }
        this.options.onDestroy(east, (this.options.groundHeight(east, north) ?? 0) + 20, north);
      },
    };
    return anchor;
  }

  private place(
    kit: "factory" | "city" | "roads",
    model: string,
    at: { east: number; north: number; up: number },
    yawDeg: number,
    fit: { width: number; height: number; depth: number },
  ): void {
    void this.options.props
      .placeAll([{ kit, model, x: at.east, y: at.up, z: at.north, yawDeg, fit }])
      .then((placed) => {
        if (this.disposed) {
          for (const prop of placed) prop.dispose();
          return;
        }
        for (const prop of placed) {
          prop.root.parent = this.root;
          this.placed.push(prop);
        }
      })
      .catch(() => undefined);
  }

  private material(name: string, colour: Color3, shine: number): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = colour.scale(0.7);
    material.specularColor = new Color3(shine, shine, shine * 1.05);
    material.specularPower = 24;
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
    mesh.enableEdgesRendering(0.99);
    mesh.edgesWidth = 6;
    mesh.edgesColor = EDGE;
    mesh.receiveShadows = true;
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
  ): Mesh {
    const mesh = MeshBuilder.CreateCylinder(
      name,
      { diameter: radius * 2, height, tessellation: 18 },
      this.scene,
    );
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.enableEdgesRendering(0.99);
    mesh.edgesWidth = 6;
    mesh.edgesColor = EDGE;
    this.meshes.push(mesh);
    return mesh;
  }
}
