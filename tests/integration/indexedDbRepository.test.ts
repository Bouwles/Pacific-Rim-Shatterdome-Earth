import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexedDbSaveRepository } from "../../src/saves/indexedDbRepository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";
import { SPAWN_SCATTER, type SpawnScatterCommand } from "../../src/simulation/commands";
import { backupSlotId, checksumOf, type RootSave, type StoredSave } from "../../src/saves/schema";
import { probeStorageHealth } from "../../src/saves/storageHealth";

const SEED = 777;
let repository: IndexedDbSaveRepository;

function makeKernel(ticks = 20): SimulationKernel {
  const kernel = new SimulationKernel({ seed: SEED });
  const command: SpawnScatterCommand = { type: SPAWN_SCATTER, schemaVersion: 1, count: 3, spread: 20 };
  kernel.enqueue(command);
  for (let i = 0; i < ticks; i += 1) kernel.step();
  return kernel;
}

function storedFrom(document: RootSave, slotId: string): StoredSave {
  return { slotId, document, checksum: checksumOf(document) };
}

beforeEach(async () => {
  // A fresh factory per test, so one test's slots cannot leak into another.
  globalThis.indexedDB = new IDBFactory();
  repository = await IndexedDbSaveRepository.open();
});

afterEach(() => {
  repository.close();
});

describe("IndexedDbSaveRepository", () => {
  it("reports itself as the indexeddb backend", () => {
    expect(repository.kind).toBe("indexeddb");
    expect(IndexedDbSaveRepository.isSupported()).toBe(true);
  });

  it("writes and reads a record back intact", async () => {
    const service = new SaveService({ repository });
    const document = service.buildDocument(makeKernel(35), { name: "Persisted" });

    await repository.write(storedFrom(document, "slot.a"));
    const read = await repository.read("slot.a");

    expect(read?.document).toEqual(document);
    expect(read?.checksum).toBe(checksumOf(document));
  });

  it("returns undefined for a slot that does not exist", async () => {
    expect(await repository.read("slot.missing")).toBeUndefined();
  });

  it("lists slot ids in sorted order and deletes them", async () => {
    const service = new SaveService({ repository });
    const document = service.buildDocument(makeKernel());

    await repository.write(storedFrom(document, "slot.b"));
    await repository.write(storedFrom(document, "slot.a"));
    expect(await repository.listSlotIds()).toEqual(["slot.a", "slot.b"]);

    await repository.delete("slot.a");
    expect(await repository.listSlotIds()).toEqual(["slot.b"]);
  });

  it("survives a close and reopen, which is the point of using IndexedDB", async () => {
    const service = new SaveService({ repository });
    await service.save("slot.a", makeKernel(50), { name: "Durable" });

    repository.close();
    repository = await IndexedDbSaveRepository.open();

    const reopened = new SaveService({ repository });
    const loaded = await reopened.load("slot.a");
    expect(loaded.document.metadata.name).toBe("Durable");
    expect(loaded.document.sim.tick).toBe(50);
  });

  it("refuses to operate once closed, with an actionable message", async () => {
    repository.close();
    await expect(repository.listSlotIds()).rejects.toThrow(/has been closed/);
  });

  it("closing twice is safe", () => {
    repository.close();
    expect(() => repository.close()).not.toThrow();
  });
});

describe("SaveService over IndexedDB", () => {
  it("runs the full slot lifecycle against real storage", async () => {
    const service = new SaveService({ repository, backupsPerSlot: 2 });

    await service.save("slot.a", makeKernel(10), { name: "First" });
    await service.save("slot.a", makeKernel(60), { name: "Second" });
    await service.rename("slot.a", "Renamed");

    const slots = await service.listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.metadata.name).toBe("Renamed");
    expect((await repository.read(backupSlotId("slot.a", 0)))?.document.sim.tick).toBe(10);

    const text = await service.exportSlot("slot.a");
    await service.importInto("slot.b", text);
    expect((await service.load("slot.b")).document.sim.tick).toBe(60);

    await service.delete("slot.a");
    expect((await service.listSlots()).map((s) => s.slotId)).toEqual(["slot.b"]);
  });

  it("recovers from a corrupted primary using a backup held in real storage", async () => {
    const service = new SaveService({ repository, backupsPerSlot: 2 });
    await service.save("slot.a", makeKernel(10), { name: "Older" });
    await service.save("slot.a", makeKernel(70), { name: "Newer" });

    // Overwrite the live record with a structurally broken one.
    await repository.write({
      slotId: "slot.a",
      document: { schemaVersion: 1, savedAt: 0 } as unknown as RootSave,
      checksum: "0000000000000000",
    });

    const recovered = await service.load("slot.a");
    expect(recovered.recoveredFrom).toBe(backupSlotId("slot.a", 0));
    expect(recovered.document.sim.tick).toBe(10);
  });

  it("round-trips a kernel through real storage with an identical hash", async () => {
    const service = new SaveService({ repository });
    const original = makeKernel(45);
    await service.save("slot.a", original);

    const loaded = await service.load("slot.a");
    const restored = new SimulationKernel({ seed: loaded.document.sim.seed });
    service.applyToKernel(loaded.document, restored);

    expect(restored.hash()).toBe(original.hash());
  });
});

describe("storage health over IndexedDB", () => {
  it("reports a durable backend with no warning", async () => {
    const service = new SaveService({ repository });
    await service.save("slot.a", makeKernel());

    const health = await probeStorageHealth(repository);
    expect(health.backend).toBe("indexeddb");
    expect(health.durable).toBe(true);
    expect(health.slotCount).toBeGreaterThan(0);
    expect(health.warning).toBeNull();
  });
});
