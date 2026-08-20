import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { ContentRegistry, type RegistryEntry } from "../data/registry";
import type { Rng } from "../simulation/rng";
import type { MaterialSlotManifest, SocketId } from "./manifest";

export type GeneratorParams = Readonly<Record<string, number | string | boolean>>;

export interface GeneratedAsset {
  readonly root: TransformNode;
  readonly sockets: ReadonlyMap<SocketId, TransformNode>;
  /** Stable part ids that presentation-level damage and inspection can address. */
  readonly parts: ReadonlyMap<string, Mesh>;
}

export interface GeneratorContext {
  readonly scene: Scene;
  readonly rng: Rng;
  readonly name: string;
  /** Resolves a material slot id declared in the manifest. */
  material(slotId: string): StandardMaterial;
}

export interface ProceduralGenerator extends RegistryEntry {
  readonly id: string;
  readonly description: string;
  validateParams(params: GeneratorParams): string[];
  build(params: GeneratorParams, context: GeneratorContext): GeneratedAsset;
}

function num(params: GeneratorParams, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(params: GeneratorParams, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function requirePositive(params: GeneratorParams, keys: readonly string[]): string[] {
  const errors: string[] = [];
  for (const key of keys) {
    const value = params[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      errors.push(`${key} must be a positive number when provided`);
    }
  }
  return errors;
}

interface BuildScope {
  readonly root: TransformNode;
  readonly parts: Map<string, Mesh>;
  readonly sockets: Map<SocketId, TransformNode>;
  box(id: string, slot: string, size: Vector3, position: Vector3): Mesh;
  cylinder(id: string, slot: string, height: number, diameter: number, position: Vector3): Mesh;
  sphere(id: string, slot: string, diameter: number, position: Vector3): Mesh;
  socket(id: SocketId, position: Vector3): void;
}

function createScope(context: GeneratorContext): BuildScope {
  const root = new TransformNode(context.name, context.scene);
  const parts = new Map<string, Mesh>();
  const sockets = new Map<SocketId, TransformNode>();

  const register = (id: string, slot: string, mesh: Mesh, position: Vector3): Mesh => {
    mesh.material = context.material(slot);
    mesh.position.copyFrom(position);
    mesh.parent = root;
    parts.set(id, mesh);
    return mesh;
  };

  return {
    root,
    parts,
    sockets,
    box(id, slot, size, position) {
      const mesh = MeshBuilder.CreateBox(
        `${context.name}.${id}`,
        { width: size.x, height: size.y, depth: size.z },
        context.scene,
      );
      return register(id, slot, mesh, position);
    },
    cylinder(id, slot, height, diameter, position) {
      const mesh = MeshBuilder.CreateCylinder(
        `${context.name}.${id}`,
        { height, diameter, tessellation: 12 },
        context.scene,
      );
      return register(id, slot, mesh, position);
    },
    sphere(id, slot, diameter, position) {
      const mesh = MeshBuilder.CreateSphere(
        `${context.name}.${id}`,
        { diameter, segments: 8 },
        context.scene,
      );
      return register(id, slot, mesh, position);
    },
    socket(id, position) {
      const node = new TransformNode(`${context.name}.socket.${id}`, context.scene);
      node.position.copyFrom(position);
      node.parent = root;
      sockets.set(id, node);
    },
  };
}

function finish(scope: BuildScope): GeneratedAsset {
  return { root: scope.root, sockets: scope.sockets, parts: scope.parts };
}

/**
 * Humanoid frame shared by Jaegers and bipedal kaiju. Proportions are ratios of
 * total height, so one generator covers a 60m Mark I and a 90m Mark VI without
 * a second code path.
 */
const bipedGenerator: ProceduralGenerator = {
  id: "biped",
  description: "Upright humanoid frame with arms, legs and a full socket set.",
  validateParams: (params) =>
    requirePositive(params, ["heightMeters", "legRatio", "torsoRatio", "headRatio", "shoulderRatio"]),
  build: (params, context) => {
    const scope = createScope(context);
    const height = num(params, "heightMeters", 75);
    const shoulderRatio = num(params, "shoulderRatio", 0.3);
    const bulk = num(params, "bulk", 1);

    // Normalised so heightMeters is the real measured height whatever the caller
    // passes; otherwise every manifest would need a hand-tuned nominal height.
    const rawLeg = num(params, "legRatio", 0.46);
    const rawTorso = num(params, "torsoRatio", 0.34);
    const rawHead = num(params, "headRatio", 0.1);
    const ratioSum = rawLeg + rawTorso + rawHead;
    const legHeight = (height * rawLeg) / ratioSum;
    const torsoHeight = (height * rawTorso) / ratioSum;
    const headSize = (height * rawHead) / ratioSum;
    const shoulderWidth = height * shoulderRatio;
    const torsoDepth = shoulderWidth * 0.55 * bulk;
    // A little seeded jitter keeps a row of placeholders from looking cloned.
    const jitter = 1 + (context.rng() - 0.5) * 0.06;

    const hipY = legHeight;
    const chestY = hipY + torsoHeight * 0.6;

    scope.box(
      "torso",
      "hull",
      new Vector3(shoulderWidth * 0.72, torsoHeight, torsoDepth),
      new Vector3(0, hipY + torsoHeight / 2, 0),
    );
    scope.box(
      "head",
      "trim",
      new Vector3(headSize * 1.1, headSize, headSize * 1.1),
      new Vector3(0, hipY + torsoHeight + headSize / 2, 0),
    );
    scope.cylinder(
      "reactor",
      "glow",
      torsoHeight * 0.16,
      torsoDepth * 0.5,
      new Vector3(0, chestY, torsoDepth * 0.45),
    ).rotation.x = Math.PI / 2;

    const armLength = torsoHeight * 1.05 * jitter;
    const armThickness = shoulderWidth * 0.16 * bulk;
    const legThickness = shoulderWidth * 0.2 * bulk;

    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? -1 : 1;
      const shoulderX = sign * (shoulderWidth / 2);
      const upperY = hipY + torsoHeight - armLength * 0.25;
      const foreY = upperY - armLength * 0.5;

      scope.box(
        `arm.upper.${side}`,
        "hull",
        new Vector3(armThickness, armLength * 0.5, armThickness),
        new Vector3(shoulderX, upperY, 0),
      );
      scope.box(
        `arm.fore.${side}`,
        "hull",
        new Vector3(armThickness * 0.85, armLength * 0.5, armThickness * 0.85),
        new Vector3(shoulderX, foreY, 0),
      );
      scope.socket(`forearm.${side}` as SocketId, new Vector3(shoulderX, foreY, 0));
      scope.socket(
        `hand.${side}` as SocketId,
        new Vector3(shoulderX, foreY - armLength * 0.28, armThickness * 0.4),
      );

      const hipX = sign * (shoulderWidth * 0.22);
      scope.box(
        `leg.thigh.${side}`,
        "hull",
        new Vector3(legThickness, legHeight * 0.52, legThickness),
        new Vector3(hipX, legHeight * 0.74, 0),
      );
      scope.box(
        `leg.shin.${side}`,
        "hull",
        new Vector3(legThickness * 0.85, legHeight * 0.48, legThickness * 0.85),
        new Vector3(hipX, legHeight * 0.24, 0),
      );
      scope.box(
        `foot.${side}`,
        "trim",
        new Vector3(legThickness * 1.15, legHeight * 0.08, legThickness * 1.9),
        new Vector3(hipX, legHeight * 0.04, legThickness * 0.3),
      );
      scope.socket(`foot.${side}` as SocketId, new Vector3(hipX, 0, 0));
    }

    scope.socket("head", new Vector3(0, hipY + torsoHeight + headSize / 2, 0));
    scope.socket("chest", new Vector3(0, chestY, torsoDepth * 0.5));
    scope.socket("reactor", new Vector3(0, chestY, 0));
    scope.socket("back", new Vector3(0, chestY, -torsoDepth * 0.5));

    return finish(scope);
  },
};

/** Four-legged kaiju frame: low slung body, optional tail. */
const quadrupedGenerator: ProceduralGenerator = {
  id: "quadruped",
  description: "Four-legged creature frame with an optional segmented tail.",
  validateParams: (params) => requirePositive(params, ["heightMeters", "lengthRatio", "legRatio"]),
  build: (params, context) => {
    const scope = createScope(context);
    const height = num(params, "heightMeters", 60);
    const lengthRatio = num(params, "lengthRatio", 1.6);
    const legRatio = num(params, "legRatio", 0.42);
    const tailSegments = Math.max(0, Math.round(num(params, "tailSegments", 4)));

    const legHeight = height * legRatio;
    const bodyHeight = height - legHeight;
    const bodyLength = height * lengthRatio;
    const bodyWidth = bodyHeight * 1.15;

    scope.box(
      "torso",
      "hide",
      new Vector3(bodyWidth, bodyHeight * 0.8, bodyLength),
      new Vector3(0, legHeight + bodyHeight * 0.4, 0),
    );
    scope.sphere(
      "head",
      "hide",
      bodyHeight * 0.85,
      new Vector3(0, legHeight + bodyHeight * 0.55, bodyLength * 0.6),
    );

    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? -1 : 1;
      for (const [index, offset] of [0.32, -0.32].entries()) {
        const id = index === 0 ? `leg.front.${side}` : `leg.rear.${side}`;
        scope.cylinder(
          id,
          "hide",
          legHeight,
          bodyWidth * 0.18,
          new Vector3(sign * bodyWidth * 0.42, legHeight / 2, bodyLength * offset),
        );
      }
      scope.socket(`foot.${side}` as SocketId, new Vector3(sign * bodyWidth * 0.42, 0, bodyLength * 0.32));
    }

    let tailZ = -bodyLength * 0.5;
    for (let i = 0; i < tailSegments; i += 1) {
      const taper = 1 - (i + 1) / (tailSegments + 1);
      const segmentLength = bodyLength * 0.18;
      tailZ -= segmentLength * 0.9;
      scope.box(
        `tail.${i}`,
        "hide",
        new Vector3(bodyWidth * 0.35 * taper, bodyHeight * 0.35 * taper, segmentLength),
        new Vector3(0, legHeight + bodyHeight * 0.35 * taper, tailZ),
      );
    }

    scope.socket("head", new Vector3(0, legHeight + bodyHeight * 0.55, bodyLength * 0.6));
    scope.socket("chest", new Vector3(0, legHeight + bodyHeight * 0.4, bodyLength * 0.3));
    scope.socket("back", new Vector3(0, legHeight + bodyHeight * 0.8, 0));
    return finish(scope);
  },
};

/** Limbless kaiju frame built from tapering segments. */
const serpentineGenerator: ProceduralGenerator = {
  id: "serpentine",
  description: "Segmented limbless creature frame that tapers along its length.",
  validateParams: (params) => requirePositive(params, ["heightMeters", "segmentCount"]),
  build: (params, context) => {
    const scope = createScope(context);
    const height = num(params, "heightMeters", 40);
    const segmentCount = Math.max(2, Math.round(num(params, "segmentCount", 8)));
    const girth = height * num(params, "girthRatio", 0.22);
    const segmentLength = height * 0.35;

    // Head crown lands exactly on heightMeters so the manifest's nominal height is the measured one.
    const headDiameter = girth * 1.2;
    const crestY = height - headDiameter / 2;

    for (let i = 0; i < segmentCount; i += 1) {
      const taper = 1 - (i / segmentCount) * 0.7;
      // Clamp to half the segment's own thickness so the tail rests on the
      // ground instead of floating above it.
      const halfThickness = (girth * taper) / 2;
      // Descend to the floor by the final segment, so the tail tip rests on the
      // ground and the asset origin sits at its base.
      const descent = 1 - i / (segmentCount - 1);
      const rise = Math.max(halfThickness, crestY * descent);
      scope.box(
        `segment.${i}`,
        "hide",
        new Vector3(girth * taper, girth * taper, segmentLength),
        new Vector3(0, rise, -i * segmentLength * 0.85),
      );
    }
    scope.sphere("head", "hide", headDiameter, new Vector3(0, crestY, segmentLength * 0.6));
    scope.socket("head", new Vector3(0, crestY, segmentLength * 0.6));
    scope.socket("chest", new Vector3(0, crestY * 0.8, 0));
    return finish(scope);
  },
};

/** City blocks: one generator covers towers, mid-rises and warehouses through params. */
const buildingGenerator: ProceduralGenerator = {
  id: "block-building",
  description: "Rectilinear building with optional setbacks and a roof plant.",
  validateParams: (params) => requirePositive(params, ["heightMeters", "footprintX", "footprintZ"]),
  build: (params, context) => {
    const scope = createScope(context);
    const height = num(params, "heightMeters", 40);
    const footprintX = num(params, "footprintX", 18);
    const footprintZ = num(params, "footprintZ", 18);
    const setbacks = Math.max(1, Math.round(num(params, "setbacks", 1)));

    let baseY = 0;
    let width = footprintX;
    let depth = footprintZ;
    for (let i = 0; i < setbacks; i += 1) {
      const tierHeight = height / setbacks;
      scope.box(
        `tier.${i}`,
        "concrete",
        new Vector3(width, tierHeight, depth),
        new Vector3(0, baseY + tierHeight / 2, 0),
      );
      baseY += tierHeight;
      width *= 0.78;
      depth *= 0.78;
    }
    if (num(params, "roofPlant", 1) > 0) {
      scope.box(
        "roof.plant",
        "trim",
        new Vector3(width * 0.5, height * 0.05, depth * 0.5),
        new Vector3(0, baseY, 0),
      );
    }
    return finish(scope);
  },
};

const vehicleGenerator: ProceduralGenerator = {
  id: "wheeled-vehicle",
  description: "Road vehicle body with cabin and wheel pairs.",
  validateParams: (params) => requirePositive(params, ["lengthMeters", "widthMeters", "heightMeters"]),
  build: (params, context) => {
    const scope = createScope(context);
    const length = num(params, "lengthMeters", 4.6);
    const width = num(params, "widthMeters", 1.9);
    const height = num(params, "heightMeters", 1.6);
    const wheelPairs = Math.max(1, Math.round(num(params, "wheelPairs", 2)));
    const wheelDiameter = height * 0.42;

    scope.box(
      "chassis",
      "paint",
      new Vector3(width, height * 0.55, length),
      new Vector3(0, height * 0.45, 0),
    );
    scope.box(
      "cabin",
      "glass",
      new Vector3(width * 0.85, height * 0.4, length * 0.45),
      new Vector3(0, height * 0.85, -length * 0.05),
    );

    for (let pair = 0; pair < wheelPairs; pair += 1) {
      const z = length * (0.34 - (pair / Math.max(1, wheelPairs - 1 || 1)) * 0.68);
      for (const side of ["L", "R"] as const) {
        const sign = side === "L" ? -1 : 1;
        const wheel = scope.cylinder(
          `wheel.${pair}.${side}`,
          "rubber",
          width * 0.16,
          wheelDiameter,
          new Vector3(sign * width * 0.48, wheelDiameter / 2, wheelPairs === 1 ? 0 : z),
        );
        wheel.rotation.z = Math.PI / 2;
      }
    }
    return finish(scope);
  },
};

const shipGenerator: ProceduralGenerator = {
  id: "hull-ship",
  description: "Ship hull with deck and stacked superstructure.",
  validateParams: (params) => requirePositive(params, ["lengthMeters", "beamMeters", "heightMeters"]),
  build: (params, context) => {
    const scope = createScope(context);
    const length = num(params, "lengthMeters", 180);
    const beam = num(params, "beamMeters", 28);
    const height = num(params, "heightMeters", 20);
    const decks = Math.max(1, Math.round(num(params, "superstructureDecks", 3)));

    scope.box("hull", "steel", new Vector3(beam, height * 0.5, length), new Vector3(0, height * 0.25, 0));
    scope.box(
      "deck",
      "steel",
      new Vector3(beam * 0.96, height * 0.06, length * 0.98),
      new Vector3(0, height * 0.52, 0),
    );

    // Decks divide the height left above the deck line, so the stack tops out at heightMeters.
    const deckHeight = (height * 0.45) / decks;
    for (let i = 0; i < decks; i += 1) {
      const scale = 1 - i * 0.18;
      scope.box(
        `superstructure.${i}`,
        "trim",
        new Vector3(beam * 0.5 * scale, deckHeight, length * 0.14 * scale),
        new Vector3(0, height * 0.55 + deckHeight * (i + 0.5), -length * 0.28),
      );
    }
    scope.socket("back", new Vector3(0, height * 0.55, -length * 0.28));
    return finish(scope);
  },
};

/** Small scenery and hand-held items. The "cannon" kind is what exposes a muzzle socket. */
const propGenerator: ProceduralGenerator = {
  id: "prop",
  description: "Small prop: crate, tank, antenna or cannon.",
  validateParams: (params) => {
    const errors = requirePositive(params, ["heightMeters", "radiusMeters"]);
    const kind = text(params, "kind", "crate");
    if (!["crate", "tank", "antenna", "cannon"].includes(kind)) {
      errors.push(`kind must be one of: crate, tank, antenna, cannon (got "${kind}")`);
    }
    return errors;
  },
  build: (params, context) => {
    const scope = createScope(context);
    const height = num(params, "heightMeters", 2.4);
    const radius = num(params, "radiusMeters", 1.2);
    const kind = text(params, "kind", "crate");

    if (kind === "crate") {
      scope.box("body", "paint", new Vector3(radius * 2, height, radius * 2), new Vector3(0, height / 2, 0));
    } else if (kind === "tank") {
      // Dome cap is part of the declared height rather than stacked on top of it.
      const capDiameter = height * 0.4;
      scope.cylinder(
        "body",
        "steel",
        height - capDiameter / 2,
        radius * 2,
        new Vector3(0, (height - capDiameter / 2) / 2, 0),
      );
      scope.sphere("cap", "steel", capDiameter, new Vector3(0, height - capDiameter / 2, 0));
    } else if (kind === "antenna") {
      const dishThickness = radius * 0.3;
      scope.cylinder(
        "mast",
        "steel",
        height - dishThickness,
        radius * 0.3,
        new Vector3(0, (height - dishThickness) / 2, 0),
      );
      scope.box(
        "dish",
        "trim",
        new Vector3(radius * 2, dishThickness, radius * 2),
        new Vector3(0, height - dishThickness / 2, 0),
      );
    } else {
      const barrelLength = height * 2.2;
      scope.box(
        "breech",
        "steel",
        new Vector3(radius * 1.6, height, radius * 1.6),
        new Vector3(0, height / 2, 0),
      );
      const barrel = scope.cylinder(
        "barrel",
        "steel",
        barrelLength,
        radius * 0.7,
        new Vector3(0, height * 0.6, barrelLength / 2),
      );
      barrel.rotation.x = Math.PI / 2;
      scope.socket("muzzle", new Vector3(0, height * 0.6, barrelLength));
    }
    return finish(scope);
  },
};

const shatterdomeModuleGenerator: ProceduralGenerator = {
  id: "shatterdome-module",
  description: "Shatterdome bay shell with gantries and blast doors.",
  validateParams: (params) => requirePositive(params, ["widthMeters", "depthMeters", "heightMeters"]),
  build: (params, context) => {
    const scope = createScope(context);
    const width = num(params, "widthMeters", 120);
    const depth = num(params, "depthMeters", 90);
    const height = num(params, "heightMeters", 100);
    const gantries = Math.max(0, Math.round(num(params, "gantryCount", 3)));
    const wall = width * 0.04;

    scope.box("floor", "concrete", new Vector3(width, wall, depth), new Vector3(0, wall / 2, 0));
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? -1 : 1;
      scope.box(
        `wall.${side}`,
        "concrete",
        new Vector3(wall, height, depth),
        new Vector3((sign * (width - wall)) / 2, height / 2, 0),
      );
    }
    scope.box(
      "wall.back",
      "concrete",
      new Vector3(width, height, wall),
      new Vector3(0, height / 2, -depth / 2),
    );
    scope.box("roof", "steel", new Vector3(width, wall, depth), new Vector3(0, height, 0));
    scope.box(
      "blast.door",
      "trim",
      new Vector3(width * 0.7, height * 0.75, wall),
      new Vector3(0, height * 0.375, depth / 2),
    );

    for (let i = 0; i < gantries; i += 1) {
      const y = (height * (i + 1)) / (gantries + 1);
      scope.box(
        `gantry.${i}`,
        "steel",
        new Vector3(width * 0.9, height * 0.02, depth * 0.12),
        new Vector3(0, y, 0),
      );
    }
    return finish(scope);
  },
};

export function createGeneratorRegistry(): ContentRegistry<ProceduralGenerator> {
  const registry = new ContentRegistry<ProceduralGenerator>((entry) =>
    entry.id ? [] : ["generator id required"],
  );
  for (const generator of [
    bipedGenerator,
    quadrupedGenerator,
    serpentineGenerator,
    buildingGenerator,
    vehicleGenerator,
    shipGenerator,
    propGenerator,
    shatterdomeModuleGenerator,
  ]) {
    registry.register(generator);
  }
  return registry;
}

/** Builds the Babylon materials a generator asks for by manifest slot id. */
export class MaterialPalette {
  private readonly materials = new Map<string, StandardMaterial>();
  private fallback: StandardMaterial | undefined;

  constructor(
    private readonly scene: Scene,
    private readonly name: string,
    slots: readonly MaterialSlotManifest[],
  ) {
    for (const slot of slots) {
      const material = new StandardMaterial(`${name}.${slot.id}`, scene);
      material.diffuseColor = Color3.FromHexString(slot.baseColorHex);
      // Placeholder shading only: roughness drives a plain specular falloff.
      material.specularColor = new Color3(1 - slot.roughness, 1 - slot.roughness, 1 - slot.roughness).scale(
        slot.metallic * 0.6,
      );
      if (slot.id === "glow") material.emissiveColor = Color3.FromHexString(slot.baseColorHex).scale(0.6);
      this.materials.set(slot.id, material);
    }
  }

  material(slotId: string): StandardMaterial {
    const existing = this.materials.get(slotId);
    if (existing) return existing;
    if (!this.fallback) {
      this.fallback = new StandardMaterial(`${this.name}.fallback`, this.scene);
      this.fallback.diffuseColor = new Color3(0.5, 0.5, 0.52);
    }
    return this.fallback;
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.fallback?.dispose();
    this.fallback = undefined;
  }
}
