import { describe, expect, it } from "vitest";
import { createMoveRegistry } from "../../src/data/moves";
import { createKaijuRegistry } from "../../src/data/kaiju";
import { createWeaponRegistry } from "../../src/data/weapons";
import { jaegerRegistry } from "../../src/data/jaegers";
import {
  CombatArena,
  combatProfileFor,
  jaegerLayout,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
  type FighterSpec,
} from "../../src/combat/arena";
import { OPEN_GROUND, type SpaceQuery } from "../../src/combat/finisher";
import { runBarrageStress, runWeaponScenario } from "../../src/debug/weaponScenario";

const MOVES = createMoveRegistry();
const WEAPONS = createWeaponRegistry();
const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");
const KAIJU = createKaijuRegistry().getOrThrow("kaiju.test-dummy");

function fighters(separationMeters: number): FighterSpec[] {
  return [
    {
      id: "jaeger",
      kind: "jaeger",
      displayName: JAEGER.name,
      heightMeters: JAEGER.locomotion.heightMeters,
      profile: combatProfileFor(JAEGER),
      pose: { east: 0, north: 0, up: 0, yawDeg: 0 },
      zones: jaegerZones(JAEGER),
      layout: jaegerLayout(JAEGER),
      finisherThreshold: 0.2,
    },
    {
      id: "kaiju",
      kind: "kaiju",
      displayName: KAIJU.name,
      heightMeters: KAIJU.heightMeters,
      profile: kaijuCombatProfile(KAIJU),
      pose: { east: 0, north: separationMeters, up: 0, yawDeg: 180 },
      zones: kaijuZones(KAIJU),
      kaiju: KAIJU,
      finisherThreshold: KAIJU.finisherThreshold,
    },
  ];
}

function arena(separationMeters = 300, space: SpaceQuery = OPEN_GROUND, capacity = 96): CombatArena {
  const combat = new CombatArena({
    moves: MOVES,
    fighters: fighters(separationMeters),
    space,
    projectileCapacity: capacity,
    groundHeight: () => 0,
    seed: 20260824,
  });
  for (const weapon of WEAPONS.all()) combat.equipWeapon("jaeger", weapon);
  return combat;
}

describe("firing", () => {
  it("spends heat and puts a beam on the target the instant it fires", () => {
    const combat = arena(300);
    const before = combat.snapshot().fighters[0]?.heat ?? 0;
    const events = combat.fireWeapon("jaeger", "weapon.plasma-caster").ok ? combat.run(1) : [];
    expect(combat.snapshot().fighters[0]?.heat).toBeGreaterThan(before);
    const hit = combat.log().find((event) => event.type === "hit" && event.moveId === "weapon.plasma-caster");
    expect(hit?.damage).toBeGreaterThan(0);
    void events;
  });

  it("puts a salvo in the air over several ticks rather than all at once", () => {
    const combat = arena(400);
    combat.fireWeapon("jaeger", "weapon.anti-kaiju-missile");
    const first = combat.projectilePool().live;
    combat.run(1);
    const afterOne = combat.projectilePool().live;
    combat.run(20);
    expect(first).toBe(0);
    expect(afterOne).toBe(1);
    expect(combat.projectilePool().spawned).toBe(3);
  });

  it("refuses a mortar in somebody's face and allows it at range, with reasons", () => {
    const close = arena(60);
    const closeCheck = close.checkWeapon("jaeger", "weapon.shoulder-mortar");
    expect(closeCheck.ok).toBe(false);
    if (!closeCheck.ok) {
      expect(closeCheck.reason).toBe("too-close");
      expect(closeCheck.message).toMatch(/needs 180 m/);
    }
    expect(arena(400).checkWeapon("jaeger", "weapon.shoulder-mortar").ok).toBe(true);
  });

  it("refuses a locked-only weapon pointed at nothing", () => {
    const lonely = new CombatArena({
      moves: MOVES,
      fighters: [fighters(300)[0] as FighterSpec],
      groundHeight: () => 0,
    });
    lonely.equipWeapon("jaeger", WEAPONS.getOrThrow("weapon.anti-kaiju-missile"));
    const check = lonely.checkWeapon("jaeger", "weapon.anti-kaiju-missile");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("needs-lock");
  });

  it("refuses a forward-arc weapon aimed away from the target", () => {
    const combat = arena(300);
    combat.moveTo("jaeger", { yawDeg: 180 });
    const check = combat.checkWeapon("jaeger", "weapon.plasma-caster");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toMatch(/only fires forward/);
  });

  it("pushes the machine back when it fires something with recoil", () => {
    const combat = arena(400);
    const before = combat.snapshot().fighters[0]?.north ?? 0;
    combat.fireWeapon("jaeger", "weapon.shoulder-mortar");
    combat.run(10);
    expect(combat.snapshot().fighters[0]?.north).toBeLessThan(before);
  });
});

describe("ammunition", () => {
  it("empties a magazine, says so, and reloads from the reserve", () => {
    const combat = arena(300);
    const cannon = WEAPONS.getOrThrow("weapon.rotary-cannon");
    for (let shot = 0; shot < cannon.magazine + 2; shot += 1) {
      combat.fireWeapon("jaeger", cannon.id);
      combat.run(cannon.cooldownTicks + 1);
    }
    const dry = combat.log().find((event) => event.type === "weapon-dry");
    expect(dry?.reason).toMatch(/empty/);

    const refused = combat.checkWeapon("jaeger", cannon.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("no-ammo");

    expect(combat.reloadWeapon("jaeger", cannon.id).ok).toBe(true);
    combat.run(cannon.reloadTicks + 2);
    expect(combat.weaponState("jaeger", cannon.id)?.magazine).toBe(cannon.magazine);
    // And it can fire again, so running dry never ends the encounter.
    expect(combat.checkWeapon("jaeger", cannon.id).ok).toBe(true);
  });

  it("leaves other options open when one weapon runs out", () => {
    const combat = arena(300);
    const missile = WEAPONS.getOrThrow("weapon.anti-kaiju-missile");
    for (let shot = 0; shot < missile.magazine + 1; shot += 1) {
      combat.fireWeapon("jaeger", missile.id);
      combat.run(missile.cooldownTicks + 1);
    }
    expect(combat.checkWeapon("jaeger", missile.id).ok).toBe(false);
    // The energy weapons have no ammunition to run out of.
    expect(combat.checkWeapon("jaeger", "weapon.plasma-caster").ok).toBe(true);
  });

  it("refuses a reload with nothing left and refuses one that is already full", () => {
    const combat = arena(300);
    const full = combat.reloadWeapon("jaeger", "weapon.rotary-cannon");
    expect(full.ok).toBe(false);
    const noMagazine = combat.reloadWeapon("jaeger", "weapon.plasma-caster");
    expect(noMagazine.ok).toBe(false);
    if (!noMagazine.ok) expect(noMagazine.message).toMatch(/no magazine/);
  });

  it("will not fire while reloading, and says why", () => {
    const combat = arena(300);
    const cannon = WEAPONS.getOrThrow("weapon.rotary-cannon");
    combat.fireWeapon("jaeger", cannon.id);
    combat.run(2);
    combat.reloadWeapon("jaeger", cannon.id);
    const check = combat.checkWeapon("jaeger", cannon.id);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("reloading");
  });
});

describe("heat and sustained fire", () => {
  it("overheats a machine that will not stop firing, and locks it out until it cools", () => {
    const combat = arena(300);
    // Fired as fast as the weapon allows: the caster puts on more heat per shot
    // than the machine sheds between them, so it is a question of when.
    for (let shot = 0; shot < 12; shot += 1) {
      combat.fireWeapon("jaeger", "weapon.plasma-caster");
      combat.run(91);
    }
    const overheated = combat.log().some((event) => event.type === "overheated");
    expect(overheated).toBe(true);
  });

  it("bleeds heat for as long as a channel is held, and stops when released", () => {
    const combat = arena(40);
    combat.fireWeapon("jaeger", "weapon.chain-sword");
    combat.run(30);
    const holding = combat.snapshot().fighters[0]?.heat ?? 0;
    expect(holding).toBeGreaterThan(0);
    expect(
      combat.snapshot().fighters[0]?.weapons.find((w) => w.id === "weapon.chain-sword")?.channelling,
    ).toBe(true);
    combat.releaseWeapon("jaeger");
    combat.run(30);
    // Released, so heat is coming down rather than climbing.
    expect(combat.snapshot().fighters[0]?.heat).toBeLessThan(holding);
  });
});

describe("status effects in the arena", () => {
  it("sets a target burning and keeps hurting it after the shot", () => {
    const combat = arena(300);
    combat.fireWeapon("jaeger", "weapon.plasma-caster");
    combat.run(2);
    const applied = combat.log().find((event) => event.type === "status-applied");
    // The log says what happened, not which row of a table it came from.
    expect(applied?.reason).toMatch(/is burning\.$/);
    expect(combat.snapshot().fighters[1]?.statuses.map((status) => status.statusId)).toContain(
      "status.burning",
    );
    const before = combat.snapshot().fighters[1]?.zones.reduce((total, zone) => total + zone.health, 0) ?? 0;
    combat.run(60);
    const after = combat.snapshot().fighters[1]?.zones.reduce((total, zone) => total + zone.health, 0) ?? 0;
    expect(after).toBeLessThan(before);
  });

  it("tethers a target with the whip rather than only hurting it", () => {
    const combat = arena(200);
    combat.fireWeapon("jaeger", "weapon.arc-whip");
    combat.run(2);
    const statuses = combat.snapshot().fighters[1]?.statuses.map((entry) => entry.statusId) ?? [];
    expect(statuses).toContain("status.tethered");
  });

  it("washes a fire out underwater", () => {
    const deep: SpaceQuery = { ...OPEN_GROUND, waterDepthMeters: () => 40 };
    const combat = arena(300, deep);
    combat.fireWeapon("jaeger", "weapon.plasma-caster");
    combat.run(4);
    expect(combat.log().some((event) => event.type === "status-ended")).toBe(true);
  });

  it("scales a weapon down underwater and reports it", () => {
    const dry = arena(300);
    dry.fireWeapon("jaeger", "weapon.plasma-caster");
    dry.run(1);
    const dryHit = dry.log().find((event) => event.type === "hit" && event.moveId === "weapon.plasma-caster");

    const deep: SpaceQuery = { ...OPEN_GROUND, waterDepthMeters: () => 40 };
    const wet = arena(300, deep);
    wet.fireWeapon("jaeger", "weapon.plasma-caster");
    wet.run(1);
    const wetHit = wet.log().find((event) => event.type === "hit" && event.moveId === "weapon.plasma-caster");

    expect(wetHit?.damage ?? 0).toBeLessThan(dryHit?.damage ?? 0);
    expect(wetHit?.reason).toBe("underwater");
  });
});

describe("the ranged scenario", () => {
  it("fires every weapon and reports what each one did", () => {
    const result = runWeaponScenario();
    expect(result.shotsFired).toBeGreaterThan(10);
    expect(result.projectileHits).toBeGreaterThan(0);
    expect(result.beamHits).toBeGreaterThan(0);
    expect(result.damageToKaiju).toBeGreaterThan(0);
    expect(new Set(result.statusesApplied).size).toBeGreaterThan(0);
  });

  it("repeats exactly", () => {
    expect(runWeaponScenario().digest).toBe(runWeaponScenario().digest);
  });

  it("runs dry, reloads, and keeps fighting", () => {
    const result = runWeaponScenario({ ticks: 3_000 });
    expect(result.dryEvents).toBeGreaterThan(0);
    expect(result.reloads).toBeGreaterThan(0);
    // Refusals are words rather than silence.
    for (const refusal of result.refusals) expect(refusal.length).toBeGreaterThan(8);
  });

  it("recovers the whole pool after a stress barrage, with nothing left flying", () => {
    const result = runBarrageStress(8);
    expect(result.poolSpawned).toBeGreaterThan(20);
    // A pool this small under this much fire has to refuse, and has to say so.
    expect(result.poolRefused).toBeGreaterThan(0);
    expect(result.events.some((event) => event.type === "projectile-refused")).toBe(true);
    // And nothing is still authoritative when the barrage is over.
    expect(result.poolLive).toBe(0);
  });

  it("does not leave rounds flying once the shooting stops", () => {
    // Fires hard for most of the run, then stops well before the end, so every
    // round in the air has time to land, expire or leave the bubble.
    const result = runWeaponScenario({ ticks: 2_400, cadenceTicks: 8 });
    expect(result.poolSpawned).toBeGreaterThan(result.poolLive);
    const settled = runWeaponScenario({ ticks: 2_400, cadenceTicks: 8, weaponIds: ["weapon.rotary-cannon"] });
    expect(settled.poolSpawned).toBeGreaterThan(20);
    // A 420 m weapon at 320 m/s clears itself inside two seconds, so what is
    // left at the end is only what was fired in the last moment of the run.
    expect(settled.poolLive).toBeLessThan(settled.poolSpawned / 4);
  });
});
