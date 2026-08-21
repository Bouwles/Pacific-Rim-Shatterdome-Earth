import { geoToLocal, localToGeo, normalizeGeo, type GeoPosition, type LocalPosition } from "./coordinates";

/**
 * Floating origin.
 *
 * Rendering and local physics work in a tangent plane around an anchor. When the
 * player drifts too far from that anchor, the anchor is moved and every local
 * position is recomputed against the new one.
 *
 * The crucial property is that rebasing changes no authoritative state. Global
 * positions stay geodetic and untouched; only the local projection moves. A
 * rebase therefore cannot make a body teleport, gain velocity, or explode: it is
 * a change of viewpoint, not a change of world.
 */

/** Past this distance from the anchor, single-precision render math starts to visibly wobble. */
export const DEFAULT_REBASE_THRESHOLD_METERS = 2_000;

export interface RebaseEvent {
  readonly previousAnchor: GeoPosition;
  readonly nextAnchor: GeoPosition;
  /**
   * Where the new anchor sat in the old frame. Useful for camera and audio
   * continuity. Do NOT subtract it from cached positions to rebase them; use
   * rebaseLocal, which accounts for the rotation between the two frames.
   */
  readonly shift: LocalPosition;
  readonly distanceMeters: number;
}

export interface FloatingOriginOptions {
  readonly anchor: GeoPosition;
  readonly thresholdMeters?: number;
}

export class FloatingOrigin {
  private currentAnchor: GeoPosition;
  private readonly threshold: number;
  private rebaseCount = 0;

  constructor(options: FloatingOriginOptions) {
    if (!Number.isFinite(options.thresholdMeters ?? DEFAULT_REBASE_THRESHOLD_METERS)) {
      throw new Error("Floating origin threshold must be a finite number");
    }
    const threshold = options.thresholdMeters ?? DEFAULT_REBASE_THRESHOLD_METERS;
    if (threshold <= 0) throw new Error(`Floating origin threshold must be positive, got ${threshold}`);
    this.currentAnchor = normalizeGeo(options.anchor);
    this.threshold = threshold;
  }

  get anchor(): GeoPosition {
    return this.currentAnchor;
  }

  get thresholdMeters(): number {
    return this.threshold;
  }

  get rebases(): number {
    return this.rebaseCount;
  }

  /** Projects a global position into the current local frame. */
  toLocal(position: GeoPosition): LocalPosition {
    return geoToLocal(this.currentAnchor, position);
  }

  /** Lifts a local position back to a global one. */
  toGeo(local: LocalPosition): GeoPosition {
    return localToGeo(this.currentAnchor, local);
  }

  /** Horizontal distance from the anchor, ignoring altitude. */
  horizontalDistanceMeters(position: GeoPosition): number {
    const local = this.toLocal(position);
    return Math.hypot(local.east, local.north);
  }

  needsRebase(position: GeoPosition): boolean {
    return this.horizontalDistanceMeters(position) >= this.threshold;
  }

  /**
   * Moves the anchor to `position` if it has drifted past the threshold, and
   * returns the event so renderers can move every cached node through
   * `rebaseLocal` in the same frame. Returns null when no rebase was needed.
   */
  update(position: GeoPosition): RebaseEvent | null {
    const distanceMeters = this.horizontalDistanceMeters(position);
    if (distanceMeters < this.threshold) return null;
    return this.rebaseTo(position, distanceMeters);
  }

  /** Forces a rebase, used by teleports where the jump is intentional. */
  forceRebase(position: GeoPosition): RebaseEvent {
    return this.rebaseTo(position, this.horizontalDistanceMeters(position));
  }

  private rebaseTo(position: GeoPosition, distanceMeters: number): RebaseEvent {
    const previousAnchor = this.currentAnchor;
    const nextAnchor = normalizeGeo(position);
    // Where the new anchor sat in the old frame. Reported for continuity, not
    // as a rebase operator: see rebaseLocal for why subtraction is not enough.
    const shift = geoToLocal(previousAnchor, nextAnchor);
    this.currentAnchor = nextAnchor;
    this.rebaseCount += 1;
    return { previousAnchor, nextAnchor, shift, distanceMeters };
  }
}

/**
 * Converts a position from the pre-rebase local frame into the post-rebase one.
 *
 * Subtracting `event.shift` looks like it should work and does not. Two tangent
 * planes on a sphere are related by a rotation as well as a translation, so a
 * plain subtraction drifts with distance: measured at 2.9 m of error across a
 * 4 km rebase on this globe, which is a visible pop on a 75 m Jaeger. Going back
 * through the authoritative global position is exact at any distance.
 */
export function rebaseLocal(local: LocalPosition, event: RebaseEvent): LocalPosition {
  return geoToLocal(event.nextAnchor, localToGeo(event.previousAnchor, local));
}
