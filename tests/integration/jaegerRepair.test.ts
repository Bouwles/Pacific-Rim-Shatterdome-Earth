import { describe, expect, it } from "vitest";
import { CombatArena, combatProfileFor, jaegerLayout, jaegerZones } from "../../src/combat/arena";
import { createMoveRegistry } from "../../src/data/moves";
import { createWeaponRegistry } from "../../src/data/weapons";
import { createComponentRegistry } from "../../src/data/components";
import { jaegerRegistry } from "../../src/data/jaegers";
import { RECOVERY_HOURS, Roster, describeStatus, validateRosterSnapshot } from "../../src/jaegers/roster";
import { applyComponentDamage, componentState, structuralIntegrity } from "../../src/jaegers/damage";
import { migrateSave } from "../../src/saves/migrations";
import { ROOT_SAVE_VERSION, validateRootSave } from "../../src/saves/schema";
import { SaveService } from "../../src/saves/saveService";
import { MemorySaveRepository } from "../../src/saves/repository";
import { SimulationKernel } from "../../src/simulation/kernel";

const components = createComponentRegistry();
const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");

function arena(damageState?: ReturnType<Roster["get"]>) {
  return new CombatArena({
    moves: createMoveRegistry(),
    seed: 20260824,
    fighters: [
      {
        id: "jaeger",
        kind: "jaeger",
        displayName: JAEGER.name,
        heightMeters: JAEGER.locomotion.heightMeters,
        profile: combatProfileFor(JAEGER),
        pose: { east: 0, north: 0, up: 0, yawDeg: 0 },
        zones: jaegerZones(JAEGER, damageState?.damage),
        layout: jaegerLayout(JAEGER),
        finisherThreshold: 0.2,
      },
      {
        id: "target",
        kind: "jaeger",
        displayName: "Sparring frame",
        heightMeters: JAEGER.locomotion.heightMeters,
        profile: combatProfileFor(JAEGER),
        pose: { east: 0, north: 40, up: 0, yawDeg: 180 },
        zones: jaegerZones(JAEGER),
        layout: jaegerLayout(JAEGER),
        finisherThreshold: 0.2,
      },
    ],
  });
}

describe("a machine built out of components", () => {
  it("fights with one zone per component rather than one hull", () => {
    const zones = jaegerZones(JAEGER);
    expect(zones.length).toBeGreaterThan(4);
    expect(zones.map((zone) => zone.id)).toContain("component.arm.right");
    // Exactly the components whose loss ends the sortie are lethal zones.
    const lethal = zones.filter((zone) => zone.onDestroyed === "kill").map((zone) => zone.id);
    expect(lethal).toContain("component.conn-pod");
    expect(lethal).toContain("component.reactor");
  });

  it("walks into the fight carrying what it walked out with", () => {
    const roster = new Roster(jaegerRegistry, components);
    const record = roster.getOrThrow(JAEGER.id);
    applyComponentDamage(record.damage, components, "component.arm.right", 400, "shear", 21);
    const fight = arena(record);
    const armZone = fight.snapshot().fighters[0]?.zones.find((zone) => zone.id === "component.arm.right");
    const torsoZone = fight.snapshot().fighters[0]?.zones.find((zone) => zone.id === "component.torso");
    expect(armZone!.health).toBeLessThan(armZone!.maxHealth);
    expect(torsoZone!.health).toBe(torsoZone!.maxHealth);
  });

  it("silences only the weapons on the arm it lost", () => {
    const weapons = createWeaponRegistry();
    const fight = arena();
    for (const weapon of weapons.all()) fight.equipWeapon("jaeger", weapon);

    // The chain sword is on the right arm; the rotary cannon is on the left.
    const before = fight.checkWeapon("jaeger", "weapon.chain-sword");
    expect(before.ok).toBe(true);

    const arm = fight.snapshot().fighters[0]?.zones.find((zone) => zone.id === "component.arm.right");
    expect(arm).toBeDefined();
    fight.damageZone("jaeger", "component.arm.right", arm!.maxHealth, "shear");

    const after = fight.checkWeapon("jaeger", "weapon.chain-sword");
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.message).toMatch(/went with the right arm/i);
    // The other arm still works, which is what makes losing one specific.
    expect(fight.checkWeapon("jaeger", "weapon.rotary-cannon").ok).toBe(true);
  });
});

describe("the roster", () => {
  it("never deletes a machine that lost", () => {
    const roster = new Roster(jaegerRegistry, components);
    const before = roster.all().length;
    const record = roster.getOrThrow(JAEGER.id);
    applyComponentDamage(record.damage, components, "component.reactor", 90_000, "pierce", 22);
    const recovery = roster.recover(JAEGER.id);
    expect(roster.all().length).toBe(before);
    expect(recovery.status).toBe("recovering");
    expect(recovery.message).toMatch(/Towed to the bay/);
    expect(roster.get(JAEGER.id)?.damage.components.length).toBeGreaterThan(0);
  });

  it("refuses to send out a machine that cannot go, and says why", () => {
    const roster = new Roster(jaegerRegistry, components);
    expect(roster.canDeploy(JAEGER.id).ok).toBe(true);
    const record = roster.getOrThrow(JAEGER.id);
    applyComponentDamage(record.damage, components, "component.conn-pod", 90_000, "neural", 23);
    roster.recover(JAEGER.id);
    const refusal = roster.canDeploy(JAEGER.id);
    expect(refusal.ok).toBe(false);
    expect(refusal.message).toMatch(/hours from ready|critical component/);
  });

  it("comes home clean when nothing happened", () => {
    const roster = new Roster(jaegerRegistry, components);
    const outcome = roster.recover(JAEGER.id);
    expect(outcome.status).toBe("ready");
    expect(outcome.message).toMatch(/without a scratch/);
  });

  it("tows first, then works, and finishes", () => {
    const roster = new Roster(jaegerRegistry, components);
    const record = roster.getOrThrow(JAEGER.id);
    applyComponentDamage(record.damage, components, "component.leg.left", 90_000, "crush", 24);
    applyComponentDamage(record.damage, components, "component.torso", 600, "impact", 25);
    roster.recover(JAEGER.id);
    expect(record.status).toBe("recovering");

    // Nothing is repaired while the machine is still on the transporter.
    const towing = roster.work(JAEGER.id, RECOVERY_HOURS / 2);
    expect(towing.finished).toBe(false);
    expect(record.status).toBe("recovering");

    let guard = 0;
    while (record.status !== "ready" && guard < 200) {
      roster.work(JAEGER.id, 24);
      guard += 1;
    }
    expect(record.status).toBe("ready");
    expect(structuralIntegrity(record.damage)).toBeCloseTo(1, 5);
    expect(record.damage.scars.length).toBe(0);
    expect(describeStatus(record.status)).toBe("ready");
  });

  it("puts the worst component first, so the legs come back before the paint", () => {
    const roster = new Roster(jaegerRegistry, components);
    const record = roster.getOrThrow(JAEGER.id);
    applyComponentDamage(record.damage, components, "component.leg.left", 90_000, "crush", 26);
    applyComponentDamage(record.damage, components, "component.sensor-mast", 40, "energy", 27);
    roster.recover(JAEGER.id);
    roster.work(JAEGER.id, RECOVERY_HOURS + 200);
    const leg = record.damage.components.find((entry) => entry.componentId === "component.leg.left");
    expect(componentState(leg!)).not.toBe("destroyed");
  });
});

describe("the saved record", () => {
  it("round-trips through a real save", async () => {
    const repository = new MemorySaveRepository();
    const service = new SaveService({ repository, appVersion: "0.3.0", now: () => 1 });
    const kernel = new SimulationKernel({ seed: 20260824 });

    const roster = new Roster(jaegerRegistry, components);
    const record = roster.getOrThrow(JAEGER.id);
    applyComponentDamage(record.damage, components, "component.arm.right", 90_000, "shear", 28);
    applyComponentDamage(record.damage, components, "component.leg.left", 300, "crush", 29);
    roster.recover(JAEGER.id);

    await service.save("slot.a", kernel, { name: "Scarred", roster: roster.snapshot() });
    const loaded = await service.load("slot.a");
    expect(validateRootSave(loaded.document)).toEqual([]);

    const restored = new Roster(jaegerRegistry, components);
    restored.restore(loaded.document.roster);
    const back = restored.getOrThrow(JAEGER.id);
    // Same scars, same missing arm, same outstanding work.
    expect(back.status).toBe(record.status);
    expect(back.damage.scars.length).toBe(record.damage.scars.length);
    expect(componentState(back.damage.components.find((e) => e.componentId === "component.arm.right")!)).toBe(
      "destroyed",
    );
    expect(restored.repairOrder(JAEGER.id).totalHours).toBeCloseTo(
      roster.repairOrder(JAEGER.id).totalHours,
      1,
    );
  });

  it("migrates a version 5 save into a full roster of undamaged machines", () => {
    const legacy = {
      schemaVersion: 5,
      savedAt: 1,
      metadata: {
        name: "Before damage",
        worldSeed: 7,
        playTimeMs: 0,
        lastPlayedAt: 0,
        simTick: 0,
        appVersion: "0.2.0",
        thumbnail: null,
      },
      sim: { schemaVersion: 1, seed: 7, tick: 0, entities: [] },
      world: { marker: "untouched" },
      shatterdome: { marker: "untouched" },
    };
    const result = migrateSave(legacy);
    expect(result.applied).toEqual(["5", "6", "7", "8", "9", "10", "11"]);
    expect(result.document.schemaVersion).toBe(ROOT_SAVE_VERSION);
    expect(validateRosterSnapshot(result.document.roster)).toEqual([]);
    expect(result.document.roster.machines.length).toBe(jaegerRegistry.all().length);
    for (const machine of result.document.roster.machines) {
      expect(machine.status).toBe("ready");
      expect(machine.damage.scars).toEqual([]);
    }
    // Everything else in the file survives: later steps add their own sections,
    // but nothing that was already written is disturbed.
    const world = (result.document as unknown as Record<string, unknown>)["world"] as Record<string, unknown>;
    expect(world["marker"]).toBe("untouched");
    expect((result.document as unknown as Record<string, unknown>)["shatterdome"]).toEqual({
      marker: "untouched",
    });
  });

  it("refuses a roster snapshot that is not one", () => {
    expect(validateRosterSnapshot(null).length).toBeGreaterThan(0);
    expect(
      validateRosterSnapshot({
        machines: [{ jaegerId: "x", status: "melted", hoursRemaining: 1, damage: null }],
      }).join(" "),
    ).toMatch(/unknown machine status/);
  });
});
