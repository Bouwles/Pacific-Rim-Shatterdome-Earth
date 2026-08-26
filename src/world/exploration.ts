import { ContentRegistry } from "../data/registry";
import {
  candidatesFor,
  createSiteRegistry,
  type DiscoverySource,
  type RegionTraits,
  type SiteDefinition,
} from "../data/sites";
import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import { WORLD_RADIUS_METERS, surfaceDistanceMeters, type GeoPosition } from "./coordinates";

/**
 * What is out there, what has been found, and what has already been taken.
 *
 * Placement is derived from the world seed and the region id, so the same world
 * always has the same things in it. Nothing is generated at runtime and nothing
 * moves, which is what makes a discovered point a place rather than a spawn.
 *
 * The rule that matters most here: **a reward is taken once, ever**. Claims are
 * kept by site id and go in the save, so crossing a sector boundary, walking
 * away and back, or reloading changes nothing. This is the same guard the ledger
 * uses for mission pay, for the same reason.
 *
 * Authoritative and serialisable. No Babylon, no DOM, no wall clock.
 */

export const EXPLORATION_SCHEMA_VERSION = 1;

/** How close a machine has to be before a site is spotted, in metres. */
export const DISCOVERY_RANGE_METERS = 4_000;
/** How close it has to be to actually work the site. */
export const REACH_RANGE_METERS = 600;

/** One site, placed in the world. */
export interface PlacedSite {
  /** Stable id: the site kind and the region it was placed in. */
  readonly id: string;
  readonly siteId: string;
  readonly regionId: string;
  readonly position: GeoPosition;
  /** Metres from the region centre, so the map can draw it sensibly. */
  readonly offsetMeters: number;
}

export interface ExplorationSnapshot {
  readonly schemaVersion: number;
  /** Ids of sites that have been found, with how each was found. */
  readonly discovered: readonly { readonly id: string; readonly source: DiscoverySource }[];
  /** Ids of sites whose reward has been taken. Never taken twice. */
  readonly claimed: readonly string[];
}

export function emptyExplorationSnapshot(): ExplorationSnapshot {
  return { schemaVersion: EXPLORATION_SCHEMA_VERSION, discovered: [], claimed: [] };
}

export function validateExplorationSnapshot(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["exploration snapshot must be an object"];
  const snapshot = value as Record<string, unknown>;
  if (snapshot["schemaVersion"] !== EXPLORATION_SCHEMA_VERSION) {
    return [`exploration schemaVersion must be ${EXPLORATION_SCHEMA_VERSION}`];
  }
  const errors: string[] = [];
  if (!Array.isArray(snapshot["discovered"])) errors.push("exploration.discovered must be an array");
  if (!Array.isArray(snapshot["claimed"])) errors.push("exploration.claimed must be an array");
  return errors;
}

/** What the map shows for one site. */
export interface SiteReadout {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly regionId: string;
  readonly description: string;
  readonly discovered: boolean;
  readonly claimed: boolean;
  /** True once reaching it has opened it as a place to deploy to. */
  readonly deployPoint: boolean;
  readonly dangerText: string;
  /** Metres from wherever the reader is standing. */
  readonly distanceMeters: number;
  /** Hours a carrier takes to get there. */
  readonly travelHours: number;
  /** Null when it can be claimed; otherwise why not. */
  readonly refusal: string | null;
}

export interface ClaimResult {
  readonly ok: boolean;
  readonly message: string;
  /** What it paid. All zero when the claim was refused. */
  readonly reward: {
    readonly funding: number;
    readonly alloy: number;
    readonly researchData: number;
    readonly sampleIds: readonly string[];
  } | null;
  /** True when this claim opened a new place to deploy to. */
  readonly openedDeployPoint: boolean;
}

/** Carrier cruise speed, metres per second. Used for every travel estimate. */
export const CARRIER_SPEED_MPS = 180;

/**
 * Hours a carrier takes between two points.
 *
 * Deliberately unrounded. The globe is scaled, so a short hop is a small
 * fraction of an hour, and rounding here would flatten every nearby journey to
 * zero. Rounding belongs where it is read, not where it is worked out.
 */
export function travelHoursBetween(from: GeoPosition, to: GeoPosition): number {
  return surfaceDistanceMeters(from, to) / CARRIER_SPEED_MPS / 3_600;
}

export class Exploration {
  private readonly sites: ContentRegistry<SiteDefinition>;
  private readonly placedList: PlacedSite[] = [];
  private readonly discoveredMap = new Map<string, DiscoverySource>();
  private readonly claimedSet = new Set<string>();

  constructor(options: { readonly sites?: ContentRegistry<SiteDefinition> } = {}) {
    this.sites = options.sites ?? createSiteRegistry();
  }

  /**
   * Puts the world's sites where they belong.
   *
   * Derived from the world seed and the region, so a given world always has the
   * same things in the same places. Regions get what suits them: a polar
   * wilderness cannot produce a rescue call, and a Shatterdome is the only place
   * a proving gate exists.
   */
  place(
    seed: number,
    regions: readonly { readonly id: string; readonly centre: GeoPosition; readonly traits: RegionTraits }[],
  ): void {
    this.placedList.length = 0;
    for (const region of regions) {
      const candidates = candidatesFor(region.traits);
      if (candidates.length === 0) continue;
      const rng = createSeededRng((hashStringToSeed(`sites|${region.id}`) ^ seed) >>> 0);

      // How many a region carries follows what it is, not a fixed quota. A busy
      // coast has more going on than an ice shelf. At least two everywhere, so
      // wherever a campaign starts there is something to walk out and find.
      const density = Math.min(5, 2 + Math.floor(candidates.length / 2));
      const count = Math.min(candidates.length, 2 + Math.floor(rng() * (density - 1)));
      const taken = new Set<string>();

      for (let index = 0; index < count; index += 1) {
        const pick = weightedPick(candidates, rng, taken);
        if (!pick) break;
        taken.add(pick.id);
        const bearing = rng() * 360;
        const offset = 900 + rng() * 5_400;
        this.placedList.push({
          id: `${pick.id}@${region.id}`,
          siteId: pick.id,
          regionId: region.id,
          position: offsetPosition(region.centre, bearing, offset),
          offsetMeters: Math.round(offset),
        });
      }
    }
  }

  placed(): readonly PlacedSite[] {
    return [...this.placedList];
  }

  isDiscovered(id: string): boolean {
    return this.discoveredMap.has(id);
  }

  isClaimed(id: string): boolean {
    return this.claimedSet.has(id);
  }

  discoveredCount(): number {
    return this.discoveredMap.size;
  }

  /**
   * Marks a site as found.
   *
   * Refuses a source the site cannot be found by, so intelligence cannot quietly
   * hand over something only a carrier could have spotted.
   */
  discover(id: string, source: DiscoverySource): boolean {
    const placed = this.placedList.find((entry) => entry.id === id);
    if (!placed) return false;
    if (this.discoveredMap.has(id)) return false;
    const definition = this.sites.get(placed.siteId);
    if (!definition || !definition.discoveredBy.includes(source)) return false;
    this.discoveredMap.set(id, source);
    return true;
  }

  /**
   * Finds everything within range of a position.
   *
   * Returns only what was newly found, so a caller can say so without keeping
   * its own list of what the player already knew.
   */
  discoverNear(position: GeoPosition, rangeMeters = DISCOVERY_RANGE_METERS): readonly PlacedSite[] {
    const found: PlacedSite[] = [];
    for (const placed of this.placedList) {
      if (this.discoveredMap.has(placed.id)) continue;
      const definition = this.sites.get(placed.siteId);
      if (!definition?.discoveredBy.includes("exploration")) continue;
      if (surfaceDistanceMeters(position, placed.position) > rangeMeters) continue;
      this.discoveredMap.set(placed.id, "exploration");
      found.push(placed);
    }
    return found;
  }

  /**
   * Takes what a site is worth.
   *
   * Once, ever. A second attempt changes nothing and says so, which is what
   * makes crossing a boundary or reloading worthless as a way of farming.
   */
  claim(id: string, position: GeoPosition): ClaimResult {
    const empty = { ok: false, reward: null, openedDeployPoint: false } as const;
    const placed = this.placedList.find((entry) => entry.id === id);
    if (!placed) return { ...empty, message: "There is nothing there." };
    const definition = this.sites.get(placed.siteId);
    if (!definition) return { ...empty, message: "There is nothing there." };
    if (!this.discoveredMap.has(id)) return { ...empty, message: "Nobody has found that yet." };
    if (this.claimedSet.has(id)) {
      return { ...empty, message: `${definition.displayName} has already been worked.` };
    }
    const distance = surfaceDistanceMeters(position, placed.position);
    if (distance > REACH_RANGE_METERS) {
      return { ...empty, message: `${Math.round(distance / 1_000)} km short of it.` };
    }

    this.claimedSet.add(id);
    return {
      ok: true,
      message: `${definition.displayName} worked.`,
      reward: { ...definition.reward, sampleIds: [...definition.reward.sampleIds] },
      openedDeployPoint: definition.becomesDeployPoint,
    };
  }

  /**
   * Everywhere the carrier can put a machine down.
   *
   * A site only becomes one after it has actually been reached, which is what
   * makes exploring worth doing rather than reading a list.
   */
  deployPoints(): readonly PlacedSite[] {
    return this.placedList.filter((placed) => {
      if (!this.claimedSet.has(placed.id)) return false;
      return this.sites.get(placed.siteId)?.becomesDeployPoint === true;
    });
  }

  /** What the map should draw, measured from wherever the reader is. */
  readouts(from: GeoPosition): readonly SiteReadout[] {
    return this.placedList
      .filter((placed) => this.discoveredMap.has(placed.id))
      .map((placed) => {
        const definition = this.sites.getOrThrow(placed.siteId);
        const distance = surfaceDistanceMeters(from, placed.position);
        const claimed = this.claimedSet.has(placed.id);
        return {
          id: placed.id,
          name: definition.displayName,
          kind: definition.kind,
          regionId: placed.regionId,
          description: definition.description,
          discovered: true,
          claimed,
          deployPoint: claimed && definition.becomesDeployPoint,
          dangerText: describeDanger(definition.danger),
          distanceMeters: Math.round(distance),
          travelHours: Math.round(travelHoursBetween(from, placed.position) * 1000) / 1000,
          refusal: claimed
            ? "Already worked."
            : distance > REACH_RANGE_METERS
              ? `${Math.round(distance / 1_000)} km away.`
              : null,
        };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  snapshot(): ExplorationSnapshot {
    return {
      schemaVersion: EXPLORATION_SCHEMA_VERSION,
      discovered: [...this.discoveredMap.entries()]
        .map(([id, source]) => ({ id, source }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      claimed: [...this.claimedSet].sort(),
    };
  }

  /**
   * Puts a saved exploration back.
   *
   * Sites are placed from the seed before this is called, so anything named
   * here that no longer exists is dropped rather than resurrected. Claims
   * survive whatever happens to the placement, which is what stops a content
   * change turning into free rewards.
   */
  restore(snapshot: ExplorationSnapshot): void {
    this.discoveredMap.clear();
    this.claimedSet.clear();
    for (const entry of snapshot.discovered) {
      if (!entry || typeof entry.id !== "string") continue;
      if (!this.placedList.some((placed) => placed.id === entry.id)) continue;
      this.discoveredMap.set(entry.id, entry.source);
    }
    for (const id of snapshot.claimed) {
      if (typeof id !== "string") continue;
      this.claimedSet.add(id);
      // A claimed site is by definition one somebody found.
      if (!this.discoveredMap.has(id) && this.placedList.some((placed) => placed.id === id)) {
        this.discoveredMap.set(id, "exploration");
      }
    }
  }
}

/** One leg of a journey: somewhere to stop and what it costs to get there. */
export interface RouteLeg {
  readonly toId: string;
  readonly toName: string;
  readonly distanceMeters: number;
  readonly travelHours: number;
}

export interface RoutePlan {
  readonly legs: readonly RouteLeg[];
  readonly totalHours: number;
  readonly totalMeters: number;
  /** What the player gave up by taking this route rather than the direct one. */
  readonly summary: string;
}

/**
 * Works out how to get somewhere.
 *
 * Two answers, always: straight there, and by way of whatever is already known.
 * The assist exists so a continuous Earth does not mean hours of holding a key,
 * and it deliberately does not choose: going direct is faster, and hopping is
 * how anything on the way gets found. The player picks.
 */
export function planRoute(
  from: GeoPosition,
  to: GeoPosition,
  toName: string,
  waypoints: readonly { readonly id: string; readonly name: string; readonly position: GeoPosition }[],
): { readonly direct: RoutePlan; readonly assisted: RoutePlan } {
  const directMeters = surfaceDistanceMeters(from, to);
  const direct: RoutePlan = {
    legs: [
      {
        toId: "direct",
        toName,
        distanceMeters: Math.round(directMeters),
        travelHours: travelHoursBetween(from, to),
      },
    ],
    totalHours: travelHoursBetween(from, to),
    totalMeters: Math.round(directMeters),
    summary: "Straight there. Nothing seen on the way.",
  };

  // Only waypoints that are actually on the way: somewhere that adds more than a
  // fifth again to the journey is a detour, not a route.
  const useful = waypoints
    .map((point) => ({
      point,
      detour: surfaceDistanceMeters(from, point.position) + surfaceDistanceMeters(point.position, to),
    }))
    .filter((entry) => entry.detour <= directMeters * 1.2)
    .sort((a, b) => a.detour - b.detour)
    .slice(0, 3);

  if (useful.length === 0) {
    return { direct, assisted: { ...direct, summary: "Nothing known lies on the way." } };
  }

  const legs: RouteLeg[] = [];
  let cursor = from;
  let totalMeters = 0;
  for (const entry of useful) {
    const metres = surfaceDistanceMeters(cursor, entry.point.position);
    legs.push({
      toId: entry.point.id,
      toName: entry.point.name,
      distanceMeters: Math.round(metres),
      travelHours: travelHoursBetween(cursor, entry.point.position),
    });
    totalMeters += metres;
    cursor = entry.point.position;
  }
  const last = surfaceDistanceMeters(cursor, to);
  legs.push({
    toId: "destination",
    toName,
    distanceMeters: Math.round(last),
    travelHours: travelHoursBetween(cursor, to),
  });
  totalMeters += last;

  // Unrounded, for the same reason travel time itself is: a short hop on a
  // scaled globe is a small fraction of an hour and rounding here would make
  // two different routes look identical.
  const totalHours = legs.reduce((sum, leg) => sum + leg.travelHours, 0);
  return {
    direct,
    assisted: {
      legs,
      totalHours,
      totalMeters: Math.round(totalMeters),
      summary:
        `${legs.length - 1} stop${legs.length === 2 ? "" : "s"} on the way, ` +
        `${Math.max(1, Math.round((totalHours - direct.totalHours) * 60))} minutes longer.`,
    },
  };
}

function describeDanger(danger: number): string {
  if (danger >= 0.4) return "Dangerous";
  if (danger >= 0.2) return "Risky";
  if (danger > 0) return "Watch your footing";
  return "Safe enough";
}

/** Picks by weight, skipping anything already taken in this region. */
function weightedPick(
  candidates: readonly SiteDefinition[],
  rng: () => number,
  taken: ReadonlySet<string>,
): SiteDefinition | null {
  const open = candidates.filter((entry) => !taken.has(entry.id));
  if (open.length === 0) return null;
  const total = open.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of open) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return open[open.length - 1] ?? null;
}

/**
 * Moves a position along a bearing.
 *
 * On the world's own radius rather than Earth's. The globe is scaled, so using
 * the real figure here would put a site a stated five kilometres away and leave
 * it a few hundred metres away in the world anybody actually walks through.
 */
function offsetPosition(from: GeoPosition, bearingDeg: number, metres: number): GeoPosition {
  const earthRadius = WORLD_RADIUS_METERS;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat = (from.latitudeDeg * Math.PI) / 180;
  const lon = (from.longitudeDeg * Math.PI) / 180;
  const angular = metres / earthRadius;
  const nextLat = Math.asin(
    Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
  );
  const nextLon =
    lon +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * Math.sin(nextLat),
    );
  return {
    latitudeDeg: Math.round(((nextLat * 180) / Math.PI) * 1e6) / 1e6,
    longitudeDeg: Math.round(((((nextLon * 180) / Math.PI + 540) % 360) - 180) * 1e6) / 1e6,
    altitudeMeters: from.altitudeMeters,
  };
}
