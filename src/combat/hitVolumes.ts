import type { HitVolumeSpec } from "../data/moves";

/**
 * Hit volumes.
 *
 * A limb on a machine this size crosses twenty metres in five ticks. Testing
 * where it is at each tick and asking whether that overlaps anything misses
 * targets that were between the samples, so every volume is swept: the capsule
 * is placed where it was at the start of the tick and where it is at the end,
 * and the closest approach over that movement is what decides a hit.
 *
 * Nothing here touches a mesh. A hit is geometry against geometry, both of them
 * numbers the simulation already has, which is what keeps hit detection out of
 * the renderer and reproducible in a headless test.
 */

export interface Point3 {
  readonly east: number;
  readonly up: number;
  readonly north: number;
}

/** A capsule as a segment with a radius, in world-local metres. */
export interface Capsule {
  readonly a: Point3;
  readonly b: Point3;
  readonly radiusMeters: number;
}

/** A target zone: a sphere the size of a body part. */
export interface TargetSphere {
  readonly id: string;
  readonly centre: Point3;
  readonly radiusMeters: number;
}

export interface SweepResult {
  readonly hit: boolean;
  /** 0 to 1 through the tick where the closest approach happened. */
  readonly atFraction: number;
  /** Metres between surfaces at that moment. Negative is penetration depth. */
  readonly separationMeters: number;
  /** Where the two were closest, for the debug view and for effects. */
  readonly contact: Point3;
}

/**
 * How finely the sweep is sampled inside one tick.
 *
 * Four substeps at a 20 m per tick swing means the volume never advances more
 * than five metres between samples, which is well inside the smallest radius any
 * shipped volume or body zone uses.
 */
export const SWEEP_SUBSTEPS = 4;

/**
 * Places a volume in the world for a given attacker pose.
 *
 * `progress` is 0 to 1 through the volume's own active window, which is what
 * makes the capsule travel from `fromForwardMeters` to `toForwardMeters` rather
 * than appearing at its full extent on the first tick.
 */
export function placeVolume(
  spec: HitVolumeSpec,
  attacker: { east: number; north: number; up: number; yawDeg: number },
  attackerHeightMeters: number,
  progress: number,
): Capsule {
  const clamped = Math.min(1, Math.max(0, progress));
  const forward = spec.fromForwardMeters + (spec.toForwardMeters - spec.fromForwardMeters) * clamped;
  const yaw = (attacker.yawDeg * Math.PI) / 180;
  const forwardEast = Math.sin(yaw);
  const forwardNorth = Math.cos(yaw);
  // Right hand of the facing, so a lateral offset means the attacker's right.
  const rightEast = Math.cos(yaw);
  const rightNorth = -Math.sin(yaw);

  const height = attacker.up + spec.heightFraction * attackerHeightMeters;
  const tip: Point3 = {
    east: attacker.east + forwardEast * forward + rightEast * spec.lateralMeters,
    north: attacker.north + forwardNorth * forward + rightNorth * spec.lateralMeters,
    up: height,
  };
  // The capsule runs from the body out to the tip, so a limb is a line rather
  // than a ball on the end of nothing.
  const root: Point3 = {
    east: attacker.east + forwardEast * spec.fromForwardMeters * 0.4 + rightEast * spec.lateralMeters * 0.6,
    north:
      attacker.north + forwardNorth * spec.fromForwardMeters * 0.4 + rightNorth * spec.lateralMeters * 0.6,
    up: height,
  };
  return { a: root, b: tip, radiusMeters: spec.radiusMeters };
}

/**
 * Sweeps a capsule from one placement to another against a target sphere.
 *
 * The target may be moving too, so both ends are interpolated: a kaiju walking
 * into a punch is the same problem as a punch reaching a standing kaiju.
 */
export function sweepCapsuleAgainstSphere(
  from: Capsule,
  to: Capsule,
  targetFrom: TargetSphere,
  targetTo: TargetSphere,
): SweepResult {
  let best: SweepResult = {
    hit: false,
    atFraction: 0,
    separationMeters: Number.POSITIVE_INFINITY,
    contact: from.b,
  };

  for (let step = 0; step <= SWEEP_SUBSTEPS; step += 1) {
    const t = step / SWEEP_SUBSTEPS;
    const a = lerpPoint(from.a, to.a, t);
    const b = lerpPoint(from.b, to.b, t);
    const centre = lerpPoint(targetFrom.centre, targetTo.centre, t);
    const radius = from.radiusMeters + (to.radiusMeters - from.radiusMeters) * t;
    const targetRadius = targetFrom.radiusMeters + (targetTo.radiusMeters - targetFrom.radiusMeters) * t;

    const closest = closestPointOnSegment(a, b, centre);
    const distance = distanceBetween(closest, centre);
    const separation = distance - (radius + targetRadius);
    if (separation < best.separationMeters) {
      best = { hit: separation <= 0, atFraction: t, separationMeters: separation, contact: closest };
    }
    if (separation <= 0) break;
  }

  return best;
}

/** Point on a segment nearest a point. The whole of capsule collision, really. */
export function closestPointOnSegment(a: Point3, b: Point3, point: Point3): Point3 {
  const abEast = b.east - a.east;
  const abUp = b.up - a.up;
  const abNorth = b.north - a.north;
  const lengthSquared = abEast * abEast + abUp * abUp + abNorth * abNorth;
  if (lengthSquared <= 1e-9) return a;
  const t =
    ((point.east - a.east) * abEast + (point.up - a.up) * abUp + (point.north - a.north) * abNorth) /
    lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  return {
    east: a.east + abEast * clamped,
    up: a.up + abUp * clamped,
    north: a.north + abNorth * clamped,
  };
}

export function distanceBetween(a: Point3, b: Point3): number {
  return Math.hypot(a.east - b.east, a.up - b.up, a.north - b.north);
}

function lerpPoint(a: Point3, b: Point3, t: number): Point3 {
  return {
    east: a.east + (b.east - a.east) * t,
    up: a.up + (b.up - a.up) * t,
    north: a.north + (b.north - a.north) * t,
  };
}

/**
 * Overlap history for one attack.
 *
 * A move's volumes stay live for several ticks, and a target standing inside one
 * would otherwise be hit on every one of them. Each attack instance remembers
 * what it has already connected with, per volume, so a multi-hit move is a
 * deliberate thing with several volumes rather than an accident of duration.
 */
export class OverlapHistory {
  private readonly seen = new Set<string>();

  register(volumeId: string, targetId: string): boolean {
    const key = `${volumeId}|${targetId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  has(volumeId: string, targetId: string): boolean {
    return this.seen.has(`${volumeId}|${targetId}`);
  }

  get size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }
}
