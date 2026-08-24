import type { ContentRegistry } from "../data/registry";
import { normalizeGeo, surfaceDistanceMeters, validateGeoPosition, type GeoPosition } from "./coordinates";
import { sectorIdAt, parseSectorId, type SectorId } from "./cubeSphere";
import {
  initialRecord,
  validateRegionRecord,
  type ClimateZone,
  type RegionDefinition,
  type RegionRecord,
  type SimulationTier,
} from "./regions";
import { EnvironmentSystem, validateEnvironmentSnapshot, type EnvironmentSnapshot } from "./environment";
import type { ClimateWeatherProfile } from "./weather";
import type { WorldClockOptions } from "./worldClock";
import type { CitySafetyReport, RegionDamageSnapshot } from "./destruction";
import { advanceAlert, setAlertLevel, type AlertLevel } from "./cityActivity";

/** Raised to 3 by Milestone 07, which added alert state to every region record. */
export const WORLD_SCHEMA_VERSION = 4;

/**
 * Climate for anywhere the player is not inside a named region. Open water is
 * the honest answer: most of this planet is ocean.
 */
export const OPEN_WATER_CLIMATE: ClimateZone = "oceanic";

/** Radius around the player that receives combat-grade simulation. */
export const ACTIVE_BUBBLE_RADIUS_METERS = 4_000;

export interface WorldSnapshot {
  readonly schemaVersion: number;
  readonly playerPosition: GeoPosition;
  readonly activeRegionId: string | null;
  readonly activeSectorId: SectorId;
  readonly regions: readonly RegionRecord[];
  /** World clock and weather. Authoritative, so it round-trips through a save. */
  readonly environment: EnvironmentSnapshot;
}

export interface WorldStateOptions {
  readonly regions: ContentRegistry<RegionDefinition>;
  readonly startPosition?: GeoPosition;
  /**
   * Seed for weather. Injected rather than read from anywhere, so world state
   * stays a pure function of what it was handed.
   */
  readonly seed: number;
  /**
   * Resolves a climate zone to its weather profile. A function rather than a
   * registry import: the world layer must not depend on the content layer.
   */
  readonly climateProfileFor: (climate: ClimateZone) => ClimateWeatherProfile;
  readonly clock?: WorldClockOptions;
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
  private readonly climateProfileFor: (climate: ClimateZone) => ClimateWeatherProfile;
  /** World clock and weather. Owned here so it is saved with the rest of the world. */
  readonly environment: EnvironmentSystem;

  constructor(options: WorldStateOptions) {
    this.regionRegistry = options.regions;
    this.climateProfileFor = options.climateProfileFor;
    for (const region of this.regionRegistry.all()) {
      this.recordsById.set(region.id, initialRecord(region.id));
    }
    this.position = normalizeGeo(options.startPosition ?? defaultStart(this.regionRegistry));
    this.sector = sectorIdAt(this.position);
    this.environment = new EnvironmentSystem({
      seed: options.seed,
      profile: options.climateProfileFor(OPEN_WATER_CLIMATE),
      clock: options.clock,
    });
    this.refreshActiveRegion(0);
  }

  /** Climate where the player is, falling back to open water outside every region. */
  get currentClimate(): ClimateZone {
    const region = this.activeRegion ? this.regionRegistry.get(this.activeRegion) : undefined;
    return region?.climate ?? OPEN_WATER_CLIMATE;
  }

  /** Advances the world clock and weather. The only thing that moves time forward. */
  advanceEnvironment(ticks: number): void {
    this.environment.advance(ticks, this.position.latitudeDeg);
  }

  /**
   * Advances every region's evacuation. Cheap by construction: a region is one
   * alert record, not a crowd, so this is a few arithmetic operations per region
   * however large the city is.
   */
  advanceAlerts(ticks: number): void {
    if (ticks <= 0) return;
    for (const [regionId, record] of this.recordsById) {
      const alert = advanceAlert(record.alert, ticks);
      if (alert !== record.alert) this.recordsById.set(regionId, { ...record, alert });
    }
  }

  /** Raises or lowers a region's alert. Throws on an unknown region rather than doing nothing. */
  setRegionAlert(regionId: string, level: AlertLevel, tick: number): RegionRecord {
    const record = this.recordsById.get(regionId);
    if (!record) {
      throw new Error(
        `Unknown region "${regionId}". Known regions: ${this.regionRegistry
          .all()
          .map((entry) => entry.id)
          .join(", ")}`,
      );
    }
    const updated: RegionRecord = { ...record, alert: setAlertLevel(record.alert, level, tick) };
    this.recordsById.set(regionId, updated);
    return updated;
  }

  alertFor(regionId: string): RegionRecord["alert"] | undefined {
    return this.recordsById.get(regionId)?.alert;
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

  /**
   * Writes a region's destruction summary back onto its strategic record.
   *
   * This is what makes damage regional rather than local: the detailed model
   * lives with the active city while you are standing in it, and what survives
   * is this summary, which every region on the planet can afford to carry.
   */
  setRegionDamage(
    regionId: string,
    damage: RegionDamageSnapshot,
    report: CitySafetyReport,
    tick: number,
  ): RegionRecord {
    const record = this.recordsById.get(regionId);
    if (!record) throw new Error(`Unknown region "${regionId}"`);
    const updated: RegionRecord = {
      ...record,
      integrity: clamp01(report.integrity),
      safetyRating: clamp01(report.safety),
      lastVisitedTick: tick,
      damage,
    };
    this.recordsById.set(regionId, updated);
    return updated;
  }

  /** The damage summary a region is carrying, for rebuilding it in detail. */
  damageFor(regionId: string): RegionDamageSnapshot | undefined {
    return this.recordsById.get(regionId)?.damage;
  }

  serialize(): WorldSnapshot {
    return {
      schemaVersion: WORLD_SCHEMA_VERSION,
      playerPosition: this.position,
      activeRegionId: this.activeRegion,
      activeSectorId: this.sector,
      regions: this.records(),
      environment: this.environment.serialize(),
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
    this.environment.restore(snapshot.environment);
    // The climate follows the restored position, not whatever was last active.
    this.environment.setClimate(this.climateProfileFor(this.currentClimate));
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

    const changed = this.activeRegion !== (nearest?.id ?? null);
    this.activeRegion = nearest?.id ?? null;
    if (changed) this.environment.setClimate(this.climateProfileFor(this.currentClimate));
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

  if (typeof snapshot.environment !== "object" || snapshot.environment === null) {
    errors.push("environment must be an object");
  } else {
    errors.push(...validateEnvironmentSnapshot(snapshot.environment));
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
