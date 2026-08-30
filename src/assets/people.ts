import {
  AnimationGroup,
  Color3,
  MeshBuilder,
  PBRMaterial,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type AssetContainer,
  type Scene,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/**
 * People.
 *
 * Every human in the game comes from one small library of CC0 animated
 * characters (Quaternius, via poly.pizza; see THIRD_PARTY_ASSETS.md), loaded
 * once per model as an asset container and instantiated as many times as a
 * room needs. Each model carries its own clips, so there is no retargeting:
 * the library maps a shared vocabulary of actions (idle, walk, work, react,
 * agree, wave, duck) onto whatever clip names the model ships with.
 *
 * Scale is measured, not assumed: every model is normalised to a stated
 * height in metres on load, so a 2-unit Blender rig and a 180-unit one stand
 * the same height on the deck.
 */

export type PersonModelId =
  "operator-f" | "operator-m" | "officer" | "technician" | "welder" | "security" | "medic" | "pilot";

export type PersonAction = "idle" | "walk" | "run" | "work" | "react" | "agree" | "refuse" | "wave" | "duck";

interface PersonModelSpec {
  readonly id: PersonModelId;
  readonly file: string;
  readonly heightMeters: number;
  /** Clip name fragments, in preference order, for each action. */
  readonly clips: Readonly<Partial<Record<PersonAction, readonly string[]>>>;
  /** Material names to tint with the role colour, when the model has named cloth. */
  readonly tint: readonly string[];
}

// Relative to the build base so a subfolder deployment finds the files.
const ROOT = `${import.meta.env.BASE_URL}assets/models/people/`;

/** The roster. Files are the CC0 Quaternius characters staged under public/assets/models/people. */
export const PERSON_MODELS: readonly PersonModelSpec[] = [
  {
    id: "operator-f",
    file: "animated-woman-b.glb",
    heightMeters: 1.72,
    clips: {
      idle: ["Idle_Neutral", "Idle"],
      walk: ["Walk"],
      run: ["Run"],
      work: ["Interact"],
      react: ["HitRecieve"],
      wave: ["Wave"],
    },
    tint: ["Orange", "Grey"],
  },
  {
    id: "operator-m",
    file: "character-animated.glb",
    heightMeters: 1.78,
    clips: {
      idle: ["CharacterArmature|Idle", "Idle"],
      walk: ["CharacterArmature|Walk", "Walk"],
      run: ["CharacterArmature|Run", "Run"],
      work: ["CharacterArmature|Idle", "Idle"],
      react: ["CharacterArmature|RecieveHit", "RecieveHit"],
    },
    tint: ["Shirt", "Pants"],
  },
  {
    id: "officer",
    file: "anne.glb",
    heightMeters: 1.74,
    clips: {
      idle: ["Idle"],
      walk: ["Walk"],
      run: ["Run"],
      work: ["Idle"],
      agree: ["Yes"],
      refuse: ["No"],
      react: ["HitReact"],
      wave: ["Wave"],
      duck: ["Duck"],
    },
    tint: [],
  },
  {
    id: "technician",
    file: "mako.glb",
    heightMeters: 1.76,
    clips: {
      idle: ["Idle"],
      walk: ["Walk"],
      run: ["Run"],
      work: ["Idle"],
      agree: ["Yes"],
      refuse: ["No"],
      react: ["HitReact"],
      wave: ["Wave"],
      duck: ["Duck"],
    },
    tint: [],
  },
  {
    id: "welder",
    file: "animated-human.glb",
    heightMeters: 1.8,
    clips: {
      idle: ["Idle"],
      walk: ["Walk"],
      run: ["Run"],
      work: ["Working"],
      react: ["Death"],
    },
    tint: [],
  },
  {
    id: "security",
    file: "character-soldier.glb",
    heightMeters: 1.82,
    clips: {
      idle: ["CharacterArmature|Idle"],
      walk: ["CharacterArmature|Walk", "CharacterArmature|Run"],
      run: ["CharacterArmature|Run"],
      work: ["CharacterArmature|Idle_Shoot", "CharacterArmature|Idle"],
      agree: ["CharacterArmature|Yes"],
      refuse: ["CharacterArmature|No"],
      react: ["CharacterArmature|HitReact"],
      wave: ["CharacterArmature|Wave"],
      duck: ["CharacterArmature|Duck"],
    },
    tint: ["Character_Main", "Pants"],
  },
  {
    id: "medic",
    file: "animated-woman-a.glb",
    heightMeters: 1.7,
    clips: {
      idle: ["Idle"],
      walk: ["Walking"],
      run: ["Running"],
      work: ["Idle"],
      react: ["Death"],
    },
    tint: [],
  },
  {
    id: "pilot",
    file: "astronaut.glb",
    heightMeters: 1.8,
    clips: {
      idle: ["Idle"],
      walk: ["Walk"],
      run: ["Run"],
      work: ["Idle"],
      agree: ["Yes"],
      refuse: ["No"],
      react: ["HitReact"],
      wave: ["Wave"],
      duck: ["Duck"],
    },
    tint: [],
  },
];

const CROSSFADE_SECONDS = 0.22;

/** A placed person: a root to move, and clips to play. */
export class Person {
  readonly root: TransformNode;
  readonly model: PersonModelId;
  private readonly groups = new Map<PersonAction, AnimationGroup>();
  private readonly all: AnimationGroup[];
  private readonly meshes: AbstractMesh[];
  private current: PersonAction | null = null;
  private fading: { from: AnimationGroup; to: AnimationGroup; left: number } | null = null;
  private disposed = false;

  constructor(
    root: TransformNode,
    model: PersonModelId,
    meshes: AbstractMesh[],
    groups: AnimationGroup[],
    spec: PersonModelSpec,
  ) {
    this.root = root;
    this.model = model;
    this.meshes = meshes;
    this.all = groups;
    for (const group of groups) group.stop();
    const actions: PersonAction[] = [
      "idle",
      "walk",
      "run",
      "work",
      "react",
      "agree",
      "refuse",
      "wave",
      "duck",
    ];
    for (const action of actions) {
      const wanted = spec.clips[action];
      if (!wanted) continue;
      for (const fragment of wanted) {
        const found =
          groups.find((group) => group.name === fragment) ??
          groups.find((group) => group.name.endsWith(fragment));
        if (found) {
          this.groups.set(action, found);
          break;
        }
      }
    }
  }

  /** Whether the model has a clip for the action. */
  has(action: PersonAction): boolean {
    return this.groups.has(action);
  }

  /**
   * Plays an action, crossfading from whatever is running. Missing actions
   * fall back to idle so nobody ever freezes in a T-pose.
   */
  play(action: PersonAction, loop = true): void {
    if (this.disposed) return;
    const target = this.groups.get(action) ?? this.groups.get("idle");
    if (!target) return;
    const resolved = this.groups.get(action) ? action : "idle";
    if (resolved === this.current) return;
    const previous = this.current ? this.groups.get(this.current) : undefined;
    this.current = resolved;
    target.start(loop, 1, target.from, target.to, false);
    if (previous && previous !== target) {
      target.setWeightForAllAnimatables(0);
      this.fading = { from: previous, to: target, left: CROSSFADE_SECONDS };
    } else {
      target.setWeightForAllAnimatables(1);
      this.fading = null;
    }
  }

  /** The action currently playing. */
  get action(): PersonAction | null {
    return this.current;
  }

  /** Advances the crossfade. Call every frame. */
  update(deltaSeconds: number): void {
    const fade = this.fading;
    if (!fade) return;
    fade.left = Math.max(0, fade.left - deltaSeconds);
    const t = 1 - fade.left / CROSSFADE_SECONDS;
    fade.to.setWeightForAllAnimatables(t);
    fade.from.setWeightForAllAnimatables(1 - t);
    if (fade.left <= 0) {
      fade.from.stop();
      fade.to.setWeightForAllAnimatables(1);
      this.fading = null;
    }
  }

  /** Tints the named cloth materials so a role reads at a glance. */
  tint(colour: Color3, names: readonly string[]): void {
    for (const mesh of this.meshes) {
      const material = mesh.material;
      if (!material || !names.some((name) => material.name === name || material.name.startsWith(`${name}.`)))
        continue;
      if (material instanceof PBRMaterial) material.albedoColor = colour;
      else if (material instanceof StandardMaterial) material.diffuseColor = colour;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const group of this.all) group.dispose();
    this.root.dispose();
  }
}

/**
 * The library: one container per model file, loaded on first use and shared
 * by every instance. Dispose frees the containers and everyone spawned.
 */
export class PeopleLibrary {
  private readonly scene: Scene;
  private readonly containers = new Map<PersonModelId, Promise<AssetContainer | null>>();
  private readonly people = new Set<Person>();
  private readonly warn: (message: string) => void;
  private disposed = false;
  private spawnCount = 0;

  constructor(scene: Scene, warn: (message: string) => void = () => undefined) {
    this.scene = scene;
    this.warn = warn;
  }

  /** Loads a model's container once. Returns null when the file is missing. */
  private container(id: PersonModelId): Promise<AssetContainer | null> {
    const existing = this.containers.get(id);
    if (existing) return existing;
    const spec = PERSON_MODELS.find((entry) => entry.id === id);
    if (!spec) return Promise.resolve(null);
    const loading = SceneLoader.LoadAssetContainerAsync(ROOT, spec.file, this.scene)
      .then((container) => {
        if (this.disposed) {
          container.dispose();
          return null;
        }
        // Materials tint per instance, so instances must not share them.
        for (const material of container.materials) {
          if (material instanceof PBRMaterial) {
            material.metallic = 0;
            material.roughness = 0.85;
          }
        }
        return container;
      })
      .catch((error: unknown) => {
        this.warn(`Person model "${spec.file}" could not load: ${String(error)}.`);
        return null;
      });
    this.containers.set(id, loading);
    return loading;
  }

  /**
   * Places a person. Resolves to null when the model is unavailable, so a
   * room can fall back to drawing nobody rather than a box.
   */
  async spawn(id: PersonModelId, roleColour: Color3 | null = null): Promise<Person | null> {
    const spec = PERSON_MODELS.find((entry) => entry.id === id);
    if (!spec || this.disposed) return null;
    if (typeof window === "undefined") {
      // Headless: no files to fetch. A stand-in of the right height keeps the
      // crew count honest for the simulation and the tests.
      this.spawnCount += 1;
      const root = new TransformNode(`person.${id}.${this.spawnCount}`, this.scene);
      const body = MeshBuilder.CreateBox(
        `${root.name}.standin`,
        { width: 0.5, height: spec.heightMeters, depth: 0.3 },
        this.scene,
      );
      body.position.y = spec.heightMeters / 2;
      body.parent = root;
      body.isPickable = false;
      const person = new Person(root, id, [body], [], spec);
      this.people.add(person);
      return person;
    }
    const container = await this.container(id);
    if (!container || this.disposed) return null;
    this.spawnCount += 1;
    const tag = `person.${id}.${this.spawnCount}`;
    const entries = container.instantiateModelsToScene((name) => `${tag}.${name}`, true, {
      doNotInstantiate: true,
    });
    const root = new TransformNode(tag, this.scene);
    const meshes: AbstractMesh[] = [];
    for (const node of entries.rootNodes) {
      node.parent = root;
      if ("getChildMeshes" in node) {
        for (const mesh of (node as TransformNode).getChildMeshes()) meshes.push(mesh);
      }
      if ((node as AbstractMesh).getBoundingInfo) meshes.push(node as AbstractMesh);
    }
    for (const mesh of meshes) mesh.isPickable = false;

    // Normalise height from the measured bounds, not the file's units.
    root.computeWorldMatrix(true);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      minY = Math.min(minY, bounds.minimumWorld.y);
      maxY = Math.max(maxY, bounds.maximumWorld.y);
    }
    const measured = maxY - minY;
    if (Number.isFinite(measured) && measured > 0.01) {
      const scale = spec.heightMeters / measured;
      for (const node of entries.rootNodes) {
        const transform = node as TransformNode;
        transform.scaling = new Vector3(scale, scale, scale);
        // Feet on the deck: lift by whatever sits below the origin.
        transform.position.y = -minY * scale;
      }
    }

    const person = new Person(root, id, meshes, entries.animationGroups, spec);
    if (roleColour) person.tint(roleColour, spec.tint);
    person.play("idle");
    this.people.add(person);
    return person;
  }

  /** Advances every crossfade. */
  update(deltaSeconds: number): void {
    for (const person of this.people) person.update(deltaSeconds);
  }

  /** Removes one person. */
  release(person: Person): void {
    if (!this.people.delete(person)) return;
    person.dispose();
  }

  get count(): number {
    return this.people.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const person of this.people) person.dispose();
    this.people.clear();
    for (const loading of this.containers.values()) {
      void loading.then((container) => container?.dispose());
    }
    this.containers.clear();
  }
}
