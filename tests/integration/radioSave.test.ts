import { beforeEach, describe, expect, it } from "vitest";
import { SimulationKernel } from "../../src/simulation/kernel";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { ROOT_SAVE_VERSION, validateRootSave } from "../../src/saves/schema";
import { migrateSave } from "../../src/saves/migrations";
import { RadioDirector } from "../../src/audio/radioDirector";
import { crewLines } from "../../src/audio/crewVoice";
import { createPilotRegistry } from "../../src/data/pilots";

/**
 * What the radio leaves behind, through the whole save pipeline.
 *
 * The unit tests prove the director round trips its own state. This proves the
 * state survives the envelope, the checksum, the validator and a migration from
 * a file written before the radio existed.
 */

const SEED = 771;

let repository: MemorySaveRepository;
let service: SaveService;

function kernel(): SimulationKernel {
  const built = new SimulationKernel({ seed: SEED });
  for (let tick = 0; tick < 5; tick += 1) built.step();
  return built;
}

beforeEach(() => {
  repository = new MemorySaveRepository();
  service = new SaveService({ repository, now: () => 1_700_000_000_000 });
});

describe("the conversation record through a save", () => {
  it("writes what was said and reads it back", async () => {
    const radio = new RadioDirector();
    radio.request("radio.breach.detected", 0);
    radio.update(10);
    radio.request("radio.victory", 20);
    radio.update(40);

    await service.save("slot.radio", kernel(), { name: "Radio", radio: radio.toSave() });
    const loaded = await service.load("slot.radio");

    expect(validateRootSave(loaded.document)).toEqual([]);
    expect(loaded.document.radio.records).toHaveLength(2);
    expect(loaded.document.radio.records[0]?.text).toContain("Breach event confirmed");

    const restored = new RadioDirector();
    restored.restore(loaded.document.radio);
    expect(restored.transcript(1)[0]?.lineId).toBe("radio.victory");
    // Still on cooldown, so a load does not fire every warning again at once.
    expect(restored.request("radio.breach.detected", 41).outcome).toBe("refused");
  });

  it("saves nothing for a campaign that has heard nothing, and still validates", async () => {
    await service.save("slot.quiet", kernel(), { name: "Quiet" });
    const loaded = await service.load("slot.quiet");
    expect(validateRootSave(loaded.document)).toEqual([]);
    expect(loaded.document.radio.records).toEqual([]);
    expect(loaded.document.radio.lastSpoken).toEqual({});
  });

  it("carries a crew line, which is registered at runtime rather than authored", async () => {
    const pilot = createPilotRegistry().all()[0]!;
    const line = crewLines(pilot).find((entry) => entry.id.includes(".onDeploy."))!;
    const radio = new RadioDirector();
    radio.define(line);
    radio.request(line.id, 0);
    radio.update(30);

    await service.save("slot.crew", kernel(), { name: "Crew", radio: radio.toSave() });
    const loaded = await service.load("slot.crew");
    expect(loaded.document.radio.records[0]?.text).toContain(pilot.callsign);

    // A director that has not been taught the line drops the record rather than
    // refusing the load, which is what keeps an old save openable.
    const blank = new RadioDirector();
    blank.restore(loaded.document.radio);
    expect(blank.records()).toHaveLength(0);

    const taught = new RadioDirector();
    taught.define(line);
    taught.restore(loaded.document.radio);
    expect(taught.records()).toHaveLength(1);
  });

  it("upgrades a save written before there was a radio", () => {
    // A bare kernel snapshot is version 0, which walks the whole chain. That is
    // the cheapest way to prove the last step is reachable and does its job,
    // and it exercises every step before it at the same time.
    const migrated = migrateSave(kernel().serialize() as unknown as Record<string, unknown>);
    expect(migrated.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(migrated.applied).toContain("16");
    expect(migrated.document.radio.records).toEqual([]);
    expect(migrated.document.radio.lastSpoken).toEqual({});
    expect(validateRootSave(migrated.document)).toEqual([]);
  });
});
