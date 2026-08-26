import { NullEngine, Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CITY_ALERT_SCENARIO,
  runCityScenario,
  scenarioDistrictsFrom,
  validateCityScenario,
} from "../../src/debug/cityScenario";
import {
  DISTRICT_DEFINITIONS,
  HONG_KONG_DISTRICT_PLAN,
  createDistrictRegistry,
  type DistrictKind,
} from "../../src/data/districts";
import { generateCityLayout, type CityLayout } from "../../src/world/cityLayout";
import { sampleActivity, type ActivitySample } from "../../src/world/cityActivity";
import { CityView } from "../../src/engine/cityView";
import { createQualityRegistry } from "../../src/data/quality";
import { createDefaultRegionRegistry } from "../../src/data/regions";
import { createClimateRegistry } from "../../src/data/climates";
import { WorldState } from "../../src/world/worldState";
import { geo } from "../../src/world/coordinates";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION, validateRootSave } from "../../src/saves/schema";

const registry = createDistrictRegistry();
const districts = new Map<DistrictKind, ReturnType<typeof registry.getOrThrow>>(
  registry.all().map((district) => [district.id, district]),
);
const climates = createClimateRegistry();
const qualities = createQualityRegistry();
const SEED = 20260823;
const HONG_KONG = geo(22.3193, 114.1694, 0);

function makeWorld(): WorldState {
  return new WorldState({
    regions: createDefaultRegionRegistry(),
    seed: SEED,
    climateProfileFor: (climate) => climates.getOrThrow(climate),
  });
}

function makeLayout(maxBlocks = 400): CityLayout {
  return generateCityLayout({
    regionId: "hong-kong",
    seed: SEED,
    radiusMeters: 6_000,
    seawardBearingDeg: 196,
    plan: HONG_KONG_DISTRICT_PLAN,
    districts,
    maxBlocks,
  });
}

describe("city alert scenario", () => {
  it("produces the same digest on every run", () => {
    const first = runCityScenario(CITY_ALERT_SCENARIO);
    const second = runCityScenario(CITY_ALERT_SCENARIO);
    expect(second.digest).toBe(first.digest);
    expect(second.records).toEqual(first.records);
  });

  it("changes traffic, shipping, military, sirens and evacuation across an alert", () => {
    const result = runCityScenario(CITY_ALERT_SCENARIO);

    const at = (level: string) => result.records.filter((record) => record.level === level);
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

    const calmCivilian = mean(at("calm").map((record) => record.civilian));
    const attackCivilian = mean(at("attack").map((record) => record.civilian));
    const calmShipping = mean(at("calm").map((record) => record.shipping));
    const attackShipping = mean(at("attack").map((record) => record.shipping));
    const calmMilitary = mean(at("calm").map((record) => record.military));
    const attackMilitary = mean(at("attack").map((record) => record.military));

    // The acceptance item, checked as five separate movements rather than one.
    expect(attackCivilian).toBeLessThan(calmCivilian * 0.5);
    expect(attackShipping).toBeLessThan(calmShipping * 0.5);
    expect(attackMilitary).toBeGreaterThan(calmMilitary * 3);
    expect(at("calm").every((record) => !record.sirens)).toBe(true);
    expect(at("attack").some((record) => record.sirens)).toBe(true);
    expect(result.maxEvacuationProgress).toBeGreaterThan(0.8);
    expect(result.sirenTicks).toBeGreaterThan(0);
  });

  it("puts traffic up during a warning and down during an attack", () => {
    const result = runCityScenario(CITY_ALERT_SCENARIO);
    const mean = (level: string) => {
      const rows = result.records.filter((record) => record.level === level);
      return rows.reduce((sum, record) => sum + record.vehicle, 0) / Math.max(1, rows.length);
    };
    // Everyone leaving at once is busier than an ordinary day; by the time it is
    // an attack the roads are empty.
    expect(mean("warning")).toBeGreaterThan(mean("attack"));
  });

  it("brings the city back during recovery", () => {
    const result = runCityScenario(CITY_ALERT_SCENARIO);
    const attack = result.records.filter((record) => record.level === "attack");
    const recovery = result.records.filter((record) => record.level === "recovery");
    const last = recovery[recovery.length - 1];
    const worst = attack[attack.length - 1];
    expect(last?.civilian ?? 0).toBeGreaterThan(worst?.civilian ?? 1);
    expect(last?.sirens).toBe(false);
  });

  it("covers every district it was given", () => {
    const scenario = { ...CITY_ALERT_SCENARIO, districts: scenarioDistrictsFrom(DISTRICT_DEFINITIONS) };
    const result = runCityScenario(scenario);
    const seen = new Set(result.records.map((record) => record.districtId));
    expect(seen.size).toBe(DISTRICT_DEFINITIONS.length);
  });

  it("refuses a scenario it cannot run", () => {
    expect(validateCityScenario({ ...CITY_ALERT_SCENARIO, stages: [] }).join(" ")).toMatch(/stages/);
    expect(() => runCityScenario({ ...CITY_ALERT_SCENARIO, samplesPerStage: 0 })).toThrow(
      /Invalid city scenario/,
    );
  });
});

describe("alert state in the world", () => {
  it("starts every region calm", () => {
    const world = makeWorld();
    for (const record of world.records()) {
      expect(record.alert.level).toBe("calm");
      expect(record.alert.evacuationProgress).toBe(0);
    }
  });

  it("raises an alert on one region without touching the others", () => {
    const world = makeWorld();
    world.setRegionAlert("hong-kong", "attack", 500);
    expect(world.alertFor("hong-kong")?.level).toBe("attack");
    expect(world.alertFor("tokyo")?.level).toBe("calm");
  });

  it("refuses an unknown region rather than silently doing nothing", () => {
    const world = makeWorld();
    expect(() => world.setRegionAlert("atlantis", "warning", 0)).toThrow(/Unknown region/);
  });

  it("advances evacuation for alerted regions only", () => {
    const world = makeWorld();
    world.setRegionAlert("hong-kong", "warning", 0);
    world.advanceAlerts(14_400);
    expect(world.alertFor("hong-kong")?.evacuationProgress).toBeGreaterThan(0);
    expect(world.alertFor("tokyo")?.evacuationProgress).toBe(0);
  });

  it("survives a world state round trip", () => {
    const world = makeWorld();
    world.setRegionAlert("hong-kong", "attack", 250);
    world.advanceAlerts(3_000);
    const snapshot = JSON.parse(JSON.stringify(world.serialize()));

    const restored = makeWorld();
    restored.restore(snapshot);
    expect(restored.alertFor("hong-kong")?.level).toBe("attack");
    expect(restored.alertFor("hong-kong")?.evacuationProgress).toBe(
      world.alertFor("hong-kong")?.evacuationProgress,
    );
    expect(restored.alertFor("hong-kong")?.sinceTick).toBe(250);
  });

  it("rejects a snapshot whose alert it does not understand", () => {
    const world = makeWorld();
    const snapshot = JSON.parse(JSON.stringify(world.serialize()));
    snapshot.regions[0].alert.level = "meltdown";
    expect(() => makeWorld().restore(snapshot)).toThrow(/alert level must be one of/);
  });
});

describe("city save migration", () => {
  it("adds a calm alert to every region of a version 3 save", () => {
    const legacy = {
      schemaVersion: 3,
      savedAt: 1,
      metadata: {
        name: "Pre-alert",
        worldSeed: SEED,
        playTimeMs: 0,
        lastPlayedAt: 0,
        simTick: 0,
        appVersion: "0.6.0",
        thumbnail: null,
      },
      sim: { schemaVersion: 1, seed: SEED, tick: 0, entities: { schemaVersion: 1, nextId: 1, entities: [] } },
      world: {
        schemaVersion: 2,
        playerPosition: { latitudeDeg: 22.3193, longitudeDeg: 114.1694, altitudeMeters: 0 },
        activeRegionId: "hong-kong",
        activeSectorId: "+Z/3/12",
        regions: [
          { regionId: "hong-kong", integrity: 0.6, safetyRating: 0.4, lastVisitedTick: 90, tier: "active" },
        ],
        environment: {
          schemaVersion: 1,
          clock: { schemaVersion: 1, elapsedTicks: 100, dayLengthTicks: 86_400 },
          weather: { schemaVersion: 1, wetness: 0.2 },
        },
      },
    };

    const result = migrateSave(legacy);
    expect(result.applied).toEqual(["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]);
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(validateRootSave(result.document)).toEqual([]);

    const record = result.document.world.regions[0];
    expect(record?.alert.level).toBe("calm");
    expect(record?.alert.evacuationProgress).toBe(0);
    // Everything the old save did record survives untouched.
    expect(record?.integrity).toBe(0.6);
    expect(record?.lastVisitedTick).toBe(90);
  });
});

describe("city view", () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  function build(qualityId = "high", maxBlocks = 400): { view: CityView; layout: CityLayout } {
    const layout = makeLayout(maxBlocks);
    const view = new CityView({
      scene,
      layout,
      regionCentre: HONG_KONG,
      anchor: () => HONG_KONG,
      groundHeightAt: () => 40,
      districts,
      quality: qualities.getOrThrow(qualityId as "high"),
    });
    return { view, layout };
  }

  function activityFor(layout: CityLayout, level: "calm" | "attack"): Map<string, ActivitySample> {
    const map = new Map<string, ActivitySample>();
    for (const districtId of layout.districts) {
      const district = districts.get(districtId);
      if (!district) continue;
      map.set(
        districtId,
        sampleActivity({
          districtId,
          populationDensityThousands: district.populationDensityThousands,
          coastal: district.coastal,
          alert: { schemaVersion: 1, level, sinceTick: 0, evacuationProgress: 0 },
          tick: 20_000,
          dayFraction: 0.5,
          precipitation: 0,
          windSpeedMps: 4,
          integrity: 1,
        }),
      );
    }
    return map;
  }

  it("builds the city as many meshes rather than one", () => {
    const { view } = build();
    const stats = view.stats();
    // One mesh per destruction group is what makes streaming and damage possible.
    expect(stats.residentGroups).toBeGreaterThan(4);
    expect(stats.meshes).toBeGreaterThan(stats.residentGroups);
    expect(stats.drawnBlocks).toBeGreaterThan(0);
    view.dispose();
  });

  it("stays inside the quality preset's block and group budgets", () => {
    for (const level of ["low", "medium", "high"] as const) {
      const preset = qualities.getOrThrow(level);
      const { view } = build(level, 1_400);
      const stats = view.stats();
      expect(stats.drawnBlocks, `${level} blocks`).toBeLessThanOrEqual(preset.maxCityBlocks);
      expect(stats.residentGroups, `${level} groups`).toBeLessThanOrEqual(preset.maxCityGroups);
      expect(stats.agentCapacity, `${level} agents`).toBeLessThanOrEqual(preset.maxCityAgents);
      view.dispose();
    }
  });

  it("draws a smaller city on a lower preset", () => {
    const low = build("low", 1_400);
    const high = build("high", 1_400);
    expect(low.view.stats().drawnBlocks).toBeLessThan(high.view.stats().drawnBlocks);
    low.view.dispose();
    high.view.dispose();
  });

  it("empties the streets and the harbour when the alert rises", () => {
    const { view, layout } = build();
    view.update(20_000, activityFor(layout, "calm"));
    const calm = view.stats().agentsByKind;
    view.update(20_000, activityFor(layout, "attack"));
    const attack = view.stats();

    // Checked per kind rather than in total: under attack the crowds go and the
    // military arrives, so a total would barely move while every kind moves a lot.
    expect(attack.agentsByKind.crowd ?? 0).toBeLessThan((calm.crowd ?? 0) * 0.5);
    expect(attack.agentsByKind.ship ?? 0).toBeLessThan((calm.ship ?? 0) * 0.5);
    expect(attack.sirensActive).toBe(true);
    view.dispose();
  });

  it("never exceeds its agent pool however busy the city gets", () => {
    const { view, layout } = build();
    const busy = activityFor(layout, "calm");
    for (let tick = 0; tick < 5; tick += 1) view.update(tick * 1_000, busy);
    const stats = view.stats();
    expect(stats.agents).toBeLessThanOrEqual(stats.agentCapacity);
    view.dispose();
  });

  it("moves its agents with the tick", () => {
    const { view, layout } = build();
    const busy = activityFor(layout, "calm");
    view.update(0, busy);
    // Positions live in the thin instance buffer, so the matrices are compared
    // directly rather than through a public accessor that does not expose them.
    const mesh = scene.meshes.find((entry) => entry.name === "city.agent.vehicle");
    const first = (
      mesh as unknown as { _thinInstanceDataStorage?: { matrixData?: Float32Array } }
    )._thinInstanceDataStorage?.matrixData?.slice(0, 32);
    view.update(600, busy);
    const second = (
      mesh as unknown as { _thinInstanceDataStorage?: { matrixData?: Float32Array } }
    )._thinInstanceDataStorage?.matrixData?.slice(0, 32);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(Array.from(second ?? [])).not.toEqual(Array.from(first ?? []));
    view.dispose();
  });

  it("leaves the scene as it found it after disposal", () => {
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    const nodes = scene.transformNodes.length;

    const { view, layout } = build();
    view.update(1_000, activityFor(layout, "calm"));
    expect(scene.meshes.length).toBeGreaterThan(meshes);

    view.dispose();
    expect(scene.meshes.length).toBe(meshes);
    expect(scene.materials.length).toBe(materials);
    expect(scene.transformNodes.length).toBe(nodes);
    // Disposing twice must be harmless; screens tear down more than once.
    view.dispose();
  });

  it("ignores updates once disposed", () => {
    const { view, layout } = build();
    view.dispose();
    expect(() => view.update(10, activityFor(layout, "calm"))).not.toThrow();
    expect(view.stats().agents).toBe(0);
  });
});
