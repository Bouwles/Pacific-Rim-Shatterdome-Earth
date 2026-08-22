/**
 * Deterministic spatial noise for terrain.
 *
 * `RngStreams` produces a sequence, which is the wrong shape for terrain: two
 * sectors that share an edge must agree on the samples along that edge no matter
 * which one was generated first, or which was generated at all. So terrain draws
 * from a hash of the sample position rather than from a stream. Same seed and
 * same point gives the same value forever, in any order, in any process.
 *
 * Noise is sampled in three dimensions on the unit sphere rather than in two
 * dimensions per cube face. A per-face 2D field would seam along the twelve cube
 * edges, and no amount of blending hides a coastline that stops dead at a face
 * boundary.
 *
 * Integer mixing only: no `Math.random`, no wall clock, no table allocation.
 */

const UINT32 = 4_294_967_296;

/** Integer avalanche (Murmur-style finaliser). Spreads one changed bit across all 32. */
function mix32(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Pseudorandom value in [0, 1) for one integer lattice point. */
export function latticeValue(seed: number, ix: number, iy: number, iz: number): number {
  let h = seed | 0;
  h = mix32(h ^ Math.imul(ix | 0, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(iy | 0, 0x165667b1));
  h = mix32(h ^ Math.imul(iz | 0, 0x9e3779b1));
  return mix32(h) / UINT32;
}

/** Smoothstep. Gives the interpolated field a continuous first derivative, so terrain has no creases. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Trilinearly interpolated value noise in [0, 1]. */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);

  const c000 = latticeValue(seed, ix, iy, iz);
  const c100 = latticeValue(seed, ix + 1, iy, iz);
  const c010 = latticeValue(seed, ix, iy + 1, iz);
  const c110 = latticeValue(seed, ix + 1, iy + 1, iz);
  const c001 = latticeValue(seed, ix, iy, iz + 1);
  const c101 = latticeValue(seed, ix + 1, iy, iz + 1);
  const c011 = latticeValue(seed, ix, iy + 1, iz + 1);
  const c111 = latticeValue(seed, ix + 1, iy + 1, iz + 1);

  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);

  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

export interface FbmOptions {
  readonly octaves: number;
  readonly frequency: number;
  readonly lacunarity?: number;
  readonly gain?: number;
}

/**
 * Fractal sum of value noise, normalised to [0, 1].
 *
 * Normalising by the amplitude sum rather than by a hard-coded constant keeps the
 * output range stable when the octave count changes, so tuning detail does not
 * silently move sea level.
 */
export function fbm3(seed: number, x: number, y: number, z: number, options: FbmOptions): number {
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;
  if (!Number.isInteger(options.octaves) || options.octaves < 1) {
    throw new Error(`fbm3 needs at least one octave, got ${options.octaves}`);
  }

  let frequency = options.frequency;
  let amplitude = 1;
  let total = 0;
  let normalisation = 0;

  for (let octave = 0; octave < options.octaves; octave += 1) {
    // Offsetting the seed per octave stops octaves from lining up on the lattice.
    total += amplitude * valueNoise3(seed + octave * 0x9e37, x * frequency, y * frequency, z * frequency);
    normalisation += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return total / normalisation;
}

/**
 * Ridged variant: folds the field at its midpoint so the maxima become sharp
 * lines rather than round blobs. This is what makes mountain ranges read as
 * ranges instead of as lumps.
 */
export function ridged3(seed: number, x: number, y: number, z: number, options: FbmOptions): number {
  const value = fbm3(seed, x, y, z, options);
  return 1 - Math.abs(value * 2 - 1);
}

/** Clamped remap of `value` from [inMin, inMax] to [0, 1]. */
export function remap01(value: number, inMin: number, inMax: number): number {
  if (inMax === inMin) return 0;
  const t = (value - inMin) / (inMax - inMin);
  return Math.min(1, Math.max(0, t));
}
