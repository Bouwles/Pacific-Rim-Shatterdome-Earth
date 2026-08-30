import { NullEngine, Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createDefaultAssetRegistry } from "../../src/data/assets";
import { createQualityRegistry } from "../../src/data/quality";
import { AssetResolver } from "../../src/assets/resolver";
import { createGeneratorRegistry } from "../../src/assets/generators";
import { JaegerView } from "../../src/engine/jaegerView";
import { PilotSession } from "../../src/jaegers/pilotSession";
import { NEUTRAL_JAEGER_INPUT, spawnPose } from "../../src/jaegers/locomotion";
import { COURSE_IDS, runAllCourses, runCourse } from "../../src/debug/jaegerScenario";

const STANDARD = jaegerRegistry.getOrThrow("placeholder-mk0");
const HEAVY = jaegerRegistry.getOrThrow("heavy-mk4");
const AGILE = jaegerRegistry.getOrThrow("agile-mk5");

describe("the locomotion courses", () => {
  it("crosses the city course without snagging on debris", () => {
    const result = runCourse({ courseId: "city", seconds: 40 });
    // The tower is the only thing that may stop it, and it is at the far end.
    expect(result.blockedFrames).toBe(0);
    expect(result.distanceMeters).toBeGreaterThan(500);
    expect(result.statesVisited).toContain("run");
  });

  it("does not skate: measured stride matches the profile's own stride", () => {
    for (const jaegerId of ["placeholder-mk0", "heavy-mk4", "agile-mk5"]) {
      const result = runCourse({ courseId: "city", jaegerId, seconds: 40 });
      expect(result.footfalls).toBeGreaterThan(5);
      const error = Math.abs(result.measuredStrideMeters - result.declaredStrideMeters);
      expect(error / result.declaredStrideMeters).toBeLessThan(0.05);
    }
  });

  it("never exceeds the machine's own speed ceiling", () => {
    for (const courseId of COURSE_IDS) {
      const result = runCourse({ courseId, seconds: 30, boosterAtSeconds: [2, 12, 22] });
      // One tick of the faster acceleration can land on top of a booster burst.
      expect(result.peakSpeedMps).toBeLessThanOrEqual(result.speedCeilingMps + 1.0);
    }
  });

  it("stops at the tower rather than walking through it", () => {
    const result = runCourse({ courseId: "city", seconds: 200 });
    expect(result.blockedFrames).toBeGreaterThan(0);
  });

  it("goes from dry ground to swimming down the coast course", () => {
    const result = runCourse({ courseId: "coast", seconds: 120 });
    expect(result.statesVisited).toContain("wade");
    expect(result.statesVisited.some((state) => state === "swim" || state === "underwater")).toBe(true);
    expect(result.finalWaterState).not.toBe("dry");
  });

  it("swims in open water with nothing under the feet", () => {
    const result = runCourse({ courseId: "ocean", seconds: 20 });
    expect(result.finalWaterState).toBe("swimming");
    expect(result.eventCounts["footfall"] ?? 0).toBe(0);
  });

  it("is deterministic: the same course twice gives the same digest", () => {
    const first = runCourse({ courseId: "city", seconds: 20 });
    const second = runCourse({ courseId: "city", seconds: 20 });
    expect(second.digest).toBe(first.digest);
  });

  it("gives a different machine a different run over the same ground", () => {
    const standard = runCourse({ courseId: "city", jaegerId: "placeholder-mk0", seconds: 30 });
    const heavy = runCourse({ courseId: "city", jaegerId: "heavy-mk4", seconds: 30 });
    const agile = runCourse({ courseId: "city", jaegerId: "agile-mk5", seconds: 30 });
    expect(heavy.distanceMeters).toBeLessThan(standard.distanceMeters);
    expect(agile.distanceMeters).toBeGreaterThan(standard.distanceMeters);
    expect(new Set([standard.digest, heavy.digest, agile.digest]).size).toBe(3);
  });

  it("runs every course for every shipped machine", () => {
    for (const entry of jaegerRegistry.all()) {
      const results = runAllCourses(entry.id);
      expect(results).toHaveLength(COURSE_IDS.length);
      for (const result of results) expect(result.distanceMeters).toBeGreaterThan(0);
    }
  });

  it("refuses an unknown course by name", () => {
    expect(() => runCourse({ courseId: "moon" as never })).toThrow(/Known courses/);
  });
});

describe("a pilot session", () => {
  const flat = (): number => 0;

  it("drives, reports and survives a rebase without moving the machine", () => {
    const session = new PilotSession({ jaeger: STANDARD, east: 0, north: 0, up: 0 });
    for (let index = 0; index < 240; index += 1) {
      session.update({
        deltaSeconds: 1 / 60,
        tick: index,
        input: { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true },
        cameraInput: { yawDeltaDeg: 0, pitchDeltaDeg: 0 },
        ground: flat,
        waterHeightMeters: -1_000,
        effects: { tractionMultiplier: 1, movementMultiplier: 1 },
      });
    }
    const moving = session.readout();
    expect(moving.speedMps).toBeGreaterThan(5);

    const before = session.pose;
    session.rebase(-5_000, 2_000, before.up);
    const after = session.pose;
    expect(after.east).toBe(-5_000);
    // Everything that is not a coordinate survives the frame change.
    expect(after.speedMps).toBe(before.speedMps);
    expect(after.state).toBe(before.state);
    expect(after.stridePhase).toBe(before.stridePhase);
  });

  it("keeps everything the player set up across a camera swap", () => {
    const session = new PilotSession({ jaeger: AGILE, east: 0, north: 0, up: 0 });
    session.setComfort({ shakeScale: 0.25, invertPitch: true });
    session.lockTarget("kaiju.test");
    session.update({
      deltaSeconds: 1 / 60,
      tick: 0,
      input: NEUTRAL_JAEGER_INPUT,
      cameraInput: { yawDeltaDeg: 40, pitchDeltaDeg: 10 },
      ground: flat,
      waterHeightMeters: -1_000,
      effects: { tractionMultiplier: 1, movementMultiplier: 1 },
    });
    const before = session.readout();
    session.setCameraMode("cockpit");
    const after = session.readout();
    expect(after.cameraMode).toBe("cockpit");
    expect(after.cameraHeadingDeg).toBe(before.cameraHeadingDeg);
    expect(after.lockedTargetId).toBe("kaiju.test");
    expect(after.shakeScale).toBe(0.25);
    expect(session.comfort.invertPitch).toBe(true);
    // The machine itself did not so much as twitch.
    expect(after.headingDeg).toBe(before.headingDeg);
    expect(after.speedMps).toBe(before.speedMps);
  });

  it("buffers a booster press through an illegal moment and fires it once", () => {
    const session = new PilotSession({ jaeger: HEAVY, east: 0, north: 0, up: 0 });
    session.react({ kind: "knockdown", impulseMps: 10 });
    session.press("booster", 0);
    let boosterEvents = 0;
    for (let index = 0; index < 60; index += 1) {
      const frame = session.update({
        deltaSeconds: 1 / 60,
        tick: index,
        input: NEUTRAL_JAEGER_INPUT,
        cameraInput: { yawDeltaDeg: 0, pitchDeltaDeg: 0 },
        ground: flat,
        waterHeightMeters: -1_000,
        effects: { tractionMultiplier: 1, movementMultiplier: 1 },
      });
      boosterEvents += frame.events.filter((event) => event.kind === "booster").length;
    }
    // Knocked down when the button was pressed, so the press expired unused
    // rather than firing a burst out of a machine lying on its back.
    expect(boosterEvents).toBe(0);
    expect(session.readout().droppedPresses).toBeGreaterThan(0);
  });
});

describe("the machine, drawn", () => {
  let engine: NullEngine;
  let scene: Scene;
  let view: JaegerView | undefined;
  const assets = createDefaultAssetRegistry();

  const makeView = (): JaegerView =>
    new JaegerView({
      scene,
      quality: createQualityRegistry().getOrThrow("high"),
      resolver: new AssetResolver(createGeneratorRegistry(), () => undefined),
      assets,
      jaeger: STANDARD,
      groundHeightAt: () => 0,
    });

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

  it("takes the camera, and gives it back on disposal", () => {
    const before = scene.activeCamera;
    view = makeView();
    expect(scene.activeCamera).not.toBe(before);
    expect(scene.activeCamera?.name).toBe("jaeger.camera");
    view.dispose();
    view = undefined;
    expect(scene.activeCamera).toBe(before);
  });

  it("runs a far plane a machine can see across, and a near plane it can sit inside", () => {
    view = makeView();
    const camera = view.activeCamera;
    expect(camera.maxZ).toBeGreaterThan(50_000);
    expect(camera.minZ).toBeLessThan(1);
    // Babylon's own camera input must never fight the controller.
    expect(Object.keys(camera.inputs.attached)).toHaveLength(0);
  });

  it("leaves footprints, bounded by the quality preset", () => {
    view = makeView();
    const session = new PilotSession({ jaeger: STANDARD, east: 0, north: 0, up: 0 });
    for (let index = 0; index < 900; index += 1) {
      const frame = session.update({
        deltaSeconds: 1 / 60,
        tick: index,
        input: { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true },
        cameraInput: { yawDeltaDeg: 0, pitchDeltaDeg: 0 },
        ground: () => 0,
        waterHeightMeters: -1_000,
        effects: { tractionMultiplier: 1, movementMultiplier: 1 },
      });
      view.update(frame.pose, frame.placement, frame.events, 1 / 60, frame.camera.mode);
    }
    const stats = view.stats();
    expect(stats.decals).toBeGreaterThan(3);
    expect(stats.decals).toBeLessThanOrEqual(stats.decalCapacity);
    expect(stats.scaleReferences).toBeGreaterThan(8);
  });

  it("returns the scene to exactly what it found", async () => {
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    const cameras = scene.cameras.length;
    view = makeView();
    // Wait for the model, so what is being disposed is the full view rather than
    // a half-built one whose asset lands afterwards.
    await view.whenReady();
    view.update(
      spawnPose(0, 0, 0),
      {
        east: 0,
        north: -100,
        up: 80,
        targetEast: 0,
        targetNorth: 0,
        targetUp: 50,
        fovDeg: 60,
        rollDeg: 0,
      },
      [],
      1 / 60,
      "third-person",
    );
    expect(scene.meshes.length).toBeGreaterThan(meshes);
    view.dispose();
    view = undefined;
    expect(scene.meshes.length).toBe(meshes);
    expect(scene.cameras.length).toBe(cameras);
    // Babylon lazily creates its own default material the first time a generated
    // mesh is drawn and keeps it for the life of the scene, so the count is not
    // the measure. What must be gone is everything this view named.
    expect(scene.materials.filter((material) => material.name.startsWith("jaeger."))).toEqual([]);
    // The inked rig also leaves Babylon's one shared edge-line shader behind,
    // cached on the scene exactly like the default material.
    expect(scene.materials.length - materials).toBeLessThanOrEqual(2);
  });

  it("reports a real sound delay for a distant footfall", () => {
    // A kilometre away is about three seconds. This is the number the panel shows.
    expect(JaegerView.soundDelaySeconds(1_000)).toBeGreaterThan(2.5);
    expect(JaegerView.soundDelaySeconds(0)).toBe(0);
  });
});
