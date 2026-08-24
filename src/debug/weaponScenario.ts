import { createMoveRegistry } from "../data/moves";
import { createKaijuRegistry } from "../data/kaiju";
import { createWeaponRegistry } from "../data/weapons";
import { jaegerRegistry } from "../data/jaegers";
import {
  CombatArena,
  combatProfileFor,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
  type ArenaSnapshot,
  type CombatEvent,
} from "../combat/arena";

/**
 * Ranged combat, run headlessly.
 *
 * Two things this proves that nothing else can. First, that every weapon behaves
 * differently through the same code: a mortar cannot be used up close, a salvo
 * puts several bodies in the air, a beam arrives instantly, a channel bleeds
 * heat for as long as it is held. Second, that a barrage cannot break the pool:
 * the stress run fires far more than the pool can hold and then checks that
 * everything came back.
 */

export const WEAPON_SCENARIO_TICKS = 1_800;

export interface WeaponScenarioOptions {
  readonly jaegerId?: string;
  readonly kaijuId?: string;
  readonly ticks?: number;
  readonly seed?: number;
  /** Which weapons the machine carries. Defaults to everything. */
  readonly weaponIds?: readonly string[];
  /** Metres between the two at the start. */
  readonly separationMeters?: number;
  /** Ticks between trigger pulls. */
  readonly cadenceTicks?: number;
  /** Ceiling on live rounds, so a test can starve the pool deliberately. */
  readonly projectileCapacity?: number;
}

export interface WeaponScenarioResult {
  readonly ticks: number;
  readonly events: readonly CombatEvent[];
  readonly snapshot: ArenaSnapshot;
  readonly digest: number;
  readonly shotsFired: number;
  readonly refusals: readonly string[];
  readonly projectileHits: number;
  readonly beamHits: number;
  readonly reloads: number;
  readonly dryEvents: number;
  readonly statusesApplied: readonly string[];
  readonly poolLive: number;
  readonly poolSpawned: number;
  readonly poolRefused: number;
  readonly damageToKaiju: number;
  readonly winner: string | null;
}

export function runWeaponScenario(options: WeaponScenarioOptions = {}): WeaponScenarioResult {
  const moves = createMoveRegistry();
  const weapons = createWeaponRegistry();
  const kaijuRegistry = createKaijuRegistry();
  const jaeger = jaegerRegistry.getOrThrow(options.jaegerId ?? "placeholder-mk0");
  const kaiju = kaijuRegistry.getOrThrow(options.kaijuId ?? "kaiju.test-dummy");
  const ticks = options.ticks ?? WEAPON_SCENARIO_TICKS;
  const separation = options.separationMeters ?? 300;
  const cadence = options.cadenceTicks ?? 40;

  const arena = new CombatArena({
    moves,
    seed: options.seed ?? 20260824,
    projectileCapacity: options.projectileCapacity ?? 96,
    // Flat ground under the fight, so a mortar shell has something to land on.
    groundHeight: () => 0,
    fighters: [
      {
        id: "jaeger",
        kind: "jaeger",
        displayName: jaeger.name,
        heightMeters: jaeger.locomotion.heightMeters,
        profile: combatProfileFor(jaeger),
        pose: { east: 0, north: 0, up: 0, yawDeg: 0 },
        zones: jaegerZones(jaeger),
        finisherThreshold: 0.2,
      },
      {
        id: "kaiju",
        kind: "kaiju",
        displayName: kaiju.name,
        heightMeters: kaiju.heightMeters,
        profile: kaijuCombatProfile(kaiju),
        pose: { east: 0, north: separation, up: 0, yawDeg: 180 },
        zones: kaijuZones(kaiju),
        kaiju,
        finisherThreshold: kaiju.finisherThreshold,
      },
    ],
  });

  const carried = (options.weaponIds ?? weapons.all().map((weapon) => weapon.id)).map((id) =>
    weapons.getOrThrow(id),
  );
  for (const weapon of carried) arena.equipWeapon("jaeger", weapon);

  const refusals: string[] = [];
  let index = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    if (tick > 0 && tick % cadence === 0) {
      const weapon = carried[index % carried.length];
      index += 1;
      if (weapon) {
        const outcome = arena.fireWeapon("jaeger", weapon.id);
        if (!outcome.ok) {
          refusals.push(outcome.message);
          // Out of ammunition is a reason to reload rather than to give up,
          // which is the whole point of the acceptance rule about running dry.
          if (outcome.reason === "no-ammo") arena.reloadWeapon("jaeger", weapon.id);
        }
      }
    }
    // A channel is held for half a second and then released, so sustained fire
    // is exercised rather than left running forever.
    if (tick % cadence === 20) arena.releaseWeapon("jaeger");
    arena.faceToward("jaeger", "kaiju", 3);
    arena.step();
  }

  const events = arena.log();
  const pool = arena.projectilePool();
  const snapshot = arena.snapshot();
  const kaijuView = snapshot.fighters.find((fighter) => fighter.id === "kaiju");
  const jaegerView = snapshot.fighters.find((fighter) => fighter.id === "jaeger");

  return {
    ticks,
    events,
    snapshot,
    digest: arena.digest(),
    shotsFired: events.filter((event) => event.type === "weapon-fired").length,
    refusals,
    projectileHits: events.filter((event) => event.type === "projectile-hit").length,
    beamHits: events.filter((event) => event.type === "hit" && (event.moveId ?? "").startsWith("weapon."))
      .length,
    reloads: events.filter((event) => event.type === "weapon-reloaded").length,
    dryEvents: events.filter((event) => event.type === "weapon-dry").length,
    statusesApplied: events
      .filter((event) => event.type === "status-applied")
      .map((event) => event.reason ?? ""),
    poolLive: pool.live,
    poolSpawned: pool.spawned,
    poolRefused: pool.refused,
    damageToKaiju: events
      .filter((event) => event.targetId === "kaiju")
      .reduce((total, event) => total + event.damage, 0),
    winner: kaijuView?.defeated === true ? "jaeger" : jaegerView?.defeated === true ? "kaiju" : null,
  };
}

/**
 * A deliberate barrage.
 *
 * Fires far more rounds than the pool can hold, then runs long enough for every
 * one of them to retire. What matters afterwards is that the pool is empty and
 * that the refusals were reported rather than silently swallowed.
 */
export function runBarrageStress(projectileCapacity = 32): WeaponScenarioResult {
  return runWeaponScenario({
    ticks: 2_400,
    cadenceTicks: 4,
    projectileCapacity,
    weaponIds: ["weapon.rotary-cannon", "weapon.anti-kaiju-missile", "weapon.shoulder-mortar"],
    separationMeters: 800,
  });
}
