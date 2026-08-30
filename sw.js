/**
 * The service worker.
 *
 * Plain JavaScript at a stable URL, because that is what a service worker has
 * to be. Every decision in here mirrors `src/pwa/swPolicy.ts`, which is the
 * testable statement of the policy; a unit test reads this file and fails if
 * the constants below drift from it.
 *
 * What this worker will never do: touch IndexedDB, cache anything that is not
 * a same-origin GET, cache anything under /saves, delete the pack cache, or
 * activate itself over a running game. Activation waits until every page has
 * asked for it.
 */

/* eslint-disable no-undef */

// Mirrors SHELL_CACHE_VERSION / names in src/pwa/swPolicy.ts. Keep in step.
const SHELL_CACHE_VERSION = 1;
const SHELL_CACHE_PREFIX = "shatterdome-shell-v";
const SHELL_CACHE_NAME = `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}`;
const PACK_CACHE_NAME = "shatterdome-packs-v1";
const SHELL_PRECACHE = ["/", "/index.html", "/manifest.webmanifest"];
const SKIP_WAITING_MESSAGE = "shatterdome.skip-waiting";
// Replaced per production build by scripts/stamp-sw.mjs. A worker whose bytes
// never change would never announce an update, so the stamp is the signal.
const BUILD_STAMP = "mtfi9z9u";
void BUILD_STAMP;
// Where the app lives: "/" at a domain root, "/Repo-Name/" on GitHub Pages.
// Every route below is written against the app, not the origin.
const BASE = new URL("./", self.location.href).pathname;

self.addEventListener("install", (event) => {
  // Precache only the smallest set that boots to a menu. Everything else is
  // cached as it is first fetched, so nothing future is downloaded eagerly.
  event.waitUntil(
    caches
      .open(SHELL_CACHE_NAME)
      .then((cache) =>
        cache.addAll(SHELL_PRECACHE.map((path) => BASE + path.slice(1))).catch(() => undefined),
      ),
  );
  // Deliberately no skipWaiting() here: a new worker waits until the page says
  // the player accepted the update from a safe place. Never mid-combat.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          // Only stale shell versions. The pack cache is the pack store's and
          // survives every update, which is what keeps downloads across deploys.
          .filter(
            (name) =>
              name.startsWith(SHELL_CACHE_PREFIX) &&
              name !== SHELL_CACHE_NAME &&
              // Defence in depth: the pack cache does not match the shell
              // prefix, and must survive even if that ever changes.
              name !== PACK_CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === SKIP_WAITING_MESSAGE) self.skipWaiting();
});

/** Mirrors decideFetch in swPolicy.ts, in the same order. */
function decide(url, method, sameOrigin) {
  if (method !== "GET" || !sameOrigin) return "ignore";
  // The path inside the app: "/Repo-Name/assets/x.js" reads as "/assets/x.js".
  const path = url.pathname.startsWith(BASE) ? `/${url.pathname.slice(BASE.length)}` : url.pathname;
  if (path.startsWith("/saves")) return "network-only";
  if (path.startsWith("/packs/")) return "network-only";
  if (path === "/" || path === "/index.html") return "network-first";
  if (path === "/manifest.webmanifest") return "network-first";
  if (path.startsWith("/assets/") || path.startsWith("/icons/")) return "cache-first";
  return "cache-first";
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    // Offline with nothing cached yet: the honest answer is the entry page if
    // we have it, because that is the shell, or a plain failure if we do not.
    const shell = await cache.match("/index.html");
    if (shell && request.mode === "navigate") return shell;
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const decision =
    event.request.mode === "navigate" ? "network-first" : decide(url, event.request.method, sameOrigin);

  if (decision === "ignore" || decision === "network-only") return;
  if (decision === "network-first") {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});
