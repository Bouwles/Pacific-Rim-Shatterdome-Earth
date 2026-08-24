import type { BodyZone, KaijuDefinition } from "../data/kaiju";
import { signedDelta, normalizeDegrees } from "../jaegers/locomotion";
import type { Point3 } from "./hitVolumes";

/**
 * Targeting.
 *
 * Four ways to say what you mean, in increasing order of deliberateness:
 *
 * - **Soft targeting** picks whatever the player is already facing, so a swing
 *   thrown at something obvious lands on it without any target being chosen.
 * - **An explicit lock** holds one creature until it is dropped, and survives a
 *   camera change.
 * - **Cycling** moves the lock between whatever is in range, left to right as
 *   the player sees them rather than by distance, because that is how they read
 *   on screen.
 * - **Aim mode** picks a body zone rather than a creature, which is the only way
 *   "hit its left arm" can mean anything against something eighty metres tall.
 *
 * Pure geometry over plain records. Nothing here knows what a mesh is.
 */

export interface TargetCandidate {
  readonly id: string;
  readonly east: number;
  readonly north: number;
  readonly up: number;
  /** Rough body radius, used to weight big targets over small ones. */
  readonly radiusMeters: number;
  readonly displayName: string;
}

export interface TargetingPose {
  readonly east: number;
  readonly north: number;
  readonly up: number;
  readonly yawDeg: number;
}

/** How far off the view centre something can be and still be soft targeted. */
export const SOFT_TARGET_CONE_DEG = 55;
/** Beyond this a target is out of the fight, whatever the player is looking at. */
export const TARGET_RANGE_METERS = 900;

export interface TargetPick {
  readonly candidate: TargetCandidate;
  readonly distanceMeters: number;
  readonly angleDeg: number;
  /** Lower is better. Distance and angle together, so neither wins alone. */
  readonly score: number;
}

/** Everything in range and in front, sorted best first. */
export function rankTargets(
  pose: TargetingPose,
  aimYawDeg: number,
  candidates: readonly TargetCandidate[],
  coneDeg = SOFT_TARGET_CONE_DEG,
  rangeMeters = TARGET_RANGE_METERS,
): readonly TargetPick[] {
  const picks: TargetPick[] = [];
  for (const candidate of candidates) {
    const distanceMeters = Math.hypot(candidate.east - pose.east, candidate.north - pose.north);
    if (distanceMeters > rangeMeters) continue;
    const bearing = normalizeDegrees(
      (Math.atan2(candidate.east - pose.east, candidate.north - pose.north) * 180) / Math.PI,
    );
    const angleDeg = Math.abs(signedDelta(aimYawDeg, bearing));
    if (angleDeg > coneDeg) continue;
    // Angle matters more than distance: something dead ahead and far off is a
    // better answer to "what did you mean" than something close and behind you.
    const score =
      angleDeg * 1.6 + (distanceMeters / Math.max(1, rangeMeters)) * 45 - candidate.radiusMeters * 0.05;
    picks.push({ candidate, distanceMeters, angleDeg, score });
  }
  return picks.sort((a, b) => a.score - b.score);
}

/** The target a swing thrown right now would land on, or null when there is nothing. */
export function softTarget(
  pose: TargetingPose,
  aimYawDeg: number,
  candidates: readonly TargetCandidate[],
): TargetPick | null {
  return rankTargets(pose, aimYawDeg, candidates)[0] ?? null;
}

/**
 * Next lock in the given direction, ordered left to right on screen.
 *
 * Ordered by signed angle rather than by distance: cycling should walk across
 * what the player can see in the order they see it.
 */
export function cycleTarget(
  pose: TargetingPose,
  aimYawDeg: number,
  candidates: readonly TargetCandidate[],
  currentId: string | null,
  direction: 1 | -1 = 1,
): string | null {
  const ordered = candidates
    .filter(
      (candidate) =>
        Math.hypot(candidate.east - pose.east, candidate.north - pose.north) <= TARGET_RANGE_METERS,
    )
    .map((candidate) => ({
      candidate,
      offset: signedDelta(
        aimYawDeg,
        normalizeDegrees(
          (Math.atan2(candidate.east - pose.east, candidate.north - pose.north) * 180) / Math.PI,
        ),
      ),
    }))
    .sort((a, b) => a.offset - b.offset);
  if (ordered.length === 0) return null;

  const index = currentId === null ? -1 : ordered.findIndex((entry) => entry.candidate.id === currentId);
  if (index === -1) return ordered[0]?.candidate.id ?? null;
  const next = (index + direction + ordered.length) % ordered.length;
  return ordered[next]?.candidate.id ?? null;
}

/** Where a zone actually sits, given where the creature is standing. */
/**
 * Where a zone sits, for anything with zones.
 *
 * A creature's head and a machine's Conn-Pod are placed by the same three
 * numbers, so both go through this rather than each having its own copy.
 */
export interface ZonePlacement {
  readonly id: string;
  readonly heightFraction: number;
  readonly forwardMeters: number;
  readonly lateralMeters: number;
  readonly radiusMeters: number;
}

export function placedZone(heightMeters: number, zone: ZonePlacement, pose: TargetingPose): Point3 {
  const yaw = (pose.yawDeg * Math.PI) / 180;
  const forwardEast = Math.sin(yaw);
  const forwardNorth = Math.cos(yaw);
  const rightEast = Math.cos(yaw);
  const rightNorth = -Math.sin(yaw);
  return {
    east: pose.east + forwardEast * zone.forwardMeters + rightEast * zone.lateralMeters,
    north: pose.north + forwardNorth * zone.forwardMeters + rightNorth * zone.lateralMeters,
    up: pose.up + zone.heightFraction * heightMeters,
  };
}

/** The zone nearest a contact point, for anything with a layout. */
export function nearestPlacedZone(
  heightMeters: number,
  zones: readonly ZonePlacement[],
  pose: TargetingPose,
  contact: Point3,
): { readonly zone: ZonePlacement; readonly position: Point3; readonly distanceMeters: number } | null {
  let best: { zone: ZonePlacement; position: Point3; distanceMeters: number } | null = null;
  for (const zone of zones) {
    const position = placedZone(heightMeters, zone, pose);
    const distanceMeters =
      Math.hypot(position.east - contact.east, position.up - contact.up, position.north - contact.north) -
      zone.radiusMeters;
    if (best === null || distanceMeters < best.distanceMeters) best = { zone, position, distanceMeters };
  }
  return best;
}

export function zonePosition(kaiju: KaijuDefinition, zone: BodyZone, pose: TargetingPose): Point3 {
  const yaw = (pose.yawDeg * Math.PI) / 180;
  const forwardEast = Math.sin(yaw);
  const forwardNorth = Math.cos(yaw);
  const rightEast = Math.cos(yaw);
  const rightNorth = -Math.sin(yaw);
  return {
    east: pose.east + forwardEast * zone.forwardMeters + rightEast * zone.lateralMeters,
    north: pose.north + forwardNorth * zone.forwardMeters + rightNorth * zone.lateralMeters,
    up: pose.up + zone.heightFraction * kaiju.heightMeters,
  };
}

export interface ZonePick {
  readonly zone: BodyZone;
  readonly position: Point3;
  readonly distanceMeters: number;
}

/**
 * Which body zone an attack aimed from here would land on.
 *
 * Aim pitch is what selects it: looking down picks legs and a tail, level picks
 * the torso and arms, up picks the head. That is the difference between fighting
 * a creature and fighting a health bar.
 */
export function zoneUnderAim(
  kaiju: KaijuDefinition,
  kaijuPose: TargetingPose,
  attacker: TargetingPose,
  attackerHeightMeters: number,
  aimPitchDeg: number,
): ZonePick | null {
  if (kaiju.zones.length === 0) return null;
  const distance = Math.hypot(kaijuPose.east - attacker.east, kaijuPose.north - attacker.north);
  // Where the aim ray is in height terms by the time it reaches the creature.
  const eye = attacker.up + attackerHeightMeters * 0.85;
  const aimHeight = eye + Math.tan((aimPitchDeg * Math.PI) / 180) * Math.max(1, distance);

  let best: ZonePick | null = null;
  for (const zone of kaiju.zones) {
    const position = zonePosition(kaiju, zone, kaijuPose);
    // Distance from the aim height, forgiven by the zone's own size.
    const heightError = Math.max(0, Math.abs(position.up - aimHeight) - zone.radiusMeters);
    const lateralError = Math.abs(zone.lateralMeters) * 0.25;
    const score = heightError + lateralError;
    if (best === null || score < best.distanceMeters) {
      best = { zone, position, distanceMeters: score };
    }
  }
  return best;
}

/** The zone a hit at this point landed on: nearest zone centre to the contact. */
export function zoneAtPoint(
  kaiju: KaijuDefinition,
  kaijuPose: TargetingPose,
  contact: Point3,
): ZonePick | null {
  let best: ZonePick | null = null;
  for (const zone of kaiju.zones) {
    const position = zonePosition(kaiju, zone, kaijuPose);
    const distanceMeters =
      Math.hypot(position.east - contact.east, position.up - contact.up, position.north - contact.north) -
      zone.radiusMeters;
    if (best === null || distanceMeters < best.distanceMeters) {
      best = { zone, position, distanceMeters };
    }
  }
  return best;
}

/** Target state a session carries. Survives camera changes, which is the point. */
export interface TargetingState {
  readonly lockedId: string | null;
  readonly aimMode: boolean;
  readonly aimZoneId: string | null;
}

export const INITIAL_TARGETING: TargetingState = { lockedId: null, aimMode: false, aimZoneId: null };

export function setLock(state: TargetingState, lockedId: string | null): TargetingState {
  return { ...state, lockedId };
}

export function setAimMode(state: TargetingState, aimMode: boolean): TargetingState {
  // Leaving aim mode drops the zone with it: an aimed zone that outlived aim
  // mode would keep steering attacks the player thought they had let go of.
  return aimMode ? { ...state, aimMode } : { ...state, aimMode, aimZoneId: null };
}

export function setAimZone(state: TargetingState, aimZoneId: string | null): TargetingState {
  return { ...state, aimZoneId };
}
