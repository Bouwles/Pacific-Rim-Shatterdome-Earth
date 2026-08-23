import { NullEngine, Scene, type Mesh } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SectorRenderer } from "../../src/engine/sectorRenderer";
import { SectorStreamer } from "../../src/world/sectorStreaming";
import { InlineTerrainService } from "../../src/world/terrainService";
import { createDefaultTerrainAnchors } from "../../src/data/regions";
import { createQualityRegistry } from "../../src/data/quality";
import { EnvironmentSystem } from "../../src/world/environment";
import { createClimateRegistry } from "../../src/data/climates";
import { generateSectorTerrain, LOD_GRID_RESOLUTION } from "../../src/world/terrain";
import { FloatingOrigin, rebaseLocal } from "../../src/world/floatingOrigin";
import { geo, geoToLocal } from "../../src/world/coordinates";
import { sectorCentre, sectorIdAt, parseSectorId } from "../../src/world/cubeSphere";

const ANCHORS = createDefaultTerrainAnchors();
const SEED = 31_415;
const HONG_KONG = geo(22.3193, 114.1694, 0);
const quality = createQualityRegistry().getOrThrow("high");

let engine: NullEngine;
let scene: Scene;
let origin: FloatingOrigin;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  origin = new FloatingOrigin({ anchor: HONG_KONG });
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

function makeRenderer(): SectorRenderer {
  return new SectorRenderer({ scene, anchor: () => origin.anchor, quality });
}

function terrainFor(sectorId: string, lod: 0 | 1 | 2 | 3 = 0) {
  return generateSectorTerrain({ sectorId, lod, seed: SEED, anchors: ANCHORS });
}

describe("sector renderer", () => {
  it("builds geometry with a skirt and per-vertex colour", () => {
    const renderer = makeRenderer();
    const terrain = terrainFor(sectorIdAt(HONG_KONG));
    renderer.upload(terrain);

    const ground = scene.meshes.find((mesh) => mesh.name.startsWith("sector.ground."));
    expect(ground).toBeDefined();

    const resolution = LOD_GRID_RESOLUTION[0];
    const gridVertices = resolution * resolution;
    const positionCount = (ground?.getVerticesData("position")?.length ?? 0) / 3;
    // Grid plus one skirt vertex per border step: the apron that hides the gap
    // between two neighbours built at different levels of detail.
    expect(positionCount).toBe(gridVertices + 4 * (resolution - 1));
    expect(ground?.getVerticesData("color")?.length).toBe(positionCount * 4);
    expect(ground?.getVerticesData("normal")?.length).toBe(positionCount * 3);

    renderer.dispose();
  });

  it("places a sector root at the sector centre in the current anchor frame", () => {
    const renderer = makeRenderer();
    const sectorId = sectorIdAt(HONG_KONG);
    renderer.upload(terrainFor(sectorId));

    const root = scene.transformNodes.find((node) => node.name === `sector.${sectorId}`);
    expect(root).toBeDefined();

    const expected = geoToLocal(origin.anchor, sectorCentre(parseSectorId(sectorId)));
    expect(root?.position.x).toBeCloseTo(expected.east, 3);
    expect(root?.position.y).toBeCloseTo(expected.up, 3);
    expect(root?.position.z).toBeCloseTo(expected.north, 3);

    renderer.dispose();
  });

  it("moves roots on a rebase without touching a vertex buffer", () => {
    const renderer = makeRenderer();
    const sectorId = sectorIdAt(HONG_KONG);
    renderer.upload(terrainFor(sectorId));

    const ground = scene.meshes.find((mesh) => mesh.name.startsWith("sector.ground."));
    const verticesBefore = Array.from(ground?.getVerticesData("position") ?? []);
    const root = scene.transformNodes.find((node) => node.name === `sector.${sectorId}`);
    const positionBefore = root?.position.clone();

    const event = origin.forceRebase(geo(22.35, 114.21, 0));
    renderer.rebase();

    expect(Array.from(ground?.getVerticesData("position") ?? [])).toEqual(verticesBefore);

    // The root must land exactly where the world layer says it should, which is
    // through the authoritative geodetic position, not by subtracting a shift.
    const expected = rebaseLocal(
      { east: positionBefore?.x ?? 0, north: positionBefore?.z ?? 0, up: positionBefore?.y ?? 0 },
      event,
    );
    expect(root?.position.x).toBeCloseTo(expected.east, 3);
    expect(root?.position.z).toBeCloseTo(expected.north, 3);

    renderer.dispose();
  });

  it("uses thin instances for city cells rather than one mesh each", () => {
    const renderer = makeRenderer();
    const terrain = terrainFor(sectorIdAt(HONG_KONG));
    expect(terrain.cityCells.length).toBeGreaterThan(1);
    renderer.upload(terrain);

    // scene.meshes is typed as AbstractMesh; thin instances live on Mesh.
    const buildings = scene.meshes.find((mesh) => mesh.name.startsWith("sector.building.")) as
      Mesh | undefined;
    expect(buildings).toBeDefined();
    expect(buildings?.thinInstanceCount).toBe(terrain.cityCells.length);
    expect(renderer.stats().thinInstances).toBeGreaterThanOrEqual(terrain.cityCells.length);

    renderer.dispose();
  });

  it("builds nothing for city, traffic or landmarks in an empty ocean sector", () => {
    const renderer = makeRenderer();
    const empty = terrainFor(sectorIdAt(geo(-20, -150, 0)));
    expect(empty.cityCells).toHaveLength(0);
    renderer.upload(empty);

    expect(scene.meshes.filter((mesh) => mesh.name.startsWith("sector.building."))).toHaveLength(0);
    expect(scene.meshes.filter((mesh) => mesh.name.startsWith("sector.traffic."))).toHaveLength(0);
    renderer.dispose();
  });

  it("recycles meshes instead of allocating a new set per sector", () => {
    const renderer = makeRenderer();
    const sectorId = sectorIdAt(HONG_KONG);
    renderer.upload(terrainFor(sectorId));
    const afterFirst = scene.meshes.length;

    for (let round = 0; round < 5; round += 1) {
      renderer.release(sectorId);
      renderer.upload(terrainFor(sectorId));
    }

    // Pooling means the mesh count settles rather than climbing with each cycle.
    expect(scene.meshes.length).toBe(afterFirst);
    renderer.dispose();
  });

  it("disables rather than destroys a sleeping sector, and wakes it again", () => {
    const renderer = makeRenderer();
    const sectorId = sectorIdAt(HONG_KONG);
    renderer.upload(terrainFor(sectorId));
    const root = scene.transformNodes.find((node) => node.name === `sector.${sectorId}`);

    renderer.sleep(sectorId);
    expect(root?.isEnabled()).toBe(false);
    expect(renderer.stats().sectorNodes).toBe(1);

    renderer.wake(sectorId);
    expect(root?.isEnabled()).toBe(true);
    renderer.dispose();
  });

  it("tolerates being asked about a sector it does not have", () => {
    const renderer = makeRenderer();
    expect(() => {
      renderer.sleep("+X/0/0");
      renderer.wake("+X/0/0");
      renderer.release("+X/0/0");
    }).not.toThrow();
    renderer.dispose();
  });

  it("leaves the scene as it found it after disposal", async () => {
    const meshesBefore = scene.meshes.length;
    const materialsBefore = scene.materials.length;
    const nodesBefore = scene.transformNodes.length;
    const lightsBefore = scene.lights.length;

    const renderer = makeRenderer();
    const streamer = new SectorStreamer({
      service: new InlineTerrainService(),
      sink: renderer,
      seed: SEED,
      anchors: ANCHORS,
      maxUploadsPerUpdate: 8,
      maxConcurrentGenerations: 8,
    });
    await streamer.pump({ position: HONG_KONG });

    expect(scene.meshes.length).toBeGreaterThan(meshesBefore);
    expect(renderer.stats().sectorNodes).toBeGreaterThan(0);

    streamer.dispose();
    renderer.dispose();

    // Every mesh, material, node and light this milestone creates is accounted for.
    expect(scene.meshes.length).toBe(meshesBefore);
    expect(scene.materials.length).toBe(materialsBefore);
    expect(scene.transformNodes.length).toBe(nodesBefore);
    expect(scene.lights.length).toBe(lightsBefore);
  });

  it("re-uploading the same sector replaces it rather than orphaning meshes", () => {
    const renderer = makeRenderer();
    const sectorId = sectorIdAt(HONG_KONG);
    renderer.upload(terrainFor(sectorId));
    const afterFirst = scene.meshes.length;

    renderer.upload(terrainFor(sectorId));
    expect(scene.meshes.length).toBe(afterFirst);
    expect(renderer.stats().sectorNodes).toBe(1);
    renderer.dispose();
  });

  it("stops accepting uploads once disposed", () => {
    const renderer = makeRenderer();
    renderer.dispose();
    renderer.upload(terrainFor(sectorIdAt(HONG_KONG)));
    expect(renderer.stats().sectorNodes).toBe(0);
  });
});

describe("sector water", () => {
  const climates = createClimateRegistry();

  function sampleAt(tick: number) {
    const environment = new EnvironmentSystem({
      seed: SEED,
      profile: climates.getOrThrow("oceanic"),
    });
    environment.setTicks(tick, HONG_KONG.latitudeDeg);
    return environment.sample({ position: HONG_KONG, groundHeightMeters: -400 });
  }

  function waterHeights(scene: Scene): number[] {
    const mesh = scene.meshes.find((entry) => entry.name.startsWith("sector.water."));
    const positions = mesh?.getVerticesData("position");
    if (!positions) return [];
    const heights: number[] = [];
    for (let index = 1; index < positions.length; index += 3) heights.push(positions[index] ?? 0);
    return heights;
  }

  it("builds a water sheet at the resolution the quality preset asks for", () => {
    const renderer = makeRenderer();
    const coastal = terrainFor(sectorIdAt(HONG_KONG));
    expect(coastal.waterFraction).toBeGreaterThan(0);
    renderer.upload(coastal);

    const heights = waterHeights(scene);
    expect(heights.length).toBe(quality.waterGridResolution ** 2);
    renderer.dispose();
  });

  it("moves the surface as the world clock advances", () => {
    const renderer = makeRenderer();
    renderer.upload(terrainFor(sectorIdAt(HONG_KONG)));
    const player = { east: 0, north: 0 };

    renderer.updateWater(sampleAt(1_000), player);
    const first = waterHeights(scene);
    renderer.updateWater(sampleAt(1_030), player);
    const second = waterHeights(scene);

    expect(first.length).toBe(second.length);
    // A flat sheet would be identical at both ticks; a wave field is not.
    expect(second.some((value, index) => Math.abs(value - (first[index] ?? 0)) > 0.01)).toBe(true);
    renderer.dispose();
  });

  it("gives the same surface for the same tick, so it is not drifting on its own", () => {
    const renderer = makeRenderer();
    renderer.upload(terrainFor(sectorIdAt(HONG_KONG)));
    const player = { east: 0, north: 0 };

    renderer.updateWater(sampleAt(2_000), player);
    const first = waterHeights(scene);
    renderer.updateWater(sampleAt(9_999), player);
    renderer.updateWater(sampleAt(2_000), player);
    expect(waterHeights(scene)).toEqual(first);
    renderer.dispose();
  });

  it("stays inside the wave amplitude the weather justifies", () => {
    const renderer = makeRenderer();
    renderer.upload(terrainFor(sectorIdAt(HONG_KONG)));
    const sample = sampleAt(4_321);
    renderer.updateWater(sample, { east: 0, north: 0 });

    for (const height of waterHeights(scene)) {
      expect(Math.abs(height)).toBeLessThanOrEqual(sample.waveAmplitudeMeters + 1e-6);
    }
    renderer.dispose();
  });

  it("animates only as many sheets as the preset budgets, nearest first", async () => {
    const low = createQualityRegistry().getOrThrow("low");
    expect(low.animatedWaterSectors).toBe(1);

    const renderer = new SectorRenderer({ scene, anchor: () => origin.anchor, quality: low });
    const streamer = new SectorStreamer({
      service: new InlineTerrainService(),
      sink: renderer,
      seed: SEED,
      anchors: ANCHORS,
      maxUploadsPerUpdate: 8,
      maxConcurrentGenerations: 8,
    });
    await streamer.pump({ position: HONG_KONG });

    const sheets = scene.meshes.filter((entry) => entry.name.startsWith("sector.water."));
    expect(sheets.length).toBeGreaterThan(1);

    const before = sheets.map((mesh) => Array.from(mesh.getVerticesData("position") ?? []));
    renderer.updateWater(sampleAt(5_000), { east: 0, north: 0 });
    const after = sheets.map((mesh) => Array.from(mesh.getVerticesData("position") ?? []));

    const changed = before.filter((positions, index) =>
      positions.some((value, at) => Math.abs(value - (after[index]?.[at] ?? 0)) > 0.01),
    ).length;
    expect(changed).toBe(low.animatedWaterSectors);

    streamer.dispose();
    renderer.dispose();
  });

  it("ignores water updates once disposed", () => {
    const renderer = makeRenderer();
    renderer.upload(terrainFor(sectorIdAt(HONG_KONG)));
    renderer.dispose();
    expect(() => renderer.updateWater(sampleAt(10), { east: 0, north: 0 })).not.toThrow();
  });
});
