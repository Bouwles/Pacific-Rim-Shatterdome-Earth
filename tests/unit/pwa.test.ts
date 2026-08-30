import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PACK_CACHE_NAME,
  SHELL_CACHE_NAME,
  SHELL_CACHE_PREFIX,
  SHELL_CACHE_VERSION,
  SHELL_PRECACHE,
  SKIP_WAITING_MESSAGE,
  decideFetch,
  isStaleCache,
} from "../../src/pwa/swPolicy";
import { SAFE_PLACES, UpdateFlow } from "../../src/pwa/updateFlow";

const url = (path: string) => new URL(`https://game.example${path}`);

describe("the caching policy", () => {
  it("ignores anything that is not a same-origin GET", () => {
    expect(decideFetch(url("/assets/app.js"), "POST", true)).toBe("ignore");
    expect(decideFetch(url("/assets/app.js"), "GET", false)).toBe("ignore");
  });

  it("never caches anything save-shaped", () => {
    expect(decideFetch(url("/saves"), "GET", true)).toBe("network-only");
    expect(decideFetch(url("/saves/export.json"), "GET", true)).toBe("network-only");
  });

  it("leaves pack files to the pack store rather than caching them eagerly", () => {
    expect(decideFetch(url("/packs/placeholder-textures/plate-detail.png"), "GET", true)).toBe(
      "network-only",
    );
  });

  it("takes the shell network first, so a deploy is noticed", () => {
    expect(decideFetch(url("/"), "GET", true)).toBe("network-first");
    expect(decideFetch(url("/index.html"), "GET", true)).toBe("network-first");
    expect(decideFetch(url("/manifest.webmanifest"), "GET", true)).toBe("network-first");
  });

  it("takes hashed assets cache first, because their names are their versions", () => {
    expect(decideFetch(url("/assets/index-CgWh.js"), "GET", true)).toBe("cache-first");
    expect(decideFetch(url("/icons/icon-192.png"), "GET", true)).toBe("cache-first");
  });

  it("reads paths inside the app when the build lives in a subfolder", () => {
    const base = "/Pacific-Rim-Shatterdome-Earth/";
    expect(decideFetch(url(`${base}`), "GET", true, base)).toBe("network-first");
    expect(decideFetch(url(`${base}index.html`), "GET", true, base)).toBe("network-first");
    expect(decideFetch(url(`${base}saves/export.json`), "GET", true, base)).toBe("network-only");
    expect(decideFetch(url(`${base}packs/placeholder-textures/plate-detail.png`), "GET", true, base)).toBe(
      "network-only",
    );
    expect(decideFetch(url(`${base}assets/index-CgWh.js`), "GET", true, base)).toBe("cache-first");
  });

  it("deletes only stale shell caches, never the pack cache", () => {
    expect(isStaleCache(`${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION - 1}`)).toBe(true);
    expect(isStaleCache(SHELL_CACHE_NAME)).toBe(false);
    expect(isStaleCache(PACK_CACHE_NAME)).toBe(false);
  });

  it("precaches only the smallest set that boots to a menu", () => {
    expect(SHELL_PRECACHE.length).toBeLessThanOrEqual(4);
    expect(SHELL_PRECACHE).toContain("/index.html");
  });
});

describe("the worker mirrors the policy", () => {
  const source = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

  it("uses the same cache names, version and message", () => {
    expect(source).toContain(`const SHELL_CACHE_VERSION = ${SHELL_CACHE_VERSION};`);
    expect(source).toContain(`const SHELL_CACHE_PREFIX = "${SHELL_CACHE_PREFIX}";`);
    expect(source).toContain(`const PACK_CACHE_NAME = "${PACK_CACHE_NAME}";`);
    expect(source).toContain(`const SKIP_WAITING_MESSAGE = "${SKIP_WAITING_MESSAGE}";`);
    for (const path of SHELL_PRECACHE) expect(source).toContain(`"${path}"`);
  });

  it("refuses the same paths the policy refuses", () => {
    expect(source).toContain('path.startsWith("/saves")');
    expect(source).toContain('path.startsWith("/packs/")');
  });

  // The comments talk about what the code refuses to do, so the negative
  // assertions run against the code alone.
  const code = source.replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never activates itself: skipWaiting only on the page's message", () => {
    const installBlock = code.slice(code.indexOf('"install"'), code.indexOf('"activate"'));
    expect(installBlock).not.toContain("skipWaiting()");
    expect(code).toContain("if (event.data === SKIP_WAITING_MESSAGE) self.skipWaiting()");
  });

  it("never touches IndexedDB", () => {
    expect(code.toLowerCase()).not.toContain("indexeddb");
  });
});

describe("the update flow", () => {
  it("offers immediately when the update lands somewhere safe", () => {
    const flow = new UpdateFlow();
    flow.placeChanged("MainMenu");
    flow.updateDownloading();
    flow.updateReady();
    expect(flow.view().showOffer).toBe(true);
  });

  it("never offers mid-combat, and follows the player back to the menu", () => {
    const flow = new UpdateFlow();
    flow.placeChanged("Combat");
    flow.updateReady();
    expect(flow.view().showOffer).toBe(false);
    expect(flow.view().phase).toBe("waiting-unsafe");
    flow.placeChanged("MainMenu");
    expect(flow.view().showOffer).toBe(true);
  });

  it("withdraws an offer if the player leaves for somewhere unsafe", () => {
    const flow = new UpdateFlow();
    flow.placeChanged("MainMenu");
    flow.updateReady();
    flow.placeChanged("WorldMap");
    expect(flow.view().showOffer).toBe(false);
    flow.placeChanged("MainMenu");
    expect(flow.view().showOffer).toBe(true);
  });

  it("lets the player postpone, and offers again on the next visit", () => {
    const flow = new UpdateFlow();
    flow.placeChanged("MainMenu");
    flow.updateReady();
    flow.postpone();
    expect(flow.view().showOffer).toBe(false);
    // Not nagged while still standing in the same menu.
    flow.placeChanged("MainMenu");
    expect(flow.view().showOffer).toBe(false);
    // Offered again after leaving and returning.
    flow.placeChanged("WorldMap");
    flow.placeChanged("MainMenu");
    expect(flow.view().showOffer).toBe(true);
  });

  it("refuses to apply from anywhere unsafe", () => {
    const flow = new UpdateFlow();
    flow.placeChanged("Combat");
    flow.updateReady();
    expect(flow.accept()).toBe(false);
  });

  it("applies only after the flush has genuinely finished", () => {
    const flow = new UpdateFlow();
    flow.placeChanged("MainMenu");
    flow.updateReady();
    expect(flow.flushed()).toBe(false);
    expect(flow.accept()).toBe(true);
    expect(flow.view().phase).toBe("flushing");
    expect(flow.flushed()).toBe(true);
    expect(flow.view().phase).toBe("applying");
  });

  it("names the safe places, and combat is not among them", () => {
    expect(SAFE_PLACES).toContain("MainMenu");
    expect(SAFE_PLACES).not.toContain("Combat" as never);
    expect(SAFE_PLACES).not.toContain("WorldMap" as never);
  });
});
