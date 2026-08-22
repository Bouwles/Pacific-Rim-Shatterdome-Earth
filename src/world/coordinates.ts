/**
 * Global coordinates for the miniature Earth.
 *
 * Authoritative positions are geodetic (latitude, longitude, altitude) rather
 * than Cartesian. Degrees in a double resolve to well under a millimetre at this
 * globe's radius, and the representation does not lose precision as you move
 * away from an arbitrary origin, which a single world-space Cartesian frame does.
 *
 * Note on determinism: this module uses `sin`, `cos`, `atan2` and `sqrt`, which
 * `src/simulation/**` is forbidden from using. That boundary is deliberate and is
 * recorded in TECH_DECISIONS.md: there is no way to place points on a sphere
 * without trigonometry, so world coordinates live outside the bit-exact kernel.
 */

/** Real Earth mean radius, in metres, before scaling. */
export const REAL_EARTH_RADIUS_METERS = 6_371_000;

/**
 * The globe is shrunk but the things standing on it are not. A 75m Jaeger keeps
 * its real size while the planet is small enough to cross, which is what
 * "miniature Earth" means here. See TECH_DECISIONS.md for the tradeoff.
 */
export const EARTH_SCALE = 1 / 50;

export const WORLD_RADIUS_METERS = REAL_EARTH_RADIUS_METERS * EARTH_SCALE;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Authoritative world position. Serializable, and stable regardless of where the player is. */
export interface GeoPosition {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly altitudeMeters: number;
}

/** Earth-centred Cartesian, metres. Y is the polar axis so it matches Babylon's up. */
export interface EcefPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Position within a local tangent plane, in metres: east, north, and up relative
 * to an anchor. This is what gameplay and rendering use near the player.
 */
export interface LocalPosition {
  readonly east: number;
  readonly north: number;
  readonly up: number;
}

export function geo(latitudeDeg: number, longitudeDeg: number, altitudeMeters = 0): GeoPosition {
  return { latitudeDeg, longitudeDeg, altitudeMeters };
}

export function validateGeoPosition(position: GeoPosition, label = "position"): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(position.latitudeDeg) || Math.abs(position.latitudeDeg) > 90) {
    errors.push(`${label}.latitudeDeg must be a finite number within [-90, 90]`);
  }
  if (!Number.isFinite(position.longitudeDeg) || Math.abs(position.longitudeDeg) > 180) {
    errors.push(`${label}.longitudeDeg must be a finite number within [-180, 180]`);
  }
  if (!Number.isFinite(position.altitudeMeters)) {
    errors.push(`${label}.altitudeMeters must be a finite number`);
  }
  return errors;
}

/** Wraps longitude into [-180, 180) so crossing the date line never produces a discontinuity. */
export function normalizeLongitude(longitudeDeg: number): number {
  const wrapped = (((longitudeDeg + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

export function clampLatitude(latitudeDeg: number): number {
  return Math.min(90, Math.max(-90, latitudeDeg));
}

export function normalizeGeo(position: GeoPosition): GeoPosition {
  return {
    latitudeDeg: clampLatitude(position.latitudeDeg),
    longitudeDeg: normalizeLongitude(position.longitudeDeg),
    altitudeMeters: position.altitudeMeters,
  };
}

export function geoToEcef(position: GeoPosition): EcefPosition {
  const lat = position.latitudeDeg * DEG_TO_RAD;
  const lon = position.longitudeDeg * DEG_TO_RAD;
  const radius = WORLD_RADIUS_METERS + position.altitudeMeters;
  const cosLat = Math.cos(lat);
  return {
    x: radius * cosLat * Math.cos(lon),
    y: radius * Math.sin(lat),
    z: radius * cosLat * Math.sin(lon),
  };
}

export function ecefToGeo(point: EcefPosition): GeoPosition {
  const radius = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
  if (radius === 0) return geo(0, 0, -WORLD_RADIUS_METERS);
  return {
    latitudeDeg: Math.asin(point.y / radius) * RAD_TO_DEG,
    longitudeDeg: Math.atan2(point.z, point.x) * RAD_TO_DEG,
    altitudeMeters: radius - WORLD_RADIUS_METERS,
  };
}

export interface TangentBasis {
  readonly east: EcefPosition;
  readonly north: EcefPosition;
  readonly up: EcefPosition;
  readonly origin: EcefPosition;
}

/** Orthonormal east/north/up basis at an anchor. Cached by callers that convert many points. */
export function tangentBasisAt(anchor: GeoPosition): TangentBasis {
  const lat = anchor.latitudeDeg * DEG_TO_RAD;
  const lon = anchor.longitudeDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  return {
    east: { x: -sinLon, y: 0, z: cosLon },
    north: { x: -sinLat * cosLon, y: cosLat, z: -sinLat * sinLon },
    up: { x: cosLat * cosLon, y: sinLat, z: cosLat * sinLon },
    origin: geoToEcef(anchor),
  };
}

/** Projects a global position into the tangent plane around an anchor. */
export function geoToLocal(anchor: GeoPosition, target: GeoPosition): LocalPosition {
  return ecefToLocal(tangentBasisAt(anchor), geoToEcef(target));
}

export function ecefToLocal(basis: TangentBasis, point: EcefPosition): LocalPosition {
  const dx = point.x - basis.origin.x;
  const dy = point.y - basis.origin.y;
  const dz = point.z - basis.origin.z;
  return {
    east: dx * basis.east.x + dy * basis.east.y + dz * basis.east.z,
    north: dx * basis.north.x + dy * basis.north.y + dz * basis.north.z,
    up: dx * basis.up.x + dy * basis.up.y + dz * basis.up.z,
  };
}

/** Lifts a tangent-plane position back to a global position. */
export function localToGeo(anchor: GeoPosition, local: LocalPosition): GeoPosition {
  return ecefToGeo(localToEcef(tangentBasisAt(anchor), local));
}

export function localToEcef(basis: TangentBasis, local: LocalPosition): EcefPosition {
  return {
    x: basis.origin.x + basis.east.x * local.east + basis.north.x * local.north + basis.up.x * local.up,
    y: basis.origin.y + basis.east.y * local.east + basis.north.y * local.north + basis.up.y * local.up,
    z: basis.origin.z + basis.east.z * local.east + basis.north.z * local.north + basis.up.z * local.up,
  };
}

/** Great-circle surface distance in metres on the scaled globe. */
export function surfaceDistanceMeters(a: GeoPosition, b: GeoPosition): number {
  const lat1 = a.latitudeDeg * DEG_TO_RAD;
  const lat2 = b.latitudeDeg * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLon = (b.longitudeDeg - a.longitudeDeg) * DEG_TO_RAD;
  // Haversine: numerically better than the cosine rule at the short distances
  // the active bubble actually deals with.
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * WORLD_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Point `t` of the way along the great circle from `a` to `b`, altitude blended
 * linearly. Straight-line interpolation of latitude and longitude bends the path
 * and moves at the wrong speed near the poles; slerping the direction vectors
 * does not.
 */
export function interpolateGeo(a: GeoPosition, b: GeoPosition, t: number): GeoPosition {
  const pa = geoToEcef({ ...a, altitudeMeters: 0 });
  const pb = geoToEcef({ ...b, altitudeMeters: 0 });
  const inverseRadius = 1 / WORLD_RADIUS_METERS;
  const ua = { x: pa.x * inverseRadius, y: pa.y * inverseRadius, z: pa.z * inverseRadius };
  const ub = { x: pb.x * inverseRadius, y: pb.y * inverseRadius, z: pb.z * inverseRadius };

  const cosAngle = Math.min(1, Math.max(-1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z));
  const angle = Math.acos(cosAngle);
  const altitude = a.altitudeMeters + (b.altitudeMeters - a.altitudeMeters) * t;

  // Coincident or antipodal endpoints make the slerp weights degenerate; a plain
  // lerp of the directions is correct in the first case and arbitrary but stable
  // in the second, which is all an antipodal midpoint can be.
  if (angle < 1e-9 || Math.abs(Math.PI - angle) < 1e-9) {
    const blended = {
      x: ua.x + (ub.x - ua.x) * t,
      y: ua.y + (ub.y - ua.y) * t,
      z: ua.z + (ub.z - ua.z) * t,
    };
    const length = Math.sqrt(blended.x ** 2 + blended.y ** 2 + blended.z ** 2) || 1;
    const radius = WORLD_RADIUS_METERS / length;
    return {
      ...ecefToGeo({ x: blended.x * radius, y: blended.y * radius, z: blended.z * radius }),
      altitudeMeters: altitude,
    };
  }

  const sinAngle = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sinAngle;
  const wb = Math.sin(t * angle) / sinAngle;
  const point = ecefToGeo({
    x: (ua.x * wa + ub.x * wb) * WORLD_RADIUS_METERS,
    y: (ua.y * wa + ub.y * wb) * WORLD_RADIUS_METERS,
    z: (ua.z * wa + ub.z * wb) * WORLD_RADIUS_METERS,
  });
  return { ...point, altitudeMeters: altitude };
}

/** Straight-line distance through the globe, in metres. */
export function straightDistanceMeters(a: GeoPosition, b: GeoPosition): number {
  const pa = geoToEcef(a);
  const pb = geoToEcef(b);
  const dx = pa.x - pb.x;
  const dy = pa.y - pb.y;
  const dz = pa.z - pb.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
