import { createSeededRng, type Rng } from "../simulation/rng";

/**
 * Rigid debris, pooled.
 *
 * The rule this file exists to enforce: **a city coming down is not a physics
 * problem**. No wall panel is a body, no building is a rigid assembly. What
 * exists is a fixed pool of chunks, allocated once, thrown out of a collapse on
 * a ballistic arc, and frozen the moment they settle. A frozen chunk costs one
 * transform in a buffer and nothing else.
 *
 * Three ceilings keep it honest:
 *
 * 1. **The pool never grows.** A collapse asking for more chunks than are free
 *    gets the free ones and the request is reported as short, not allocated for.
 * 2. **Everything freezes.** A chunk that lands stops integrating forever.
 * 3. **Everything expires.** Past its lifetime a chunk is recycled even if it is
 *    still in the air, so a bad launch cannot leak a slot.
 *
 * When the pool is full and something new falls, the oldest settled chunk is
 * recycled first: what is happening now matters more than what happened a
 * minute ago.
 */

export const GRAVITY_MPS2 = 9.81;
/**
 * Chunks one collapse may ask for.
 *
 * A tower's worth of rubble is hundreds of pieces and nobody can tell the
 * difference past a couple of dozen, so the ask is capped before it reaches the
 * pool. The pool's own ceiling is the hard limit; this is the sensible one.
 */
export const MAX_CHUNKS_PER_COLLAPSE = 24;
/** Seconds a chunk may exist before its slot is taken back. */
export const DEBRIS_LIFETIME_SECONDS = 45;
/** Below this speed a chunk on the ground is considered settled. */
const SETTLE_SPEED_MPS = 0.6;
/** How much speed a bounce keeps. Rubble does not bounce well. */
const RESTITUTION = 0.22;

export interface DebrisChunk {
  readonly slot: number;
  active: boolean;
  /** True once it has stopped moving. A frozen chunk is never integrated again. */
  frozen: boolean;
  east: number;
  north: number;
  up: number;
  velocityEast: number;
  velocityNorth: number;
  velocityUp: number;
  yawRadians: number;
  spinRadiansPerSecond: number;
  sizeMeters: number;
  ageSeconds: number;
  /** Which group threw it, so clearing a block can take its rubble with it. */
  groupId: string;
}

export interface DebrisSpawnRequest {
  readonly east: number;
  readonly north: number;
  readonly up: number;
  readonly groupId: string;
  /** How many chunks the collapse wants. The pool decides how many it gets. */
  readonly count: number;
  /** Metres the chunks are thrown across. */
  readonly spreadMeters: number;
  readonly sizeMeters: number;
  /** Seeded, so the same collapse always throws the same rubble. */
  readonly rng: Rng;
}

export interface DebrisSpawnResult {
  readonly spawned: number;
  /** Chunks the collapse wanted that the pool would not give it. */
  readonly refused: number;
  /** Settled chunks recycled to make room. */
  readonly recycled: number;
}

export class DebrisPool {
  private readonly slots: DebrisChunk[] = [];
  private liveCount = 0;
  private frozenCount = 0;
  private spawnedTotal = 0;
  private refusedTotal = 0;
  private recycledTotal = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`Debris pool capacity must be a positive integer, got ${capacity}`);
    }
    for (let slot = 0; slot < capacity; slot += 1) {
      this.slots.push({
        slot,
        active: false,
        frozen: false,
        east: 0,
        north: 0,
        up: 0,
        velocityEast: 0,
        velocityNorth: 0,
        velocityUp: 0,
        yawRadians: 0,
        spinRadiansPerSecond: 0,
        sizeMeters: 1,
        ageSeconds: 0,
        groupId: "",
      });
    }
  }

  get live(): number {
    return this.liveCount;
  }

  /** Chunks that have stopped moving. They cost a transform and nothing else. */
  get frozen(): number {
    return this.frozenCount;
  }

  /** Chunks still being integrated. This is the number that costs anything. */
  get simulating(): number {
    return this.liveCount - this.frozenCount;
  }

  get spawned(): number {
    return this.spawnedTotal;
  }

  get refused(): number {
    return this.refusedTotal;
  }

  get recycled(): number {
    return this.recycledTotal;
  }

  active(): readonly DebrisChunk[] {
    return this.slots.filter((chunk) => chunk.active);
  }

  /**
   * Throws chunks out of a collapse.
   *
   * Takes free slots first, then recycles settled chunks, and refuses the rest
   * rather than allocating. A collapse that asks for thirty chunks in a pool of
   * eight gets eight and says so.
   */
  spawn(request: DebrisSpawnRequest): DebrisSpawnResult {
    let spawned = 0;
    let recycled = 0;
    const wanted = Math.max(0, Math.round(request.count));

    for (let index = 0; index < wanted; index += 1) {
      let chunk = this.slots.find((entry) => !entry.active);
      if (!chunk) {
        // Nothing free. Take the oldest thing that has already stopped moving,
        // because a settled chunk from a minute ago is the least interesting
        // object in the scene.
        chunk = this.oldestFrozen();
        if (!chunk) break;
        this.release(chunk);
        recycled += 1;
      }
      const angle = request.rng() * Math.PI * 2;
      const speed = 6 + request.rng() * 18;
      const lift = 4 + request.rng() * 14;
      chunk.active = true;
      chunk.frozen = false;
      chunk.east = request.east + Math.sin(angle) * request.spreadMeters * request.rng() * 0.3;
      chunk.north = request.north + Math.cos(angle) * request.spreadMeters * request.rng() * 0.3;
      chunk.up = request.up;
      chunk.velocityEast = Math.sin(angle) * speed;
      chunk.velocityNorth = Math.cos(angle) * speed;
      chunk.velocityUp = lift;
      chunk.yawRadians = request.rng() * Math.PI * 2;
      chunk.spinRadiansPerSecond = (request.rng() - 0.5) * 6;
      chunk.sizeMeters = request.sizeMeters * (0.6 + request.rng() * 0.8);
      chunk.ageSeconds = 0;
      chunk.groupId = request.groupId;
      this.liveCount += 1;
      this.spawnedTotal += 1;
      spawned += 1;
    }

    const refused = wanted - spawned;
    this.refusedTotal += refused;
    this.recycledTotal += recycled;
    return { spawned, refused, recycled };
  }

  /**
   * Integrates everything still moving.
   *
   * Frozen chunks are skipped entirely, which is the point of freezing them: a
   * street full of settled rubble costs nothing per tick.
   */
  advance(deltaSeconds: number, groundHeight: (east: number, north: number) => number | null): void {
    if (deltaSeconds <= 0) return;
    for (const chunk of this.slots) {
      if (!chunk.active) continue;
      chunk.ageSeconds += deltaSeconds;
      if (chunk.ageSeconds >= DEBRIS_LIFETIME_SECONDS) {
        this.release(chunk);
        continue;
      }
      if (chunk.frozen) continue;

      chunk.velocityUp -= GRAVITY_MPS2 * deltaSeconds;
      chunk.east += chunk.velocityEast * deltaSeconds;
      chunk.north += chunk.velocityNorth * deltaSeconds;
      chunk.up += chunk.velocityUp * deltaSeconds;
      chunk.yawRadians += chunk.spinRadiansPerSecond * deltaSeconds;

      const ground = groundHeight(chunk.east, chunk.north);
      if (ground === null) {
        // Off the loaded world. Nothing out there is worth simulating.
        this.release(chunk);
        continue;
      }
      const rest = ground + chunk.sizeMeters * 0.5;
      if (chunk.up > rest) continue;

      chunk.up = rest;
      chunk.velocityUp = -chunk.velocityUp * RESTITUTION;
      chunk.velocityEast *= 0.55;
      chunk.velocityNorth *= 0.55;
      chunk.spinRadiansPerSecond *= 0.5;
      const speed = Math.hypot(chunk.velocityEast, chunk.velocityNorth, chunk.velocityUp);
      if (speed < SETTLE_SPEED_MPS) {
        chunk.velocityEast = 0;
        chunk.velocityNorth = 0;
        chunk.velocityUp = 0;
        chunk.spinRadiansPerSecond = 0;
        chunk.frozen = true;
        this.frozenCount += 1;
      }
    }
  }

  /** Takes back everything thrown by one group. Used when a block is cleared. */
  clearGroup(groupId: string): number {
    let cleared = 0;
    for (const chunk of this.slots) {
      if (!chunk.active || chunk.groupId !== groupId) continue;
      this.release(chunk);
      cleared += 1;
    }
    return cleared;
  }

  clear(): void {
    for (const chunk of this.slots) {
      if (chunk.active) this.release(chunk);
    }
  }

  private oldestFrozen(): DebrisChunk | undefined {
    let oldest: DebrisChunk | undefined;
    for (const chunk of this.slots) {
      if (!chunk.active || !chunk.frozen) continue;
      if (!oldest || chunk.ageSeconds > oldest.ageSeconds) oldest = chunk;
    }
    return oldest;
  }

  private release(chunk: DebrisChunk): void {
    if (!chunk.active) return;
    chunk.active = false;
    if (chunk.frozen) this.frozenCount -= 1;
    chunk.frozen = false;
    this.liveCount -= 1;
  }
}

/** A named stream, so two collapses on the same tick throw different rubble. */
export function debrisStream(seed: number, groupId: string): Rng {
  let hash = 2_166_136_261;
  for (let index = 0; index < groupId.length; index += 1) {
    hash ^= groupId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return createSeededRng((hash ^ (seed | 0)) >>> 0);
}
