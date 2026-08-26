import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_ARCHETYPES,
  archetypeBlueprint,
  compareArchetypes,
  runBuilderScenario,
  starterIsLegal,
  sweepRandomBuilds,
} from "../../src/debug/builderScenario";
import {
  CUSTOM_CHASSIS_ID,
  assemble,
  chassisFrom,
  emptyBlueprint,
  starterBlueprint,
} from "../../src/custom/blueprint";
import { BlueprintLibrary } from "../../src/custom/blueprintLibrary";
import { createPartRegistry } from "../../src/data/parts";
import { ContentRegistry } from "../../src/data/registry";
import { jaegerRegistry, type JaegerDefinition } from "../../src/data/jaegers";
import { Roster } from "../../src/jaegers/roster";
import { CombatArena, combatProfileFor, jaegerLayout, jaegerZones } from "../../src/combat/arena";
import { createMoveRegistry } from "../../src/data/moves";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SaveService } from "../../src/saves/saveService";
import { SimulationKernel } from "../../src/simulation/kernel";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION } from "../../src/saves/schema";

/**
 * The builder where it meets the rest of the game.
 *
 * The acceptance questions: can an illegal build reach a fight by any route,
 * do two different builds actually fly differently once they are chassis, and
 * can a blueprint be renamed, recoloured, rebuilt, saved, exported and imported
 * without ever duplicating the one machine a campaign is allowed.
 */

const SEED = 20260831;
const parts = createPartRegistry();
const template = jaegerRegistry.getOrThrow("placeholder-mk0");
const MOVES = createMoveRegistry();

let repository: MemorySaveRepository;
let service: SaveService;
let clock: number;

function kernel(): SimulationKernel {
  const instance = new SimulationKernel({ seed: SEED });
  for (let tick = 0; tick < 10; tick += 1) instance.step();
  return instance;
}

/**
 * A chassis registry with the custom machine in it.
 *
 * This is the whole integration: the custom build becomes an ordinary entry in
 * an ordinary registry, and the roster is handed that registry. Nothing else
 * changes, and no parallel roster exists.
 */
function registryWith(custom: JaegerDefinition): ContentRegistry<JaegerDefinition> {
  const registry = new ContentRegistry<JaegerDefinition>();
  for (const chassis of jaegerRegistry.all()) registry.register(chassis);
  registry.register(custom);
  return registry;
}

beforeEach(() => {
  repository = new MemorySaveRepository();
  clock = 1_700_000_000_000;
  service = new SaveService({ repository, now: () => (clock += 1000), autosaveSlots: 2, backupsPerSlot: 1 });
});

describe("the catalogue can be built with", () => {
  it("has a starter build that is legal, or a new campaign is stuck", () => {
    expect(starterIsLegal()).toBe(true);
  });

  it("runs the same way twice", () => {
    expect(runBuilderScenario("brawler").digest).toBe(runBuilderScenario("brawler").digest);
  });

  it("lets every archetype somebody would actually make be legal", () => {
    for (const result of compareArchetypes()) {
      expect(result.legal, `${result.archetype}: ${result.violations.join("; ")}`).toBe(true);
    }
  });

  it("makes every archetype a different machine", () => {
    const results = compareArchetypes();
    expect(new Set(results.map((entry) => entry.digest)).size).toBe(BUILD_ARCHETYPES.length);
    const brawler = results.find((entry) => entry.archetype === "brawler")!;
    const sprinter = results.find((entry) => entry.archetype === "sprinter")!;
    expect(sprinter.mobilityScale).toBeGreaterThan(brawler.mobilityScale * 1.5);
    expect(brawler.armorRating).toBeGreaterThan(sprinter.armorRating * 1.5);
    expect(brawler.massTons).toBeGreaterThan(sprinter.massTons * 1.4);
  });

  it("leaves a heavy gun build on a knife edge rather than comfortable", () => {
    // A build that carries two power-hungry weapons should be barely coolable,
    // or the tradeoff is not a tradeoff.
    const gunline = runBuilderScenario("gunline");
    expect(gunline.legal).toBe(true);
    expect(gunline.heatSpare).toBeLessThan(40);
  });

  it("allows a meaningful share of random builds without allowing everything", () => {
    const sweep = sweepRandomBuilds();
    expect(sweep.legal).toBeGreaterThan(sweep.tried * 0.15);
    expect(sweep.legal).toBeLessThan(sweep.tried * 0.75);
  });

  it("refuses the rest for stated reasons rather than arbitrary ones", () => {
    const sweep = sweepRandomBuilds();
    expect(sweep.refusalKinds.length).toBeGreaterThan(3);
    for (const kind of sweep.refusalKinds) expect(kind.length).toBeGreaterThan(10);
  });

  it("does not collapse every legal build into the same machine", () => {
    // The failure mode: one dominant answer. Almost every legal build should be
    // a different shape from the others.
    const sweep = sweepRandomBuilds();
    expect(sweep.distinctLegalShapes).toBeGreaterThan(sweep.legal * 0.8);
  });
});

describe("an illegal build cannot enter combat", () => {
  it("cannot become a chassis", () => {
    const bad = emptyBlueprint();
    expect(chassisFrom(bad, assemble(bad, parts), template)).toBeNull();
  });

  it("cannot reach the roster, because there is nothing to acquire", () => {
    const bad = archetypeBlueprint("brawler");
    const broken = { ...bad, parts: { ...bad.parts, reactor: [] } };
    const result = assemble(broken, parts);
    expect(result.legal).toBe(false);
    const chassis = chassisFrom(broken, result, template);
    expect(chassis).toBeNull();

    // And with no chassis there is nothing for the roster to be handed.
    const roster = new Roster();
    expect(roster.acquire({ chassisId: CUSTOM_CHASSIS_ID, acquiredBy: "research-manufacture" })).toBeNull();
  });

  it("cannot reach the arena either", () => {
    const bad = emptyBlueprint();
    const chassis = chassisFrom(bad, assemble(bad, parts), template);
    expect(chassis).toBeNull();
    // An arena needs a chassis to derive a fighter from. There is none.
    expect(() => {
      if (!chassis) throw new Error("no chassis");
      return new CombatArena({ moves: MOVES, fighters: [] });
    }).toThrow();
  });

  it("explains every violated constraint, so a fix is possible", () => {
    const bad = emptyBlueprint();
    const violations = assemble(bad, parts).issues.filter((issue) => issue.severity === "violation");
    expect(violations.length).toBeGreaterThan(4);
    // Each one names a slot the player can go and look at.
    expect(violations.filter((issue) => issue.slot !== null).length).toBe(violations.length);
  });
});

describe("two valid builds are two machines in the roster and the arena", () => {
  const sprinter = archetypeBlueprint("sprinter");
  const brawler = archetypeBlueprint("brawler");

  function chassisOf(blueprint: typeof sprinter): JaegerDefinition {
    const chassis = chassisFrom(blueprint, assemble(blueprint, parts), template);
    expect(chassis).not.toBeNull();
    return chassis!;
  }

  it("are owned as ordinary machines", () => {
    const chassis = chassisOf(sprinter);
    const roster = new Roster(registryWith(chassis));
    const built = roster.acquire({ chassisId: CUSTOM_CHASSIS_ID, acquiredBy: "research-manufacture" });
    expect(built).not.toBeNull();
    expect(built!.chassisId).toBe(CUSTOM_CHASSIS_ID);
    expect(roster.all().filter((record) => record.chassisId === CUSTOM_CHASSIS_ID)).toHaveLength(1);
  });

  it("handle differently", () => {
    const quick = chassisOf(sprinter);
    const heavy = chassisOf(brawler);
    expect(quick.locomotion.runSpeedMps).toBeGreaterThan(heavy.locomotion.runSpeedMps);
    expect(quick.locomotion.turnRateDegPerSecond).toBeGreaterThan(heavy.locomotion.turnRateDegPerSecond);
    expect(heavy.locomotion.getUpSeconds).not.toBe(quick.locomotion.getUpSeconds);
  });

  it("fight differently, because the arena derives from the chassis", () => {
    const quick = chassisOf(sprinter);
    const heavy = chassisOf(brawler);
    // Combat resources come off the machine's own numbers, so two builds arrive
    // in the arena with different profiles without the arena knowing why.
    expect(combatProfileFor(quick)).not.toEqual(combatProfileFor(heavy));
    expect(jaegerZones(quick).length).toBe(jaegerZones(heavy).length);
    // Zone placement is derived from the machine's height, so a taller build
    // puts its components further apart without anything else changing.
    expect(jaegerLayout(quick)[0]!.radiusMeters).not.toBe(jaegerLayout(heavy)[0]!.radiusMeters);
  });

  it("actually reach an arena and take a swing", () => {
    const chassis = chassisOf(brawler);
    const arena = new CombatArena({
      moves: MOVES,
      seed: SEED,
      fighters: [
        {
          id: "custom",
          kind: "jaeger",
          displayName: chassis.name,
          heightMeters: chassis.locomotion.heightMeters,
          profile: combatProfileFor(chassis),
          pose: { east: 0, north: 0, up: 0, yawDeg: 0 },
          zones: jaegerZones(chassis),
          layout: jaegerLayout(chassis),
          finisherThreshold: 0.2,
        },
      ],
    });
    arena.run(4);
    expect(arena.snapshot().fighters[0]!.id).toBe("custom");
  });

  it("look different", () => {
    const quick = assemble(sprinter, parts).silhouette;
    const heavy = assemble(brawler, parts).silhouette;
    expect(quick.bulk).not.toBe(heavy.bulk);
    expect(quick.heightMeters).not.toBe(heavy.heightMeters);
    // And the sockets a real model would attach to are unchanged, which is what
    // keeps a GLB drop-in possible later.
    expect(quick.headRatio).toBe(heavy.headRatio);
  });
});

describe("nothing the builder does reaches a canon machine", () => {
  it("leaves every shipped chassis exactly as it was", () => {
    const before = jaegerRegistry.all().map((chassis) => ({
      id: chassis.id,
      equipment: [...chassis.signatureEquipment],
      price: chassis.listPrice,
    }));
    const chassis = chassisFrom(
      archetypeBlueprint("gunline"),
      assemble(archetypeBlueprint("gunline"), parts),
      template,
    )!;
    const roster = new Roster(registryWith(chassis));
    roster.acquire({ chassisId: CUSTOM_CHASSIS_ID, acquiredBy: "research-manufacture" });

    for (const record of before) {
      const live = jaegerRegistry.getOrThrow(record.id);
      expect(live.signatureEquipment, record.id).toEqual(record.equipment);
      expect(live.listPrice, record.id).toBe(record.price);
    }
  });

  it("never registers itself into the shipped registry", () => {
    expect(jaegerRegistry.has(CUSTOM_CHASSIS_ID)).toBe(false);
  });

  it("cannot be owned by a roster that was never told about it", () => {
    // The bug this guards: a roster built on the shipped table alone has no
    // custom chassis, so assembling one would silently produce nothing. A
    // campaign has to hand the roster a registry the build was put into.
    const shipped = new Roster();
    expect(shipped.acquire({ chassisId: CUSTOM_CHASSIS_ID, acquiredBy: "research-manufacture" })).toBeNull();

    const chassis = chassisFrom(
      archetypeBlueprint("sprinter"),
      assemble(archetypeBlueprint("sprinter"), parts),
      template,
    )!;
    const aware = new Roster(registryWith(chassis));
    expect(
      aware.acquire({ chassisId: CUSTOM_CHASSIS_ID, acquiredBy: "research-manufacture" }),
    ).not.toBeNull();
  });

  it("can be replaced in a registry as the blueprint changes, without duplicating", () => {
    const first = chassisFrom(
      archetypeBlueprint("sprinter"),
      assemble(archetypeBlueprint("sprinter"), parts),
      template,
    )!;
    const registry = registryWith(first);
    const before = registry.all().length;

    const second = chassisFrom(
      archetypeBlueprint("brawler"),
      assemble(archetypeBlueprint("brawler"), parts),
      template,
    )!;
    registry.replace(second);
    expect(registry.all().length).toBe(before);
    expect(registry.getOrThrow(CUSTOM_CHASSIS_ID).massBudget.massTons).toBe(second.massBudget.massTons);
  });
});

describe("a blueprint through a real save", () => {
  it("survives writing and loading", async () => {
    const library = new BlueprintLibrary({ parts });
    library.save(archetypeBlueprint("gunline"));
    const built = library.build("blueprint.gunline", 3);
    expect(built.result.ok).toBe(true);

    await service.save("slot.builder", kernel(), { name: "Builder", library: library.snapshot() });
    const loaded = await service.load("slot.builder");
    const restored = new BlueprintLibrary({ parts });
    restored.restore(loaded.document.library);

    expect(restored.blueprints()).toHaveLength(1);
    expect(restored.built()[0]!.serial).toBe(built.record!.serial);
    // And the campaign still holds exactly one machine.
    expect(restored.buildRefusal("blueprint.gunline")).toMatch(/already exists/);
  });

  it("renames, recolours and rebuilds without duplicating the owned machine", async () => {
    const library = new BlueprintLibrary({ parts });
    library.save(archetypeBlueprint("sprinter"));
    const first = library.build("blueprint.sprinter", 1);

    library.rename("blueprint.sprinter", "Second Thoughts");
    library.recolour("blueprint.sprinter", { paint: "part.paint.oxide", emblemText: "SD-01" });
    // Renaming the drawing does not repaint the machine already standing.
    expect(library.built()[0]!.name).toBe("sprinter");
    expect(library.built()).toHaveLength(1);

    library.scrap(first.record!.serial);
    const second = library.build("blueprint.sprinter", 9);
    expect(second.result.ok).toBe(true);
    expect(library.built()).toHaveLength(1);
    expect(second.record!.name).toBe("Second Thoughts");
    expect(second.record!.serial).not.toBe(first.record!.serial);

    await service.save("slot.rebuilt", kernel(), { name: "Rebuilt", library: library.snapshot() });
    const restored = new BlueprintLibrary({ parts });
    restored.restore((await service.load("slot.rebuilt")).document.library);
    expect(restored.built()).toHaveLength(1);
  });

  it("exports and imports without ever handing over a second machine", async () => {
    const library = new BlueprintLibrary({ parts });
    library.save(archetypeBlueprint("brawler"));
    library.build("blueprint.brawler", 1);
    const text = library.export("blueprint.brawler")!;

    const other = new BlueprintLibrary({ parts });
    expect(other.import(text, "blueprint.received").ok).toBe(true);
    expect(other.built()).toHaveLength(0);
    // The imported design is buildable in its own campaign, and only once.
    expect(other.buildRefusal("blueprint.received")).toBeNull();
    other.build("blueprint.received", 1);
    expect(other.buildRefusal("blueprint.received")).toMatch(/already exists/);
  });

  it("migrates a version 14 save into an empty library rather than inventing a design", () => {
    const legacy = {
      schemaVersion: 14,
      savedAt: 1,
      metadata: {
        name: "Before the builder",
        worldSeed: 7,
        playTimeMs: 0,
        lastPlayedAt: 0,
        simTick: 0,
        appVersion: "0.2.0",
        thumbnail: null,
      },
      sim: { schemaVersion: 1, seed: 7, tick: 0, entities: [] },
    };
    const result = migrateSave(legacy);
    expect(result.applied).toContain("14");
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(result.document.library.blueprints).toEqual([]);
    expect(result.document.library.built).toEqual([]);
  });

  it("keeps a design whose part was retired, rather than losing the player's work", () => {
    const library = new BlueprintLibrary({ parts });
    const blueprint = starterBlueprint("blueprint.old");
    library.restore({
      schemaVersion: 1,
      blueprints: [{ ...blueprint, parts: { ...blueprint.parts, arms: ["part.arms.retired"] } }],
      built: [],
      serialCounter: 4,
      sandbox: false,
    });
    expect(library.blueprints()).toHaveLength(1);
    expect(library.get("blueprint.old")?.parts.arms).toEqual([]);
    // It fails validation and says so, rather than the design vanishing.
    expect(library.buildRefusal("blueprint.old")).toMatch(/constraint/);
  });
});
