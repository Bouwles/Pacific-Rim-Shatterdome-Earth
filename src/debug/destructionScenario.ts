import { generateCityLayout, type CityLayout } from "../world/cityLayout";
import { createDistrictRegistry, HONG_KONG_DISTRICT_PLAN } from "../data/districts";
import { RegionDestruction, type CitySafetyReport } from "../world/destruction";
import { DebrisPool, debrisStream, MAX_CHUNKS_PER_COLLAPSE } from "../world/debris";

/**
 * A city being knocked down, run headlessly.
 *
 * Three things this proves that nothing else can. That a battle changes the
 * district it happens in and the change survives being written out and read
 * back. That time turns a levelled block into a cleared one and then a rebuilt
 * one, in stages, rather than snapping back. And that a stress run cannot put
 * more debris in the world than the pool allows, however hard it is pushed.
 */

export const DESTRUCTION_SCENARIO_SEED = 20260824;

export interface DestructionScenarioOptions {
  readonly seed?: number;
  /** How many impacts the fight lands. */
  readonly impacts?: number;
  /** Metres of blast radius per impact. */
  readonly radiusMeters?: number;
  /** Damage per impact. */
  readonly energy?: number;
  /** Ceiling on live debris, so a test can starve the pool deliberately. */
  readonly debrisCapacity?: number;
  /** Hours of recovery run after the fight. */
  readonly recoveryHours?: number;
  /** Crew hours put into projects during recovery. */
  readonly workHours?: number;
  readonly funding?: number;
}

export interface DestructionScenarioResult {
  readonly layout: CityLayout;
  readonly before: CitySafetyReport;
  readonly afterFight: CitySafetyReport;
  readonly afterRecovery: CitySafetyReport;
  readonly groupsHit: number;
  readonly structuresDowned: number;
  readonly debrisRequested: number;
  readonly debrisSpawned: number;
  readonly debrisRefused: number;
  readonly debrisPeakLive: number;
  readonly debrisLiveAtEnd: number;
  readonly debrisCapacity: number;
  readonly projectMessages: readonly string[];
  readonly snapshotBytes: number;
  /** Digest of the saved summary, so two identical runs can be compared. */
  readonly digest: number;
}

export function buildScenarioLayout(seed = DESTRUCTION_SCENARIO_SEED): CityLayout {
  const registry = createDistrictRegistry();
  const districts = new Map(registry.all().map((district) => [district.id, district]));
  return generateCityLayout({
    regionId: "hong-kong",
    seed,
    radiusMeters: 5_600,
    seawardBearingDeg: 180,
    plan: HONG_KONG_DISTRICT_PLAN,
    districts,
    maxBlocks: 1_400,
  });
}

/**
 * Levels part of a city, then gives it time and crews.
 *
 * Deterministic throughout: the layout is seeded, the impacts walk a fixed path
 * through the harbour front, and every fire and every chunk of rubble comes from
 * a named stream.
 */
export function runDestructionScenario(options: DestructionScenarioOptions = {}): DestructionScenarioResult {
  const seed = options.seed ?? DESTRUCTION_SCENARIO_SEED;
  const layout = buildScenarioLayout(seed);
  const destruction = new RegionDestruction({ layout, seed });
  const pool = new DebrisPool(options.debrisCapacity ?? 140);
  const impacts = options.impacts ?? 12;
  const radius = options.radiusMeters ?? 260;
  const energy = options.energy ?? 90_000;

  const before = destruction.report();
  const groupsHit = new Set<string>();
  let downed = 0;
  let requested = 0;
  let peakLive = 0;

  // A fight walks across the city rather than standing still, so the damage is
  // a scar through the district instead of one crater.
  const start = layout.destructionGroups[0];
  for (let index = 0; index < impacts; index += 1) {
    const target = layout.destructionGroups[(index * 7) % Math.max(1, layout.destructionGroups.length)];
    const east = target?.centreEast ?? start?.centreEast ?? 0;
    const north = target?.centreNorth ?? start?.centreNorth ?? 0;
    const result = destruction.applyImpact(east, north, radius, energy);
    for (const id of result.groupsHit) groupsHit.add(id);
    downed += result.structuresDowned;
    // A collapse asks for a sensible number of chunks, not one per brick.
    const wanted = Math.min(result.debrisSpawned, MAX_CHUNKS_PER_COLLAPSE);
    requested += wanted;
    if (wanted > 0) {
      pool.spawn({
        east,
        north,
        up: 40,
        groupId: result.groupsHit[0] ?? "unknown",
        count: wanted,
        spreadMeters: radius,
        sizeMeters: 6,
        rng: debrisStream(seed + index, result.groupsHit[0] ?? "unknown"),
      });
    }
    // A second of fighting between impacts, with the rubble in the air.
    for (let step = 0; step < 60; step += 1) {
      pool.advance(1 / 60, () => 0);
      destruction.advanceSeconds(1 / 60);
      peakLive = Math.max(peakLive, pool.live);
    }
  }

  const afterFight = destruction.report();

  // Recovery: fires burn down, people come out, and crews start on the worst
  // block that is no longer alight.
  const recoveryHours = options.recoveryHours ?? 72;
  destruction.advanceHours(recoveryHours);
  const messages: string[] = [];
  const worst = [...destruction.groups()]
    .filter((group) => group.structuresDown > 0)
    .sort((a, b) => a.integrity - b.integrity)[0];
  if (worst) {
    const started = destruction.startProject(worst.groupId);
    messages.push(started.message);
  }
  messages.push(
    ...destruction.progressProjects(options.workHours ?? 4_000, {
      facilityBonus: 1.2,
      security: 0.9,
      funding: options.funding ?? 200_000_000,
    }),
  );

  // Long enough for every chunk to have expired, so the pool must come back.
  for (let step = 0; step < 60 * 60; step += 1) pool.advance(1 / 60, () => 0);

  const snapshot = destruction.snapshot();
  const text = JSON.stringify(snapshot);

  return {
    layout,
    before,
    afterFight,
    afterRecovery: destruction.report(),
    groupsHit: groupsHit.size,
    structuresDowned: downed,
    debrisRequested: requested,
    debrisSpawned: pool.spawned,
    debrisRefused: pool.refused,
    debrisPeakLive: peakLive,
    debrisLiveAtEnd: pool.live,
    debrisCapacity: pool.capacity,
    projectMessages: messages,
    snapshotBytes: text.length,
    digest: digestOf(text),
  };
}

/** A deliberate overload: far more rubble than the pool can hold. */
export function runDebrisStress(debrisCapacity = 48): DestructionScenarioResult {
  return runDestructionScenario({
    debrisCapacity,
    impacts: 30,
    radiusMeters: 420,
    energy: 400_000,
  });
}

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
