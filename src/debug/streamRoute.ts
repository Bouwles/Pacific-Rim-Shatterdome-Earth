import {
  geoToLocal,
  interpolateGeo,
  surfaceDistanceMeters,
  type GeoPosition,
  type LocalPosition,
} from "../world/coordinates";
import type { SectorStreamer, StreamingStats } from "../world/sectorStreaming";

/**
 * Deterministic streaming stress route.
 *
 * A fixed set of waypoints, a fixed speed and a fixed step, so a run is
 * reproducible from nothing but its arguments. This is the scenario the
 * milestone's performance claims are measured against, and it is the same route
 * whether it runs headless in a test or live in the browser, which is the only
 * way the two numbers can be compared.
 *
 * It samples positions along great circles rather than in a straight line
 * through latitude and longitude, so it crosses sector boundaries at a genuine
 * constant speed instead of accelerating with latitude.
 */

export interface RouteWaypoint {
  readonly label: string;
  readonly position: GeoPosition;
}

export interface RouteSample {
  readonly position: GeoPosition;
  /** Velocity in the tangent frame at that position, metres per second. */
  readonly velocity: LocalPosition;
  readonly elapsedSeconds: number;
  readonly distanceMeters: number;
}

export interface RouteOptions {
  readonly waypoints: readonly RouteWaypoint[];
  /** Metres per second across the ground. */
  readonly speedMetersPerSecond: number;
  readonly stepSeconds: number;
  readonly loops?: number;
}

/** Straight out of Hong Kong, around the western Pacific, and back. */
export const STRESS_ROUTE_REGION_IDS = ["hong-kong", "manila", "tokyo", "vladivostok", "hong-kong"] as const;

export function buildRouteSamples(options: RouteOptions): readonly RouteSample[] {
  const { waypoints, speedMetersPerSecond, stepSeconds } = options;
  if (waypoints.length < 2) throw new Error("A stress route needs at least two waypoints");
  if (!(speedMetersPerSecond > 0)) {
    throw new Error(`Route speed must be positive, got ${speedMetersPerSecond}`);
  }
  if (!(stepSeconds > 0)) throw new Error(`Route step must be positive, got ${stepSeconds}`);

  const loops = options.loops ?? 1;
  const samples: RouteSample[] = [];
  const stepMeters = speedMetersPerSecond * stepSeconds;
  let elapsedSeconds = 0;
  let distanceMeters = 0;

  for (let loop = 0; loop < loops; loop += 1) {
    for (let leg = 0; leg < waypoints.length - 1; leg += 1) {
      const from = waypoints[leg];
      const to = waypoints[leg + 1];
      if (!from || !to) continue;

      const legMeters = surfaceDistanceMeters(from.position, to.position);
      const steps = Math.max(1, Math.ceil(legMeters / stepMeters));
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        const position = interpolateGeo(from.position, to.position, t);
        // Velocity is read from the next point on the same leg rather than
        // assumed, so a route that turns reports the turn instead of pretending
        // the player is still heading the old way.
        const ahead = interpolateGeo(from.position, to.position, Math.min(1, t + 1 / steps));
        const delta = geoToLocal(position, ahead);
        const magnitude = Math.hypot(delta.east, delta.north) || 1;
        samples.push({
          position,
          velocity: {
            east: (delta.east / magnitude) * speedMetersPerSecond,
            north: (delta.north / magnitude) * speedMetersPerSecond,
            up: 0,
          },
          elapsedSeconds,
          distanceMeters,
        });
        elapsedSeconds += stepSeconds;
        distanceMeters += legMeters / steps;
      }
    }
  }
  return samples;
}

export interface RouteReport {
  readonly samples: number;
  readonly distanceMeters: number;
  readonly sectorsVisited: number;
  readonly stats: StreamingStats;
  /** Highest resident sector count seen at any point along the route. */
  readonly peakResident: number;
  readonly peakResidentBytes: number;
  /** Wall-clock milliseconds spent driving the route, for headless comparison only. */
  readonly wallClockMs: number;
}

/**
 * Drives a streamer along a route to completion, waiting for each step to settle.
 *
 * Deliberately not how the game runs: the live loop calls `update` once per frame
 * and never waits. Settling per step is what makes the headless run deterministic
 * and its memory numbers meaningful, since nothing is left half-loaded when the
 * measurement is taken.
 */
export async function runStreamingRoute(
  streamer: SectorStreamer,
  samples: readonly RouteSample[],
): Promise<RouteReport> {
  const startedAt = now();
  const visited = new Set<string>();
  let peakResident = 0;
  let peakResidentBytes = 0;
  let distanceMeters = 0;

  for (const sample of samples) {
    await streamer.pump({ position: sample.position, velocity: sample.velocity });
    const current = streamer.currentSectorId;
    if (current) visited.add(current);
    const stats = streamer.stats();
    if (stats.resident > peakResident) peakResident = stats.resident;
    if (stats.residentBytes > peakResidentBytes) peakResidentBytes = stats.residentBytes;
    distanceMeters = sample.distanceMeters;
  }

  return {
    samples: samples.length,
    distanceMeters,
    sectorsVisited: visited.size,
    stats: streamer.stats(),
    peakResident,
    peakResidentBytes,
    wallClockMs: now() - startedAt,
  };
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
