import {
  archetypeForDistrict,
  blocksRoutes,
  createBuildingRegistry,
  standingState,
  structureFor,
  type BuildingArchetype,
  type BuildingState,
} from "../data/buildings";
import type { ContentRegistry } from "../data/registry";
import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import type { CityLayout, DestructionGroup } from "./cityLayout";

/**
 * What a fight does to a city, and what the city does about it afterwards.
 *
 * The unit of damage is a **destruction group**: a few city blocks on a 480 m
 * grid, which the layout already buckets every block into. A group carries how
 * much of it is standing, how many of its structures are down, whether it is
 * burning or contaminated, how much rubble is in the road and how many people
 * are still waiting to be pulled out of it.
 *
 * That is the whole persisted model, and it is deliberately small: a handful of
 * numbers per group and a state per named landmark. A city that has been through
 * three fights saves in a couple of kilobytes. **No scene graph is ever saved**,
 * and no individual wall is ever simulated: a group is the smallest thing that
 * can be damaged, and the renderer works out what that looks like.
 *
 * Time is handled in two clocks. Seconds move a collapse through to rubble and
 * burn fires down, which happens while you are standing there. Hours move
 * clearing and rebuilding, which happens while you are not.
 */

export const DESTRUCTION_SCHEMA_VERSION = 1;

/** Fires and contamination die down on their own, per hour. */
const FIRE_DECAY_PER_HOUR = 0.06;
const CONTAMINATION_DECAY_PER_HOUR = 0.012;
/** How much of a group's rubble a single structure's collapse contributes. */
const RUBBLE_PER_STRUCTURE = 0.14;
/** People become reachable at this fraction per hour once fires are out. */
const RESCUE_PER_HOUR = 0.08;

export interface GroupDamage {
  readonly groupId: string;
  /** 0 levelled, 1 untouched. The headline number for this patch of city. */
  integrity: number;
  /** Structures in this group that are down, of `structureCount`. */
  structuresDown: number;
  readonly structureCount: number;
  /** 0 to 1. Burning right now. */
  fire: number;
  /** 0 to 1. Left behind by industrial collapses; decays slowly. */
  contamination: number;
  /** 0 to 1 of the roads through this group that are blocked by rubble. */
  rubble: number;
  /** Thousands of people still to be pulled out of this group. */
  trappedThousands: number;
  /** Seconds left of the collapsing state, or zero when nothing is coming down. */
  collapseSecondsLeft: number;
}

/** A named structure worth remembering the state of by name. */
export interface LandmarkDamage {
  readonly landmarkId: string;
  state: BuildingState;
  integrity: number;
}

export const PROJECT_PHASES = ["clearing", "rebuilding"] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export interface RebuildProject {
  readonly groupId: string;
  phase: ProjectPhase;
  /** Crew hours still owed for the current phase. */
  hoursRemaining: number;
  /** Funding still owed. Rebuilding stalls rather than fails when it runs out. */
  fundingRemaining: number;
  /** Hours of work already done, for a readout that means something. */
  hoursSpent: number;
}

export interface RegionDamageSnapshot {
  readonly schemaVersion: number;
  readonly regionId: string;
  /** Only groups that have been touched. An untouched city saves almost nothing. */
  readonly groups: readonly {
    readonly id: string;
    readonly integrity: number;
    readonly down: number;
    readonly fire: number;
    readonly contamination: number;
    readonly rubble: number;
    readonly trapped: number;
  }[];
  readonly landmarks: readonly { readonly id: string; readonly state: BuildingState }[];
  readonly projects: readonly {
    readonly groupId: string;
    readonly phase: ProjectPhase;
    readonly hours: number;
    readonly funding: number;
  }[];
}

/** What an impact did, in words and numbers. */
export interface ImpactResult {
  readonly groupsHit: readonly string[];
  readonly structuresDowned: number;
  readonly debrisSpawned: number;
  readonly firesStarted: number;
  readonly message: string;
}

/** What the region looks like from a strategic screen. */
export interface CitySafetyReport {
  /** 0 to 1. The headline: how much of the city is standing and working. */
  readonly safety: number;
  readonly integrity: number;
  readonly groupsDamaged: number;
  readonly groupsRuined: number;
  readonly firesBurning: number;
  readonly contaminatedGroups: number;
  /** 0 to 1 of the road network blocked by rubble. */
  readonly routesBlocked: number;
  readonly trappedThousands: number;
  /** 0 to 1. How badly rescue crews are needed right now. */
  readonly rescuePressure: number;
  readonly summary: string;
}

export interface DestructionOptions {
  readonly layout: CityLayout;
  readonly buildings?: ContentRegistry<BuildingArchetype>;
  /** Seed for fire and contamination rolls, so a fight repeats exactly. */
  readonly seed?: number;
}

/**
 * Authoritative destruction for one region.
 *
 * Owns no scene objects, no timers and no wall clock. Everything that changes
 * arrives as seconds of combat or hours of work.
 */
export class RegionDestruction {
  private readonly layout: CityLayout;
  private readonly buildings: ContentRegistry<BuildingArchetype>;
  private readonly damageByGroup = new Map<string, GroupDamage>();
  private readonly landmarks = new Map<string, LandmarkDamage>();
  private readonly projects = new Map<string, RebuildProject>();
  private readonly seedValue: number;
  /** Rolls per group, so two fights on the same seed burn the same buildings. */
  private rollCount = 0;

  constructor(options: DestructionOptions) {
    this.layout = options.layout;
    this.buildings = options.buildings ?? createBuildingRegistry();
    this.seedValue = options.seed ?? hashStringToSeed(options.layout.regionId);
    for (const group of options.layout.destructionGroups) {
      this.damageByGroup.set(group.id, freshDamage(group, this.structureCountOf(group)));
    }
    for (const landmark of options.layout.landmarks) {
      this.landmarks.set(landmark.id, { landmarkId: landmark.id, state: "intact", integrity: 1 });
    }
  }

  get regionId(): string {
    return this.layout.regionId;
  }

  groups(): readonly GroupDamage[] {
    return [...this.damageByGroup.values()];
  }

  group(groupId: string): GroupDamage | undefined {
    return this.damageByGroup.get(groupId);
  }

  landmarkStates(): readonly LandmarkDamage[] {
    return [...this.landmarks.values()];
  }

  activeProjects(): readonly RebuildProject[] {
    return [...this.projects.values()];
  }

  /** The state a group is drawn in. Derived, never stored. */
  stateOf(groupId: string): BuildingState {
    const damage = this.damageByGroup.get(groupId);
    if (!damage) return "intact";
    if (damage.collapseSecondsLeft > 0) return "collapsing";
    const project = this.projects.get(groupId);
    if (project) return project.phase === "clearing" ? "ruined" : "rebuilding";
    if (damage.structuresDown >= damage.structureCount && damage.structureCount > 0) return "ruined";
    if (damage.rubble <= 0 && damage.integrity <= 0.2) return "cleared";
    return standingState(damage.integrity);
  }

  /**
   * Puts an impact into the city.
   *
   * Energy is spread across every group inside the radius, weighted by how close
   * the centre of the group is, so one hit at a district boundary damages both
   * sides rather than picking one. Structures come down in whole numbers because
   * a structure is the smallest thing that can fall over.
   */
  applyImpact(east: number, north: number, radiusMeters: number, energy: number): ImpactResult {
    const hit: string[] = [];
    let downed = 0;
    let debris = 0;
    let fires = 0;
    if (energy <= 0 || radiusMeters <= 0) {
      return { groupsHit: hit, structuresDowned: 0, debrisSpawned: 0, firesStarted: 0, message: "" };
    }

    for (const group of this.layout.destructionGroups) {
      const distance = Math.hypot(group.centreEast - east, group.centreNorth - north);
      const reach = radiusMeters + group.radiusMeters;
      if (distance > reach) continue;
      const damage = this.damageByGroup.get(group.id);
      if (!damage) continue;

      // Linear falloff. Closer groups take more, and a group at the very edge
      // takes something rather than nothing, which is what stops a fight
      // leaving a suspiciously round crater.
      const share = 1 - Math.min(1, distance / Math.max(1, reach));
      const archetype = archetypeForDistrict(this.buildings, group.districtId);
      const perStructure = structureFor(archetype, this.averageHeightOf(group));
      const applied = energy * share;
      const before = damage.integrity;
      const total = Math.max(1, perStructure * damage.structureCount);
      damage.integrity = Math.max(0, damage.integrity - applied / total);
      if (damage.integrity >= before) continue;
      hit.push(group.id);

      // How many structures that took down. Whole structures only.
      const standingBefore = damage.structureCount - damage.structuresDown;
      const targetDown = Math.round(damage.structureCount * (1 - damage.integrity));
      const newlyDown = Math.max(0, Math.min(standingBefore, targetDown - damage.structuresDown));
      if (newlyDown > 0) {
        damage.structuresDown += newlyDown;
        downed += newlyDown;
        debris += newlyDown * archetype.debrisYield;
        damage.collapseSecondsLeft = Math.max(damage.collapseSecondsLeft, archetype.collapseSeconds);
        damage.rubble = Math.min(1, damage.rubble + newlyDown * RUBBLE_PER_STRUCTURE);
        damage.trappedThousands += newlyDown * archetype.occupancyThousands * 0.12;

        // Fire and contamination are rolled once per collapse from a named
        // stream, so the same fight always burns the same buildings.
        const rng = createSeededRng(this.seedValue + hashStringToSeed(group.id) + this.rollCount);
        this.rollCount += 1;
        if (rng() < archetype.fireChance) {
          damage.fire = Math.min(1, damage.fire + 0.35 + newlyDown * 0.08);
          fires += 1;
        }
        if (rng() < archetype.contaminationChance) {
          damage.contamination = Math.min(1, damage.contamination + 0.3);
        }
      }
    }

    for (const landmark of this.layout.landmarks) {
      const distance = Math.hypot(landmark.east - east, landmark.north - north);
      if (distance > radiusMeters + landmark.footprintMeters) continue;
      const record = this.landmarks.get(landmark.id);
      if (!record || record.state === "ruined") continue;
      const archetype = archetypeForDistrict(this.buildings, landmark.districtId);
      record.integrity = Math.max(
        0,
        record.integrity - energy / Math.max(1, structureFor(archetype, landmark.heightMeters)),
      );
      record.state = record.integrity <= 0 ? "ruined" : standingState(record.integrity);
      if (record.state === "ruined") debris += archetype.debrisYield;
    }

    const message =
      hit.length === 0
        ? "Nothing standing there to hit."
        : `${hit.length} ${hit.length === 1 ? "block" : "blocks"} hit` +
          (downed > 0 ? `, ${downed} ${downed === 1 ? "structure" : "structures"} down` : "") +
          (fires > 0 ? `, ${fires} on fire` : "") +
          ".";

    return { groupsHit: hit, structuresDowned: downed, debrisSpawned: debris, firesStarted: fires, message };
  }

  /**
   * Seconds of a fight.
   *
   * Only moves what happens on a human timescale: a collapse finishing, and a
   * fire spreading a little while nobody is putting it out.
   */
  advanceSeconds(seconds: number): void {
    if (seconds <= 0) return;
    for (const damage of this.damageByGroup.values()) {
      if (damage.collapseSecondsLeft > 0) {
        damage.collapseSecondsLeft = Math.max(0, damage.collapseSecondsLeft - seconds);
      }
      if (damage.fire > 0) {
        // Untended fire spreads slowly while the fight is on.
        damage.fire = Math.min(1, damage.fire + seconds * 0.002);
      }
    }
  }

  /**
   * Hours between fights.
   *
   * Fires burn out, contamination fades, and people get pulled out of the
   * rubble once the fire is off them. Nothing here rebuilds: rebuilding is a
   * project somebody has to start.
   */
  advanceHours(hours: number): void {
    if (hours <= 0) return;
    for (const damage of this.damageByGroup.values()) {
      damage.collapseSecondsLeft = 0;
      damage.fire = Math.max(0, damage.fire - hours * FIRE_DECAY_PER_HOUR);
      damage.contamination = Math.max(0, damage.contamination - hours * CONTAMINATION_DECAY_PER_HOUR);
      if (damage.trappedThousands > 0 && damage.fire < 0.2) {
        damage.trappedThousands = Math.max(0, damage.trappedThousands - hours * RESCUE_PER_HOUR);
      }
    }
  }

  /** What it would take to put one group right. */
  quoteProject(groupId: string): { readonly hours: number; readonly funding: number } | null {
    const damage = this.damageByGroup.get(groupId);
    const group = this.layout.destructionGroups.find((entry) => entry.id === groupId);
    if (!damage || !group || damage.structuresDown === 0) return null;
    const archetype = archetypeForDistrict(this.buildings, group.districtId);
    return {
      hours: Math.round(damage.structuresDown * (archetype.clearHours + archetype.rebuildHours)),
      funding: Math.round(damage.structuresDown * archetype.rebuildCost),
    };
  }

  /**
   * Starts clearing and then rebuilding one group.
   *
   * Refused, with a reason, when there is nothing to do, when work is already
   * underway, or when the group is still burning: nobody sends crews into a
   * fire.
   */
  startProject(groupId: string): { readonly ok: boolean; readonly message: string } {
    const damage = this.damageByGroup.get(groupId);
    if (!damage) return { ok: false, message: `There is no block called ${groupId}.` };
    if (this.projects.has(groupId)) {
      return { ok: false, message: "Work is already underway there." };
    }
    if (damage.structuresDown === 0) {
      return { ok: false, message: "Nothing to clear there." };
    }
    if (damage.fire > 0.25) {
      return { ok: false, message: "It is still burning. Crews go in once the fire is down." };
    }
    const quote = this.quoteProject(groupId);
    if (!quote) return { ok: false, message: "Nothing to clear there." };
    const group = this.layout.destructionGroups.find((entry) => entry.id === groupId);
    const archetype = archetypeForDistrict(
      this.buildings,
      group?.districtId ?? this.layout.districts[0] ?? "downtown",
    );
    this.projects.set(groupId, {
      groupId,
      phase: "clearing",
      hoursRemaining: damage.structuresDown * archetype.clearHours,
      fundingRemaining: quote.funding,
      hoursSpent: 0,
    });
    return { ok: true, message: `Crews are on their way to ${this.describeGroup(groupId)}.` };
  }

  /**
   * Puts crew hours and funding into every running project.
   *
   * Rate is not just hours: a Shatterdome with a logistics tier behind it works
   * faster, and a region nobody has secured works slower, because crews will not
   * stay in a place that is still being attacked.
   */
  progressProjects(
    hours: number,
    modifiers: {
      readonly facilityBonus?: number;
      readonly security?: number;
      readonly funding?: number;
    } = {},
  ): readonly string[] {
    const messages: string[] = [];
    if (hours <= 0) return messages;
    const facility = Math.max(0.1, modifiers.facilityBonus ?? 1);
    const security = Math.min(1, Math.max(0.1, modifiers.security ?? 1));
    let fundsLeft = modifiers.funding ?? Number.POSITIVE_INFINITY;

    for (const project of [...this.projects.values()]) {
      const damage = this.damageByGroup.get(project.groupId);
      if (!damage) {
        this.projects.delete(project.groupId);
        continue;
      }
      const worked = hours * facility * security;
      project.hoursSpent += worked;
      project.hoursRemaining = Math.max(0, project.hoursRemaining - worked);

      if (project.hoursRemaining > 0) continue;

      if (project.phase === "clearing") {
        // The rubble is gone. Roads open again and the lot is empty.
        damage.rubble = 0;
        damage.collapseSecondsLeft = 0;
        const group = this.layout.destructionGroups.find((entry) => entry.id === project.groupId);
        const archetype = archetypeForDistrict(
          this.buildings,
          group?.districtId ?? this.layout.districts[0] ?? "downtown",
        );
        project.phase = "rebuilding";
        project.hoursRemaining = damage.structuresDown * archetype.rebuildHours;
        messages.push(`${capitalise(this.describeGroup(project.groupId))} is clear. Rebuilding starts.`);
        continue;
      }

      // Rebuilding only finishes when it has been paid for.
      const owed = project.fundingRemaining;
      const paid = Math.min(owed, Math.max(0, fundsLeft));
      project.fundingRemaining -= paid;
      fundsLeft -= paid;
      if (project.fundingRemaining > 0) {
        messages.push(
          `${capitalise(this.describeGroup(project.groupId))} is built but unpaid: ` +
            `${Math.round(project.fundingRemaining).toLocaleString("en-GB")} short.`,
        );
        continue;
      }
      damage.integrity = 1;
      damage.structuresDown = 0;
      damage.rubble = 0;
      damage.trappedThousands = 0;
      damage.contamination = Math.min(damage.contamination, 0.05);
      this.projects.delete(project.groupId);
      messages.push(`${capitalise(this.describeGroup(project.groupId))} is standing again.`);
    }
    return messages;
  }

  /** The strategic view of this city. */
  report(): CitySafetyReport {
    const groups = this.groups();
    if (groups.length === 0) {
      return {
        safety: 1,
        integrity: 1,
        groupsDamaged: 0,
        groupsRuined: 0,
        firesBurning: 0,
        contaminatedGroups: 0,
        routesBlocked: 0,
        trappedThousands: 0,
        rescuePressure: 0,
        summary: "No city here to damage.",
      };
    }

    let integrity = 0;
    let damaged = 0;
    let ruined = 0;
    let fires = 0;
    let contaminated = 0;
    let rubble = 0;
    let trapped = 0;
    for (const group of groups) {
      integrity += group.integrity;
      if (group.integrity < 0.99) damaged += 1;
      if (group.structuresDown >= group.structureCount && group.structureCount > 0) ruined += 1;
      if (group.fire > 0.05) fires += 1;
      if (group.contamination > 0.05) contaminated += 1;
      rubble += group.rubble;
      trapped += group.trappedThousands;
    }
    const count = groups.length;
    const meanIntegrity = integrity / count;
    const routesBlocked = rubble / count;
    // Rescue pressure is people still trapped, made worse by fire on top of them.
    const rescuePressure = Math.min(1, trapped / 40 + (fires / count) * 0.5);
    // Safety is what a strategic screen shows: standing, passable, not burning.
    const safety = Math.max(
      0,
      Math.min(1, meanIntegrity * 0.6 + (1 - routesBlocked) * 0.2 + (1 - rescuePressure) * 0.2),
    );

    return {
      safety,
      integrity: meanIntegrity,
      groupsDamaged: damaged,
      groupsRuined: ruined,
      firesBurning: fires,
      contaminatedGroups: contaminated,
      routesBlocked,
      trappedThousands: trapped,
      rescuePressure,
      summary:
        damaged === 0
          ? "The city is whole."
          : `${damaged} of ${count} blocks damaged, ${ruined} levelled` +
            (fires > 0 ? `, ${fires} still burning` : "") +
            (trapped > 0.05 ? `, ${trapped.toFixed(1)}k still trapped` : "") +
            ".",
    };
  }

  /**
   * True when a point is passable on the ground.
   *
   * Roads, bridges and evacuation routes all use this: rubble in a group closes
   * what runs through it, and clearing it opens them again.
   */
  isPassable(east: number, north: number): boolean {
    // A point belongs to the block it is nearest to. Group radii overlap on a
    // 480 m grid, so asking "is any group near here blocked" would call a street
    // impassable because the next block along came down.
    let nearest: GroupDamage | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const group of this.layout.destructionGroups) {
      const distance = Math.hypot(group.centreEast - east, group.centreNorth - north);
      if (distance > group.radiusMeters || distance >= nearestDistance) continue;
      const damage = this.damageByGroup.get(group.id);
      if (!damage) continue;
      nearest = damage;
      nearestDistance = distance;
    }
    return nearest === undefined || nearest.rubble <= 0.6;
  }

  /**
   * The saved form.
   *
   * Only touched groups, only named landmarks that are not intact, and only
   * running projects. An untouched city writes three empty arrays.
   */
  snapshot(): RegionDamageSnapshot {
    return {
      schemaVersion: DESTRUCTION_SCHEMA_VERSION,
      regionId: this.layout.regionId,
      groups: this.groups()
        .filter(
          (group) =>
            group.integrity < 1 ||
            group.fire > 0 ||
            group.contamination > 0 ||
            group.rubble > 0 ||
            group.trappedThousands > 0,
        )
        .map((group) => ({
          id: group.groupId,
          integrity: round(group.integrity),
          down: group.structuresDown,
          fire: round(group.fire),
          contamination: round(group.contamination),
          rubble: round(group.rubble),
          trapped: round(group.trappedThousands),
        })),
      landmarks: this.landmarkStates()
        .filter((landmark) => landmark.state !== "intact")
        .map((landmark) => ({ id: landmark.landmarkId, state: landmark.state })),
      projects: this.activeProjects().map((project) => ({
        groupId: project.groupId,
        phase: project.phase,
        hours: Math.round(project.hoursRemaining),
        funding: Math.round(project.fundingRemaining),
      })),
    };
  }

  /**
   * Restores from a save.
   *
   * A group or landmark this build no longer has is dropped rather than
   * resurrected, and anything the file never mentioned comes back untouched,
   * which is what an unmentioned block honestly means.
   */
  restore(snapshot: RegionDamageSnapshot): void {
    for (const group of this.damageByGroup.values()) {
      group.integrity = 1;
      group.structuresDown = 0;
      group.fire = 0;
      group.contamination = 0;
      group.rubble = 0;
      group.trappedThousands = 0;
      group.collapseSecondsLeft = 0;
    }
    this.projects.clear();
    for (const landmark of this.landmarks.values()) {
      landmark.state = "intact";
      landmark.integrity = 1;
    }

    for (const record of snapshot.groups) {
      const group = this.damageByGroup.get(record.id);
      if (!group) continue;
      group.integrity = clamp01(record.integrity);
      group.structuresDown = Math.max(0, Math.min(group.structureCount, Math.round(record.down)));
      group.fire = clamp01(record.fire);
      group.contamination = clamp01(record.contamination);
      group.rubble = clamp01(record.rubble);
      group.trappedThousands = Math.max(0, record.trapped);
    }
    for (const record of snapshot.landmarks) {
      const landmark = this.landmarks.get(record.id);
      if (!landmark) continue;
      landmark.state = record.state;
      landmark.integrity = record.state === "ruined" ? 0 : 0.5;
    }
    for (const record of snapshot.projects) {
      if (!this.damageByGroup.has(record.groupId)) continue;
      this.projects.set(record.groupId, {
        groupId: record.groupId,
        phase: record.phase,
        hoursRemaining: Math.max(0, record.hours),
        fundingRemaining: Math.max(0, record.funding),
        hoursSpent: 0,
      });
    }
  }

  /** A block in words, for anything a player reads. */
  describeGroup(groupId: string): string {
    const group = this.layout.destructionGroups.find((entry) => entry.id === groupId);
    if (!group) return groupId;
    const east = Math.round(group.centreEast / 100) / 10;
    const north = Math.round(group.centreNorth / 100) / 10;
    return `the ${group.districtId} block at ${east} km east, ${north} km north`;
  }

  private structureCountOf(group: DestructionGroup): number {
    let total = 0;
    for (const blockId of group.blockIds) {
      const block = this.layout.blocks.find((entry) => entry.id === blockId);
      total += block?.towerCount ?? 1;
    }
    return Math.max(1, total);
  }

  private averageHeightOf(group: DestructionGroup): number {
    let total = 0;
    let count = 0;
    for (const blockId of group.blockIds) {
      const block = this.layout.blocks.find((entry) => entry.id === blockId);
      if (!block) continue;
      total += block.heightMeters;
      count += 1;
    }
    return count === 0 ? 20 : total / count;
  }
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function freshDamage(group: DestructionGroup, structureCount: number): GroupDamage {
  return {
    groupId: group.id,
    integrity: 1,
    structuresDown: 0,
    structureCount,
    fire: 0,
    contamination: 0,
    rubble: 0,
    trappedThousands: 0,
    collapseSecondsLeft: 0,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function emptyDamageSnapshot(regionId: string): RegionDamageSnapshot {
  return {
    schemaVersion: DESTRUCTION_SCHEMA_VERSION,
    regionId,
    groups: [],
    landmarks: [],
    projects: [],
  };
}

export function validateDamageSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["damage snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  const errors: string[] = [];
  if (record["schemaVersion"] !== DESTRUCTION_SCHEMA_VERSION) {
    errors.push(
      `damage.schemaVersion must be ${DESTRUCTION_SCHEMA_VERSION}, got ${String(record["schemaVersion"])}`,
    );
  }
  if (typeof record["regionId"] !== "string" || record["regionId"] === "") {
    errors.push("damage.regionId must name a region");
  }
  for (const key of ["groups", "landmarks", "projects"] as const) {
    if (!Array.isArray(record[key])) errors.push(`damage.${key} must be an array`);
  }
  if (Array.isArray(record["groups"])) {
    for (const entry of record["groups"] as unknown[]) {
      const line = entry as Record<string, unknown>;
      if (typeof line["id"] !== "string") errors.push("every damaged group needs an id");
      for (const key of ["integrity", "fire", "contamination", "rubble"] as const) {
        const value = line[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
          errors.push(`group ${String(line["id"])}.${key} must be within [0, 1]`);
        }
      }
    }
  }
  if (Array.isArray(record["projects"])) {
    for (const entry of record["projects"] as unknown[]) {
      const line = entry as Record<string, unknown>;
      if (!PROJECT_PHASES.includes(line["phase"] as ProjectPhase)) {
        errors.push(`unknown project phase "${String(line["phase"])}"`);
      }
    }
  }
  return errors;
}

/** True when a state should be drawn as rubble rather than as a building. */
export { blocksRoutes };
