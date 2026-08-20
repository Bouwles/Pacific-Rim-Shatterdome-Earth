export type Rng = () => number;

/**
 * mulberry32 — small, fast, deterministic PRNG. Authoritative simulation code
 * (attack director, salvage, mutations, weather, etc.) must use this instead
 * of Math.random so runs are reproducible from a seed.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0 || 1;
  return function mulberry32(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  if (maxExclusive <= minInclusive) {
    throw new Error(`rngInt range invalid: [${minInclusive}, ${maxExclusive})`);
  }
  return Math.floor(rng() * (maxExclusive - minInclusive)) + minInclusive;
}

/** FNV-1a 32-bit string hash. Maps a subsystem name to a stable seed offset. */
export function hashStringToSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Named, independent RNG streams derived from one master seed.
 *
 * Each subsystem takes its own stream by name, so how often one subsystem draws
 * numbers can never shift another subsystem's sequence. That independence is
 * what makes a replay reproducible when only part of the simulation changes.
 */
export class RngStreams {
  private readonly streams = new Map<string, Rng>();

  constructor(readonly masterSeed: number) {
    if (!Number.isFinite(masterSeed)) {
      throw new Error(`RngStreams master seed must be finite, got ${masterSeed}`);
    }
  }

  stream(name: string): Rng {
    if (!name) throw new Error("RngStreams.stream requires a non-empty subsystem name");
    let existing = this.streams.get(name);
    if (!existing) {
      existing = createSeededRng((this.masterSeed ^ hashStringToSeed(name)) >>> 0);
      this.streams.set(name, existing);
    }
    return existing;
  }

  /** Stream names taken so far, sorted — for diagnostics only, never for simulation branching. */
  activeStreamNames(): readonly string[] {
    return Array.from(this.streams.keys()).sort();
  }
}
