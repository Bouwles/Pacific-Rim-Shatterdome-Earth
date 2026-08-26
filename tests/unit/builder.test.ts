import { describe, expect, it } from "vitest";
import {
  MULTI_SLOTS,
  PART_DEFINITIONS,
  PART_SLOTS,
  STRUCTURAL_SLOTS,
  createPartRegistry,
  partsForSlot,
  validatePart,
} from "../../src/data/parts";
import {
  CUSTOM_CHASSIS_ID,
  assemble,
  chassisFrom,
  emptyBlueprint,
  starterBlueprint,
  type Blueprint,
} from "../../src/custom/blueprint";
import {
  BlueprintLibrary,
  CAMPAIGN_BUILD_LIMIT,
  compareToOwned,
  emptyLibrarySnapshot,
  validateLibrarySnapshot,
} from "../../src/custom/blueprintLibrary";
import { jaegerRegistry } from "../../src/data/jaegers";

const parts = createPartRegistry();
const template = jaegerRegistry.getOrThrow("placeholder-mk0");

function build(overrides: Partial<Record<(typeof PART_SLOTS)[number], readonly string[]>>): Blueprint {
  const base = starterBlueprint();
  return { ...base, parts: { ...base.parts, ...overrides } };
}

describe("the part catalogue", () => {
  it("all validate", () => {
    for (const part of PART_DEFINITIONS) expect(validatePart(part), part.id).toEqual([]);
  });

  it("registers without a duplicate", () => {
    expect(parts.all().length).toBe(PART_DEFINITIONS.length);
  });

  it("offers a choice in every slot that matters", () => {
    for (const slot of STRUCTURAL_SLOTS) {
      // A slot with one option is not a decision.
      expect(partsForSlot(slot).length, slot).toBeGreaterThan(1);
    }
  });

  it("keeps cosmetics weightless, so paint can never be a hidden tradeoff", () => {
    for (const part of PART_DEFINITIONS) {
      if (STRUCTURAL_SLOTS.includes(part.slot) || MULTI_SLOTS.includes(part.slot)) continue;
      expect(part.massTons, part.id).toBe(0);
      expect(part.powerDrawMw, part.id).toBe(0);
      expect(part.armorRating, part.id).toBe(0);
    }
  });

  it("has no part that is simply better than another in its slot", () => {
    // The failure mode this whole catalogue is built against. For every pair in
    // a slot, neither may beat the other on every axis at no extra mass.
    const axes = [
      "structure",
      "armorRating",
      "actuatorCapacity",
      "mobilityScale",
      "ammunitionVolume",
      "moduleSlots",
      "hardpoints",
    ] as const;
    for (const slot of STRUCTURAL_SLOTS) {
      const options = partsForSlot(slot);
      for (const first of options) {
        for (const second of options) {
          if (first.id === second.id) continue;
          const dominates =
            axes.every((axis) => first[axis] >= second[axis]) &&
            first.massTons <= second.massTons &&
            first.heatOutput <= second.heatOutput &&
            first.powerDrawMw <= second.powerDrawMw;
          expect(dominates, `${first.id} dominates ${second.id}`).toBe(false);
        }
      }
    }
  });

  it("refuses a cosmetic part that weighs something", () => {
    const paint = parts.getOrThrow("part.paint.slate");
    expect(validatePart({ ...paint, massTons: 40 }).join(" ")).toMatch(/weightless/);
  });

  it("refuses a part whose id does not name its slot", () => {
    const legs = parts.getOrThrow("part.legs.standard");
    expect(validatePart({ ...legs, id: "part.wrong.thing" }).length).toBeGreaterThan(0);
  });
});

describe("assembling a build", () => {
  it("accepts a sensible one", () => {
    const result = assemble(starterBlueprint(), parts);
    expect(result.legal).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "violation")).toEqual([]);
  });

  it("reports every violated constraint rather than only the first", () => {
    // An empty build breaks seven separate rules. A builder that surfaced one at
    // a time would be a guessing game.
    const result = assemble(emptyBlueprint(), parts);
    const violations = result.issues.filter((issue) => issue.severity === "violation");
    expect(violations.length).toBeGreaterThanOrEqual(STRUCTURAL_SLOTS.length);
    for (const slot of STRUCTURAL_SLOTS) {
      expect(
        violations.some((issue) => issue.slot === slot),
        slot,
      ).toBe(true);
    }
  });

  it("says what is missing in words a person can act on", () => {
    for (const issue of assemble(emptyBlueprint(), parts).issues) {
      expect(issue.message.length).toBeGreaterThan(4);
      expect(issue.message.endsWith(".")).toBe(true);
    }
  });

  it("refuses a build that draws more power than it makes, and says how short", () => {
    const hungry = build({
      reactor: ["part.reactor.standard"],
      weapon: ["part.weapon.plasma", "part.weapon.plasma"],
      torso: ["part.torso.magazine"],
      legs: ["part.legs.heavy"],
      arms: ["part.arms.heavy"],
    });
    const result = assemble(hungry, parts);
    const power = result.issues.find((issue) => /MW/.test(issue.message));
    expect(power?.severity).toBe("violation");
    expect(power?.message).toMatch(/Short \d+ MW/);
  });

  it("refuses a build that cooks itself, and says by how much", () => {
    const hot = build({
      reactor: ["part.reactor.output"],
      armor: ["part.armor.ablative"],
      weapon: ["part.weapon.plasma"],
    });
    const result = assemble(hot, parts);
    const heat = result.issues.find((issue) => /cooks itself/.test(issue.message));
    expect(heat?.severity).toBe("violation");
  });

  it("refuses a build heavier than its own actuators", () => {
    // Thin legs and thin arms under a heavy hull. The actuators are the ceiling
    // here rather than the power or the cooling.
    const heavy = build({
      legs: ["part.legs.sprint"],
      arms: ["part.arms.light"],
      torso: ["part.torso.compact"],
      reactor: ["part.reactor.output"],
      armor: ["part.armor.ablative"],
      head: ["part.head.armoured"],
      // The plain drive rather than the stabiliser rig: the rig would carry some
      // of the load itself and this build is about the actuators running out.
      movement: ["part.movement.standard"],
      weapon: ["part.weapon.cannon"],
    });
    const result = assemble(heavy, parts);
    expect(result.issues.some((issue) => /actuators rated for/.test(issue.message))).toBe(true);
    // And it reports the other things wrong with it at the same time.
    expect(result.issues.filter((issue) => issue.severity === "violation").length).toBeGreaterThan(1);
  });

  it("refuses a build whose fittings do not meet, and names both sides", () => {
    // Sprint legs offer only a light spine; the magazine frame needs a heavy one.
    const mismatched = build({ legs: ["part.legs.sprint"], torso: ["part.torso.magazine"] });
    const issue = assemble(mismatched, parts).issues.find((entry) => /spine\.heavy/.test(entry.message));
    expect(issue?.severity).toBe("violation");
    expect(issue?.message).toMatch(/Deep Magazine Frame needs/);
  });

  it("refuses more weapons than there are hardpoints", () => {
    const overgunned = build({
      torso: ["part.torso.compact"],
      arms: ["part.arms.light"],
      weapon: [
        "part.weapon.chainsword",
        "part.weapon.chainsword",
        "part.weapon.chainsword",
        "part.weapon.chainsword",
      ],
    });
    expect(assemble(overgunned, parts).issues.some((issue) => /hardpoints/.test(issue.message))).toBe(true);
  });

  it("refuses weapons that want more ammunition than the hull stows", () => {
    const starved = build({
      torso: ["part.torso.compact"],
      arms: ["part.arms.heavy"],
      weapon: ["part.weapon.cannon", "part.weapon.cannon"],
    });
    expect(
      assemble(starved, parts).issues.some((issue) => /more rounds than the hull/.test(issue.message)),
    ).toBe(true);
  });

  it("warns without refusing when a margin is thin", () => {
    const result = assemble(starterBlueprint(), parts);
    // Warnings must never make a build illegal.
    const warnings = result.issues.filter((issue) => issue.severity === "warning");
    expect(result.legal).toBe(true);
    for (const warning of warnings) expect(warning.severity).toBe("warning");
  });

  it("keeps balance and mobility as separate axes", () => {
    // The explicit failure mode: everything collapsing into one capacity bar.
    const planted = assemble(
      build({ legs: ["part.legs.heavy"], movement: ["part.movement.stabiliser"] }),
      parts,
    );
    const quick = assemble(
      build({
        legs: ["part.legs.sprint"],
        torso: ["part.torso.compact"],
        arms: ["part.arms.light"],
        armor: ["part.armor.radiator"],
      }),
      parts,
    );
    expect(quick.stats.mobilityScale).toBeGreaterThan(planted.stats.mobilityScale);
    // And the quicker machine is not automatically the steadier one.
    expect(quick.stats.balance).not.toBe(planted.stats.balance);
  });

  it("puts mass where the parts put it", () => {
    const topHeavy = assemble(build({ head: ["part.head.armoured"], legs: ["part.legs.sprint"] }), parts);
    const bottomHeavy = assemble(build({ head: ["part.head.standard"], legs: ["part.legs.heavy"] }), parts);
    expect(topHeavy.stats.massHeight).toBeGreaterThan(bottomHeavy.stats.massHeight);
  });

  it("costs what its parts cost", () => {
    const blueprint = starterBlueprint();
    const expected = Object.values(blueprint.parts)
      .flat()
      .reduce((total, id) => total + (parts.get(id)?.cost ?? 0), 0);
    expect(assemble(blueprint, parts).stats.cost).toBe(expected);
  });
});

describe("two builds are two machines", () => {
  const light = assemble(
    build({
      legs: ["part.legs.sprint"],
      torso: ["part.torso.compact"],
      arms: ["part.arms.light"],
      armor: ["part.armor.radiator"],
      head: ["part.head.standard"],
    }),
    parts,
  );
  const heavy = assemble(
    build({
      legs: ["part.legs.heavy"],
      arms: ["part.arms.heavy"],
      armor: ["part.armor.ablative"],
      head: ["part.head.armoured"],
      movement: ["part.movement.stabiliser"],
    }),
    parts,
  );

  it("are both legal", () => {
    expect(light.legal, JSON.stringify(light.issues)).toBe(true);
    expect(heavy.legal, JSON.stringify(heavy.issues)).toBe(true);
  });

  it("handle differently", () => {
    expect(light.stats.mobilityScale).toBeGreaterThan(heavy.stats.mobilityScale * 1.4);
    expect(heavy.stats.armorRating).toBeGreaterThan(light.stats.armorRating * 1.5);
  });

  it("look different", () => {
    expect(light.silhouette.bulk).not.toBe(heavy.silhouette.bulk);
    expect(light.silhouette.heightMeters).not.toBe(heavy.silhouette.heightMeters);
  });

  it("fly differently once they are chassis", () => {
    const a = chassisFrom(
      build({
        legs: ["part.legs.sprint"],
        torso: ["part.torso.compact"],
        arms: ["part.arms.light"],
        armor: ["part.armor.radiator"],
      }),
      light,
      template,
    );
    const b = chassisFrom(
      build({
        legs: ["part.legs.heavy"],
        arms: ["part.arms.heavy"],
        armor: ["part.armor.ablative"],
        head: ["part.head.armoured"],
        movement: ["part.movement.stabiliser"],
      }),
      heavy,
      template,
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.locomotion.runSpeedMps).toBeGreaterThan(b!.locomotion.runSpeedMps);
    expect(a!.massBudget.massTons).toBeLessThan(b!.massBudget.massTons);
    // And a worse balanced machine takes longer to get back up.
    expect(b!.locomotion.getUpSeconds).not.toBe(a!.locomotion.getUpSeconds);
  });
});

describe("an illegal build cannot reach the pad", () => {
  it("produces no chassis at all", () => {
    const result = assemble(emptyBlueprint(), parts);
    expect(chassisFrom(emptyBlueprint(), result, template)).toBeNull();
  });

  it("produces no chassis even when only one constraint is broken", () => {
    const mismatched = build({ legs: ["part.legs.sprint"], torso: ["part.torso.magazine"] });
    const result = assemble(mismatched, parts);
    expect(result.legal).toBe(false);
    expect(chassisFrom(mismatched, result, template)).toBeNull();
  });
});

describe("the custom chassis is an ordinary chassis", () => {
  const result = assemble(starterBlueprint(), parts);
  const chassis = chassisFrom(starterBlueprint(), result, template)!;

  it("has the one custom id, so there is only ever one design", () => {
    expect(chassis.id).toBe(CUSTOM_CHASSIS_ID);
  });

  it("cannot be bought, and carries no price", () => {
    expect(chassis.acquisition).not.toContain("purchase");
    expect(chassis.listPrice).toBe(0);
  });

  it("carries no signature loadout, so it cannot overwrite a canon one", () => {
    expect(chassis.signatureEquipment).toEqual([]);
  });

  it("leaves the template it was built from untouched", () => {
    // The failure mode this guards: custom parts reaching a canon machine.
    // Building one must not edit the definition it was derived from.
    const live = jaegerRegistry.getOrThrow("placeholder-mk0");
    expect(live.id).toBe("placeholder-mk0");
    expect(live.name).toBe(template.name);
    expect(live.signatureEquipment).toEqual(template.signatureEquipment);
    expect(live.massBudget).toEqual(template.massBudget);
    expect(live.locomotion.runSpeedMps).toBe(template.locomotion.runSpeedMps);
  });

  it("does not put itself on any canon chassis", () => {
    for (const other of jaegerRegistry.all()) {
      if (other.id === CUSTOM_CHASSIS_ID) continue;
      expect(other.manufacturer).not.toBe("Shatterdome Earth Assembly");
    }
  });
});

describe("the blueprint library", () => {
  function library(): BlueprintLibrary {
    const instance = new BlueprintLibrary({ parts });
    instance.save(starterBlueprint("blueprint.a"));
    return instance;
  }

  it("files a blueprint and finds it again", () => {
    const instance = library();
    expect(instance.blueprints()).toHaveLength(1);
    expect(instance.get("blueprint.a")?.name).toBe("Yard Standard");
  });

  it("updates rather than duplicating on a second save", () => {
    const instance = library();
    instance.save({ ...starterBlueprint("blueprint.a"), name: "Renamed" });
    expect(instance.blueprints()).toHaveLength(1);
    expect(instance.get("blueprint.a")?.name).toBe("Renamed");
  });

  it("renames without touching anything structural", () => {
    const instance = library();
    const before = instance.get("blueprint.a")!.parts;
    instance.rename("blueprint.a", "Ceremony");
    expect(instance.get("blueprint.a")?.name).toBe("Ceremony");
    expect(instance.get("blueprint.a")?.parts).toEqual(before);
  });

  it("refuses a nameless blueprint", () => {
    const instance = library();
    expect(instance.save({ ...starterBlueprint("blueprint.b"), name: "   " }).ok).toBe(false);
  });

  it("recolours without touching anything structural", () => {
    const instance = library();
    const before = instance.get("blueprint.a")!.parts.legs;
    const result = instance.recolour("blueprint.a", {
      paint: "part.paint.oxide",
      emblem: "part.emblem.anchor",
    });
    expect(result.ok).toBe(true);
    expect(instance.get("blueprint.a")?.parts.paint).toEqual(["part.paint.oxide"]);
    expect(instance.get("blueprint.a")?.parts.legs).toEqual(before);
  });

  it("refuses a recolour that is not a colour", () => {
    const instance = library();
    expect(instance.recolour("blueprint.a", { paint: "part.legs.heavy" }).ok).toBe(false);
  });

  it("builds one machine and then refuses a second", () => {
    const instance = library();
    instance.save(starterBlueprint("blueprint.b"));
    expect(instance.build("blueprint.a", 1).result.ok).toBe(true);
    const second = instance.build("blueprint.b", 1);
    expect(second.result.ok).toBe(false);
    expect(second.result.message).toMatch(/already exists/);
    expect(instance.built()).toHaveLength(CAMPAIGN_BUILD_LIMIT);
  });

  it("refuses to build an illegal blueprint, and says it is the build", () => {
    const instance = library();
    instance.save(emptyBlueprint("blueprint.bad"));
    const refusal = instance.buildRefusal("blueprint.bad");
    expect(refusal).toMatch(/constraints not met/);
  });

  it("tells a design problem apart from a fleet problem", () => {
    const instance = library();
    instance.build("blueprint.a", 1);
    instance.save(starterBlueprint("blueprint.b"));
    // A legal build refused only because one already exists must not tell the
    // player to fix a build that is already fine.
    expect(instance.buildRefusal("blueprint.b")).toMatch(/already exists/);
  });

  it("frees the slot when a machine is scrapped, and never reuses the serial", () => {
    const instance = library();
    const first = instance.build("blueprint.a", 1);
    expect(instance.scrap(first.record!.serial).ok).toBe(true);
    const second = instance.build("blueprint.a", 2);
    expect(second.result.ok).toBe(true);
    expect(second.record!.serial).not.toBe(first.record!.serial);
  });

  it("lets a sandbox library build as many as it likes", () => {
    const instance = new BlueprintLibrary({ parts, sandbox: true });
    instance.save(starterBlueprint("blueprint.a"));
    expect(instance.build("blueprint.a", 1).result.ok).toBe(true);
    expect(instance.build("blueprint.a", 1).result.ok).toBe(true);
    expect(instance.built()).toHaveLength(2);
  });

  it("will not discard a blueprint something was built from", () => {
    const instance = library();
    instance.build("blueprint.a", 1);
    expect(instance.remove("blueprint.a").ok).toBe(false);
  });

  it("exports and imports a design without ever handing over a machine", () => {
    const instance = library();
    instance.build("blueprint.a", 1);
    const text = instance.export("blueprint.a")!;
    expect(text).not.toMatch(/CUSTOM-/);

    const other = new BlueprintLibrary({ parts });
    expect(other.import(text, "blueprint.imported").ok).toBe(true);
    expect(other.blueprints()).toHaveLength(1);
    expect(other.built()).toHaveLength(0);
  });

  it("gives an imported blueprint a fresh id rather than overwriting one", () => {
    const instance = library();
    const text = instance.export("blueprint.a")!;
    instance.import(text, "blueprint.copy");
    expect(instance.blueprints()).toHaveLength(2);
  });

  it("refuses nonsense on import rather than throwing", () => {
    const instance = library();
    expect(instance.import("not json", "blueprint.x").ok).toBe(false);
    expect(instance.import(JSON.stringify({ schemaVersion: 99 }), "blueprint.x").ok).toBe(false);
  });

  it("survives a save and a load", () => {
    const instance = library();
    instance.build("blueprint.a", 4);
    const restored = new BlueprintLibrary({ parts });
    restored.restore(instance.snapshot());
    expect(restored.blueprints()).toHaveLength(1);
    expect(restored.built()).toHaveLength(1);
    expect(restored.built()[0]!.serial).toBe(instance.built()[0]!.serial);
  });

  it("does not reuse a serial across a save", () => {
    const instance = library();
    const first = instance.build("blueprint.a", 1);
    const restored = new BlueprintLibrary({ parts });
    restored.restore(instance.snapshot());
    restored.scrap(first.record!.serial);
    expect(restored.build("blueprint.a", 2).record!.serial).not.toBe(first.record!.serial);
  });

  it("drops a part this build no longer has rather than the whole design", () => {
    const instance = new BlueprintLibrary({ parts });
    instance.restore({
      ...emptyLibrarySnapshot(),
      blueprints: [
        {
          ...starterBlueprint("blueprint.old"),
          parts: { ...starterBlueprint().parts, legs: ["part.legs.removed"] },
        },
      ],
    });
    // The design survives, missing a leg, and will simply fail validation.
    expect(instance.blueprints()).toHaveLength(1);
    expect(instance.get("blueprint.old")?.parts.legs).toEqual([]);
    expect(instance.buildRefusal("blueprint.old")).toMatch(/constraint/);
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateLibrarySnapshot(null).length).toBeGreaterThan(0);
    expect(validateLibrarySnapshot({ ...emptyLibrarySnapshot(), schemaVersion: 99 })).toHaveLength(1);
    expect(validateLibrarySnapshot(emptyLibrarySnapshot())).toEqual([]);
  });
});

describe("comparing against what is already owned", () => {
  it("reports several axes rather than one score", () => {
    const stats = assemble(starterBlueprint(), parts).stats;
    const rows = compareToOwned(stats, { massTons: 2400, armour: 0.3, mobility: 1, structure: 3000 });
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) expect(row.label.length).toBeGreaterThan(0);
  });

  it("says which way is better per axis, so mass is not read as a win", () => {
    const stats = assemble(starterBlueprint(), parts).stats;
    const rows = compareToOwned(stats, { massTons: 2400, armour: 0.3, mobility: 1, structure: 3000 });
    expect(rows.find((row) => row.label === "Mass")?.higherIsBetter).toBe(false);
    expect(rows.find((row) => row.label === "Armour")?.higherIsBetter).toBe(true);
  });
});
