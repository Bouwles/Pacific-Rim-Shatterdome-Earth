import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JaegerRig } from "../../src/engine/jaegerRig";
import { CreatureRig } from "../../src/engine/creatureRig";
import { forwardForYaw, uprightDotOf, validateOrientation } from "../../src/engine/orientation";

/**
 * The orientation contract, checked on the rigs the game ships. A rig that
 * fails here would walk backwards, stand on its head or sink into the ground
 * in the fight, so this is the test that keeps docs/ORIENTATION.md honest.
 */

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

describe("the Jaeger rig against the contract", () => {
  it("stands upright, faces +Z and keeps its soles on the ground", () => {
    const rig = new JaegerRig(scene, 75, "test");
    const report = validateOrientation({
      label: "jaeger",
      root: rig.root,
      frontMarker: rig.frontMarker,
      heightMeters: 75,
      groundY: 0,
    });
    expect(report.problems.join("; ")).toBe("");
    expect(report.upDot).toBeGreaterThan(0.99);
    expect(report.frontOffset).toBeGreaterThan(0.05);
    expect(report.boundsMaxY).toBeGreaterThan(60);
    rig.dispose();
  });

  it("holds the contract through every pose the fight uses", () => {
    const rig = new JaegerRig(scene, 75, "test");
    const poses = [
      { stridePhase: 0.25, speedMps: 14 },
      { stridePhase: 0.6, speedMps: 30 },
      { attack: { phase: "active" as const, progress: 0.5, kind: "jab" as const } },
      { attack: { phase: "windup" as const, progress: 0.8, kind: "overhead" as const } },
      { attack: { phase: "active" as const, progress: 0.3, kind: "haymaker" as const } },
      {
        attack: { phase: "active" as const, progress: 0.7, kind: "sword" as const },
        weapon: "sword" as const,
      },
      { guarding: true },
      { dodge: { progress: 0.5, direction: "L" as const } },
      { grapple: { holding: true, progress: 0.5 } },
      {
        weapon: "plasma" as const,
        attack: { phase: "active" as const, progress: 0.2, kind: "finisher" as const },
      },
    ];
    for (const pose of poses) {
      rig.update({ timeSeconds: 1, ...pose });
      const report = validateOrientation({
        label: JSON.stringify(pose),
        root: rig.root,
        frontMarker: rig.frontMarker,
        heightMeters: 75,
        groundY: 0,
      });
      expect(report.problems, JSON.stringify(pose)).toEqual([]);
    }
    rig.dispose();
  });

  it("reports a knockdown as a tagged tilt and returns from it upright", () => {
    const rig = new JaegerRig(scene, 75, "test");
    rig.update({ knockdown: { progress: 1, recovering: false } });
    expect(rig.tilt).toBeGreaterThan(60);
    const down = validateOrientation({
      label: "down",
      root: rig.visual,
      frontMarker: rig.frontMarker,
      heightMeters: 75,
      groundY: 0,
      taggedTiltDeg: rig.tilt,
    });
    // The visual node is tilted, the root above it is not: the gameplay root stays upright.
    expect(down.upDot).toBeLessThan(0.5);
    const rootReport = validateOrientation({
      label: "root",
      root: rig.root,
      frontMarker: rig.sockets.head,
      heightMeters: 75,
      groundY: 0,
      taggedTiltDeg: rig.tilt,
    });
    expect(rootReport.upDot).toBeGreaterThan(0.99);
    rig.update({ knockdown: null });
    expect(rig.tilt).toBe(0);
    const up = validateOrientation({
      label: "up",
      root: rig.root,
      frontMarker: rig.frontMarker,
      heightMeters: 75,
      groundY: 0,
    });
    expect(up.problems).toEqual([]);
    rig.dispose();
  });

  it("refuses a mirrored root and a root on its head", () => {
    const rig = new JaegerRig(scene, 75, "test");
    rig.root.scaling.x = -1;
    const mirrored = validateOrientation({
      label: "mirrored",
      root: rig.root,
      frontMarker: rig.frontMarker,
      heightMeters: 75,
      groundY: 0,
    });
    expect(mirrored.ok).toBe(false);
    expect(mirrored.problems.join(" ")).toMatch(/negative or zero scale|mirrored/);
    rig.root.scaling.x = 1;
    rig.root.rotation.x = Math.PI;
    const inverted = validateOrientation({
      label: "inverted",
      root: rig.root,
      frontMarker: rig.frontMarker,
      heightMeters: 75,
      groundY: 0,
    });
    expect(inverted.ok).toBe(false);
    expect(inverted.problems.join(" ")).toMatch(/not upright/);
    rig.dispose();
  });

  it("refuses a front marker behind the body", () => {
    const rig = new JaegerRig(scene, 75, "test");
    const report = validateOrientation({
      label: "back",
      root: rig.root,
      frontMarker: rig.sockets.back,
      heightMeters: 75,
      groundY: 0,
    });
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/not ahead of the root/);
    rig.dispose();
  });
});

describe("the creature rig against the contract", () => {
  it("stands upright, faces +Z with the jaw and keeps its feet on the ground", () => {
    const rig = new CreatureRig(scene, 90, "test");
    const report = validateOrientation({
      label: "creature",
      root: rig.root,
      frontMarker: rig.frontMarker,
      heightMeters: 90,
      groundY: 0,
    });
    expect(report.problems.join("; ")).toBe("");
    expect(report.frontOffset).toBeGreaterThan(0.2);
    rig.dispose();
  });

  it("holds the contract through its attacks and reports a knockdown as a tilt", () => {
    const rig = new CreatureRig(scene, 90, "test");
    for (const kind of [
      "claw.L",
      "claw.R",
      "blade.sweep",
      "blade.down",
      "charge",
      "bite",
      "shove",
      "tail",
    ] as const) {
      rig.update({ timeSeconds: 2, windup: 1, striking: 0, attackKind: kind, speedMps: 8 });
      const windup = validateOrientation({
        label: kind,
        root: rig.root,
        frontMarker: rig.frontMarker,
        heightMeters: 90,
        groundY: 0,
      });
      expect(windup.problems.join("; "), `${kind} windup`).toBe("");
      rig.update({ timeSeconds: 2.2, windup: 0, striking: 1, attackKind: kind });
      // A strike may drive the crest or a claw into the ground; that is contact, not sinking.
      const strike = validateOrientation({
        label: kind,
        root: rig.root,
        frontMarker: rig.frontMarker,
        heightMeters: 90,
        groundY: 0,
        groundContactFraction: 0.06,
      });
      expect(strike.problems.join("; "), `${kind} strike`).toBe("");
    }
    rig.update({ knockdown: 1 });
    expect(rig.tilt).toBeGreaterThan(60);
    rig.update({ knockdown: 0 });
    expect(rig.tilt).toBeLessThan(1);
    rig.dispose();
  });

  it("takes the plates off a broken region and shows the tissue", () => {
    const rig = new CreatureRig(scene, 90, "test");
    rig.update({ regions: { torso: { armor: 0, wound: 0.5, severed: false } } });
    const plates = rig.allMeshes().filter((mesh) => mesh.name.includes("chestPlate"));
    const tissue = rig.allMeshes().filter((mesh) => mesh.name.includes("chestTissue"));
    expect(plates.every((mesh) => !mesh.isVisible)).toBe(true);
    expect(tissue.every((mesh) => mesh.isVisible)).toBe(true);
    rig.update({ regions: { tail: { armor: 1, wound: 0, severed: true } } });
    expect(
      rig
        .allMeshes()
        .filter((mesh) => mesh.name.includes("tailMass"))
        .every((mesh) => !mesh.isVisible),
    ).toBe(true);
    rig.dispose();
  });
});

describe("the pure helpers", () => {
  it("agree with the locomotion's forward basis and the yaw-only pose", () => {
    expect(forwardForYaw(0).north).toBeCloseTo(1);
    expect(forwardForYaw(90).east).toBeCloseTo(1);
    expect(uprightDotOf(0, 0)).toBeCloseTo(1);
    expect(uprightDotOf(Math.PI, 0)).toBeCloseTo(-1);
    // A body placed by the contract: a transform node with yaw only is upright.
    const node = new TransformNode("pose", scene);
    node.rotation.y = 2.1;
    const marker = new TransformNode("marker", scene);
    marker.parent = node;
    marker.position.z = 10;
    const report = validateOrientation({
      label: "node",
      root: node,
      frontMarker: marker,
      heightMeters: 1,
      groundY: 0,
    });
    expect(report.upDot).toBeCloseTo(1);
    expect(report.frontOffset).toBeCloseTo(10);
  });
});
