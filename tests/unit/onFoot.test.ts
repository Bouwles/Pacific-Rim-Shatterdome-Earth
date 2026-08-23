import { describe, expect, it } from "vitest";
import {
  NEUTRAL_INPUT,
  ON_FOOT,
  SHELTERED_EFFECTS,
  effectsForRoom,
  eyeHeightOf,
  isClear,
  poseAt,
  stepOnFoot,
  unstuck,
  type OnFootInput,
  type OnFootPose,
} from "../../src/shatterdome/onFoot";
import { INTERIOR_CAMERA } from "../../src/engine/interiorView";
import type { EnvironmentEffects, InteriorRoomLike } from "./onFootFixtures";
import { room, walkFor } from "./onFootFixtures";

const CALM: EnvironmentEffects = {
  visibilityMeters: 20_000,
  tractionMultiplier: 1,
  movementMultiplier: 1,
  windPushMps: 0,
  rangedAccuracyPenalty: 0,
  hazardous: false,
};

function input(overrides: Partial<OnFootInput> = {}): OnFootInput {
  return { ...NEUTRAL_INPUT, ...overrides };
}

describe("on-foot scale", () => {
  it("moves at walking pace, not at Jaeger pace", () => {
    // A 75 m machine crosses ground at tens of metres a second; a person does not.
    expect(ON_FOOT.walkSpeedMps).toBeLessThan(4);
    expect(ON_FOOT.runSpeedMps).toBeLessThan(8);
    expect(ON_FOOT.crouchSpeedMps).toBeLessThan(ON_FOOT.walkSpeedMps);
    expect(ON_FOOT.heightMeters).toBeLessThan(2.2);
    expect(ON_FOOT.radiusMeters).toBeLessThan(0.6);
  });

  it("uses a camera built for a corridor rather than for a continent", () => {
    // The ground view runs a 400 km far plane and a 5 m near plane, which would
    // clip a console the player is standing at straight through the middle.
    expect(INTERIOR_CAMERA.minZ).toBeLessThan(0.2);
    expect(INTERIOR_CAMERA.maxZ).toBeLessThan(1_000);
  });

  it("stands and crouches at human eye heights", () => {
    const standing = poseAt({ x: 0, z: 0 });
    expect(eyeHeightOf(standing)).toBeCloseTo(ON_FOOT.eyeHeightMeters, 5);
    expect(eyeHeightOf({ ...standing, crouched: true })).toBeLessThan(ON_FOOT.eyeHeightMeters);
  });
});

describe("on-foot movement", () => {
  it("accelerates to walking speed and no further", () => {
    const pose = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1 }), 3, room(), CALM);
    expect(pose.speedMps).toBeGreaterThan(ON_FOOT.walkSpeedMps * 0.95);
    expect(pose.speedMps).toBeLessThanOrEqual(ON_FOOT.walkSpeedMps + 1e-6);
  });

  it("runs faster than it walks and crouches slower than either", () => {
    // One second: long enough to reach top speed, short enough not to reach the wall.
    const walk = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1 }), 1, room(), CALM);
    const run = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1, run: true }), 1, room(), CALM);
    const crouch = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1, crouch: true }), 1, room(), CALM);
    expect(run.speedMps).toBeGreaterThan(walk.speedMps);
    expect(crouch.speedMps).toBeLessThan(walk.speedMps);
    expect(crouch.crouched).toBe(true);
  });

  it("walks in the direction it is facing", () => {
    const facingEast = { ...poseAt({ x: 0, z: 0 }), yawDeg: 90 };
    const pose = walkFor(facingEast, input({ forward: 1 }), 1, room(), CALM);
    expect(pose.x).toBeGreaterThan(1);
    expect(Math.abs(pose.z)).toBeLessThan(0.2);
  });

  it("comes to a stop when the keys are released", () => {
    const moving = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1 }), 2, room(), CALM);
    const stopped = walkFor(moving, NEUTRAL_INPUT, 1, room(), CALM);
    expect(stopped.speedMps).toBeLessThan(0.01);
  });

  it("cannot walk through a wall, however long it tries", () => {
    const space = room();
    const pose = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1, run: true }), 30, space, CALM);
    expect(pose.z).toBeLessThan(space.depthMeters / 2);
    expect(isClear(pose.x, pose.z, space)).toBe(true);
    expect(pose.blocked).toBe(true);
  });

  it("cannot pass through a fixture even at a full run in one long frame", () => {
    const space = room({
      obstacles: [
        { id: "block", kind: "fixture", x: 0, z: 4, halfWidth: 3, halfDepth: 0.6, heightMeters: 2 },
      ],
    });
    // One enormous step is exactly the case substepping exists for.
    const pose = stepOnFoot(poseAt({ x: 0, z: 0 }), input({ forward: 1, run: true }), 1.5, space, CALM);
    expect(pose.z).toBeLessThan(4);
    expect(isClear(pose.x, pose.z, space)).toBe(true);
  });

  it("slides along a wall rather than sticking to it", () => {
    const space = room();
    // Facing the wall at forty five degrees: blocked in z, still moving in x.
    const angled = { ...poseAt({ x: 0, z: space.depthMeters / 2 - 1 }), yawDeg: 45 };
    const pose = walkFor(angled, input({ forward: 1 }), 2, space, CALM);
    expect(pose.x).toBeGreaterThan(1);
  });

  it("obeys the environment rather than inventing its own footing", () => {
    const slow = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1 }), 3, room(), {
      ...CALM,
      movementMultiplier: 0.5,
    });
    const normal = walkFor(poseAt({ x: 0, z: 0 }), input({ forward: 1 }), 3, room(), CALM);
    expect(slow.speedMps).toBeLessThan(normal.speedMps * 0.6);
  });

  it("takes longer to get going on slick footing", () => {
    const slick = stepOnFoot(poseAt({ x: 0, z: 0 }), input({ forward: 1 }), 0.1, room(), {
      ...CALM,
      tractionMultiplier: 0.4,
    });
    const dry = stepOnFoot(poseAt({ x: 0, z: 0 }), input({ forward: 1 }), 0.1, room(), CALM);
    expect(slick.speedMps).toBeLessThan(dry.speedMps);
  });

  it("keeps the weather outdoors", () => {
    const wet = { ...CALM, tractionMultiplier: 0.4, movementMultiplier: 0.6 };
    expect(effectsForRoom(room({ id: "command" }), wet)).toEqual(SHELTERED_EFFECTS);
    // The bay stands open to the apron, so its floor is as wet as the weather.
    expect(effectsForRoom(room({ id: "jaeger-bay" }), wet).tractionMultiplier).toBe(0.4);
  });

  it("clamps how far up and down a person can look", () => {
    let pose: OnFootPose = poseAt({ x: 0, z: 0 });
    for (let index = 0; index < 60; index += 1) {
      pose = stepOnFoot(pose, input({ pitchDeltaDeg: 20 }), 1 / 60, room(), CALM);
    }
    expect(pose.pitchDeg).toBeLessThanOrEqual(ON_FOOT.maxPitchDeg);
    for (let index = 0; index < 120; index += 1) {
      pose = stepOnFoot(pose, input({ pitchDeltaDeg: -20 }), 1 / 60, room(), CALM);
    }
    expect(pose.pitchDeg).toBeGreaterThanOrEqual(-ON_FOOT.maxPitchDeg);
  });

  it("keeps yaw inside one turn of the compass", () => {
    let pose: OnFootPose = poseAt({ x: 0, z: 0 });
    for (let index = 0; index < 100; index += 1) {
      pose = stepOnFoot(pose, input({ yawDeltaDeg: 37 }), 1 / 60, room(), CALM);
    }
    expect(pose.yawDeg).toBeGreaterThanOrEqual(0);
    expect(pose.yawDeg).toBeLessThan(360);
  });

  it("ignores a zero or negative frame instead of moving backwards through time", () => {
    const pose = poseAt({ x: 1, z: 2 });
    expect(stepOnFoot(pose, input({ forward: 1 }), 0, room(), CALM)).toBe(pose);
    expect(stepOnFoot(pose, input({ forward: 1 }), -1, room(), CALM)).toBe(pose);
  });
});

describe("unstuck", () => {
  it("puts a trapped player somewhere they fit, in the same room", () => {
    const space: InteriorRoomLike = room({
      obstacles: [{ id: "trap", kind: "fixture", x: 0, z: 0, halfWidth: 4, halfDepth: 4, heightMeters: 2 }],
      spawnPoints: [
        { x: 0, z: -8 },
        { x: 8, z: 8 },
      ],
    });
    const trapped = poseAt({ x: 0, z: 0 });
    const freed = unstuck(trapped, space);
    expect(isClear(freed.x, freed.z, space)).toBe(true);
    expect(freed.speedMps).toBe(0);
  });

  it("picks the nearest clear spawn point, and is the same answer every time", () => {
    const space = room({
      spawnPoints: [
        { x: -9, z: 0 },
        { x: 9, z: 0 },
      ],
    });
    const first = unstuck(poseAt({ x: 6, z: 0 }), space);
    const second = unstuck(poseAt({ x: 6, z: 0 }), space);
    expect(first.x).toBeCloseTo(9, 5);
    expect(second).toEqual(first);
  });

  it("falls back to the room centre when every spawn point is blocked", () => {
    const space = room({
      obstacles: [{ id: "wall", kind: "fixture", x: -9, z: 0, halfWidth: 2, halfDepth: 2, heightMeters: 2 }],
      spawnPoints: [{ x: -9, z: 0 }],
    });
    const freed = unstuck(poseAt({ x: -9, z: 0 }), space);
    expect(freed.x).toBe(0);
    expect(freed.z).toBe(0);
  });
});
