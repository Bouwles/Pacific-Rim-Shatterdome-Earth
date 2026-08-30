import { NullEngine, Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JaegerRig } from "../../src/engine/jaegerRig";
import { CreatureRig } from "../../src/engine/creatureRig";
import { gradeFor } from "../../src/engine/postPipeline";

/**
 * The bodies: built from parts, driven by a pose, and gone when disposed.
 *
 * Nothing here looks at pixels. What is checked is the contract the views
 * rely on: a rig is many parts rather than one box, it moves when the pose
 * says it moves, a hit is a kick that dies away, and disposal leaves the
 * scene exactly as it found it.
 */

describe("the machine rig", () => {
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

  it("is a body of many parts scaled to the machine's height", () => {
    const rig = new JaegerRig(scene, 75, "test");
    expect(rig.allMeshes().length).toBeGreaterThan(20);
    const bounds = rig.root.getHierarchyBoundingVectors();
    // Head near the top, feet on the ground, within a few percent of the stated height.
    expect(bounds.max.y).toBeGreaterThan(70);
    expect(bounds.max.y).toBeLessThan(82);
    expect(bounds.min.y).toBeLessThan(2);
    rig.dispose();
  });

  it("walks from the stride phase and stands still at rest", () => {
    const rig = new JaegerRig(scene, 75, "test");
    const thigh = scene.getTransformNodeByName("test.leg.L");
    expect(thigh).not.toBeNull();
    rig.update({ stridePhase: 0.25, speedMps: 8, timeSeconds: 1 }, 1 / 60);
    const walking = thigh?.rotation.x ?? 0;
    rig.update({ stridePhase: 0.25, speedMps: 0, timeSeconds: 1 }, 1 / 60);
    const standing = thigh?.rotation.x ?? 0;
    expect(Math.abs(walking)).toBeGreaterThan(Math.abs(standing));
    rig.dispose();
  });

  it("kicks on a hit and settles", () => {
    const rig = new JaegerRig(scene, 75, "test");
    const torso = scene.getTransformNodeByName("test.torso");
    rig.update({ timeSeconds: 0 }, 1 / 60);
    const rest = torso?.rotation.x ?? 0;
    rig.addRecoil(1);
    rig.update({ timeSeconds: 1 / 60 }, 1 / 60);
    const kicked = torso?.rotation.x ?? 0;
    expect(kicked).not.toBeCloseTo(rest, 3);
    for (let frame = 0; frame < 120; frame += 1) rig.update({ timeSeconds: frame / 60 }, 1 / 60);
    // Idle breathing keeps it moving a hair; the kick itself is gone.
    expect(Math.abs((torso?.rotation.x ?? 0) - rest)).toBeLessThan(0.05);
    rig.dispose();
  });

  it("leaves nothing behind on disposal", () => {
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    const nodes = scene.transformNodes.length;
    const rig = new JaegerRig(scene, 75, "test");
    rig.update({ stridePhase: 0.5, speedMps: 4, attack: { phase: "active", progress: 0.5 } }, 1 / 60);
    rig.dispose();
    expect(scene.meshes.length).toBe(meshes);
    // The inked edges leave Babylon's one shared line shader on the scene, like the default material.
    expect(scene.materials.length - materials).toBeLessThanOrEqual(1);
    expect(scene.transformNodes.length).toBe(nodes);
  });
});

describe("the creature rig", () => {
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

  it("has a head, a tail and plates rather than one capsule", () => {
    const rig = new CreatureRig(scene, 60, "beast");
    expect(rig.allMeshes().length).toBeGreaterThan(12);
    const bounds = rig.root.getHierarchyBoundingVectors();
    // Long: the tail and the skull make it much deeper than it is wide.
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(bounds.max.x - bounds.min.x);
    rig.dispose();
  });

  it("goes down when defeated and stays down", () => {
    const rig = new CreatureRig(scene, 60, "beast");
    rig.update({ timeSeconds: 0 });
    expect(Math.abs(rig.visual.rotation.z)).toBeLessThan(0.01);
    for (let frame = 0; frame < 240; frame += 1) rig.update({ timeSeconds: frame / 60, defeated: true });
    // The topple is a tagged tilt on the visual node; the root stays upright for the arena.
    expect(Math.abs(rig.visual.rotation.z)).toBeGreaterThan(1);
    expect(Math.abs(rig.root.rotation.z)).toBeLessThan(0.01);
    expect(rig.tilt).toBeGreaterThan(60);
    rig.dispose();
  });

  it("leaves nothing behind on disposal", () => {
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    const rig = new CreatureRig(scene, 60, "beast");
    rig.update({ timeSeconds: 1, windup: 1, striking: 1, flinch: 1, damage: 0.5 });
    rig.dispose();
    expect(scene.meshes.length).toBe(meshes);
    expect(scene.materials.length - materials).toBeLessThanOrEqual(1);
  });
});

describe("the grade", () => {
  it("runs bare on Low and grows with the preset", () => {
    expect(gradeFor("low").enabled).toBe(false);
    expect(gradeFor("medium").fxaa).toBe(true);
    expect(gradeFor("medium").bloomWeight).toBe(0);
    expect(gradeFor("high").bloomWeight).toBeGreaterThan(0);
    expect(gradeFor("cinematic").bloomWeight).toBeGreaterThanOrEqual(gradeFor("high").bloomWeight);
  });
});
