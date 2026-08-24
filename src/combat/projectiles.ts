import { createSeededRng, hashStringToSeed, type Rng } from "../simulation/rng";
import type { WeaponDefinition } from "../data/weapons";
import { sweepCapsuleAgainstSphere, type Point3, type TargetSphere } from "./hitVolumes";

/**
 * Projectiles.
 *
 * A fixed pool of bodies, allocated once and reused forever. Two rules keep this
 * from becoming the thing that eats a frame:
 *
 * 1. **The pool has a ceiling and never grows.** A barrage that would exceed it
 *    is refused rather than allocating; the refusal is reported so a weapon that
 *    outruns the budget is visible rather than silently thinning.
 * 2. **Nothing is simulated outside the combat bubble.** A round that leaves the
 *    bubble, outlives its own range, or exceeds its lifetime is retired on the
 *    spot. There is no such thing as a shell still flying somewhere over the
 *    Pacific ten minutes later.
 *
 * Movement is straight-line for direct fire and a real arc for indirect, both
 * integrated on the combat tick. Spread is drawn from a seeded stream, so the
 * same barrage from the same seed lands in the same places.
 */

export const PROJECTILE_TICK_SECONDS = 1 / 60;
/** Nothing outside this distance from the fight is simulated at all. */
export const COMBAT_BUBBLE_METERS = 2_400;
/** Hard ceiling on how long any round may live, whatever its speed. */
export const MAX_PROJECTILE_SECONDS = 12;

export interface Projectile {
  /** Stable while live. Reused when the slot is recycled, with a new generation. */
  readonly slot: number;
  generation: number;
  active: boolean;
  weaponId: string;
  ownerId: string;
  /** Fighter this was fired at, for weapons that track. Null for dumb fire. */
  targetId: string | null;
  east: number;
  north: number;
  up: number;
  velocityEast: number;
  velocityNorth: number;
  velocityUp: number;
  radiusMeters: number;
  /** Metres left before it falls out of the air. */
  rangeLeftMeters: number;
  ageSeconds: number;
  /** True for indirect fire, which arcs rather than flying straight. */
  ballistic: boolean;
  friendlyFire: boolean;
}

export interface ProjectileHit {
  readonly projectile: Projectile;
  readonly targetId: string;
  readonly contact: Point3;
}

export interface ProjectileRetirement {
  readonly slot: number;
  readonly reason: "hit" | "out-of-range" | "expired" | "left-bubble" | "ground";
}

export interface ProjectileTargets {
  /** Spheres a round may hit, by fighter id. */
  readonly spheresFor: (fighterId: string) => readonly TargetSphere[];
  readonly fighterIds: readonly string[];
  /** Ground height at a point, or null where nothing is loaded. */
  readonly groundHeight: (east: number, north: number) => number | null;
  /** Centre of the fight. Anything beyond the bubble from here is retired. */
  readonly bubbleCentre: () => { east: number; north: number };
}

export interface SpawnRequest {
  readonly weapon: WeaponDefinition;
  readonly ownerId: string;
  readonly targetId: string | null;
  readonly east: number;
  readonly north: number;
  readonly up: number;
  readonly yawDeg: number;
  /** Degrees above the horizon. Indirect fire uses a real launch angle. */
  readonly pitchDeg: number;
  /** Index inside a salvo, so each round of a burst scatters differently. */
  readonly shotIndex: number;
  /** Seeded stream, so a barrage is reproducible. */
  readonly rng: Rng;
}

export const GRAVITY_MPS2 = 9.81;

/**
 * A fixed pool of projectiles.
 *
 * Owns no scene objects and no timers. The renderer reads `live()` and draws
 * what is there; nothing about drawing can change what the simulation believes.
 */
export class ProjectilePool {
  private readonly slots: Projectile[] = [];
  private liveCount = 0;
  private spawnedTotal = 0;
  private refusedTotal = 0;
  private retiredTotal = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`Projectile pool capacity must be a positive integer, got ${capacity}`);
    }
    for (let slot = 0; slot < capacity; slot += 1) {
      this.slots.push({
        slot,
        generation: 0,
        active: false,
        weaponId: "",
        ownerId: "",
        targetId: null,
        east: 0,
        north: 0,
        up: 0,
        velocityEast: 0,
        velocityNorth: 0,
        velocityUp: 0,
        radiusMeters: 1,
        rangeLeftMeters: 0,
        ageSeconds: 0,
        ballistic: false,
        friendlyFire: false,
      });
    }
  }

  get live(): number {
    return this.liveCount;
  }

  get spawned(): number {
    return this.spawnedTotal;
  }

  get refused(): number {
    return this.refusedTotal;
  }

  get retired(): number {
    return this.retiredTotal;
  }

  /** Every live projectile. The renderer reads this and owns none of it. */
  active(): readonly Projectile[] {
    return this.slots.filter((projectile) => projectile.active);
  }

  /**
   * Puts a round in the world, or refuses when the pool is full.
   *
   * Refusing is deliberate: growing the pool under fire is how a barrage turns
   * into a frame spike, and thinning silently is how a weapon quietly stops
   * working without anybody knowing why.
   */
  spawn(request: SpawnRequest): Projectile | null {
    const free = this.slots.find((projectile) => !projectile.active);
    if (!free) {
      this.refusedTotal += 1;
      return null;
    }

    const weapon = request.weapon;
    // Spread is deterministic: the same shot index from the same stream always
    // scatters the same way.
    const spread = weapon.spreadDeg === 0 ? 0 : (request.rng() - 0.5) * weapon.spreadDeg;
    const yaw = ((request.yawDeg + spread) * Math.PI) / 180;
    const ballistic = weapon.behavior === "mortar" || weapon.behavior === "arc";
    // Indirect fire leaves at a real angle; direct fire leaves along the aim.
    const pitch = ((ballistic ? Math.max(28, request.pitchDeg + 34) : request.pitchDeg) * Math.PI) / 180;
    const speed = Math.max(1, weapon.projectileSpeedMps);
    const horizontal = Math.cos(pitch) * speed;

    free.active = true;
    free.generation += 1;
    free.weaponId = weapon.id;
    free.ownerId = request.ownerId;
    free.targetId = request.targetId;
    free.east = request.east;
    free.north = request.north;
    free.up = request.up;
    free.velocityEast = Math.sin(yaw) * horizontal;
    free.velocityNorth = Math.cos(yaw) * horizontal;
    free.velocityUp = Math.sin(pitch) * speed;
    free.radiusMeters = weapon.behavior === "salvo" ? 6 : 3.5;
    free.rangeLeftMeters = weapon.rangeMeters;
    free.ageSeconds = 0;
    free.ballistic = ballistic;
    free.friendlyFire = weapon.friendlyFire;
    this.liveCount += 1;
    this.spawnedTotal += 1;
    return free;
  }

  /**
   * Advances every live round by one tick and reports what hit and what retired.
   *
   * A round is swept from where it was to where it is, against the same geometry
   * a fist is swept against, so a fast shell cannot pass through a target
   * between two ticks.
   */
  advance(
    deltaSeconds: number,
    targets: ProjectileTargets,
  ): {
    readonly hits: readonly ProjectileHit[];
    readonly retired: readonly ProjectileRetirement[];
  } {
    const hits: ProjectileHit[] = [];
    const retired: ProjectileRetirement[] = [];
    if (deltaSeconds <= 0) return { hits, retired };

    const centre = targets.bubbleCentre();

    for (const projectile of this.slots) {
      if (!projectile.active) continue;

      const fromEast = projectile.east;
      const fromNorth = projectile.north;
      const fromUp = projectile.up;

      if (projectile.ballistic) projectile.velocityUp -= GRAVITY_MPS2 * deltaSeconds;
      projectile.east += projectile.velocityEast * deltaSeconds;
      projectile.north += projectile.velocityNorth * deltaSeconds;
      projectile.up += projectile.velocityUp * deltaSeconds;
      projectile.ageSeconds += deltaSeconds;

      const travelled = Math.hypot(
        projectile.east - fromEast,
        projectile.north - fromNorth,
        projectile.up - fromUp,
      );
      projectile.rangeLeftMeters -= travelled;

      // What it hit, swept over the whole step rather than sampled at the end.
      const from: TargetSphere = {
        id: "shot",
        centre: { east: fromEast, up: fromUp, north: fromNorth },
        radiusMeters: projectile.radiusMeters,
      };
      const to: TargetSphere = {
        id: "shot",
        centre: { east: projectile.east, up: projectile.up, north: projectile.north },
        radiusMeters: projectile.radiusMeters,
      };
      let struck: ProjectileHit | null = null;
      for (const fighterId of targets.fighterIds) {
        if (fighterId === projectile.ownerId) continue;
        for (const sphere of targets.spheresFor(fighterId)) {
          const result = sweepCapsuleAgainstSphere(
            { a: from.centre, b: from.centre, radiusMeters: from.radiusMeters },
            { a: to.centre, b: to.centre, radiusMeters: to.radiusMeters },
            sphere,
            sphere,
          );
          if (result.hit) {
            struck = { projectile, targetId: fighterId, contact: result.contact };
            break;
          }
        }
        if (struck) break;
      }

      if (struck) {
        hits.push(struck);
        this.retire(projectile, "hit", retired);
        continue;
      }

      const ground = targets.groundHeight(projectile.east, projectile.north);
      if (ground !== null && projectile.up <= ground) {
        this.retire(projectile, "ground", retired);
        continue;
      }
      if (projectile.rangeLeftMeters <= 0) {
        this.retire(projectile, "out-of-range", retired);
        continue;
      }
      if (projectile.ageSeconds >= MAX_PROJECTILE_SECONDS) {
        this.retire(projectile, "expired", retired);
        continue;
      }
      // The bubble rule: nothing is authoritative once it has left the fight.
      const distance = Math.hypot(projectile.east - centre.east, projectile.north - centre.north);
      if (distance > COMBAT_BUBBLE_METERS) {
        this.retire(projectile, "left-bubble", retired);
      }
    }

    return { hits, retired };
  }

  /** Empties the pool. Used when a fight ends, so nothing survives it. */
  clear(): void {
    for (const projectile of this.slots) {
      if (projectile.active) {
        projectile.active = false;
        this.retiredTotal += 1;
      }
    }
    this.liveCount = 0;
  }

  private retire(
    projectile: Projectile,
    reason: ProjectileRetirement["reason"],
    into: ProjectileRetirement[],
  ): void {
    projectile.active = false;
    this.liveCount -= 1;
    this.retiredTotal += 1;
    into.push({ slot: projectile.slot, reason });
  }
}

/** A named stream, so two weapons firing on the same tick scatter independently. */
export function spreadStream(seed: number, weaponId: string): Rng {
  return createSeededRng(hashStringToSeed(`${weaponId}|spread`) ^ (seed | 0));
}
