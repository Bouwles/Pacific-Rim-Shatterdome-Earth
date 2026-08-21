import type { ContentRegistry } from "../data/registry";
import { normalizeGeo, surfaceDistanceMeters, validateGeoPosition, type GeoPosition } from "./coordinates";
import { sectorIdAt, parseSectorId, type SectorId } from "./cubeSphere";
import {
  initialRecord,
  validateRegionRecord,
  type RegionDefinition,
  type RegionRecord,
  type SimulationTier,
} from "./regions";

export const WORLD_SCHEMA_VERSION = 1;

/** Radius around the player that receives combat-grade simulation. */
export const ACTIVE_BUBBLE_RADIUS_METERS = 4_000;

export interface WorldSnapshot {
  readonly schemaVersion: number;
  readonly playerPosition: GeoPosition;
  readonly activeRegionId: string | null;
  readonly activeSectorId: SectorId;
  readonly regions: readonly RegionRecord[];
}

export interface WorldStateOptions {
  readonly regions: ContentRegistry<RegionDefinition>;
  readonly startPosition?: GeoPosition;
}

/**
 * Authoritative world state: where the player is, which sector and region that
 * puts them in, and the strategic record for every region on the planet.
 *
 * Holds no Babylon or DOM references. Exactly one region is ever tiered active;
 * all others stay strategic, which is the rule that keeps distant cities from
 * running combat physics.
 */
export class WorldState {
  private readonly regionRegistry: ContentRegistry<RegionDefinition>;
  private readonly recordsById = new Map<string, RegionRecord>();
  private position: GeoPosition;
  private sector: SectorId;
  private activeRegion: string | null = null;

  constructor(options: WorldStateOptions) {
    this.regionRegistry = options.regions;
    for (const region of this.regionRegistry.all()) {
      this.recordsById.set(region.id, initialRecord(region.id));
    }
    this.position = normalizeGeo(options.startPosition ?? defaultStart(this.regionRegistry));
    this.sector = sectorIdAt(this.position);
    this.refreshActiveRegion(0);
  }

  get playerPosition(): GeoPosition {
    return this.position;
  }

  get activeSectorId(): SectorId {
    return this.sector;
  }

  get activeRegionId(): string | null {
    return this.activeRegion;
  }

  get regionCount(): number {
    return this.recordsById.size;
  }

  records(): readonly RegionRecord[] {
    return Array.from(this.recordsById.values()).sort((a, b) => a.regionId.localeCompare(b.regionId));
  }

  recordFor(regionId: string): RegionRecord | undefined {
    return this.recordsById.get(regionId);
  }

  definitionFor(regionId: string): RegionDefinition | undefined {
    return this.regionRegistry.get(regionId);
  }

  /** Regions currently receiving combat-grade simulation. Never more than one. */
  activeRegions(): readonly RegionRecord[] {
    return this.records().filter((record) => record.tier === "active");
  }

  tierOf(regionId: string): SimulationTier | undefined {
    return this.recordsById.get(regionId)?.tier;
  }

  /**
   * Moves the player. Returns true when this crossed into a different sector,
   * which is the signal streaming uses to swap what is loaded.
   */
  moveTo(position: GeoPosition, tick = 0): boolean {
    const errors = validateGeoPosition(position, "playerPosition");
    if (errors.length > 0) throw new Error(`Cannot move player: ${errors.join("; ")}`);

    this.position = normalizeGeo(position);
    const nextSector = sectorIdAt(this.position);
    const changed = nextSector !== this.sector;
    this.sector = nextSector;
    this.refreshActiveRegion(tick);
    return changed;
  }

  /** Jumps to a region centre. Throws on an unknown id rather than silently doing nothing. */
  teleportTo(regionId: string, tick = 0): GeoPosition {
    const region = this.regionRegistry.get(regionId);
    if (!region) {
      throw new Error(
        `Unknown region "${regionId}". Known regions: ${this.regionRegistry
          .all()
          .map((entry) => entry.id)
          .join(", ")}`,
      );
    }
    this.moveTo(region.centre, tick);
    return this.position;
  }

  /** Applies damage to the strategic record of a region, clamped into range. */
  applyRegionDamage(regionId: string, integrityLoss: number, tick: number): RegionRecord {
    const record = this.recordsById.get(regionId);
    if (!record) throw new Error(`Unknown region "${regionId}"`);
    const updated: RegionRecord = {
      ...record,
      integrity: clamp01(record.integrity - integrityLoss),
      safetyRating: clamp01(record.safetyRating - integrityLoss * 0.5),
      lastVisitedTick: tick,
    };
    this.recordsById.set(regionId, updated);
    return updated;
  }

  serialize(): WorldSnapshot {
    return {
      schemaVersion: WORLD_SCHEMA_VERSION,
      playerPosition: this.position,
      activeRegionId: this.activeRegion,
      activeSectorId: this.sector,
      regions: this.records(),
    };
  }

  restore(snapshot: WorldSnapshot): void {
    if (snapshot.schemaVersion !== WORLD_SCHEMA_VERSION) {
      throw new Error(
        `World snapshot schema version ${snapshot.schemaVersion} is not supported ` +
          `(expected ${WORLD_SCHEMA_VERSION}); a migration is required`,
      );
    }
    const errors = validateWorldSnapshot(snapshot, new Set(this.regionRegistry.all().map((r) => r.id)));
    if (errors.length > 0) throw new Error(`Invalid world snapshot: ${errors.join("; ")}`);

    this.position = normalizeGeo(snapshot.playerPosition);
    this.sector = snapshot.activeSectorId;
    this.recordsById.clear();
    // Any region added since the save was written starts fresh rather than missing.
    for (const region of this.regionRegistry.all()) this.recordsById.set(region.id, initialRecord(region.id));
    for (const record of snapshot.regions) this.recordsById.set(record.regionId, record);
    this.activeRegion = snapshot.activeRegionId;
  }

  /** Recomputes which region the player is standing in and retiers accordingly. */
  private refreshActiveRegion(tick: number): void {
    let nearest: RegionDefinition | undefined;
    let nearestDistance = Infinity;
    for (const region of this.regionRegistry.all()) {
      const distance = surfaceDistanceMeters(this.position, region.centre);
      const reach = Math.max(region.radiusMeters, ACTIVE_BUBBLE_RADIUS_METERS);
      if (distance <= reach && distance < nearestDistance) {
        nearest = region;
        nearestDistance = distance;
      }
    }

    this.activeRegion = nearest?.id ?? null;
    for (const [regionId, record] of this.recordsById) {
      const tier: SimulationTier = regionId === this.activeRegion ? "active" : "strategic";
      const lastVisitedTick = tier === "active" ? tick : record.lastVisitedTick;
      if (record.tier === tier && record.lastVisitedTick === lastVisitedTick) continue;
      this.recordsById.set(regionId, { ...record, tier, lastVisitedTick });
    }
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function defaultStart(regions: ContentRegistry<RegionDefinition>): GeoPosition {
  const home = regions.get("hong-kong") ?? regions.all()[0];
  if (!home) throw new Error("Cannot build world state from an empty region registry");
  return home.centre;
}

export function validateWorldSnapshot(
  snapshot: WorldSnapshot,
  knownRegionIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  errors.push(...validateGeoPosition(snapshot.playerPosition, "playerPosition"));

  try {
    parseSectorId(snapshot.activeSectorId);
  } catch (error) {
    errors.push((error as Error).message);
  }

  if (snapshot.activeRegionId !== null && !knownRegionIds.has(snapshot.activeRegionId)) {
    errors.push(`activeRegionId "${snapshot.activeRegionId}" is not a known region`);
  }
  if (!Array.isArray(snapshot.regions)) {
    errors.push("regions must be an array");
    return errors;
  }
  for (const record of snapshot.regions) {
    errors.push(...validateRegionRecord(record, knownRegionIds));
  }

  const active = snapshot.regions.filter((record) => record.tier === "active");
  if (active.length > 1) {
    errors.push(
      `only one region may be active at a time, found ${active.length}: ${active
        .map((r) => r.regionId)
        .join(", ")}`,
    );
  }
  return errors;
}
