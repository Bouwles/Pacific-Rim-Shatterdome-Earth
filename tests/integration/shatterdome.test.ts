import { NullEngine, Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFacilityRegistry } from "../../src/data/facilities";
import { CREW_MEMBERS } from "../../src/data/personnel";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createQualityRegistry } from "../../src/data/quality";
import { createDefaultAssetRegistry } from "../../src/data/assets";
import { AssetResolver } from "../../src/assets/resolver";
import { createGeneratorRegistry } from "../../src/assets/generators";
import { InteriorView } from "../../src/engine/interiorView";
import { ShatterdomeState } from "../../src/shatterdome/facilityState";
import { ShatterdomeSession } from "../../src/shatterdome/session";
import { CONN_POD_ROOM_ID, roomById } from "../../src/shatterdome/interiorLayout";
import { poseAt } from "../../src/shatterdome/onFoot";
import {
  createScenarioSession,
  runShatterdomeScenario,
  settle,
  walkToInteractable,
} from "../../src/debug/shatterdomeScenario";
import { SimulationKernel } from "../../src/simulation/kernel";
import { SaveService } from "../../src/saves/saveService";
import { MemorySaveRepository } from "../../src/saves/repository";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION, validateRootSave } from "../../src/saves/schema";
import { WORLD_SCHEMA_VERSION } from "../../src/world/worldState";
import { emptyEnvironmentSnapshot } from "../../src/world/environment";
import { initialAlertState } from "../../src/world/cityActivity";

const SEED = 20260824;
const quality = createQualityRegistry().getOrThrow("high");
const assets = createDefaultAssetRegistry();

function freshSession(): ShatterdomeSession {
  return createScenarioSession(SEED);
}

describe("the walk from command to a Conn-Pod", () => {
  it("walks the whole acceptance path without a single teleport", () => {
    const result = runShatterdomeScenario({ seed: SEED });
    expect(result.roomsVisited).toEqual([
      "command",
      "quarters",
      "jaeger-bay",
      CONN_POD_ROOM_ID,
      "jaeger-bay",
    ]);
    expect(result.steps.every((step) => step.reached)).toBe(true);
    // Every leg took real time, which is what proves it was walked.
    expect(result.steps.filter((step) => step.seconds > 0).length).toBeGreaterThan(3);
    expect(result.finalRoomId).toBe("jaeger-bay");
  });

  it("inspects a real machine from the roster on the way through", () => {
    const result = runShatterdomeScenario({ seed: SEED });
    expect(result.inspectedJaegerId).not.toBeNull();
    expect(jaegerRegistry.has(result.inspectedJaegerId ?? "")).toBe(true);
  });

  it("places a build order at the terminal and reports it on the radio", () => {
    const result = runShatterdomeScenario({ seed: SEED });
    expect(result.orderPlaced).toBe(true);
    expect(result.orderRefusal).toBeNull();
    expect(result.radioLines).toBeGreaterThan(0);
  });

  it("digests identically across runs of the same seed", () => {
    expect(runShatterdomeScenario({ seed: SEED }).digest).toBe(runShatterdomeScenario({ seed: SEED }).digest);
  });

  it("takes a person about as long to cross a Jaeger bay as a person should", () => {
    const result = runShatterdomeScenario({ seed: SEED });
    const berthLeg = result.steps.find((step) => step.label === "berth");
    // A hundred metre bay at walking pace: tens of seconds, not one and not five hundred.
    expect(berthLeg?.seconds ?? 0).toBeGreaterThan(5);
    expect(berthLeg?.seconds ?? 0).toBeLessThan(120);
  });
});

describe("session behaviour", () => {
  it("only changes room at the darkest point of a transition", () => {
    const session = freshSession();
    const walk = walkToInteractable(
      session,
      (entry) => entry.kind === "transit" && entry.targetRoomId === "quarters",
      0,
      90,
    );
    expect(walk.reached).toBe(true);
    const outcome = session.interact();
    expect(outcome.kind).toBe("transit");
    // Still in command, with the screen going dark.
    expect(session.currentRoom.id).toBe("command");
    expect(session.transition?.swapped).toBe(false);
    settle(session, walk.ticks, 4);
    expect(session.currentRoom.id).toBe("quarters");
    expect(session.transition).toBeNull();
    expect(session.fade).toBe(0);
  });

  it("refuses a sealed door and says which facility is missing", () => {
    const session = freshSession();
    const sealed = session.currentRoom.interactables.find((entry) => entry.sealedReason !== null);
    if (!sealed) throw new Error("command has no sealed door to test");
    session.cycleFocus();
    let focus = session.focus;
    let guard = 0;
    while (focus?.interactable.id !== sealed.id && guard < 40) {
      focus = session.cycleFocus();
      guard += 1;
    }
    const outcome = session.interact();
    expect(outcome.kind).toBe("sealed");
    if (outcome.kind === "sealed") expect(outcome.message).toMatch(/has not been built/);
  });

  it("keeps the player where they are when an order is refused, and says why", () => {
    const session = freshSession();
    session.orderUpgrade("research");
    session.orderUpgrade("archive");
    session.orderUpgrade("contract");
    const refused = session.orderUpgrade("training");
    expect(refused.ok).toBe(false);
    expect(session.radioLog.at(-1)?.text).toMatch(/refused/);
  });

  it("changes the room the moment an order lands, scaffolds and all", () => {
    const session = freshSession();
    const before = session.revision;
    session.orderUpgrade("logistics");
    expect(session.revision).toBeGreaterThan(before);
    const logistics = roomById(session.layout, "logistics");
    expect(logistics?.underConstruction).toBe(true);
  });

  it("finishes a build while the player is in another room", () => {
    const session = freshSession();
    const order = session.state.order("research");
    if (!order.ok) throw new Error("order refused");
    session.update({
      deltaSeconds: 1 / 60,
      ticks: order.record.workRemainingTicks,
      tick: order.record.workRemainingTicks,
      dayFraction: 0.5,
      timeLabel: "12:00",
      input: { forward: 0, strafe: 0, run: false, crouch: false, yawDeltaDeg: 0, pitchDeltaDeg: 0 },
      outsideEffects: {
        visibilityMeters: 10_000,
        tractionMultiplier: 1,
        movementMultiplier: 1,
        windPushMps: 0,
        rangedAccuracyPenalty: 0,
        hazardous: false,
      },
    });
    expect(session.state.isOperational("research")).toBe(true);
    expect(session.radioLog.some((line) => /Kaiju Research is built/.test(line.text))).toBe(true);
    // And the room it built now exists to walk into.
    expect(roomById(session.layout, "research")).toBeDefined();
  });

  it("speaks to a named character and gets live facility state back", () => {
    const session = freshSession();
    const walk = walkToInteractable(session, (entry) => entry.crewId === "crew.marshal", 0, 90);
    expect(walk.reached).toBe(true);
    const outcome = session.interact();
    expect(outcome.kind).toBe("spoke");
    if (outcome.kind === "spoke") {
      expect(outcome.line.speaker).toMatch(/Okonjo/);
      expect(outcome.line.text).not.toMatch(/[{}]/);
    }
  });

  it("always puts an unstuck player somewhere they fit", () => {
    const session = freshSession();
    session.unstuck();
    const room = session.currentRoom;
    expect(Math.abs(session.pose.x)).toBeLessThan(room.widthMeters / 2);
    expect(session.pose.speedMps).toBe(0);
    expect(session.radioLog.at(-1)?.text).toMatch(/Position reset/);
  });

  it("writes the player's position back so a reload puts them where they stood", () => {
    const session = freshSession();
    const walk = walkToInteractable(session, (entry) => entry.kind === "terminal", 0, 90);
    expect(walk.reached).toBe(true);
    const location = session.state.playerLocation;
    expect(location.roomId).toBe("command");
    expect(Math.hypot(location.x - session.pose.x, location.z - session.pose.z)).toBeLessThan(1e-9);
  });
});

describe("saves", () => {
  it("round-trips a complex with a build running, and keeps building after the load", async () => {
    const kernel = new SimulationKernel({ seed: SEED });
    const service = new SaveService({ repository: new MemorySaveRepository() });
    const definitions = createFacilityRegistry();
    const state = new ShatterdomeState(definitions);
    const order = state.order("research");
    if (!order.ok) throw new Error("order refused");
    state.advance(1_200);
    state.setPlayerLocation({ roomId: "jaeger-bay", x: 3, z: -20, yawDeg: 45 });
    state.selectJaeger("heavy-mk4");

    await service.save("slot.a", kernel, { name: "interior", shatterdome: state.serialize() });
    const loaded = await service.load("slot.a");
    expect(validateRootSave(loaded.document)).toEqual([]);

    const restored = new ShatterdomeState(createFacilityRegistry());
    restored.restore(
      loaded.document.shatterdome,
      new Set([...definitions.all().map((d) => d.id), CONN_POD_ROOM_ID]),
    );
    expect(restored.recordFor("research")?.status).toBe("building");
    expect(restored.playerLocation.roomId).toBe("jaeger-bay");
    expect(restored.selectedJaegerId).toBe("heavy-mk4");

    // The session comes back standing where it was, and the build completes.
    const session = new ShatterdomeSession({
      state: restored,
      definitions: createFacilityRegistry(),
      crew: CREW_MEMBERS,
      berths: jaegerRegistry.all().map((j) => ({ jaegerId: j.id, displayName: j.name })),
      seed: SEED,
    });
    expect(session.currentRoom.id).toBe("jaeger-bay");
    expect(session.pose.x).toBeCloseTo(3, 5);
    restored.advance(999_999);
    expect(restored.isOperational("research")).toBe(true);
  });

  it("keeps a facility built before the save built after it, scaffolds gone", async () => {
    const kernel = new SimulationKernel({ seed: SEED });
    const service = new SaveService({ repository: new MemorySaveRepository() });
    const state = new ShatterdomeState(createFacilityRegistry());
    const order = state.order("research");
    if (!order.ok) throw new Error("order refused");
    state.advance(order.record.workRemainingTicks);

    await service.save("slot.b", kernel, { name: "built", shatterdome: state.serialize() });
    const loaded = await service.load("slot.b");
    const restored = new ShatterdomeState(createFacilityRegistry());
    restored.restore(loaded.document.shatterdome, new Set(["research", "command", CONN_POD_ROOM_ID]));
    const session = new ShatterdomeSession({
      state: restored,
      definitions: createFacilityRegistry(),
      crew: CREW_MEMBERS,
      berths: [],
      seed: SEED,
    });
    const research = roomById(session.layout, "research");
    expect(research).toBeDefined();
    expect(research?.underConstruction).toBe(false);
    expect(research?.obstacles.some((obstacle) => obstacle.kind === "scaffold")).toBe(false);
    expect(research?.fixtureCount).toBeGreaterThan(0);
  });

  it("migrates a version 4 save into a fresh complex on the command floor", () => {
    const legacy = {
      schemaVersion: 4,
      savedAt: 1_700_000_000_000,
      metadata: {
        name: "before the interior",
        worldSeed: SEED,
        playTimeMs: 1_000,
        lastPlayedAt: 1_700_000_000_000,
        simTick: 10,
        appVersion: "0.7.0",
        thumbnail: null,
      },
      sim: {
        schemaVersion: 1,
        seed: SEED,
        tick: 10,
        entities: { schemaVersion: 1, nextId: 1, entities: [] },
      },
      world: {
        schemaVersion: WORLD_SCHEMA_VERSION,
        playerPosition: { latitudeDeg: 22.3193, longitudeDeg: 114.1694, altitudeMeters: 0 },
        activeRegionId: "hong-kong",
        activeSectorId: "+X/8/9",
        regions: [
          {
            regionId: "hong-kong",
            tier: "active" as const,
            integrity: 0.9,
            safetyRating: 0.8,
            lastVisitedTick: 10,
            alert: initialAlertState(),
          },
        ],
        environment: emptyEnvironmentSnapshot(),
      },
    };

    const result = migrateSave(legacy);
    expect(result.applied).toEqual(["4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(validateRootSave(result.document)).toEqual([]);
    expect(result.document.shatterdome.location.roomId).toBe("command");
    const command = result.document.shatterdome.facilities.find((f) => f.facilityId === "command");
    expect(command?.status).toBe("operational");
    // Nothing else in the file was disturbed.
    expect(result.document.world.regions[0]?.integrity).toBe(0.9);
  });
});

describe("the interior, drawn", () => {
  let engine: NullEngine;
  let scene: Scene;
  let view: InteriorView | undefined;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });

  afterEach(() => {
    view?.dispose();
    view = undefined;
    scene.dispose();
    engine.dispose();
  });

  function makeView(): InteriorView {
    return new InteriorView({
      scene,
      quality,
      resolver: new AssetResolver(createGeneratorRegistry(), () => undefined),
      assets,
      berthAssets: jaegerRegistry.all().map((jaeger) => jaeger.assetId),
    });
  }

  it("builds one room and only one room", async () => {
    const session = freshSession();
    view = makeView();
    await view.setRoom(session.currentRoom);
    expect(view.activeRoomId).toBe("command");
    const stats = view.stats();
    expect(stats.meshes).toBeGreaterThan(5);
    // The Jaeger bay is a hundred metres across and is not in this scene at all.
    expect(scene.meshes.some((mesh) => mesh.name.includes("jaeger-bay"))).toBe(false);
  });

  it("swaps rooms without leaking the one it left", async () => {
    const session = freshSession();
    view = makeView();
    await view.setRoom(session.currentRoom);
    const afterFirst = scene.meshes.length;
    const bay = roomById(session.layout, "jaeger-bay");
    if (!bay) throw new Error("no bay");
    await view.setRoom(bay);
    expect(view.activeRoomId).toBe("jaeger-bay");
    expect(scene.meshes.some((mesh) => mesh.name.includes("command"))).toBe(false);
    // The bay carries two resolved machines, so it is heavier, not lighter.
    expect(scene.meshes.length).toBeGreaterThan(afterFirst - 4);
    expect(view.stats().jaegerModels).toBe(2);
  });

  it("stands the roster machines in the berths through the asset pipeline", async () => {
    const session = freshSession();
    const bay = roomById(session.layout, "jaeger-bay");
    if (!bay) throw new Error("no bay");
    view = makeView();
    await view.setRoom(bay);
    // One model per berth, not one per roster entry: a tier 1 bay has two
    // berths, and Milestone 09 added a third machine to the roster. A bay that
    // stood every machine it knew about would be reporting capacity it has not
    // built.
    const berths = bay.interactables.filter((entry) => entry.kind === "berth").length;
    expect(view.stats().jaegerModels).toBe(berths);
    expect(view.stats().jaegerModels).toBeLessThanOrEqual(jaegerRegistry.all().length);
  });

  it("draws no more staff than the quality budget, however many are on shift", async () => {
    const session = freshSession();
    view = new InteriorView({
      scene,
      quality: createQualityRegistry().getOrThrow("low"),
      resolver: new AssetResolver(createGeneratorRegistry(), () => undefined),
      assets,
      berthAssets: [],
    });
    await view.setRoom(session.currentRoom);
    view.update(poseAt({ x: 0, z: 0 }), 500, 0.5);
    const stats = view.stats();
    expect(stats.staffDrawn).toBeLessThanOrEqual(stats.staffBudget);
    expect(stats.staffDrawn).toBeGreaterThan(0);
  });

  it("returns the scene to exactly what it found on disposal", async () => {
    const session = freshSession();
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    const lights = scene.lights.length;
    const cameras = scene.cameras.length;
    const nodes = scene.transformNodes.length;

    const local = makeView();
    const bay = roomById(session.layout, "jaeger-bay");
    if (!bay) throw new Error("no bay");
    await local.setRoom(session.currentRoom);
    await local.setRoom(bay);
    local.update(poseAt({ x: 0, z: 0 }), 10, 0.5);
    local.dispose();

    expect(scene.meshes.length).toBe(meshes);
    expect(scene.materials.length).toBe(materials);
    expect(scene.lights.length).toBe(lights);
    expect(scene.cameras.length).toBe(cameras);
    expect(scene.transformNodes.length).toBe(nodes);
  });

  it("puts the camera at a person's eye height, not on a crane", async () => {
    const session = freshSession();
    view = makeView();
    await view.setRoom(session.currentRoom);
    view.update({ ...poseAt({ x: 2, z: -3 }, 90), crouched: false }, 0, 0.5);
    const camera = scene.activeCamera;
    expect(camera?.position.y).toBeCloseTo(1.68, 2);
    expect(camera?.position.x).toBeCloseTo(2, 5);
  });
});
