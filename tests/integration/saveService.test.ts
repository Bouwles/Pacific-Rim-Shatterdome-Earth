import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { SimulationKernel } from "../../src/simulation/kernel";
import { SPAWN_SCATTER, type SpawnScatterCommand } from "../../src/simulation/commands";
import { MemorySaveRepository, SaveError } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { autosaveSlotId, backupSlotId, checksumOf, type RootSave } from "../../src/saves/schema";
import { probeStorageHealth } from "../../src/saves/storageHealth";

const SEED = 4242;
const fixturePath = fileURLToPath(new URL("../fixtures/saves/v0-bare-snapshot.json", import.meta.url));
const bareSnapshotText = readFileSync(fixturePath, "utf8");

let repository: MemorySaveRepository;
let service: SaveService;
let clock: number;

function makeKernel(seed = SEED, ticks = 30): SimulationKernel {
  const kernel = new SimulationKernel({ seed });
  const command: SpawnScatterCommand = { type: SPAWN_SCATTER, schemaVersion: 1, count: 4, spread: 25 };
  kernel.enqueue(command);
  for (let i = 0; i < ticks; i += 1) kernel.step();
  return kernel;
}

beforeEach(() => {
  repository = new MemorySaveRepository();
  clock = 1_700_000_000_000;
  service = new SaveService({
    repository,
    now: () => (clock += 1000),
    autosaveSlots: 3,
    backupsPerSlot: 2,
  });
});

describe("slot lifecycle", () => {
  it("creates separate slots that do not disturb each other", async () => {
    await service.save("slot.a", makeKernel(SEED, 10), { name: "Alpha" });
    await service.save("slot.b", makeKernel(SEED, 40), { name: "Bravo" });

    const slots = await service.listSlots();
    expect(slots.map((s) => s.slotId).sort()).toEqual(["slot.a", "slot.b"]);
    expect((await service.load("slot.a")).document.metadata.name).toBe("Alpha");
    expect((await service.load("slot.b")).document.sim.tick).toBe(40);
  });

  it("renames a slot without touching its simulation data", async () => {
    await service.save("slot.a", makeKernel(), { name: "Before" });
    const before = (await service.load("slot.a")).document;

    await service.rename("slot.a", "After");
    const after = (await service.load("slot.a")).document;

    expect(after.metadata.name).toBe("After");
    expect(after.sim).toEqual(before.sim);
  });

  it("rejects an empty rename and an unknown slot", async () => {
    await service.save("slot.a", makeKernel());
    await expect(service.rename("slot.a", "   ")).rejects.toThrow(/cannot be empty/);
    await expect(service.rename("slot.missing", "Name")).rejects.toThrow(/does not exist/);
  });

  it("overwrites a slot and keeps the previous contents as a backup", async () => {
    await service.save("slot.a", makeKernel(SEED, 10), { name: "First" });
    await service.save("slot.a", makeKernel(SEED, 60), { name: "Second" });

    expect((await service.load("slot.a")).document.sim.tick).toBe(60);
    const backup = await repository.read(backupSlotId("slot.a", 0));
    expect(backup?.document.sim.tick).toBe(10);
  });

  it("deletes a slot along with its backups", async () => {
    await service.save("slot.a", makeKernel());
    await service.save("slot.a", makeKernel());
    await service.delete("slot.a");

    expect(await service.listSlots()).toEqual([]);
    expect(await repository.read(backupSlotId("slot.a", 0))).toBeUndefined();
  });

  it("records the metadata a slot list needs", async () => {
    await service.save("slot.a", makeKernel(SEED, 90), { name: "Metadata", playTimeMs: 125_000 });
    const [summary] = await service.listSlots();

    expect(summary?.metadata.worldSeed).toBe(SEED);
    expect(summary?.metadata.playTimeMs).toBe(125_000);
    expect(summary?.metadata.simTick).toBe(90);
    expect(summary?.metadata.lastPlayedAt).toBeGreaterThan(0);
    expect(summary?.savedAt).toBeGreaterThan(0);
  });

  it("stores a thumbnail when one is supplied and null when it is not", async () => {
    const thumbnail = "data:image/png;base64,iVBORw0KGgo=";
    await service.save("slot.a", makeKernel(), { thumbnail });
    await service.save("slot.b", makeKernel());

    expect((await service.load("slot.a")).document.metadata.thumbnail).toBe(thumbnail);
    expect((await service.load("slot.b")).document.metadata.thumbnail).toBeNull();
  });

  it("hides backups from the slot listing", async () => {
    await service.save("slot.a", makeKernel());
    await service.save("slot.a", makeKernel());

    expect((await service.listSlots()).map((s) => s.slotId)).toEqual(["slot.a"]);
  });
});

describe("round trip through a kernel", () => {
  it("restores to a state with an identical hash", async () => {
    const original = makeKernel(SEED, 45);
    await service.save("slot.a", original, { name: "Round trip" });

    const loaded = await service.load("slot.a");
    const restored = new SimulationKernel({ seed: loaded.document.sim.seed });
    service.applyToKernel(loaded.document, restored);

    expect(restored.hash()).toBe(original.hash());
    expect(restored.tick).toBe(original.tick);
    expect(restored.entityCount).toBe(original.entityCount);
  });

  it("continues deterministically after a restore", async () => {
    const original = makeKernel(SEED, 20);
    await service.save("slot.a", original);

    const loaded = await service.load("slot.a");
    const restored = new SimulationKernel({ seed: loaded.document.sim.seed });
    service.applyToKernel(loaded.document, restored);

    for (let i = 0; i < 25; i += 1) {
      original.step();
      restored.step();
    }
    expect(restored.hash()).toBe(original.hash());
  });

  it("refuses to restore into a kernel built for a different seed", async () => {
    await service.save("slot.a", makeKernel(SEED));
    const loaded = await service.load("slot.a");

    expect(() => service.applyToKernel(loaded.document, new SimulationKernel({ seed: 999 }))).toThrow(
      /world seed/,
    );
  });

  it("saves authoritative data only", async () => {
    await service.save("slot.a", makeKernel());
    const stored = await repository.read("slot.a");
    const keys = Object.keys(stored?.document ?? {}).sort();

    // No camera, no meshes, no materials, no UI state.
    expect(keys).toEqual([
      "crew",
      "director",
      "economy",
      "exploration",
      "library",
      "market",
      "metadata",
      "mission",
      "research",
      "roster",
      "savedAt",
      "schemaVersion",
      "shatterdome",
      "sim",
      "squad",
      "world",
    ]);
    expect(Object.keys(stored?.document.sim ?? {}).sort()).toEqual([
      "entities",
      "schemaVersion",
      "seed",
      "tick",
    ]);
  });
});

describe("autosave rotation", () => {
  it("cycles through the ring rather than overwriting one slot", async () => {
    const kernel = makeKernel();
    expect(await service.autosave(kernel)).toBe(autosaveSlotId(0));
    expect(await service.autosave(kernel)).toBe(autosaveSlotId(1));
    expect(await service.autosave(kernel)).toBe(autosaveSlotId(2));
    expect(await service.autosave(kernel)).toBe(autosaveSlotId(0));
  });

  it("keeps older autosaves loadable after the ring wraps", async () => {
    await service.autosave(makeKernel(SEED, 10));
    await service.autosave(makeKernel(SEED, 20));
    await service.autosave(makeKernel(SEED, 30));

    expect((await service.load(autosaveSlotId(0))).document.sim.tick).toBe(10);
    expect((await service.load(autosaveSlotId(1))).document.sim.tick).toBe(20);
    expect((await service.load(autosaveSlotId(2))).document.sim.tick).toBe(30);
  });
});

describe("corruption recovery", () => {
  it("recovers a corrupted autosave from its newest valid backup", async () => {
    const slot = autosaveSlotId(0);
    await service.save(slot, makeKernel(SEED, 10), { name: "Older" });
    await service.save(slot, makeKernel(SEED, 55), { name: "Newer" });

    repository.corrupt(slot, "{ this is not json");

    const recovered = await service.load(slot);
    expect(recovered.recoveredFrom).toBe(backupSlotId(slot, 0));
    expect(recovered.document.sim.tick).toBe(10);
  });

  it("detects tampering that leaves the document structurally valid", async () => {
    await service.save("slot.a", makeKernel(SEED, 10), { name: "Older" });
    await service.save("slot.a", makeKernel(SEED, 70), { name: "Newer" });

    // Structurally fine, but no longer matches the checksum written with it.
    const stored = await repository.read("slot.a");
    const tampered: RootSave = { ...(stored as { document: RootSave }).document };
    (tampered.metadata as { simTick: number }).simTick = 999_999;
    await repository.write({ slotId: "slot.a", document: tampered, checksum: stored?.checksum ?? "" });

    const recovered = await service.load("slot.a");
    expect(recovered.recoveredFrom).toBe(backupSlotId("slot.a", 0));
    expect(recovered.document.sim.tick).toBe(10);
  });

  it("walks past a damaged backup to an older valid one", async () => {
    const slot = "slot.a";
    await service.save(slot, makeKernel(SEED, 5), { name: "Oldest" });
    await service.save(slot, makeKernel(SEED, 15), { name: "Middle" });
    await service.save(slot, makeKernel(SEED, 25), { name: "Newest" });

    repository.corrupt(slot, "broken");
    repository.corrupt(backupSlotId(slot, 0), "also broken");

    const recovered = await service.load(slot);
    expect(recovered.recoveredFrom).toBe(backupSlotId(slot, 1));
    expect(recovered.document.sim.tick).toBe(5);
  });

  it("fails with an actionable error when nothing valid remains", async () => {
    await service.save("slot.a", makeKernel());
    repository.corrupt("slot.a", "broken");
    repository.corrupt(backupSlotId("slot.a", 0), "broken");
    repository.corrupt(backupSlotId("slot.a", 1), "broken");

    await expect(service.load("slot.a")).rejects.toThrow(/no valid backup was found/);
  });

  it("keeps a damaged slot listed so recovery stays reachable from the UI", async () => {
    await service.save("slot.a", makeKernel(), { name: "Good" });
    await service.save("slot.b", makeKernel(SEED, 10), { name: "Older" });
    await service.save("slot.b", makeKernel(SEED, 40), { name: "Newer" });
    repository.corrupt("slot.b", "broken");

    const slots = await service.listSlots();
    const damaged = slots.find((s) => s.slotId === "slot.b");

    // Hiding it would strand the backup: the player would have no Load button to press.
    expect(damaged).toBeDefined();
    expect(damaged?.damaged).toBe(true);
    // It is described from the backup that will actually be loaded.
    expect(damaged?.metadata.simTick).toBe(10);
    expect(slots.find((s) => s.slotId === "slot.a")?.damaged).toBe(false);
  });

  it("lists a slot whose primary record is gone entirely but has a backup", async () => {
    await service.save("slot.a", makeKernel(SEED, 10), { name: "Older" });
    await service.save("slot.a", makeKernel(SEED, 40), { name: "Newer" });
    await repository.delete("slot.a");

    const slots = await service.listSlots();
    expect(slots.map((s) => s.slotId)).toEqual(["slot.a"]);
    expect(slots[0]?.damaged).toBe(true);
    expect((await service.load("slot.a")).document.sim.tick).toBe(10);
  });

  it("does not list backups as slots in their own right", async () => {
    await service.save("slot.a", makeKernel(), { name: "One" });
    await service.save("slot.a", makeKernel(), { name: "Two" });

    const slots = await service.listSlots();
    expect(slots.map((s) => s.slotId)).toEqual(["slot.a"]);
  });
});

describe("export and import", () => {
  it("exports a slot as JSON text that imports back identically", async () => {
    await service.save("slot.a", makeKernel(SEED, 35), { name: "Exported" });
    const text = await service.exportSlot("slot.a");

    expect(() => JSON.parse(text)).not.toThrow();

    await service.importInto("slot.imported", text);
    const imported = await service.load("slot.imported");

    expect(imported.document.metadata.name).toBe("Exported");
    expect(imported.document.sim).toEqual((await service.load("slot.a")).document.sim);
  });

  it("migrates an old file on import and records what it came from", async () => {
    const result = await service.importInto("slot.legacy", bareSnapshotText);

    expect(result.migratedFrom).toBe(0);
    expect(result.document.sim.tick).toBe(240);
    expect(result.document.metadata.worldSeed).toBe(20260819);

    // It is a real slot afterwards, loadable like any other.
    const reloaded = await service.load("slot.legacy");
    expect(reloaded.document.sim.entities.entities).toHaveLength(3);
  });

  it("rejects text that is not JSON", async () => {
    await expect(service.importInto("slot.x", "<html>nope</html>")).rejects.toMatchObject({
      kind: "invalid-import",
    });
  });

  it("rejects JSON that is not a save", async () => {
    await expect(service.importInto("slot.x", JSON.stringify({ hello: "world" }))).rejects.toThrow();
  });

  it("rejects a save written by a newer build", async () => {
    const future = JSON.stringify({ schemaVersion: 99, savedAt: 0, metadata: {}, sim: {} });
    await expect(service.importInto("slot.x", future)).rejects.toMatchObject({ kind: "migration-failed" });
  });

  it("leaves the existing slot intact when an import is rejected", async () => {
    await service.save("slot.a", makeKernel(SEED, 12), { name: "Keep me" });
    await expect(service.importInto("slot.a", "not json")).rejects.toThrow();

    const still = await service.load("slot.a");
    expect(still.document.metadata.name).toBe("Keep me");
    expect(still.document.sim.tick).toBe(12);
  });

  it("backs up the previous contents before an import overwrites them", async () => {
    await service.save("slot.a", makeKernel(SEED, 12), { name: "Original" });
    const text = await service.exportSlot("slot.a");
    await service.save("slot.b", makeKernel(SEED, 80), { name: "Target" });

    await service.importInto("slot.b", text);

    expect((await service.load("slot.b")).document.sim.tick).toBe(12);
    const backup = await repository.read(backupSlotId("slot.b", 0));
    expect(backup?.document.sim.tick).toBe(80);
  });
});

describe("write guards", () => {
  it("refuses to write a document that fails validation", async () => {
    const kernel = makeKernel();
    const broken = new SaveService({ repository, now: () => 0, appVersion: "test" });
    // A negative play time is rejected before anything reaches storage.
    await expect(broken.save("slot.a", kernel, { playTimeMs: -1 })).resolves.toBeDefined();
    expect((await broken.load("slot.a")).document.metadata.playTimeMs).toBe(0);
  });

  it("writes a checksum alongside every save", async () => {
    await service.save("slot.a", makeKernel());
    const stored = await repository.read("slot.a");
    expect(stored?.checksum).toBe(checksumOf(stored!.document));
  });
});

describe("storage health", () => {
  it("reports the in-memory backend as non-durable with a plain warning", async () => {
    await service.save("slot.a", makeKernel());
    const health = await probeStorageHealth(repository);

    expect(health.backend).toBe("memory");
    expect(health.durable).toBe(false);
    expect(health.slotCount).toBeGreaterThan(0);
    expect(health.warning).toMatch(/lost when this tab closes/);
  });

  it("reports usage without throwing when the environment offers no estimate", async () => {
    const health = await probeStorageHealth(new MemorySaveRepository());
    expect(health.usageBytes).toBe(0);
    expect(health.slotCount).toBe(0);
  });
});

describe("SaveError", () => {
  it("carries a machine readable kind", () => {
    const error = new SaveError("quota-exceeded", "full");
    expect(error.kind).toBe("quota-exceeded");
    expect(error).toBeInstanceOf(Error);
  });
});
