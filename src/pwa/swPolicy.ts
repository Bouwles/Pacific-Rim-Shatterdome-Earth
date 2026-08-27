/**
 * The caching policy, as pure decisions.
 *
 * The service worker itself is `public/sw.js` and has to be plain JavaScript at
 * a stable URL, so it cannot import this module. What it can do is implement
 * exactly these rules, and a test holds the two together by reading the
 * worker's source and checking the constants match. The rules live here so they
 * are stated once, testable headless, and legible without reading a worker.
 *
 * Three rules carry the milestone's safety requirements:
 *
 * **Saves are never cached.** The worker only ever handles GET, and IndexedDB
 * traffic never passes through a service worker at all, so the save pipeline is
 * structurally out of reach. The one place save-shaped data could leak into a
 * cache is a future save-export URL, so anything under `/saves` is refused
 * explicitly as well.
 *
 * **The shell updates, immutable assets do not.** Navigations and the entry
 * page go network first with a cache fallback, so a new deploy is noticed on
 * the next online load and the old shell still boots offline. Hashed build
 * assets are cached first-hit and served cache first for ever, because their
 * names change when their contents do.
 *
 * **Packs survive updates.** The shell cache is versioned and old shell caches
 * are deleted on activate; the pack cache has its own name and activation never
 * touches it, which is what "updating preserves cached optional packs" means.
 */

/** Bumped when the shell caching strategy itself changes shape. */
export const SHELL_CACHE_VERSION = 1;
export const SHELL_CACHE_PREFIX = "shatterdome-shell-v";
export const SHELL_CACHE_NAME = `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}`;
/** The pack cache. Never deleted by activation; owned by the pack store. */
export const PACK_CACHE_NAME = "shatterdome-packs-v1";
/** What install precaches: the smallest set that boots to a menu. */
export const SHELL_PRECACHE = ["/", "/index.html", "/manifest.webmanifest"] as const;
/** The message the page sends when the player accepts an update. */
export const SKIP_WAITING_MESSAGE = "shatterdome.skip-waiting";

export type FetchDecision = "network-first" | "cache-first" | "network-only" | "ignore";

/** The one routing decision, shared by the worker and the tests. */
export function decideFetch(url: URL, method: string, sameOrigin: boolean): FetchDecision {
  // Anything that is not a same-origin GET is none of the worker's business.
  if (method !== "GET" || !sameOrigin) return "ignore";
  // Nothing save-shaped is ever cached, whatever it is called in the future.
  if (url.pathname.startsWith("/saves")) return "network-only";
  // Packs are the pack store's cache, filled deliberately, never eagerly.
  if (url.pathname.startsWith("/packs/")) return "network-only";
  // The shell entry points go network first so a deploy is noticed.
  if (url.pathname === "/" || url.pathname === "/index.html") return "network-first";
  if (url.pathname === "/manifest.webmanifest") return "network-first";
  // Hashed build output and icons are immutable: first hit fills the cache.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) return "cache-first";
  // Everything else, dev-server modules included, is cached as it is fetched so
  // one successful load leaves enough behind to boot again.
  return "cache-first";
}

/** Which caches activation may delete. Only old shell versions, never packs. */
export function isStaleCache(name: string): boolean {
  return name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE_NAME;
}
