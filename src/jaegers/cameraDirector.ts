import type { LocomotionProfile } from "../data/jaegers";
import type { CameraComfort, CameraInput, CameraPlacement } from "./camera";
import { normalizeDegrees, signedDelta, type JaegerPose } from "./locomotion";

/**
 * The combat camera director.
 *
 * One camera, many states, and a blend between them that never snaps, never
 * rolls the horizon and never takes the mouse away from the player. Every
 * number here is a multiple of the machine's height so a 68 m frame and an
 * 82 m frame are framed alike.
 *
 * Pure: no Babylon, no DOM. The obstruction query is injected, so the
 * director can be tested with a fake wall and the renderer can answer it
 * with a real sphere cast.
 */

export const CAMERA_DIRECTOR_STATES = [
  "free",
  "soft",
  "lock",
  "sprint",
  "close",
  "aim",
  "grapple",
  "clash",
  "knockdown",
  "finisher",
  "boundary",
] as const;
export type CameraDirectorState = (typeof CAMERA_DIRECTOR_STATES)[number];

export interface CameraPoint {
  readonly east: number;
  readonly north: number;
  readonly up: number;
}

/**
 * Distance along the line from `from` to `to` at which a sphere of `radius`
 * first touches something, or null when the line is clear.
 */
export type ObstructionQuery = (from: CameraPoint, to: CameraPoint, radiusMeters: number) => number | null;

export interface CombatCameraContext {
  readonly targetPosition: CameraPoint | null;
  readonly targetHeightMeters: number;
  /** Hard lock engaged by the player. */
  readonly locked: boolean;
  readonly sprinting: boolean;
  /** Booster output this frame, 0 to 1. */
  readonly boost: number;
  readonly aiming: boolean;
  readonly grapple: boolean;
  readonly clash: boolean;
  readonly knockedDown: boolean;
  readonly finisher: boolean;
  /** Bearing from the machine to the arena centre when it is near the edge, else null. */
  readonly boundaryBearingDeg: number | null;
  /** A committed attack is running: recentre gently behind the machine. */
  readonly attacking: boolean;
  /** Directional trauma this frame: strength 0 to 1 and the bearing it came from. */
  readonly trauma?: { readonly strength: number; readonly bearingDeg: number | null } | null;
  /** A short field-of-view kick, 0 to 1 (plasma fire). */
  readonly fovKick?: number;
}

interface StateTuning {
  /** Distance behind the anchor, heights. */
  readonly distance: number;
  /** Camera height above the feet, heights. */
  readonly height: number;
  /** Look-at height above the feet, heights. */
  readonly look: number;
  readonly fovDeg: number;
  /** Lateral offset to the right, heights (over the shoulder). */
  readonly lateral: number;
  /** How much the look point leans toward the target, 0 to 1. */
  readonly frame: number;
  /** Spring frequency, per second. Higher is tighter. */
  readonly omega: number;
  /** Degrees per second the camera orbits on its own. */
  readonly orbit: number;
  /** Mouse sensitivity multiplier. */
  readonly sensitivity: number;
}

const TUNING: Readonly<Record<CameraDirectorState, StateTuning>> = {
  free: {
    distance: 2.1,
    height: 1.05,
    look: 0.72,
    fovDeg: 62,
    lateral: 0,
    frame: 0,
    omega: 4,
    orbit: 0,
    sensitivity: 1,
  },
  soft: {
    distance: 2.05,
    height: 0.95,
    look: 0.76,
    fovDeg: 58,
    lateral: 0.22,
    frame: 0.3,
    omega: 5,
    orbit: 0,
    sensitivity: 1,
  },
  lock: {
    distance: 2.2,
    height: 0.9,
    look: 0.8,
    fovDeg: 56,
    lateral: 0.28,
    frame: 0.48,
    omega: 6,
    orbit: 0,
    sensitivity: 1,
  },
  sprint: {
    distance: 2.7,
    height: 1.0,
    look: 0.8,
    fovDeg: 68,
    lateral: 0.12,
    frame: 0.15,
    omega: 4,
    orbit: 0,
    sensitivity: 1,
  },
  close: {
    distance: 1.75,
    height: 0.85,
    look: 0.85,
    fovDeg: 60,
    lateral: 0.34,
    frame: 0.42,
    omega: 6.5,
    orbit: 0,
    sensitivity: 1,
  },
  aim: {
    distance: 1.3,
    height: 0.95,
    look: 0.96,
    fovDeg: 44,
    lateral: 0.5,
    frame: 0.2,
    omega: 9,
    orbit: 0,
    sensitivity: 0.6,
  },
  grapple: {
    distance: 1.9,
    height: 0.75,
    look: 0.75,
    fovDeg: 55,
    lateral: 0.55,
    frame: 0.5,
    omega: 3,
    orbit: 11,
    sensitivity: 0.7,
  },
  clash: {
    distance: 1.8,
    height: 0.7,
    look: 0.78,
    fovDeg: 52,
    lateral: 0.7,
    frame: 0.5,
    omega: 5,
    orbit: 0,
    sensitivity: 0.5,
  },
  knockdown: {
    distance: 2.4,
    height: 1.3,
    look: 0.45,
    fovDeg: 60,
    lateral: 0.2,
    frame: 0.25,
    omega: 3,
    orbit: 0,
    sensitivity: 0.8,
  },
  finisher: {
    distance: 1.6,
    height: 0.7,
    look: 0.8,
    fovDeg: 48,
    lateral: 0.5,
    frame: 0.6,
    omega: 3,
    orbit: 18,
    sensitivity: 0.3,
  },
  boundary: {
    distance: 2.0,
    height: 1.1,
    look: 0.7,
    fovDeg: 62,
    lateral: 0,
    frame: 0.2,
    omega: 4,
    orbit: 0,
    sensitivity: 1,
  },
};

export const CAMERA_DIRECTOR_TUNING = TUNING;

/** Seconds a candidate state has to hold before the director commits to it. */
const HYSTERESIS_SECONDS = 0.14;
/** States that take over on the frame they are asked for. */
const INSTANT_STATES: ReadonlySet<CameraDirectorState> = new Set([
  "finisher",
  "clash",
  "grapple",
  "knockdown",
  "aim",
]);
/** Soft framing engages inside this many heights of the target. */
const SOFT_RANGE_HEIGHTS = 6.5;
/** Close pressure engages inside this many heights. */
const CLOSE_RANGE_HEIGHTS = 1.35;
/** A hard lock suggests breaking beyond this many heights. */
export const LOCK_BREAK_HEIGHTS = 10;
/** The lock's bearing stops updating when the bodies nearly overlap, so it cannot spin. */
const OVERLAP_HEIGHTS = 0.45;
/** How far the player can drag the view off a locked target, degrees. */
const LOCK_OFFSET_LIMIT_DEG = 120;
/** Seconds of no mouse before the director may recentre on its own. */
const MOUSE_IDLE_SECONDS = 0.45;
/** The camera never rolls past this, in degrees. */
export const MAX_ROLL_DEG = 1.4;

export interface CameraDirectorSnapshot {
  readonly state: CameraDirectorState;
  readonly pending: CameraDirectorState | null;
  readonly pendingSeconds: number;
  /** Blended tuning: distance, height, look, fov, lateral, frame. */
  readonly values: readonly number[];
  readonly velocities: readonly number[];
  /** Player's drag off the locked bearing, degrees. */
  readonly yawOffsetDeg: number;
  readonly mouseIdleSeconds: number;
  readonly orbitDeg: number;
  /** Metres actually behind after obstruction; zero before the first frame. */
  readonly distanceMeters: number;
  readonly fovKick: number;
  readonly traumaEast: number;
  readonly traumaNorth: number;
  readonly traumaUp: number;
  readonly traumaStrength: number;
  /** The last bearing used for the lock, held while the bodies overlap. */
  readonly lockBearingDeg: number | null;
  /** True when the target is far enough that a hard lock should let go. */
  readonly lockBreakSuggested: boolean;
}

function tuningVector(tuning: StateTuning): number[] {
  return [tuning.distance, tuning.height, tuning.look, tuning.fovDeg, tuning.lateral, tuning.frame];
}

export function initialDirector(): CameraDirectorSnapshot {
  return {
    state: "free",
    pending: null,
    pendingSeconds: 0,
    values: tuningVector(TUNING.free),
    velocities: [0, 0, 0, 0, 0, 0],
    yawOffsetDeg: 0,
    mouseIdleSeconds: 10,
    orbitDeg: 0,
    distanceMeters: 0,
    fovKick: 0,
    traumaEast: 0,
    traumaNorth: 0,
    traumaUp: 0,
    traumaStrength: 0,
    lockBearingDeg: null,
    lockBreakSuggested: false,
  };
}

function bearingBetween(from: CameraPoint | JaegerPose, to: CameraPoint): number {
  return normalizeDegrees((Math.atan2(to.east - from.east, to.north - from.north) * 180) / Math.PI);
}

/** Which state the fight is asking for this frame, before hysteresis. */
export function desiredDirectorState(
  pose: JaegerPose,
  profile: LocomotionProfile,
  combat: CombatCameraContext,
): CameraDirectorState {
  const height = profile.heightMeters;
  const separation = combat.targetPosition
    ? Math.hypot(combat.targetPosition.east - pose.east, combat.targetPosition.north - pose.north)
    : Number.POSITIVE_INFINITY;
  if (combat.finisher) return "finisher";
  if (combat.clash) return "clash";
  if (combat.grapple) return "grapple";
  if (combat.knockedDown) return "knockdown";
  if (combat.aiming) return "aim";
  if (combat.boundaryBearingDeg !== null && !combat.locked) return "boundary";
  if (combat.locked && combat.targetPosition) return "lock";
  if (separation < CLOSE_RANGE_HEIGHTS * height) return "close";
  if (combat.sprinting) return "sprint";
  if (separation < SOFT_RANGE_HEIGHTS * height) return "soft";
  return "free";
}

export interface DirectorStep {
  readonly director: CameraDirectorSnapshot;
  readonly yawDeg: number;
}

/**
 * Advances the director one frame. Returns the new snapshot and the camera
 * yaw after the mouse, the lock and any recentring have been applied.
 */
export function stepDirector(
  snapshot: CameraDirectorSnapshot,
  yawDeg: number,
  input: CameraInput,
  deltaSeconds: number,
  pose: JaegerPose,
  profile: LocomotionProfile,
  comfort: CameraComfort,
  combat: CombatCameraContext,
): DirectorStep {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return { director: snapshot, yawDeg };
  const dt = Math.min(deltaSeconds, 0.1);
  const height = profile.heightMeters;

  // State selection with hysteresis. The instant states cut straight in,
  // because a grab or a knockdown cannot wait for the camera to agree.
  const wanted = desiredDirectorState(pose, profile, combat);
  let state = snapshot.state;
  let pending = snapshot.pending;
  let pendingSeconds = snapshot.pendingSeconds;
  if (wanted !== state) {
    if (INSTANT_STATES.has(wanted)) {
      state = wanted;
      pending = null;
      pendingSeconds = 0;
    } else if (pending === wanted) {
      pendingSeconds += dt;
      if (pendingSeconds >= HYSTERESIS_SECONDS) {
        state = wanted;
        pending = null;
        pendingSeconds = 0;
      }
    } else {
      pending = wanted;
      pendingSeconds = dt;
    }
  } else {
    pending = null;
    pendingSeconds = 0;
  }

  // Critically damped springs toward the state's tuning, one per value.
  const tuning = TUNING[state];
  const target = tuningVector(tuning);
  const values = [...snapshot.values];
  const velocities = [...snapshot.velocities];
  const omega = tuning.omega;
  // Substep so a long frame integrates as several short ones: the spring is
  // only critically damped when omega times the step stays well under one.
  const substeps = Math.max(1, Math.ceil(dt / (1 / 60)));
  const step = dt / substeps;
  for (let i = 0; i < values.length; i += 1) {
    let current = values[i] ?? 0;
    let velocity = velocities[i] ?? 0;
    const goal = target[i] ?? current;
    for (let n = 0; n < substeps; n += 1) {
      const acceleration = omega * omega * (goal - current) - 2 * omega * velocity;
      velocity += acceleration * step;
      current += velocity * step;
    }
    values[i] = current;
    velocities[i] = velocity;
  }

  // The mouse turns the camera now. Under a lock it drags the view off the
  // target instead, and the drag relaxes while the mouse is idle.
  const mouseMoved = Math.abs(input.yawDeltaDeg) > 1e-4 || Math.abs(input.pitchDeltaDeg) > 1e-4;
  const mouseIdleSeconds = mouseMoved ? 0 : snapshot.mouseIdleSeconds + dt;
  const scaledYawDelta = input.yawDeltaDeg * tuning.sensitivity;
  let yawOffsetDeg = snapshot.yawOffsetDeg;
  let lockBearingDeg = snapshot.lockBearingDeg;
  let nextYaw: number;
  let lockBreakSuggested = false;

  const separation = combat.targetPosition
    ? Math.hypot(combat.targetPosition.east - pose.east, combat.targetPosition.north - pose.north)
    : Number.POSITIVE_INFINITY;

  if (state === "lock" && combat.targetPosition) {
    // Hold the bearing while the bodies overlap so the camera cannot whip
    // round the moment the creature steps through the machine.
    if (separation > OVERLAP_HEIGHTS * height || lockBearingDeg === null) {
      lockBearingDeg = bearingBetween(pose, combat.targetPosition);
    }
    yawOffsetDeg = clamp(yawOffsetDeg + scaledYawDelta, -LOCK_OFFSET_LIMIT_DEG, LOCK_OFFSET_LIMIT_DEG);
    if (mouseIdleSeconds > MOUSE_IDLE_SECONDS) {
      yawOffsetDeg = approach(yawOffsetDeg, 0, 70 * dt);
    }
    // Ease onto the locked bearing rather than jumping to it.
    const goal = normalizeDegrees(lockBearingDeg + yawOffsetDeg);
    const follow = clamp(6 * dt, 0, 1);
    nextYaw = normalizeDegrees(yawDeg + signedDelta(yawDeg, goal) * follow);
    lockBreakSuggested = separation > LOCK_BREAK_HEIGHTS * height;
  } else {
    lockBearingDeg = null;
    yawOffsetDeg = 0;
    nextYaw = normalizeDegrees(yawDeg + scaledYawDelta);
    // Gentle recentring: only when the mouse is idle, only in the states that
    // have somewhere to look, and never fast enough to fight the player.
    if (mouseIdleSeconds > MOUSE_IDLE_SECONDS) {
      if (
        (state === "soft" || state === "close") &&
        combat.targetPosition &&
        separation > OVERLAP_HEIGHTS * height
      ) {
        const bearing = bearingBetween(pose, combat.targetPosition);
        const rate = state === "close" ? 1.6 : 1.1;
        nextYaw = normalizeDegrees(nextYaw + signedDelta(nextYaw, bearing) * clamp(rate * dt, 0, 1));
      } else if (state === "boundary" && combat.boundaryBearingDeg !== null) {
        nextYaw = normalizeDegrees(
          nextYaw + signedDelta(nextYaw, combat.boundaryBearingDeg) * clamp(1.4 * dt, 0, 1),
        );
      } else if (combat.attacking && (state === "free" || state === "sprint")) {
        nextYaw = normalizeDegrees(nextYaw + signedDelta(nextYaw, pose.yawDeg) * clamp(0.9 * dt, 0, 1));
      }
    }
  }

  // The states that orbit on their own do it slowly and only while they last.
  const orbitDeg =
    tuning.orbit > 0 ? snapshot.orbitDeg + tuning.orbit * dt : approach(snapshot.orbitDeg, 0, 90 * dt);

  // Trauma: a short directional push, decaying fast. Scaled by comfort.
  const trauma = combat.trauma;
  let traumaStrength = Math.max(0, snapshot.traumaStrength - dt * 3.2);
  let traumaEast = snapshot.traumaEast;
  let traumaNorth = snapshot.traumaNorth;
  let traumaUp = snapshot.traumaUp;
  if (trauma && trauma.strength > 0 && comfort.shakeScale > 0) {
    const strength = clamp(trauma.strength, 0, 1) * comfort.shakeScale;
    if (strength > traumaStrength) {
      traumaStrength = strength;
      if (trauma.bearingDeg !== null) {
        const radians = (trauma.bearingDeg * Math.PI) / 180;
        // Pushed away from where the hit came from.
        traumaEast = -Math.sin(radians);
        traumaNorth = -Math.cos(radians);
        traumaUp = 0.35;
      } else {
        traumaEast = 0;
        traumaNorth = 0;
        traumaUp = -1;
      }
    }
  }
  const fovKick =
    Math.max(0, snapshot.fovKick - dt * 4) + (combat.fovKick ?? 0) * (comfort.reducedMotion ? 0 : 1);

  return {
    director: {
      state,
      pending,
      pendingSeconds,
      values,
      velocities,
      yawOffsetDeg,
      mouseIdleSeconds,
      orbitDeg,
      distanceMeters: snapshot.distanceMeters,
      fovKick: clamp(fovKick, 0, 1),
      traumaEast,
      traumaNorth,
      traumaUp,
      traumaStrength,
      lockBearingDeg,
      lockBreakSuggested,
    },
    yawDeg: nextYaw,
  };
}

export interface DirectorPlacementInput {
  readonly director: CameraDirectorSnapshot;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly pose: JaegerPose;
  readonly profile: LocomotionProfile;
  readonly comfort: CameraComfort;
  readonly combat: CombatCameraContext;
  readonly obstruction?: ObstructionQuery;
  /** Seconds since the last placement, for the obstruction restore rate. */
  readonly deltaSeconds: number;
  /** Stride sway, 0 to 1, from the camera state. */
  readonly swayPhase: number;
  /** Decaying impulse, 0 to 1, from the camera state. */
  readonly impulse: number;
}

export interface DirectorPlacement {
  readonly placement: CameraPlacement;
  readonly director: CameraDirectorSnapshot;
}

/** Where the camera goes this frame, given the director's blend. */
export function directorPlacement(input: DirectorPlacementInput): DirectorPlacement {
  const { director, pose, profile, comfort, combat } = input;
  const height = profile.heightMeters;
  const [distanceH = 2, heightH = 1, lookH = 0.75, fovBase = 60, lateralH = 0, frame = 0] = director.values;
  const yawDeg = normalizeDegrees(input.yawDeg + director.orbitDeg);
  const yawRad = (yawDeg * Math.PI) / 180;
  const pitchRad = (input.pitchDeg * Math.PI) / 180;

  // Framing: the look point leans from the machine toward the target, and the
  // boom lengthens so both bodies fit when they are far apart.
  const lookPlayer: CameraPoint = { east: pose.east, north: pose.north, up: pose.up + lookH * height };
  let look = lookPlayer;
  let separation = 0;
  if (combat.targetPosition) {
    const target = combat.targetPosition;
    separation = Math.hypot(target.east - pose.east, target.north - pose.north);
    const targetCentre: CameraPoint = {
      east: target.east,
      north: target.north,
      up: target.up + combat.targetHeightMeters * 0.5,
    };
    const weight = clamp(frame, 0, 1) * 0.5;
    look = {
      east: lookPlayer.east + (targetCentre.east - lookPlayer.east) * weight,
      north: lookPlayer.north + (targetCentre.north - lookPlayer.north) * weight,
      up: lookPlayer.up + (targetCentre.up - lookPlayer.up) * weight * 0.6,
    };
  }
  const framingDistance = frame > 0.05 ? clamp(separation * 0.36, 0, 3.4 * height) : 0;
  const speedFraction = clamp(pose.speedMps / Math.max(1, profile.runSpeedMps), 0, 1);
  const speedPull = comfort.reducedMotion ? 0 : speedFraction * 0.35 * height;
  const idealDistance = Math.max(distanceH * height, framingDistance) + speedPull;

  const behindEast = -Math.sin(yawRad);
  const behindNorth = -Math.cos(yawRad);
  const rightEast = Math.cos(yawRad);
  const rightNorth = -Math.sin(yawRad);
  const lateral = lateralH * height;

  // The boom runs from a point above the machine's chest back to the camera.
  const boomFrom: CameraPoint = {
    east: pose.east,
    north: pose.north,
    up: pose.up + Math.min(heightH, 0.9) * height,
  };
  const boomTo = (distance: number): CameraPoint => ({
    east: pose.east + behindEast * distance * Math.cos(pitchRad) + rightEast * lateral,
    north: pose.north + behindNorth * distance * Math.cos(pitchRad) + rightNorth * lateral,
    up: pose.up + heightH * height + distance * Math.sin(pitchRad),
  });

  // Obstruction: pull in at once, let out slowly.
  let targetDistance = idealDistance;
  const blocked = input.obstruction?.(boomFrom, boomTo(idealDistance), height * 0.06) ?? null;
  if (blocked !== null)
    targetDistance = Math.max(height * 0.35, Math.min(idealDistance, blocked - height * 0.06));
  let distanceMeters: number;
  if (director.distanceMeters === 0) distanceMeters = targetDistance;
  else if (targetDistance < director.distanceMeters) distanceMeters = targetDistance;
  else distanceMeters = Math.min(targetDistance, director.distanceMeters + height * 0.9 * input.deltaSeconds);

  const camera = boomTo(distanceMeters);
  const shake = comfort.shakeScale;
  const sway = comfort.reducedMotion ? 0 : Math.sin(input.swayPhase * Math.PI * 2) * shake;
  const traumaOffset = director.traumaStrength * height * 0.022;
  const east = camera.east + sway * height * 0.008 + director.traumaEast * traumaOffset;
  const north = camera.north + director.traumaNorth * traumaOffset;
  const up = camera.up + director.traumaUp * traumaOffset - input.impulse * height * 0.015 * shake;

  const boostWiden =
    combat.sprinting || combat.boost > 0 ? clamp(combat.boost, 0, 1) * 6 + (combat.sprinting ? 2 : 0) : 0;
  const fovDeg = clamp(
    fovBase + comfort.fovOffsetDeg + (comfort.reducedMotion ? 0 : boostWiden + director.fovKick * 5),
    30,
    95,
  );
  const rollDeg = clamp(
    sway * 0.9 * shake + director.traumaStrength * 0.4 * (director.traumaEast > 0 ? 1 : -1),
    -MAX_ROLL_DEG,
    MAX_ROLL_DEG,
  );

  return {
    placement: {
      east,
      north,
      up,
      targetEast: look.east,
      targetNorth: look.north,
      targetUp: look.up,
      fovDeg,
      rollDeg,
    },
    director: { ...director, distanceMeters },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  if (value > target) return Math.max(target, value - rate);
  return value;
}
