import type { LocomotionProfile } from "../data/jaegers";
import { normalizeDegrees, signedDelta, type JaegerPose } from "./locomotion";

/**
 * Jaeger cameras.
 *
 * Three rigs, one state. Switching between them changes where the eye sits and
 * nothing else: the heading the player was steering toward, the target they had
 * locked, their comfort settings and the whole control scheme survive the swap,
 * because all of those live here rather than in the rig.
 *
 * Mass is not communicated by shake. Shake is the last and smallest part of it:
 * the camera lags the machine, swings wide on a turn, rises with speed and
 * settles after a landing, and every one of those can be turned down to nothing
 * by a player who needs it to be. What cannot be turned off is the framing that
 * shows how big the thing is.
 *
 * Pure: no Babylon types, no DOM. The renderer asks for a placement and applies
 * it to whatever camera it owns.
 */

export const CAMERA_MODES = ["third-person", "combat", "cockpit"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export interface CameraRig {
  readonly id: CameraMode;
  readonly displayName: string;
  /** Metres behind the machine. Zero for a rig that sits inside it. */
  readonly distanceMeters: number;
  /** Metres above the machine's feet. */
  readonly heightMeters: number;
  /** Metres above the feet the camera looks at. */
  readonly lookAtHeightMeters: number;
  readonly fovDeg: number;
  /** How fast the rig follows the body, per second. Lower is heavier. */
  readonly followRate: number;
  /** Extra distance at full speed, so running opens the frame out. */
  readonly speedDistanceMeters: number;
  /** Multiplier on impulse this rig passes through before comfort is applied. */
  readonly impulseScale: number;
  readonly description: string;
}

/**
 * Rig geometry as multiples of the machine's own height, so a 68 m frame and an
 * 82 m frame are both framed correctly without a per-machine camera table.
 */
const RIGS: readonly CameraRig[] = [
  {
    id: "third-person",
    displayName: "Exploration",
    distanceMeters: 2.1,
    heightMeters: 1.05,
    lookAtHeightMeters: 0.72,
    fovDeg: 62,
    followRate: 2.6,
    speedDistanceMeters: 0.9,
    impulseScale: 1,
    description: "Wide and high: the rig that shows the streets going past the ankles.",
  },
  {
    id: "combat",
    displayName: "Combat",
    distanceMeters: 1.5,
    heightMeters: 0.85,
    lookAtHeightMeters: 0.82,
    fovDeg: 54,
    followRate: 4.2,
    speedDistanceMeters: 0.45,
    impulseScale: 1.15,
    description: "Closer, tighter and faster to follow, so a swing reads before it lands.",
  },
  {
    id: "cockpit",
    displayName: "Conn-Pod",
    distanceMeters: 0,
    heightMeters: 0.94,
    lookAtHeightMeters: 0.94,
    fovDeg: 72,
    followRate: 12,
    speedDistanceMeters: 0,
    impulseScale: 0.55,
    description: "Inside the head. Rigid to the machine, so every step is felt rather than watched.",
  },
];

const RIG_BY_ID: ReadonlyMap<CameraMode, CameraRig> = new Map(RIGS.map((rig) => [rig.id, rig]));

export const CAMERA_RIGS = RIGS;

export function rigFor(mode: CameraMode): CameraRig {
  const rig = RIG_BY_ID.get(mode);
  if (!rig) throw new Error(`Unknown camera mode "${mode}"`);
  return rig;
}

/**
 * Player comfort. Every one of these is a setting rather than a constant,
 * because motion that reads as weight to one player reads as nausea to another.
 */
export interface CameraComfort {
  /** 0 to 1 multiplier on every impulse, shake and sway. Zero is a locked-off camera. */
  readonly shakeScale: number;
  /** Turns off sway, speed-driven pull-back and roll in one switch. */
  readonly reducedMotion: boolean;
  /** Added to the rig's own field of view. */
  readonly fovOffsetDeg: number;
  readonly invertPitch: boolean;
  /** Degrees of look per pixel of mouse movement. */
  readonly sensitivity: number;
}

export const DEFAULT_COMFORT: CameraComfort = {
  shakeScale: 1,
  reducedMotion: false,
  fovOffsetDeg: 0,
  invertPitch: false,
  sensitivity: 0.11,
};

export interface CameraState {
  readonly mode: CameraMode;
  /** Where the player is looking. This is the heading intent the body chases. */
  readonly yawDeg: number;
  readonly pitchDeg: number;
  /** Metres actually behind the machine after obstruction and speed. */
  readonly distanceMeters: number;
  /** Decaying impulse, 0 to 1. What a landing or a hit leaves behind. */
  readonly impulse: number;
  /** Deterministic sway phase. Advances with distance travelled, not with time. */
  readonly swayPhase: number;
  /** Entity the camera is framing, or null when free. Survives a mode change. */
  readonly lockedTargetId: string | null;
}

export const MAX_PITCH_DEG = 62;
export const MIN_PITCH_DEG = -35;
/** Impulse decays to nothing in about this many seconds. */
export const IMPULSE_DECAY_PER_SECOND = 2.4;

export function initialCameraState(mode: CameraMode = "third-person", yawDeg = 0): CameraState {
  return {
    mode,
    yawDeg: normalizeDegrees(yawDeg),
    pitchDeg: 6,
    distanceMeters: 0,
    impulse: 0,
    swayPhase: 0,
    lockedTargetId: null,
  };
}

export interface CameraInput {
  /** Degrees, already scaled by sensitivity by the input source. */
  readonly yawDeltaDeg: number;
  readonly pitchDeltaDeg: number;
}

export interface CameraContext {
  readonly pose: JaegerPose;
  readonly profile: LocomotionProfile;
  readonly comfort: CameraComfort;
  /** Impulse earned this frame by the machine, 0 to 1. */
  readonly impulse: number;
  /**
   * Distance to the first thing between the machine and the ideal camera
   * position, or null when the line is clear. Injected so this module never
   * touches a scene.
   */
  readonly obstruction?: (desiredDistanceMeters: number) => number | null;
  /** Where a locked target is, for the rigs that frame it. */
  readonly targetPosition?: { readonly east: number; readonly north: number; readonly up: number } | null;
}

export function stepCamera(
  state: CameraState,
  input: CameraInput,
  deltaSeconds: number,
  context: CameraContext,
): CameraState {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return state;
  const rig = rigFor(state.mode);
  const comfort = context.comfort;
  const profile = context.profile;

  const pitchDelta = comfort.invertPitch ? -input.pitchDeltaDeg : input.pitchDeltaDeg;
  let yawDeg = normalizeDegrees(state.yawDeg + input.yawDeltaDeg);
  const pitchDeg = clamp(state.pitchDeg + pitchDelta, MIN_PITCH_DEG, MAX_PITCH_DEG);

  // A locked target owns the yaw: the camera keeps it in frame while the player
  // circles it. The body still turns at its own rate, which is what makes
  // strafing around something read as heavy rather than as spinning on a pin.
  if (state.lockedTargetId !== null && context.targetPosition) {
    const bearing = normalizeDegrees(
      (Math.atan2(
        context.targetPosition.east - context.pose.east,
        context.targetPosition.north - context.pose.north,
      ) *
        180) /
        Math.PI,
    );
    const follow = clamp(rig.followRate * deltaSeconds, 0, 1);
    yawDeg = normalizeDegrees(yawDeg + signedDelta(yawDeg, bearing) * follow);
  }

  // Speed opens the frame out. Reduced motion holds it still instead.
  const speedFraction = clamp(context.pose.speedMps / Math.max(1, profile.runSpeedMps), 0, 1);
  const height = profile.heightMeters;
  const idealDistance =
    rig.distanceMeters * height +
    (comfort.reducedMotion ? 0 : rig.speedDistanceMeters * height * speedFraction);

  // Obstruction pulls the camera in rather than letting it sit inside a tower.
  const blocked = context.obstruction?.(idealDistance) ?? null;
  const targetDistance = blocked === null ? idealDistance : Math.max(height * 0.35, blocked);
  const distanceMeters =
    state.distanceMeters === 0
      ? targetDistance
      : approach(state.distanceMeters, targetDistance, height * 4 * deltaSeconds);

  const impulse = clamp(
    Math.max(state.impulse - IMPULSE_DECAY_PER_SECOND * deltaSeconds, 0) +
      context.impulse * rig.impulseScale * comfort.shakeScale,
    0,
    1,
  );

  // Sway advances with distance covered, so it stays in step with the feet and
  // stops dead when the machine does, however the frame rate is behaving.
  const travelled = context.pose.speedMps * deltaSeconds;
  const swayPhase = comfort.reducedMotion
    ? 0
    : (state.swayPhase + travelled / Math.max(1, profile.strideMeters)) % 1;

  return { ...state, yawDeg, pitchDeg, distanceMeters, impulse, swayPhase };
}

/**
 * Changes rig without losing anything the player set up.
 *
 * Yaw, pitch, lock and comfort all carry over; only the geometry changes. The
 * distance is reset so the new rig settles from its own ideal rather than
 * inheriting a pull-in meant for the old one.
 */
export function switchCameraMode(state: CameraState, mode: CameraMode): CameraState {
  rigFor(mode);
  if (mode === state.mode) return state;
  return { ...state, mode, distanceMeters: 0 };
}

export function nextCameraMode(mode: CameraMode): CameraMode {
  const index = CAMERA_MODES.indexOf(mode);
  return CAMERA_MODES[(index + 1) % CAMERA_MODES.length] ?? "third-person";
}

export function setLockedTarget(state: CameraState, targetId: string | null): CameraState {
  return { ...state, lockedTargetId: targetId };
}

/** Where the camera actually goes this frame, in the machine's own local frame. */
export interface CameraPlacement {
  readonly east: number;
  readonly north: number;
  readonly up: number;
  readonly targetEast: number;
  readonly targetNorth: number;
  readonly targetUp: number;
  readonly fovDeg: number;
  /** Degrees of roll from sway and impulse. Small by design. */
  readonly rollDeg: number;
}

export function cameraPlacement(state: CameraState, context: CameraContext): CameraPlacement {
  const rig = rigFor(state.mode);
  const profile = context.profile;
  const comfort = context.comfort;
  const height = profile.heightMeters;
  const pose = context.pose;

  const yawRadians = (state.yawDeg * Math.PI) / 180;
  const pitchRadians = (state.pitchDeg * Math.PI) / 180;

  // Sway is a small figure of eight driven by the stride, scaled by comfort. It
  // is the least of what communicates mass and the first thing a player turns off.
  const sway = comfort.reducedMotion ? 0 : Math.sin(state.swayPhase * Math.PI * 2) * comfort.shakeScale;
  const bob = comfort.reducedMotion ? 0 : Math.sin(state.swayPhase * Math.PI * 4) * comfort.shakeScale;
  const impulseDrop = state.impulse * height * 0.02;

  const lookUp = pose.up + rig.lookAtHeightMeters * height + sway * height * 0.004;

  if (rig.distanceMeters === 0) {
    // Cockpit: rigid to the machine, looking where the player looks.
    const forwardEast = Math.sin(yawRadians) * Math.cos(pitchRadians);
    const forwardNorth = Math.cos(yawRadians) * Math.cos(pitchRadians);
    const forwardUp = -Math.sin(pitchRadians);
    const east = pose.east + Math.sin((pose.yawDeg * Math.PI) / 180) * height * 0.08;
    const north = pose.north + Math.cos((pose.yawDeg * Math.PI) / 180) * height * 0.08;
    const up = pose.up + rig.heightMeters * height + bob * height * 0.002 - impulseDrop;
    return {
      east,
      north,
      up,
      targetEast: east + forwardEast * height,
      targetNorth: north + forwardNorth * height,
      targetUp: up + forwardUp * height,
      fovDeg: rig.fovDeg + comfort.fovOffsetDeg,
      rollDeg: sway * 0.6 * comfort.shakeScale,
    };
  }

  const distance = state.distanceMeters === 0 ? rig.distanceMeters * height : state.distanceMeters;
  const horizontal = distance * Math.cos(pitchRadians);
  const east = pose.east - Math.sin(yawRadians) * horizontal + sway * height * 0.01;
  const north = pose.north - Math.cos(yawRadians) * horizontal;
  const up =
    pose.up +
    rig.heightMeters * height +
    distance * Math.sin(pitchRadians) +
    bob * height * 0.006 -
    impulseDrop;

  return {
    east,
    north,
    up,
    targetEast: pose.east,
    targetNorth: pose.north,
    targetUp: lookUp,
    fovDeg: rig.fovDeg + comfort.fovOffsetDeg + (comfort.reducedMotion ? 0 : state.impulse * 3),
    rollDeg: sway * 1.2 * comfort.shakeScale,
  };
}

export function validateComfort(comfort: CameraComfort): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(comfort.shakeScale) || comfort.shakeScale < 0 || comfort.shakeScale > 1) {
    errors.push("shakeScale must be within 0 and 1");
  }
  if (!Number.isFinite(comfort.fovOffsetDeg) || Math.abs(comfort.fovOffsetDeg) > 25) {
    errors.push("fovOffsetDeg must be within 25 degrees either way");
  }
  if (!Number.isFinite(comfort.sensitivity) || comfort.sensitivity <= 0) {
    errors.push("sensitivity must be a positive number");
  }
  return errors;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  if (value > target) return Math.max(target, value - rate);
  return value;
}
