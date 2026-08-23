import type { EnvironmentEffects } from "../world/environment";
import {
  PLAYER_CLEARANCE_METERS,
  type InteriorRoom,
  type RoomObstacle,
  type RoomPoint,
} from "./interiorLayout";

/**
 * On-foot movement.
 *
 * A person, at person scale. Every number here is written down once so it can be
 * compared against the Jaeger-scale constants elsewhere in the codebase and seen
 * to be a different order of magnitude: a Jaeger is 75 m tall and crosses a
 * kilometre in the time a person crosses forty metres. Nothing in this file
 * reads a Jaeger constant, and the tests assert that the two never converge.
 *
 * Pure: given a pose, an input snapshot, a room and the environment, it returns
 * the next pose. No Babylon, no DOM, no listeners. The camera is placed from the
 * pose rather than the pose being read back out of a camera.
 */

export const ON_FOOT = {
  /** Standing eye height, metres. */
  eyeHeightMeters: 1.68,
  crouchEyeHeightMeters: 1.12,
  /** Body height, handed to the environment so water states resolve for a person. */
  heightMeters: 1.8,
  /** Collision radius. Wide enough not to clip a doorframe, narrow enough to pass one. */
  radiusMeters: 0.34,
  walkSpeedMps: 2.4,
  runSpeedMps: 5.1,
  crouchSpeedMps: 1.15,
  /** Metres per second squared. Reaching walking pace takes about a fifth of a second. */
  accelerationMps2: 22,
  /** Deceleration with no input, metres per second squared. */
  frictionMps2: 26,
  /** Degrees of yaw per pixel of mouse movement at the default sensitivity. */
  lookDegreesPerPixel: 0.12,
  /** Degrees per second when turning with the keyboard instead of the mouse. */
  keyboardTurnDegPerSecond: 110,
  /** Looking further up or down than this puts the horizon out of the frame. */
  maxPitchDeg: 85,
  /** Longest movement substep. Anything larger is split so a fast run cannot tunnel a wall. */
  maxSubstepSeconds: 0.02,
} as const;

/** Rooms open to the weather. Everywhere else, the roof is doing its job. */
const EXPOSED_ROOMS: ReadonlySet<string> = new Set(["jaeger-bay", "launch"]);

/** What the environment does to a person indoors, which is nothing. */
export const SHELTERED_EFFECTS: Pick<EnvironmentEffects, "tractionMultiplier" | "movementMultiplier"> = {
  tractionMultiplier: 1,
  movementMultiplier: 1,
};

export interface OnFootInput {
  /** Forward is +1, back is -1. */
  readonly forward: number;
  /** Right is +1, left is -1. */
  readonly strafe: number;
  readonly run: boolean;
  readonly crouch: boolean;
  /** Yaw change in degrees, already scaled by sensitivity. */
  readonly yawDeltaDeg: number;
  readonly pitchDeltaDeg: number;
}

export const NEUTRAL_INPUT: OnFootInput = {
  forward: 0,
  strafe: 0,
  run: false,
  crouch: false,
  yawDeltaDeg: 0,
  pitchDeltaDeg: 0,
};

export interface OnFootPose {
  readonly x: number;
  readonly z: number;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly crouched: boolean;
  /** Metres per second actually achieved, after collision. Reported, not commanded. */
  readonly speedMps: number;
  /** True when the last step was blocked by something. Drives the unstuck hint. */
  readonly blocked: boolean;
}

export function poseAt(point: RoomPoint, yawDeg = 0): OnFootPose {
  return {
    x: point.x,
    z: point.z,
    yawDeg,
    pitchDeg: 0,
    velocityX: 0,
    velocityZ: 0,
    crouched: false,
    speedMps: 0,
    blocked: false,
  };
}

export function eyeHeightOf(pose: OnFootPose): number {
  return pose.crouched ? ON_FOOT.crouchEyeHeightMeters : ON_FOOT.eyeHeightMeters;
}

/** Effects a room actually feels: weather indoors is weather outside a closed door. */
export function effectsForRoom(
  room: InteriorRoom,
  outside: EnvironmentEffects,
): Pick<EnvironmentEffects, "tractionMultiplier" | "movementMultiplier"> {
  if (!EXPOSED_ROOMS.has(room.id)) return SHELTERED_EFFECTS;
  return {
    tractionMultiplier: outside.tractionMultiplier,
    movementMultiplier: outside.movementMultiplier,
  };
}

/**
 * Advances the player by one frame.
 *
 * Movement is resolved one axis at a time, which is what makes a shoulder slide
 * along a wall instead of stopping dead against it, and is split into substeps
 * so a running player cannot pass through a fixture between two frames.
 */
export function stepOnFoot(
  pose: OnFootPose,
  input: OnFootInput,
  deltaSeconds: number,
  room: InteriorRoom,
  effects: Pick<EnvironmentEffects, "tractionMultiplier" | "movementMultiplier"> = SHELTERED_EFFECTS,
): OnFootPose {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return pose;

  const yawDeg = normalizeDegrees(pose.yawDeg + input.yawDeltaDeg);
  const pitchDeg = clamp(pose.pitchDeg + input.pitchDeltaDeg, -ON_FOOT.maxPitchDeg, ON_FOOT.maxPitchDeg);

  const substeps = Math.min(8, Math.max(1, Math.ceil(deltaSeconds / ON_FOOT.maxSubstepSeconds)));
  const step = deltaSeconds / substeps;

  let x = pose.x;
  let z = pose.z;
  let velocityX = pose.velocityX;
  let velocityZ = pose.velocityZ;
  let blocked = false;

  const crouched = input.crouch;
  const baseSpeed = crouched
    ? ON_FOOT.crouchSpeedMps
    : input.run
      ? ON_FOOT.runSpeedMps
      : ON_FOOT.walkSpeedMps;
  // Wet or slick footing costs grip, which costs acceleration rather than top
  // speed: a person on ice still walks, they just cannot start or stop quickly.
  const traction = clamp(effects.tractionMultiplier, 0.2, 1.2);
  const maxSpeed = baseSpeed * clamp(effects.movementMultiplier, 0.1, 1.5);

  const yawRadians = (yawDeg * Math.PI) / 180;
  const forwardX = Math.sin(yawRadians);
  const forwardZ = Math.cos(yawRadians);
  const magnitude = Math.hypot(input.forward, input.strafe);
  const wish =
    magnitude > 1e-6
      ? {
          x: (forwardX * input.forward + forwardZ * input.strafe) / Math.max(1, magnitude),
          z: (forwardZ * input.forward - forwardX * input.strafe) / Math.max(1, magnitude),
        }
      : { x: 0, z: 0 };

  for (let index = 0; index < substeps; index += 1) {
    if (magnitude > 1e-6) {
      const targetX = wish.x * maxSpeed;
      const targetZ = wish.z * maxSpeed;
      const rate = ON_FOOT.accelerationMps2 * traction * step;
      velocityX = approach(velocityX, targetX, rate);
      velocityZ = approach(velocityZ, targetZ, rate);
    } else {
      const rate = ON_FOOT.frictionMps2 * traction * step;
      velocityX = approach(velocityX, 0, rate);
      velocityZ = approach(velocityZ, 0, rate);
    }

    const nextX = resolveAxis(x, z, velocityX * step, "x", room);
    if (nextX.blocked) {
      blocked = true;
      velocityX = 0;
    }
    x = nextX.value;

    const nextZ = resolveAxis(x, z, velocityZ * step, "z", room);
    if (nextZ.blocked) {
      blocked = true;
      velocityZ = 0;
    }
    z = nextZ.value;
  }

  return {
    x,
    z,
    yawDeg,
    pitchDeg,
    velocityX,
    velocityZ,
    crouched,
    speedMps: Math.hypot(velocityX, velocityZ),
    blocked,
  };
}

/**
 * Moves the player somewhere they can certainly stand.
 *
 * Deterministic and always inside the room: the nearest spawn point that is
 * clear, falling back to the room centre. This is the safe action a player uses
 * when geometry has trapped them, so it must never itself be able to fail.
 */
export function unstuck(pose: OnFootPose, room: InteriorRoom): OnFootPose {
  const candidates = [...room.spawnPoints, { x: 0, z: 0 }];
  let best: RoomPoint = { x: 0, z: 0 };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isClear(candidate.x, candidate.z, room)) continue;
    const distance = Math.hypot(candidate.x - pose.x, candidate.z - pose.z);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return { ...poseAt(best, pose.yawDeg), pitchDeg: 0 };
}

/** True when a person of the standard radius fits at this point. */
export function isClear(x: number, z: number, room: InteriorRoom): boolean {
  const halfWidth = room.widthMeters / 2 - ON_FOOT.radiusMeters - PLAYER_CLEARANCE_METERS;
  const halfDepth = room.depthMeters / 2 - ON_FOOT.radiusMeters - PLAYER_CLEARANCE_METERS;
  if (Math.abs(x) > halfWidth || Math.abs(z) > halfDepth) return false;
  return !room.obstacles.some((obstacle) => intersects(x, z, obstacle));
}

function resolveAxis(
  x: number,
  z: number,
  delta: number,
  axis: "x" | "z",
  room: InteriorRoom,
): { value: number; blocked: boolean } {
  const current = axis === "x" ? x : z;
  if (delta === 0) return { value: current, blocked: false };
  const proposed = current + delta;
  const testX = axis === "x" ? proposed : x;
  const testZ = axis === "z" ? proposed : z;
  if (isClear(testX, testZ, room)) return { value: proposed, blocked: false };

  // Slide up to the surface rather than stopping short of it, so a wall feels
  // solid instead of sticky.
  const limit = axis === "x" ? room.widthMeters / 2 : room.depthMeters / 2;
  const bound = limit - ON_FOOT.radiusMeters - PLAYER_CLEARANCE_METERS;
  const clamped = clamp(proposed, -bound, bound);
  if (isClear(axis === "x" ? clamped : x, axis === "z" ? clamped : z, room)) {
    return { value: clamped, blocked: true };
  }
  return { value: current, blocked: true };
}

function intersects(x: number, z: number, obstacle: RoomObstacle): boolean {
  const reach = ON_FOOT.radiusMeters;
  return (
    Math.abs(x - obstacle.x) <= obstacle.halfWidth + reach &&
    Math.abs(z - obstacle.z) <= obstacle.halfDepth + reach
  );
}

function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  if (value > target) return Math.max(target, value - rate);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
