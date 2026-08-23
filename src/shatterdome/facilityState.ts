import type { ContentRegistry } from "../data/registry";
import {
  BASE_CREW_CAPACITY,
  FACILITY_KINDS,
  type FacilityDefinition,
  type FacilityKind,
  type FacilityTier,
} from "../data/facilities";

/**
 * Authoritative Shatterdome state.
 *
 * What is genuinely history: which facilities exist, what tier they are at,
 * what is being built and how far along it is, where the player was standing,
 * and which machine they had selected. Everything else about the interior, the
 * rooms, the fixtures, the staff, the chatter, is derived from these numbers
 * and the world seed, so it is rebuilt rather than stored.
 *
 * No Babylon, no DOM, no wall clock. Construction advances on simulation ticks
 * like everything else that is allowed to call itself authoritative.
 */

export const SHATTERDOME_SCHEMA_VERSION = 1;

export const FACILITY_STATUSES = ["absent", "building", "operational", "upgrading"] as const;
export type FacilityStatus = (typeof FACILITY_STATUSES)[number];

export interface FacilityRecord {
  readonly facilityId: FacilityKind;
  /** 0 while absent, otherwise the tier currently standing and running. */
  readonly tier: number;
  readonly status: FacilityStatus;
  /** Tier being worked toward, or 0 when no order is running. */
  readonly targetTier: number;
  /** In-game seconds of work left on the running order. */
  readonly workRemainingTicks: number;
  /** Crews held by the running order. Released on completion. */
  readonly crewsHeld: number;
}

export interface ShatterdomeLocation {
  readonly roomId: string;
  readonly x: number;
  readonly z: number;
  readonly yawDeg: number;
}

export interface ShatterdomeSnapshot {
  readonly schemaVersion: number;
  readonly facilities: readonly FacilityRecord[];
  readonly location: ShatterdomeLocation;
  readonly selectedJaegerId: string | null;
}

export interface PowerBalance {
  readonly outputMw: number;
  readonly drawMw: number;
  readonly headroomMw: number;
}

export interface CrewBalance {
  readonly capacity: number;
  readonly inUse: number;
  readonly free: number;
}

/** Why an order was refused, with the numbers that refused it. */
export interface OrderRefusal {
  readonly reason: "already-working" | "at-max-tier" | "no-crews" | "no-power";
  readonly message: string;
}

export type OrderResult =
  { readonly ok: true; readonly record: FacilityRecord } | ({ readonly ok: false } & OrderRefusal);

/** A build that finished on this advance. The session turns these into radio traffic. */
export interface FacilityCompletion {
  readonly facilityId: FacilityKind;
  readonly tier: number;
  readonly tierName: string;
  /** True when this was the facility coming into existence rather than growing. */
  readonly firstBuild: boolean;
}

/** Where a new campaign starts: the command floor, at the door, facing in. */
export const DEFAULT_START_ROOM: FacilityKind = "command";

export function defaultLocation(): ShatterdomeLocation {
  return { roomId: DEFAULT_START_ROOM, x: 0, z: -8, yawDeg: 0 };
}

export class ShatterdomeState {
  private readonly definitions: ContentRegistry<FacilityDefinition>;
  private readonly records = new Map<FacilityKind, FacilityRecord>();
  private location: ShatterdomeLocation = defaultLocation();
  private selectedJaeger: string | null = null;

  constructor(definitions: ContentRegistry<FacilityDefinition>) {
    this.definitions = definitions;
    for (const definition of definitions.all()) {
      this.records.set(definition.id, initialRecord(definition));
    }
  }

  all(): readonly FacilityRecord[] {
    return [...this.records.values()].sort((a, b) => a.facilityId.localeCompare(b.facilityId));
  }

  recordFor(facilityId: FacilityKind): FacilityRecord | undefined {
    return this.records.get(facilityId);
  }

  definitionFor(facilityId: FacilityKind): FacilityDefinition | undefined {
    return this.definitions.get(facilityId);
  }

  get playerLocation(): ShatterdomeLocation {
    return this.location;
  }

  setPlayerLocation(location: ShatterdomeLocation): void {
    this.location = { ...location };
  }

  get selectedJaegerId(): string | null {
    return this.selectedJaeger;
  }

  selectJaeger(jaegerId: string | null): void {
    this.selectedJaeger = jaegerId;
  }

  /** True when the facility is standing and running, whatever else is being built on it. */
  isOperational(facilityId: FacilityKind): boolean {
    const record = this.records.get(facilityId);
    return record !== undefined && record.tier >= 1;
  }

  /**
   * Power across the complex.
   *
   * Draw is the tier a facility is actually running at, not the one being built
   * toward: an upgrade under way costs power when it finishes, not while the
   * scaffolds are up.
   */
  power(): PowerBalance {
    let outputMw = 0;
    let drawMw = 0;
    for (const record of this.records.values()) {
      const tier = this.tierData(record.facilityId, record.tier);
      if (!tier) continue;
      outputMw += tier.powerOutputMw;
      drawMw += tier.powerDrawMw;
    }
    return { outputMw, drawMw, headroomMw: outputMw - drawMw };
  }

  /** Construction crews: what logistics musters, and what running orders are holding. */
  crews(): CrewBalance {
    let capacity = BASE_CREW_CAPACITY;
    let inUse = 0;
    for (const record of this.records.values()) {
      const tier = this.tierData(record.facilityId, record.tier);
      if (tier) capacity += tier.crewProvided;
      inUse += record.crewsHeld;
    }
    return { capacity, inUse, free: Math.max(0, capacity - inUse) };
  }

  /** Staff posted across every running facility. One number per facility, never per person. */
  staffSlots(): number {
    let total = 0;
    for (const record of this.records.values()) {
      total += this.tierData(record.facilityId, record.tier)?.staffSlots ?? 0;
    }
    return total;
  }

  /** The tier a facility would move to if an order were placed now, or null at the top. */
  nextTier(facilityId: FacilityKind): FacilityTier | null {
    const record = this.records.get(facilityId);
    const definition = this.definitions.get(facilityId);
    if (!record || !definition) return null;
    return definition.tiers[record.tier] ?? null;
  }

  /**
   * Checks an order without placing it, so an interface can grey a button and say
   * why in the same breath rather than failing on click.
   */
  checkOrder(facilityId: FacilityKind): OrderRefusal | null {
    const record = this.records.get(facilityId);
    const definition = this.definitions.get(facilityId);
    if (!record || !definition) {
      return { reason: "at-max-tier", message: `Unknown facility "${facilityId}".` };
    }
    if (record.status === "building" || record.status === "upgrading") {
      return {
        reason: "already-working",
        message: `${definition.displayName} is already under construction.`,
      };
    }
    const target = definition.tiers[record.tier];
    if (!target) {
      return {
        reason: "at-max-tier",
        message: `${definition.displayName} is at its highest tier.`,
      };
    }
    const crews = this.crews();
    if (crews.free < target.crewRequired) {
      return {
        reason: "no-crews",
        message:
          `${target.displayName} needs ${target.crewRequired} construction crew` +
          `${target.crewRequired === 1 ? "" : "s"} and ${crews.free} of ${crews.capacity} are free. ` +
          "Finish an order, or upgrade Logistics to muster more.",
      };
    }
    const power = this.power();
    const current = this.tierData(facilityId, record.tier);
    // The draw that matters is the one this facility will have when the order
    // finishes; everything else stays where it is.
    const projectedDraw = power.drawMw - (current?.powerDrawMw ?? 0) + target.powerDrawMw;
    const projectedOutput = power.outputMw - (current?.powerOutputMw ?? 0) + target.powerOutputMw;
    if (projectedDraw > projectedOutput) {
      return {
        reason: "no-power",
        message:
          `${target.displayName} would draw ${projectedDraw} MW against ${projectedOutput} MW of output. ` +
          "Upgrade the reactor first.",
      };
    }
    return null;
  }

  /** Places a build or upgrade order. Refuses with the reason rather than throwing. */
  order(facilityId: FacilityKind): OrderResult {
    const refusal = this.checkOrder(facilityId);
    if (refusal) return { ok: false, ...refusal };

    const record = this.records.get(facilityId);
    const definition = this.definitions.get(facilityId);
    // checkOrder has already proven both exist and that a next tier is available.
    if (!record || !definition) throw new Error(`Unknown facility "${facilityId}"`);
    const target = definition.tiers[record.tier];
    if (!target) throw new Error(`No tier above ${record.tier} for "${facilityId}"`);

    const updated: FacilityRecord = {
      ...record,
      status: record.tier === 0 ? "building" : "upgrading",
      targetTier: target.tier,
      workRemainingTicks: target.constructionTicks,
      crewsHeld: target.crewRequired,
    };
    this.records.set(facilityId, updated);
    return { ok: true, record: updated };
  }

  /**
   * Advances every running order. Returns what finished, so the caller can report
   * it rather than discovering the change by comparing snapshots.
   */
  advance(ticks: number): readonly FacilityCompletion[] {
    if (ticks <= 0) return [];
    const completed: FacilityCompletion[] = [];
    for (const [facilityId, record] of this.records) {
      if (record.status !== "building" && record.status !== "upgrading") continue;
      const remaining = record.workRemainingTicks - ticks;
      if (remaining > 0) {
        this.records.set(facilityId, { ...record, workRemainingTicks: remaining });
        continue;
      }
      const definition = this.definitions.getOrThrow(facilityId);
      const tier = definition.tiers[record.targetTier - 1];
      this.records.set(facilityId, {
        facilityId,
        tier: record.targetTier,
        status: "operational",
        targetTier: 0,
        workRemainingTicks: 0,
        crewsHeld: 0,
      });
      completed.push({
        facilityId,
        tier: record.targetTier,
        tierName: tier?.displayName ?? `Tier ${record.targetTier}`,
        firstBuild: record.status === "building",
      });
    }
    return completed;
  }

  /** Progress on a running order, 0 to 1. Zero when nothing is being built. */
  progressOf(facilityId: FacilityKind): number {
    const record = this.records.get(facilityId);
    const definition = this.definitions.get(facilityId);
    if (!record || !definition) return 0;
    if (record.status !== "building" && record.status !== "upgrading") return 0;
    const tier = definition.tiers[record.targetTier - 1];
    if (!tier || tier.constructionTicks <= 0) return 0;
    return clamp01(1 - record.workRemainingTicks / tier.constructionTicks);
  }

  serialize(): ShatterdomeSnapshot {
    return {
      schemaVersion: SHATTERDOME_SCHEMA_VERSION,
      facilities: this.all(),
      location: this.location,
      selectedJaegerId: this.selectedJaeger,
    };
  }

  restore(snapshot: ShatterdomeSnapshot, knownRoomIds: ReadonlySet<string>): void {
    const errors = validateShatterdomeSnapshot(snapshot, knownRoomIds);
    if (errors.length > 0) throw new Error(`Invalid Shatterdome snapshot: ${errors.join("; ")}`);

    // A facility added since the save was written starts from its own default
    // rather than being missing, the same way a new region does.
    this.records.clear();
    for (const definition of this.definitions.all()) {
      this.records.set(definition.id, initialRecord(definition));
    }
    for (const record of snapshot.facilities) {
      if (this.definitions.has(record.facilityId)) this.records.set(record.facilityId, record);
    }
    this.location = { ...snapshot.location };
    this.selectedJaeger = snapshot.selectedJaegerId;
  }

  private tierData(facilityId: FacilityKind, tier: number): FacilityTier | undefined {
    if (tier < 1) return undefined;
    return this.definitions.get(facilityId)?.tiers[tier - 1];
  }
}

function initialRecord(definition: FacilityDefinition): FacilityRecord {
  return definition.startsBuilt
    ? {
        facilityId: definition.id,
        tier: 1,
        status: "operational",
        targetTier: 0,
        workRemainingTicks: 0,
        crewsHeld: 0,
      }
    : {
        facilityId: definition.id,
        tier: 0,
        status: "absent",
        targetTier: 0,
        workRemainingTicks: 0,
        crewsHeld: 0,
      };
}

/** A fresh complex, used by a save written before one existed and by the migration that adds it. */
export function emptyShatterdomeSnapshot(
  definitions: ContentRegistry<FacilityDefinition>,
): ShatterdomeSnapshot {
  return {
    schemaVersion: SHATTERDOME_SCHEMA_VERSION,
    facilities: definitions
      .all()
      .map(initialRecord)
      .sort((a, b) => a.facilityId.localeCompare(b.facilityId)),
    location: defaultLocation(),
    selectedJaegerId: null,
  };
}

export function validateShatterdomeSnapshot(
  snapshot: ShatterdomeSnapshot,
  knownRoomIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== SHATTERDOME_SCHEMA_VERSION) {
    errors.push(
      `shatterdome schemaVersion ${snapshot.schemaVersion} is not supported ` +
        `(expected ${SHATTERDOME_SCHEMA_VERSION})`,
    );
    return errors;
  }
  if (!Array.isArray(snapshot.facilities)) {
    errors.push("shatterdome.facilities must be an array");
    return errors;
  }
  const seen = new Set<string>();
  for (const record of snapshot.facilities) {
    if (!FACILITY_KINDS.includes(record.facilityId)) {
      errors.push(`unknown facility "${record.facilityId}"`);
      continue;
    }
    if (seen.has(record.facilityId)) errors.push(`duplicate record for "${record.facilityId}"`);
    seen.add(record.facilityId);
    if (!FACILITY_STATUSES.includes(record.status)) {
      errors.push(`facility "${record.facilityId}" has unknown status "${record.status}"`);
    }
    if (!Number.isInteger(record.tier) || record.tier < 0) {
      errors.push(`facility "${record.facilityId}" tier must be a non-negative integer`);
    }
    if (record.status === "absent" && record.tier !== 0) {
      errors.push(`facility "${record.facilityId}" is absent but claims tier ${record.tier}`);
    }
    if (record.status === "operational" && record.tier < 1) {
      errors.push(`facility "${record.facilityId}" is operational at tier ${record.tier}`);
    }
    const working = record.status === "building" || record.status === "upgrading";
    if (working && record.targetTier !== record.tier + 1) {
      errors.push(
        `facility "${record.facilityId}" is building tier ${record.targetTier} from tier ${record.tier}`,
      );
    }
    if (working && !(record.workRemainingTicks > 0)) {
      errors.push(`facility "${record.facilityId}" is building with no work left to do`);
    }
    if (!working && record.crewsHeld !== 0) {
      errors.push(`facility "${record.facilityId}" holds crews without an order running`);
    }
  }

  const location = snapshot.location;
  if (typeof location !== "object" || location === null) {
    errors.push("shatterdome.location must be an object");
  } else {
    if (!knownRoomIds.has(location.roomId)) {
      errors.push(
        `shatterdome.location.roomId "${location.roomId}" is not a room in this build. ` +
          `Known rooms: ${[...knownRoomIds].sort().join(", ")}`,
      );
    }
    for (const key of ["x", "z", "yawDeg"] as const) {
      if (!Number.isFinite(location[key])) errors.push(`shatterdome.location.${key} must be finite`);
    }
  }
  if (snapshot.selectedJaegerId !== null && typeof snapshot.selectedJaegerId !== "string") {
    errors.push("shatterdome.selectedJaegerId must be a string or null");
  }
  return errors;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
