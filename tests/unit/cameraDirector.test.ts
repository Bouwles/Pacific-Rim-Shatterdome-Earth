import { describe, expect, it } from "vitest";
import { jaegerRegistry } from "../../src/data/jaegers";
import { DEFAULT_COMFORT, type CameraInput } from "../../src/jaegers/camera";
import {
  CAMERA_DIRECTOR_TUNING,
  MAX_ROLL_DEG,
  desiredDirectorState,
  directorPlacement,
  initialDirector,
  stepDirector,
  type CameraDirectorSnapshot,
  type CombatCameraContext,
} from "../../src/jaegers/cameraDirector";
import { spawnPose, type JaegerPose } from "../../src/jaegers/locomotion";

const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");
const PROFILE = JAEGER.locomotion;
const H = PROFILE.heightMeters;
const STILL: CameraInput = { yawDeltaDeg: 0, pitchDeltaDeg: 0 };

function combat(overrides: Partial<CombatCameraContext> = {}): CombatCameraContext {
  return {
    targetPosition: null,
    targetHeightMeters: 90,
    locked: false,
    sprinting: false,
    boost: 0,
    aiming: false,
    grapple: false,
    clash: false,
    knockedDown: false,
    finisher: false,
    boundaryBearingDeg: null,
    attacking: false,
    ...overrides,
  };
}

function run(
  frames: number,
  context: CombatCameraContext,
  pose: JaegerPose = spawnPose(0, 0, 0, 0),
  input: CameraInput = STILL,
  start: { director: CameraDirectorSnapshot; yawDeg: number } = { director: initialDirector(), yawDeg: 0 },
): { director: CameraDirectorSnapshot; yawDeg: number } {
  let state = start;
  for (let i = 0; i < frames; i += 1) {
    state = stepDirector(
      state.director,
      state.yawDeg,
      input,
      1 / 60,
      pose,
      PROFILE,
      DEFAULT_COMFORT,
      context,
    );
  }
  return state;
}

function place(
  state: { director: CameraDirectorSnapshot; yawDeg: number },
  context: CombatCameraContext,
  pose = spawnPose(0, 0, 0, 0),
  pitchDeg = 6,
) {
  return directorPlacement({
    director: state.director,
    yawDeg: state.yawDeg,
    pitchDeg,
    pose,
    profile: PROFILE,
    comfort: DEFAULT_COMFORT,
    combat: context,
    deltaSeconds: 1 / 60,
    swayPhase: 0,
    impulse: 0,
  });
}

describe("state selection", () => {
  it("names every state the fight can ask for, in priority order", () => {
    const pose = spawnPose(0, 0, 0, 0);
    const near = { east: 0, north: 0.8 * H, up: 0 };
    const mid = { east: 0, north: 3 * H, up: 0 };
    expect(desiredDirectorState(pose, PROFILE, combat())).toBe("free");
    expect(desiredDirectorState(pose, PROFILE, combat({ targetPosition: mid }))).toBe("soft");
    expect(desiredDirectorState(pose, PROFILE, combat({ targetPosition: near }))).toBe("close");
    expect(desiredDirectorState(pose, PROFILE, combat({ targetPosition: mid, locked: true }))).toBe("lock");
    expect(desiredDirectorState(pose, PROFILE, combat({ sprinting: true }))).toBe("sprint");
    expect(desiredDirectorState(pose, PROFILE, combat({ targetPosition: mid, aiming: true }))).toBe("aim");
    expect(desiredDirectorState(pose, PROFILE, combat({ targetPosition: near, grapple: true }))).toBe(
      "grapple",
    );
    expect(
      desiredDirectorState(pose, PROFILE, combat({ targetPosition: near, grapple: true, clash: true })),
    ).toBe("clash");
    expect(
      desiredDirectorState(pose, PROFILE, combat({ knockedDown: true, locked: true, targetPosition: mid })),
    ).toBe("knockdown");
    expect(desiredDirectorState(pose, PROFILE, combat({ finisher: true, clash: true }))).toBe("finisher");
    expect(desiredDirectorState(pose, PROFILE, combat({ boundaryBearingDeg: 90 }))).toBe("boundary");
  });

  it("waits a few frames before a soft change and none before a grab", () => {
    const mid = { east: 0, north: 3 * H, up: 0 };
    const one = run(1, combat({ targetPosition: mid }));
    expect(one.director.state).toBe("free");
    expect(one.director.pending).toBe("soft");
    const settled = run(12, combat({ targetPosition: mid }));
    expect(settled.director.state).toBe("soft");
    const grabbed = run(1, combat({ targetPosition: mid, grapple: true }), undefined, STILL, settled);
    expect(grabbed.director.state).toBe("grapple");
  });
});

describe("blending", () => {
  it("moves every value toward the new state's tuning without overshooting", () => {
    let state = run(60, combat());
    const target = CAMERA_DIRECTOR_TUNING.aim;
    let maxDistance = 0;
    for (let i = 0; i < 120; i += 1) {
      state = run(
        1,
        combat({ aiming: true, targetPosition: { east: 0, north: 2 * H, up: 0 } }),
        undefined,
        STILL,
        state,
      );
      maxDistance = Math.max(maxDistance, state.director.values[0] ?? 0);
      // A critically damped spring never crosses its goal.
      expect(state.director.values[0]).toBeGreaterThanOrEqual(target.distance - 1e-6);
    }
    expect(state.director.values[0]).toBeCloseTo(target.distance, 2);
    expect(state.director.values[3]).toBeCloseTo(target.fovDeg, 1);
    expect(maxDistance).toBeLessThanOrEqual(CAMERA_DIRECTOR_TUNING.free.distance + 1e-6);
  });

  it("survives a long frame without exploding", () => {
    let state = { director: initialDirector(), yawDeg: 0 };
    for (let i = 0; i < 10; i += 1) {
      state = stepDirector(
        state.director,
        state.yawDeg,
        STILL,
        0.5,
        spawnPose(0, 0, 0, 0),
        PROFILE,
        DEFAULT_COMFORT,
        combat({ aiming: true, targetPosition: { east: 0, north: 2 * H, up: 0 } }),
      );
    }
    for (const value of state.director.values) expect(Number.isFinite(value)).toBe(true);
    expect(state.director.values[0]).toBeGreaterThan(0.5);
    expect(state.director.values[0]).toBeLessThan(3);
  });
});

describe("the mouse", () => {
  it("turns the camera on the frame it moves, with no smoothing", () => {
    const moved = run(1, combat(), undefined, { yawDeltaDeg: 9, pitchDeltaDeg: 0 });
    expect(moved.yawDeg).toBeCloseTo(9);
  });

  it("drags the view off a locked target and relaxes back when idle", () => {
    const target = { east: 0, north: 3 * H, up: 0 };
    const context = combat({ targetPosition: target, locked: true });
    let state = run(30, context);
    expect(state.director.state).toBe("lock");
    expect(Math.abs(state.yawDeg)).toBeLessThan(2);
    state = run(10, context, undefined, { yawDeltaDeg: 4, pitchDeltaDeg: 0 }, state);
    expect(state.director.yawOffsetDeg).toBeCloseTo(40);
    expect(state.yawDeg).toBeGreaterThan(10);
    state = run(180, context, undefined, STILL, state);
    expect(Math.abs(state.director.yawOffsetDeg)).toBeLessThan(1);
  });

  it("holds the lock bearing while the bodies overlap so the camera cannot spin", () => {
    const context = combat({ targetPosition: { east: 0, north: 3 * H, up: 0 }, locked: true });
    let state = run(30, context);
    const held = state.director.lockBearingDeg;
    const overlapping = combat({ targetPosition: { east: -0.1 * H, north: -0.1 * H, up: 0 }, locked: true });
    state = run(5, overlapping, undefined, STILL, state);
    expect(state.director.lockBearingDeg).toBe(held);
  });

  it("suggests letting go of a lock at extreme range", () => {
    const far = combat({ targetPosition: { east: 0, north: 12 * H, up: 0 }, locked: true });
    expect(run(30, far).director.lockBreakSuggested).toBe(true);
  });
});

describe("placement", () => {
  it("sits behind the camera heading and looks at the machine when free", () => {
    const state = run(60, combat());
    const { placement } = place(state, combat());
    expect(placement.north).toBeLessThan(0);
    expect(Math.abs(placement.east)).toBeLessThan(H * 0.05);
    expect(placement.up).toBeGreaterThan(H * 0.8);
    expect(placement.targetUp).toBeCloseTo(CAMERA_DIRECTOR_TUNING.free.look * H, 0);
  });

  it("leans the look point toward a locked target and lengthens the boom when they are apart", () => {
    const target = { east: 0, north: 8 * H, up: 0 };
    const context = combat({ targetPosition: target, locked: true });
    const state = run(120, context);
    const { placement, director } = place(state, context);
    expect(placement.targetNorth).toBeGreaterThan(H * 0.5);
    expect(director.distanceMeters).toBeGreaterThan(CAMERA_DIRECTOR_TUNING.lock.distance * H);
    // The machine itself is still ahead of the camera, never behind it.
    expect(placement.north).toBeLessThan(0);
  });

  it("pulls in at once for a wall and lets out slowly when clear", () => {
    const context = combat();
    const state = run(60, context);
    const wall = () => 0.9 * H;
    const blocked = directorPlacement({ ...place(state, context), ...placeArgs(state, context, wall) });
    expect(blocked.director.distanceMeters).toBeLessThan(0.9 * H);
    const clearState = { director: blocked.director, yawDeg: state.yawDeg };
    const clear = directorPlacement(placeArgs(clearState, context, () => null));
    expect(clear.director.distanceMeters).toBeGreaterThan(blocked.director.distanceMeters);
    expect(clear.director.distanceMeters).toBeLessThan(CAMERA_DIRECTOR_TUNING.free.distance * H);
  });

  it("never rolls the horizon past the limit and never inverts the pitch", () => {
    const context = combat({ trauma: { strength: 1, bearingDeg: 45 }, sprinting: true, boost: 1 });
    let state = run(1, context);
    for (let i = 0; i < 30; i += 1) state = run(1, context, undefined, STILL, state);
    const { placement } = place(state, context, undefined, 60);
    expect(Math.abs(placement.rollDeg)).toBeLessThanOrEqual(MAX_ROLL_DEG);
    expect(placement.fovDeg).toBeGreaterThan(CAMERA_DIRECTOR_TUNING.sprint.fovDeg - 8);
    expect(placement.fovDeg).toBeLessThan(96);
  });

  it("removes every trauma and widening under reduced motion and zero shake", () => {
    const comfort = { ...DEFAULT_COMFORT, shakeScale: 0, reducedMotion: true };
    const context = combat({ trauma: { strength: 1, bearingDeg: 0 }, sprinting: true, boost: 1, fovKick: 1 });
    let state = { director: initialDirector(), yawDeg: 0 };
    for (let i = 0; i < 20; i += 1) {
      state = stepDirector(
        state.director,
        state.yawDeg,
        STILL,
        1 / 60,
        spawnPose(0, 0, 0, 0),
        PROFILE,
        comfort,
        context,
      );
    }
    expect(state.director.traumaStrength).toBe(0);
    const { placement } = directorPlacement({
      director: state.director,
      yawDeg: state.yawDeg,
      pitchDeg: 6,
      pose: spawnPose(0, 0, 0, 0),
      profile: PROFILE,
      comfort,
      combat: context,
      deltaSeconds: 1 / 60,
      swayPhase: 0.3,
      impulse: 1,
    });
    expect(placement.rollDeg).toBe(0);
    expect(placement.fovDeg).toBeCloseTo(state.director.values[3] ?? 0, 5);
  });

  it("keeps the horizon level in a knockdown", () => {
    const context = combat({ knockedDown: true, targetPosition: { east: 0, north: 2 * H, up: 0 } });
    const state = run(90, context);
    expect(state.director.state).toBe("knockdown");
    const { placement } = place(state, context);
    expect(Math.abs(placement.rollDeg)).toBeLessThanOrEqual(MAX_ROLL_DEG);
    expect(placement.up).toBeGreaterThan(H);
  });
});

function placeArgs(
  state: { director: CameraDirectorSnapshot; yawDeg: number },
  context: CombatCameraContext,
  obstruction: () => number | null,
) {
  return {
    director: state.director,
    yawDeg: state.yawDeg,
    pitchDeg: 6,
    pose: spawnPose(0, 0, 0, 0),
    profile: PROFILE,
    comfort: DEFAULT_COMFORT,
    combat: context,
    obstruction,
    deltaSeconds: 1 / 60,
    swayPhase: 0,
    impulse: 0,
  };
}
