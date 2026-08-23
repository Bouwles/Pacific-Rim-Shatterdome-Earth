import { describe, expect, it } from "vitest";
import { jaegerRegistry } from "../../src/data/jaegers";
import {
  CAMERA_MODES,
  DEFAULT_COMFORT,
  MAX_PITCH_DEG,
  MIN_PITCH_DEG,
  cameraPlacement,
  initialCameraState,
  nextCameraMode,
  rigFor,
  setLockedTarget,
  stepCamera,
  switchCameraMode,
  validateComfort,
  type CameraContext,
  type CameraMode,
} from "../../src/jaegers/camera";
import { spawnPose, type JaegerPose } from "../../src/jaegers/locomotion";

const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");
const PROFILE = JAEGER.locomotion;

function contextFor(
  pose: JaegerPose = spawnPose(0, 0, 0),
  overrides: Partial<CameraContext> = {},
): CameraContext {
  return { pose, profile: PROFILE, comfort: DEFAULT_COMFORT, impulse: 0, ...overrides };
}

describe("camera rigs", () => {
  it("ships the three the milestone names, and no others", () => {
    expect([...CAMERA_MODES]).toEqual(["third-person", "combat", "cockpit"]);
    for (const mode of CAMERA_MODES) expect(rigFor(mode).displayName.length).toBeGreaterThan(0);
  });

  it("frames every machine from its own height rather than a fixed distance", () => {
    const heavy = jaegerRegistry.getOrThrow("heavy-mk4");
    const agile = jaegerRegistry.getOrThrow("agile-mk5");
    const place = (profileOwner: typeof heavy) =>
      cameraPlacement(initialCameraState("third-person"), {
        pose: spawnPose(0, 0, 0),
        profile: profileOwner.locomotion,
        comfort: DEFAULT_COMFORT,
        impulse: 0,
      });
    const behindHeavy = Math.hypot(place(heavy).east, place(heavy).north);
    const behindAgile = Math.hypot(place(agile).east, place(agile).north);
    expect(behindHeavy).toBeGreaterThan(behindAgile);
  });

  it("puts the cockpit inside the machine and the chase camera behind it", () => {
    const cockpit = cameraPlacement(initialCameraState("cockpit"), contextFor());
    const chase = cameraPlacement(initialCameraState("third-person"), contextFor());
    expect(Math.hypot(cockpit.east, cockpit.north)).toBeLessThan(PROFILE.heightMeters * 0.2);
    expect(Math.hypot(chase.east, chase.north)).toBeGreaterThan(PROFILE.heightMeters);
    // Inside the head, not at the ankles.
    expect(cockpit.up).toBeGreaterThan(PROFILE.heightMeters * 0.85);
  });
});

describe("switching rigs", () => {
  it("keeps heading intent, pitch and lock", () => {
    let state = initialCameraState("third-person", 40);
    state = stepCamera(state, { yawDeltaDeg: 35, pitchDeltaDeg: 12 }, 0.1, contextFor());
    state = setLockedTarget(state, "kaiju.test");
    const before = state;
    const after = switchCameraMode(state, "cockpit");
    expect(after.yawDeg).toBe(before.yawDeg);
    expect(after.pitchDeg).toBe(before.pitchDeg);
    expect(after.lockedTargetId).toBe("kaiju.test");
    expect(after.mode).toBe("cockpit");
  });

  it("cycles through every rig and comes back", () => {
    let mode: CameraMode = CAMERA_MODES[0];
    const seen = new Set<string>();
    for (let index = 0; index < CAMERA_MODES.length; index += 1) {
      seen.add(mode);
      mode = nextCameraMode(mode);
    }
    expect(seen.size).toBe(CAMERA_MODES.length);
    expect(mode).toBe(CAMERA_MODES[0]);
  });

  it("is a no-op when the rig is already active", () => {
    const state = initialCameraState("combat", 10);
    expect(switchCameraMode(state, "combat")).toBe(state);
  });
});

describe("looking around", () => {
  it("clamps pitch so the horizon cannot leave the frame", () => {
    let state = initialCameraState();
    for (let index = 0; index < 100; index += 1) {
      state = stepCamera(state, { yawDeltaDeg: 0, pitchDeltaDeg: 20 }, 1 / 60, contextFor());
    }
    expect(state.pitchDeg).toBeLessThanOrEqual(MAX_PITCH_DEG);
    let down = initialCameraState();
    for (let index = 0; index < 100; index += 1) {
      down = stepCamera(down, { yawDeltaDeg: 0, pitchDeltaDeg: -20 }, 1 / 60, contextFor());
    }
    expect(down.pitchDeg).toBeGreaterThanOrEqual(MIN_PITCH_DEG);
  });

  it("inverts pitch when the player asks it to", () => {
    const normal = stepCamera(
      initialCameraState(),
      { yawDeltaDeg: 0, pitchDeltaDeg: 10 },
      1 / 60,
      contextFor(),
    );
    const inverted = stepCamera(
      initialCameraState(),
      { yawDeltaDeg: 0, pitchDeltaDeg: 10 },
      1 / 60,
      contextFor(spawnPose(0, 0, 0), { comfort: { ...DEFAULT_COMFORT, invertPitch: true } }),
    );
    expect(normal.pitchDeg).toBeGreaterThan(inverted.pitchDeg);
  });
});

describe("comfort", () => {
  it("turns every bit of motion off without turning the camera off", () => {
    const pose = { ...spawnPose(0, 0, 0), speedMps: PROFILE.runSpeedMps };
    const reduced = { ...DEFAULT_COMFORT, reducedMotion: true, shakeScale: 0 };
    let state = initialCameraState();
    for (let index = 0; index < 120; index += 1) {
      state = stepCamera(state, { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1 / 60, {
        ...contextFor(pose, { comfort: reduced }),
        impulse: 1,
      });
    }
    expect(state.swayPhase).toBe(0);
    expect(state.impulse).toBe(0);
    const placement = cameraPlacement(state, contextFor(pose, { comfort: reduced }));
    expect(placement.rollDeg).toBe(0);
    // Still a working camera: it is behind the machine and looking at it.
    expect(Math.hypot(placement.east, placement.north)).toBeGreaterThan(PROFILE.heightMeters);
  });

  it("keeps the pull-back at speed unless reduced motion is on", () => {
    const fast = { ...spawnPose(0, 0, 0), speedMps: PROFILE.runSpeedMps };
    const normal = stepCamera(
      initialCameraState(),
      { yawDeltaDeg: 0, pitchDeltaDeg: 0 },
      1 / 60,
      contextFor(fast),
    );
    const reduced = stepCamera(
      initialCameraState(),
      { yawDeltaDeg: 0, pitchDeltaDeg: 0 },
      1 / 60,
      contextFor(fast, { comfort: { ...DEFAULT_COMFORT, reducedMotion: true } }),
    );
    expect(normal.distanceMeters).toBeGreaterThan(reduced.distanceMeters);
  });

  it("rejects settings that would make the camera unusable", () => {
    expect(validateComfort({ ...DEFAULT_COMFORT, shakeScale: 4 }).join(" ")).toMatch(/shakeScale/);
    expect(validateComfort({ ...DEFAULT_COMFORT, sensitivity: 0 }).join(" ")).toMatch(/sensitivity/);
    expect(validateComfort({ ...DEFAULT_COMFORT, fovOffsetDeg: 90 }).join(" ")).toMatch(/fovOffsetDeg/);
    expect(validateComfort(DEFAULT_COMFORT)).toEqual([]);
  });
});

describe("impulse", () => {
  it("decays rather than accumulating", () => {
    let state = stepCamera(initialCameraState(), { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1 / 60, {
      ...contextFor(),
      impulse: 1,
    });
    const peak = state.impulse;
    for (let index = 0; index < 120; index += 1) {
      state = stepCamera(state, { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1 / 60, contextFor());
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(state.impulse).toBe(0);
  });

  it("is scaled by the comfort slider, not just by the rig", () => {
    const full = stepCamera(initialCameraState(), { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1 / 60, {
      ...contextFor(),
      impulse: 1,
    });
    const half = stepCamera(initialCameraState(), { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1 / 60, {
      ...contextFor(spawnPose(0, 0, 0), { comfort: { ...DEFAULT_COMFORT, shakeScale: 0.5 } }),
      impulse: 1,
    });
    expect(half.impulse).toBeLessThan(full.impulse);
  });
});

describe("obstruction", () => {
  it("pulls in when something is between the machine and the camera", () => {
    const clear = stepCamera(initialCameraState(), { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1, contextFor());
    const blocked = stepCamera(initialCameraState(), { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1, {
      ...contextFor(),
      obstruction: () => 40,
    });
    expect(blocked.distanceMeters).toBeLessThan(clear.distanceMeters);
    expect(blocked.distanceMeters).toBeGreaterThan(0);
  });
});

describe("target lock", () => {
  it("brings a locked target into frame without moving the body", () => {
    const pose = spawnPose(0, 0, 0);
    let state = setLockedTarget(initialCameraState("combat", 0), "kaiju.test");
    const target = { east: 300, north: 0, up: 0 };
    for (let index = 0; index < 120; index += 1) {
      state = stepCamera(state, { yawDeltaDeg: 0, pitchDeltaDeg: 0 }, 1 / 60, {
        ...contextFor(pose),
        targetPosition: target,
      });
    }
    // Due east of the machine is 90 degrees, and the pose itself never moved.
    expect(Math.abs(state.yawDeg - 90)).toBeLessThan(2);
    expect(pose.yawDeg).toBe(0);
  });
});
