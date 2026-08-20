import { NullEngine, Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGeneratorRegistry } from "../../src/assets/generators";
import { hasErrors } from "../../src/assets/inspection";
import { applyAssetOverride, type AssetManifest } from "../../src/assets/manifest";
import { AssetResolver } from "../../src/assets/resolver";
import { ASSET_MANIFESTS, createDefaultAssetRegistry } from "../../src/data/assets";
import { buildOverrideMap } from "../../src/app/galleryOverrides";
import { SimulationKernel } from "../../src/simulation/kernel";
import { SPAWN_SCATTER, type SpawnScatterCommand } from "../../src/simulation/commands";

let engine: NullEngine;
let scene: Scene;
let warnings: string[];

function makeResolver(): AssetResolver {
  return new AssetResolver(createGeneratorRegistry(), (message) => warnings.push(message));
}

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  warnings = [];
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("AssetResolver fallback behaviour", () => {
  it("falls back to the generator and warns once when a model is missing", async () => {
    const resolver = makeResolver();
    const base = createDefaultAssetRegistry().getOrThrow("jaeger.placeholder-mk0");
    const manifest = applyAssetOverride(base, {
      source: { url: "/assets/models/definitely-not-installed.glb", format: "glb" },
    });

    const resolved = await resolver.resolve(manifest, scene);

    expect(resolved.origin).toBe("generator");
    expect(resolved.root.getChildMeshes(false).length).toBeGreaterThan(0);
    expect(warnings).toHaveLength(1);
    // The warning has to say which asset, which path, and what to do about it.
    expect(warnings[0]).toMatch(/jaeger\.placeholder-mk0/);
    expect(warnings[0]).toMatch(/definitely-not-installed\.glb/);
    expect(warnings[0]).toMatch(/public\/assets\/models/);

    resolved.dispose();
  });

  it("warns only once per asset however many times it is resolved", async () => {
    const resolver = makeResolver();
    const base = createDefaultAssetRegistry().getOrThrow("prop.cargo-crate");
    const manifest = applyAssetOverride(base, {
      source: { url: "/assets/models/missing.glb", format: "glb" },
    });

    const instances = [];
    for (let i = 0; i < 5; i += 1) instances.push(await resolver.resolve(manifest, scene, `crate.${i}`));

    expect(warnings).toHaveLength(1);
    for (const instance of instances) instance.dispose();
  });

  it("fails loudly when a manifest names a generator that does not exist", async () => {
    const resolver = makeResolver();
    const base = createDefaultAssetRegistry().getOrThrow("prop.cargo-crate");
    const broken: AssetManifest = { ...base, fallbackGenerator: { id: "no-such-generator", params: {} } };

    await expect(resolver.resolve(broken, scene)).rejects.toThrow(/not registered/);
  });

  it("fails loudly when generator params are invalid", async () => {
    const resolver = makeResolver();
    const base = createDefaultAssetRegistry().getOrThrow("prop.cargo-crate");
    const broken: AssetManifest = {
      ...base,
      fallbackGenerator: { id: "prop", params: { kind: "trebuchet", heightMeters: 2, radiusMeters: 1 } },
    };

    await expect(resolver.resolve(broken, scene)).rejects.toThrow(/kind must be one of/);
  });
});

describe("shipped placeholders", () => {
  it("every manifest resolves, measures close to its declared height, and has no errors", async () => {
    const resolver = makeResolver();
    for (const manifest of ASSET_MANIFESTS) {
      const resolved = await resolver.resolve(manifest, scene);

      expect(resolved.origin).toBe("generator");
      expect(resolved.inspection.triangleCount).toBeGreaterThan(0);
      expect(hasErrors(resolved.diagnostics)).toBe(false);

      const drift =
        Math.abs(resolved.inspection.boundingBoxMeters.y - manifest.nominalHeightMeters) /
        manifest.nominalHeightMeters;
      expect(drift, `${manifest.id} height drift`).toBeLessThanOrEqual(0.1);

      resolved.dispose();
    }
    expect(warnings).toEqual([]);
  });

  it("stays inside its own class triangle budget", async () => {
    const resolver = makeResolver();
    for (const manifest of ASSET_MANIFESTS) {
      const resolved = await resolver.resolve(manifest, scene);
      const overBudget = resolved.diagnostics.filter((d) => d.code === "triangle-budget");
      expect(overBudget, `${manifest.id} triangle budget`).toEqual([]);
      resolved.dispose();
    }
  });

  it("exposes every socket the manifest declares", async () => {
    const resolver = makeResolver();
    for (const manifest of ASSET_MANIFESTS) {
      const resolved = await resolver.resolve(manifest, scene);
      for (const socket of manifest.sockets) {
        expect(resolved.sockets.has(socket.id), `${manifest.id} socket ${socket.id}`).toBe(true);
      }
      resolved.dispose();
    }
  });

  it("gives the cannon a muzzle socket for projectiles to spawn from", async () => {
    const resolver = makeResolver();
    const manifest = createDefaultAssetRegistry().getOrThrow("prop.shore-cannon");
    const resolved = await resolver.resolve(manifest, scene);
    expect(resolved.sockets.has("muzzle")).toBe(true);
    resolved.dispose();
  });

  it("is reproducible: the same manifest generates identical geometry twice", async () => {
    const resolver = makeResolver();
    const manifest = createDefaultAssetRegistry().getOrThrow("jaeger.placeholder-mk0");
    const first = await resolver.resolve(manifest, scene, "a");
    const second = await resolver.resolve(manifest, scene, "b");

    expect(second.inspection.boundingBoxMeters).toEqual(first.inspection.boundingBoxMeters);
    expect(second.inspection.triangleCount).toBe(first.inspection.triangleCount);

    first.dispose();
    second.dispose();
  });

  it("shares one generator across differently proportioned units", async () => {
    const resolver = makeResolver();
    const registry = createDefaultAssetRegistry();
    const light = await resolver.resolve(registry.getOrThrow("jaeger.placeholder-mk0"), scene, "light");
    const heavy = await resolver.resolve(registry.getOrThrow("jaeger.heavy-mk4"), scene, "heavy");

    // Same "biped" generator, different params, visibly different results.
    expect(light.inspection.boundingBoxMeters.y).not.toBeCloseTo(heavy.inspection.boundingBoxMeters.y, 1);
    expect(heavy.inspection.boundingBoxMeters.x).toBeGreaterThan(light.inspection.boundingBoxMeters.x);

    light.dispose();
    heavy.dispose();
  });
});

describe("resource disposal", () => {
  it("returns the scene to its original node and material counts", async () => {
    const resolver = makeResolver();
    const meshesBefore = scene.meshes.length;
    const materialsBefore = scene.materials.length;
    const nodesBefore = scene.transformNodes.length;

    const resolved = await resolver.resolve(
      createDefaultAssetRegistry().getOrThrow("jaeger.placeholder-mk0"),
      scene,
    );
    expect(scene.meshes.length).toBeGreaterThan(meshesBefore);
    expect(scene.materials.length).toBeGreaterThan(materialsBefore);

    resolved.dispose();

    expect(scene.meshes.length).toBe(meshesBefore);
    expect(scene.materials.length).toBe(materialsBefore);
    expect(scene.transformNodes.length).toBe(nodesBefore);
  });

  it("leaks nothing across many resolve and dispose cycles", async () => {
    const resolver = makeResolver();
    const manifest = createDefaultAssetRegistry().getOrThrow("kaiju.quadruped-alpha");
    const meshesBefore = scene.meshes.length;

    for (let i = 0; i < 10; i += 1) {
      const resolved = await resolver.resolve(manifest, scene, `cycle.${i}`);
      resolved.dispose();
    }

    expect(scene.meshes.length).toBe(meshesBefore);
  });
});

describe("presentation swaps cannot reach gameplay", () => {
  it("an override changes materials and source but no gameplay field", () => {
    const registry = createDefaultAssetRegistry();
    const overrides = buildOverrideMap("alt-palette", registry.all());

    for (const base of registry.all()) {
      const override = overrides.get(base.id);
      if (!override) continue;
      const swapped = applyAssetOverride(base, override);

      expect(swapped.collision).toEqual(base.collision);
      expect(swapped.sockets).toEqual(base.sockets);
      expect(swapped.nominalHeightMeters).toBe(base.nominalHeightMeters);
      expect(swapped.assetClass).toBe(base.assetClass);
      expect(swapped.animations).toEqual(base.animations);
    }
  });

  it("resolving assets under any override leaves the simulation hash untouched", async () => {
    const registry = createDefaultAssetRegistry();
    const command: SpawnScatterCommand = { type: SPAWN_SCATTER, schemaVersion: 1, count: 6, spread: 30 };

    const runWithOverride = async (overrideId: string): Promise<string> => {
      const kernel = new SimulationKernel({ seed: 4242 });
      const resolver = makeResolver();
      kernel.enqueue(command);

      for (const base of registry.all()) {
        const override = buildOverrideMap(overrideId, registry.all()).get(base.id);
        const manifest = override ? applyAssetOverride(base, override) : base;
        const resolved = await resolver.resolve(manifest, scene, `${overrideId}.${manifest.id}`);
        kernel.step();
        resolved.dispose();
      }

      const hash = kernel.hash();
      kernel.dispose();
      return hash;
    };

    const baseline = await runWithOverride("default");
    expect(await runWithOverride("alt-palette")).toBe(baseline);
    // Even the path that fails to load a model and falls back must not perturb the simulation.
    expect(await runWithOverride("external-model")).toBe(baseline);
  });
});
