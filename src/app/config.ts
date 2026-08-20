/**
 * Seed used when nothing overrides it. A fixed constant rather than a clock
 * reading, so a plain page load is reproducible; new-campaign seeding becomes a
 * save-system concern once saves exist.
 */
export const DEFAULT_SEED = 20260819;

/**
 * Reads `?seed=` from a URL for reproducible dev runs. Falls back to the default
 * on anything unparseable rather than silently seeding with NaN.
 */
export function resolveSeed(search: string, fallback: number = DEFAULT_SEED): number {
  const raw = new URLSearchParams(search).get("seed");
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
