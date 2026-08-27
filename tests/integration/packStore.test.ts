import { describe, expect, it } from "vitest";
import {
  PACK_DEFINITIONS,
  PackStore,
  createPackRegistry,
  statusFrom,
  validatePack,
  type PackCache,
} from "../../src/pwa/packs";

/** An in-memory pack cache with the same contract as the real one. */
function memoryCache(): PackCache & { readonly paths: Set<string> } {
  const paths = new Set<string>();
  return {
    paths,
    has: async (path) => paths.has(path),
    put: async (path) => {
      paths.add(path);
    },
    delete: async (path) => {
      paths.delete(path);
    },
  };
}

/** A fetch that serves some files and refuses others, counting its calls. */
function fakeFetch(failing: ReadonlySet<string> = new Set()) {
  const calls: string[] = [];
  const fetchFile = async (path: string): Promise<Response> => {
    calls.push(path);
    if (failing.has(path)) return new Response("missing", { status: 404 });
    return new Response(new Uint8Array(8), { status: 200 });
  };
  return { calls, fetchFile };
}

const pack = PACK_DEFINITIONS[0]!;

describe("the pack catalogue", () => {
  it("has at least one real pack, and it validates", () => {
    expect(createPackRegistry().all().length).toBeGreaterThan(0);
    for (const entry of PACK_DEFINITIONS) expect(validatePack(entry)).toEqual([]);
  });

  it("refuses a pack file outside /packs/", () => {
    const rogue = { ...pack, files: [{ path: "/saves/export.json", bytes: 10 }] };
    expect(validatePack(rogue).join(" ")).toMatch(/live under \/packs\//);
  });

  it("refuses a pack that does not say what it is for", () => {
    expect(validatePack({ ...pack, purpose: "stuff" }).join(" ")).toMatch(/must say what it is for/);
  });
});

describe("pack status arithmetic", () => {
  it("reports not-downloaded, partial and complete from the cache contents", () => {
    expect(statusFrom(pack, new Set(), false, "").phase).toBe("not-downloaded");
    expect(statusFrom(pack, new Set([pack.files[0]!.path]), false, "").phase).toBe("partial");
    expect(statusFrom(pack, new Set(pack.files.map((file) => file.path)), false, "").phase).toBe("complete");
  });

  it("counts bytes from what is actually cached", () => {
    const status = statusFrom(pack, new Set([pack.files[0]!.path]), false, "");
    expect(status.bytesCached).toBe(pack.files[0]!.bytes);
    expect(status.bytesTotal).toBeGreaterThan(status.bytesCached);
  });
});

describe("downloading, resuming and restarting", () => {
  it("downloads every file of a pack, once each", async () => {
    const cache = memoryCache();
    const { calls, fetchFile } = fakeFetch();
    const store = new PackStore({ cache, fetchFile });
    const status = await store.download(pack.id);
    expect(status.phase).toBe("complete");
    expect(calls).toHaveLength(pack.files.length);
  });

  it("resumes: a second download fetches only what is missing", async () => {
    const cache = memoryCache();
    // The first two files are already there, as an interrupted download leaves them.
    cache.paths.add(pack.files[0]!.path);
    cache.paths.add(pack.files[1]!.path);
    const { calls, fetchFile } = fakeFetch();
    const store = new PackStore({ cache, fetchFile });
    const status = await store.download(pack.id);
    expect(status.phase).toBe("complete");
    expect(calls).toEqual(pack.files.slice(2).map((file) => file.path));
  });

  it("stops at a failing file, keeps what it got, and names the file", async () => {
    const cache = memoryCache();
    const failing = new Set([pack.files[2]!.path]);
    const { fetchFile } = fakeFetch(failing);
    const store = new PackStore({ cache, fetchFile });
    const status = await store.download(pack.id);
    expect(status.phase).toBe("failed");
    expect(status.filesCached).toBe(2);
    expect(status.detail).toContain(pack.files[2]!.path);
    expect(status.detail).toContain("404");
  });

  it("retries after a failure and finishes from where it stopped", async () => {
    const cache = memoryCache();
    const failing = new Set([pack.files[2]!.path]);
    const first = fakeFetch(failing);
    const store = new PackStore({ cache, fetchFile: first.fetchFile });
    await store.download(pack.id);

    const second = fakeFetch();
    const retryStore = new PackStore({ cache, fetchFile: second.fetchFile });
    const status = await retryStore.download(pack.id);
    expect(status.phase).toBe("complete");
    // Only the failed file and the one after it were fetched on the retry.
    expect(second.calls).toEqual(pack.files.slice(2).map((file) => file.path));
  });

  it("reports a network failure as retryable rather than throwing", async () => {
    const cache = memoryCache();
    const store = new PackStore({
      cache,
      fetchFile: async () => {
        throw new Error("offline");
      },
    });
    const status = await store.download(pack.id);
    expect(status.phase).toBe("failed");
    expect(status.detail).toMatch(/retry/i);
  });

  it("restarts cleanly: remove empties the pack and download refills it", async () => {
    const cache = memoryCache();
    const { fetchFile } = fakeFetch();
    const store = new PackStore({ cache, fetchFile });
    await store.download(pack.id);
    await store.remove(pack.id);
    expect((await store.statuses())[0]!.phase).toBe("not-downloaded");
    const again = await store.download(pack.id);
    expect(again.phase).toBe("complete");
  });

  it("says so rather than throwing when the browser has no cache", async () => {
    const store = new PackStore({ cache: null });
    expect(store.available).toBe(false);
    const status = await store.download(pack.id);
    expect(status.phase).toBe("failed");
    expect(status.detail).toMatch(/not storing site data/);
  });

  it("refuses a pack nobody defined", async () => {
    const store = new PackStore({ cache: memoryCache() });
    await expect(store.download("pack.nonsense")).rejects.toThrow(/No pack called/);
  });
});
