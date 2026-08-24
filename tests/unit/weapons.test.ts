import { describe, expect, it } from "vitest";
import {
  WEAPON_DEFINITIONS,
  createWeaponRegistry,
  firesProjectiles,
  fitsJaeger,
  resolvesInstantly,
  validateWeapon,
  type WeaponDefinition,
} from "../../src/data/weapons";
import {
  COMBAT_BUBBLE_METERS,
  MAX_PROJECTILE_SECONDS,
  ProjectilePool,
  spreadStream,
  type ProjectileTargets,
} from "../../src/combat/projectiles";
import {
  STATUS_DEFINITIONS,
  advanceStatuses,
  applyStatus,
  createStatusRegistry,
  rankWeapons,
  scoreWeapon,
  validateStatus,
  weaponsWithTag,
  type AbilitySituation,
  type ActiveStatus,
} from "../../src/combat/abilities";

const WEAPONS = createWeaponRegistry();
const CASTER = WEAPONS.getOrThrow("weapon.plasma-caster");
const MISSILE = WEAPONS.getOrThrow("weapon.anti-kaiju-missile");
const MORTAR = WEAPONS.getOrThrow("weapon.shoulder-mortar");
const CANNON = WEAPONS.getOrThrow("weapon.rotary-cannon");
const WHIP = WEAPONS.getOrThrow("weapon.arc-whip");
const SWORD = WEAPONS.getOrThrow("weapon.chain-sword");
const BOOSTER = WEAPONS.getOrThrow("weapon.booster-strike");

function situation(overrides: Partial<AbilitySituation> = {}): AbilitySituation {
  return {
    distanceMeters: 300,
    targetHealthFraction: 1,
    targetIsReeling: false,
    targetIsHeld: false,
    selfHeatFraction: 0,
    ammoFraction: 1,
    hasLock: true,
    underwater: false,
    alliesInLine: 0,
    ...overrides,
  };
}

describe("the weapon table", () => {
  it("ships every example the milestone names, and validates them all", () => {
    for (const weapon of WEAPON_DEFINITIONS) expect(validateWeapon(weapon), weapon.id).toEqual([]);
    const behaviors = new Set(WEAPON_DEFINITIONS.map((weapon) => weapon.behavior));
    expect(behaviors.has("beam")).toBe(true);
    expect(behaviors.has("salvo")).toBe(true);
    expect(behaviors.has("mortar")).toBe(true);
    expect(behaviors.has("projectile")).toBe(true);
    expect(behaviors.has("tether")).toBe(true);
    expect(behaviors.has("channel")).toBe(true);
    expect(behaviors.has("cone")).toBe(true);
  });

  it("refuses a weapon that costs nothing at all", () => {
    const free: WeaponDefinition = {
      ...CASTER,
      heatCost: 0,
      reactorDrawMw: 0,
      magazine: 0,
      reserve: 0,
      cooldownTicks: 0,
    };
    const errors = validateWeapon(free).join(" ");
    expect(errors).toMatch(/ranged fire is never free/);
  });

  it("refuses a reserve that cannot fill its own magazine, and a magazine that reloads instantly", () => {
    expect(validateWeapon({ ...CANNON, reserve: 3 }).join(" ")).toMatch(/at least one magazine/);
    expect(validateWeapon({ ...CANNON, reloadTicks: 0 }).join(" ")).toMatch(/reload that takes time/);
  });

  it("insists a mortar has a minimum range and a beam has no travel time", () => {
    expect(validateWeapon({ ...MORTAR, minimumRangeMeters: 0 }).join(" ")).toMatch(/wearing a hat/);
    expect(validateWeapon({ ...CASTER, projectileSpeedMps: 100 }).join(" ")).toMatch(/arrives instantly/);
    expect(validateWeapon({ ...MISSILE, salvoCount: 1 }).join(" ")).toMatch(/salvo of one/);
  });

  it("separates what travels from what lands instantly", () => {
    expect(firesProjectiles(MISSILE)).toBe(true);
    expect(firesProjectiles(MORTAR)).toBe(true);
    expect(firesProjectiles(CANNON)).toBe(true);
    expect(resolvesInstantly(CASTER)).toBe(true);
    expect(resolvesInstantly(WHIP)).toBe(true);
    expect(resolvesInstantly(BOOSTER)).toBe(true);
    expect(firesProjectiles(CASTER)).toBe(false);
  });

  it("gives every weapon a genuinely different shape", () => {
    // The volume weapon has the ammunition and none of the punch; the signature
    // weapons have the punch and no ammunition at all.
    expect(CANNON.magazine).toBeGreaterThan(MISSILE.magazine * 10);
    expect(CANNON.damage.amount).toBeLessThan(MISSILE.damage.amount / 5);
    expect(CASTER.magazine).toBe(0);
    expect(CASTER.heatCost).toBeGreaterThan(CANNON.heatCost * 10);
    expect(MORTAR.minimumRangeMeters).toBeGreaterThan(0);
    expect(WHIP.underwaterScale).toBeGreaterThan(1);
    expect(MORTAR.underwaterScale).toBeLessThan(0.2);
    expect(SWORD.rangeMeters).toBeLessThan(CANNON.rangeMeters / 5);
  });

  it("lets any machine mount anything the table does not restrict", () => {
    expect(fitsJaeger(CASTER, "placeholder-mk0")).toBe(true);
    expect(fitsJaeger({ ...CASTER, jaegerIds: ["heavy-mk4"] }, "placeholder-mk0")).toBe(false);
  });
});

describe("the projectile pool", () => {
  const targets = (fighterIds: readonly string[] = []): ProjectileTargets => ({
    spheresFor: () => [{ id: "core", centre: { east: 0, up: 40, north: 400 }, radiusMeters: 20 }],
    fighterIds,
    groundHeight: () => -1_000,
    bubbleCentre: () => ({ east: 0, north: 0 }),
  });

  const fire = (pool: ProjectilePool, weapon: WeaponDefinition, index = 0) =>
    pool.spawn({
      weapon,
      ownerId: "jaeger",
      targetId: "kaiju",
      east: 0,
      north: 0,
      up: 40,
      yawDeg: 0,
      pitchDeg: 0,
      shotIndex: index,
      rng: spreadStream(1, weapon.id),
    });

  it("refuses a nonsense capacity rather than allocating one", () => {
    expect(() => new ProjectilePool(0)).toThrow(/positive integer/);
  });

  it("never grows: a full pool refuses and says so", () => {
    const pool = new ProjectilePool(3);
    for (let index = 0; index < 3; index += 1) expect(fire(pool, CANNON, index)).not.toBeNull();
    expect(fire(pool, CANNON, 3)).toBeNull();
    expect(pool.refused).toBe(1);
    expect(pool.live).toBe(3);
  });

  it("recovers every slot once its rounds retire", () => {
    const pool = new ProjectilePool(8);
    for (let index = 0; index < 8; index += 1) fire(pool, CANNON, index);
    expect(pool.live).toBe(8);
    // Long enough for a 420 m weapon at 320 m/s to run out of range.
    for (let tick = 0; tick < 300; tick += 1) pool.advance(1 / 60, targets());
    expect(pool.live).toBe(0);
    expect(pool.retired).toBe(8);
    // And the slots are usable again.
    expect(fire(pool, CANNON, 0)).not.toBeNull();
  });

  it("retires a round that leaves the combat bubble", () => {
    const pool = new ProjectilePool(2);
    // A weapon with more range than the bubble is wide.
    fire(pool, { ...CANNON, rangeMeters: COMBAT_BUBBLE_METERS * 3, projectileSpeedMps: 900 });
    let reasons: string[] = [];
    for (let tick = 0; tick < 600 && pool.live > 0; tick += 1) {
      reasons = [...reasons, ...pool.advance(1 / 60, targets()).retired.map((entry) => entry.reason)];
    }
    expect(pool.live).toBe(0);
    expect(reasons).toContain("left-bubble");
  });

  it("never lets a round live past its own ceiling", () => {
    const pool = new ProjectilePool(1);
    // Slow enough that neither range nor the bubble would ever end it.
    fire(pool, { ...CANNON, projectileSpeedMps: 1, rangeMeters: 100_000 });
    let reasons: string[] = [];
    const ticks = Math.ceil(MAX_PROJECTILE_SECONDS * 60) + 10;
    for (let tick = 0; tick < ticks && pool.live > 0; tick += 1) {
      reasons = [...reasons, ...pool.advance(1 / 60, targets()).retired.map((entry) => entry.reason)];
    }
    expect(pool.live).toBe(0);
    expect(reasons).toContain("expired");
  });

  it("hits what it is swept through, and retires on contact", () => {
    const pool = new ProjectilePool(1);
    fire(pool, CANNON);
    let hits = 0;
    for (let tick = 0; tick < 200 && pool.live > 0; tick += 1) {
      hits += pool.advance(1 / 60, targets(["kaiju"])).hits.length;
    }
    expect(hits).toBe(1);
    expect(pool.live).toBe(0);
  });

  it("arcs indirect fire and flies direct fire straight", () => {
    const pool = new ProjectilePool(2);
    const mortarShell = fire(pool, MORTAR);
    const bullet = fire(pool, CANNON);
    expect(mortarShell?.ballistic).toBe(true);
    expect(bullet?.ballistic).toBe(false);
    expect(mortarShell?.velocityUp ?? 0).toBeGreaterThan(0);
    expect(Math.abs(bullet?.velocityUp ?? 99)).toBeLessThan(0.001);
  });

  it("scatters the same way from the same seed", () => {
    const first = new ProjectilePool(1);
    const second = new ProjectilePool(1);
    const a = fire(first, CANNON, 7);
    const b = fire(second, CANNON, 7);
    expect(b?.velocityEast).toBe(a?.velocityEast);
  });

  it("empties completely when a fight ends", () => {
    const pool = new ProjectilePool(4);
    for (let index = 0; index < 4; index += 1) fire(pool, CANNON, index);
    pool.clear();
    expect(pool.live).toBe(0);
    expect(pool.active()).toHaveLength(0);
  });
});

describe("status effects", () => {
  const registry = createStatusRegistry();

  it("validates every shipped effect and refuses one that does nothing", () => {
    for (const status of STATUS_DEFINITIONS) expect(validateStatus(status)).toEqual([]);
    const inert = {
      ...registry.getOrThrow("status.burning"),
      damagePerTick: 0,
      movementScale: 1,
      damageOutputScale: 1,
      disables: false,
    };
    expect(validateStatus(inert).join(" ")).toMatch(/must do something/);
  });

  it("stacks up to its ceiling and refreshes past it", () => {
    const active: ActiveStatus[] = [];
    for (let index = 0; index < 6; index += 1) applyStatus(active, "status.bleeding", 100, 4);
    expect(active[0]?.stacks).toBe(4);
  });

  it("ticks damage per stack and ends on its own", () => {
    const active: ActiveStatus[] = [];
    applyStatus(active, "status.burning", 3, 3);
    applyStatus(active, "status.burning", 3, 3);
    const first = advanceStatuses(active, registry, false);
    expect(first.damage).toBeCloseTo(3.2 * 2, 5);
    advanceStatuses(active, registry, false);
    const last = advanceStatuses(active, registry, false);
    expect(last.ended).toContain("status.burning");
    expect(active).toHaveLength(0);
  });

  it("puts a fire out in the water and leaves a shock running", () => {
    const burning: ActiveStatus[] = [];
    applyStatus(burning, "status.burning", 300, 1);
    expect(advanceStatuses(burning, registry, true).ended).toContain("status.burning");

    const shocked: ActiveStatus[] = [];
    applyStatus(shocked, "status.shocked", 300, 1);
    const tick = advanceStatuses(shocked, registry, true);
    expect(tick.ended).toHaveLength(0);
    expect(tick.movementScale).toBeLessThan(1);
  });
});

describe("ability scoring", () => {
  it("refuses out of range, too close, and no lock, in words", () => {
    expect(scoreWeapon(SWORD, situation({ distanceMeters: 900 })).reason).toMatch(/Out of range/);
    expect(scoreWeapon(MORTAR, situation({ distanceMeters: 20 })).reason).toMatch(/Too close/);
    expect(scoreWeapon(MISSILE, situation({ hasLock: false })).reason).toMatch(/Needs a lock/);
    expect(scoreWeapon(MORTAR, situation({ distanceMeters: 20 })).score).toBe(0);
  });

  it("stops reaching for expensive answers when the machine is hot", () => {
    const cool = scoreWeapon(CASTER, situation({ selfHeatFraction: 0 }));
    const hot = scoreWeapon(CASTER, situation({ selfHeatFraction: 0.9 }));
    expect(hot.score).toBeLessThan(cool.score);
    expect(hot.reason).toMatch(/running hot/);
  });

  it("knows what water does to each weapon", () => {
    const whip = scoreWeapon(WHIP, situation({ underwater: true, distanceMeters: 150 }));
    const mortar = scoreWeapon(MORTAR, situation({ underwater: true, distanceMeters: 400 }));
    expect(whip.reason).toMatch(/better underwater/);
    expect(mortar.reason).toMatch(/poor underwater/);
    expect(mortar.score).toBeLessThan(whip.score);
  });

  it("will not fire something with friendly fire through an ally", () => {
    const clear = scoreWeapon(MORTAR, situation({ distanceMeters: 400 }));
    const blocked = scoreWeapon(MORTAR, situation({ distanceMeters: 400, alliesInLine: 1 }));
    expect(blocked.score).toBeLessThan(clear.score);
    expect(blocked.reason).toMatch(/allies in the line/);
    // The whip does not hurt allies, so it does not care.
    expect(scoreWeapon(WHIP, situation({ distanceMeters: 150, alliesInLine: 2 })).reason).not.toMatch(
      /allies/,
    );
  });

  it("ranks a loadout, and picks something different at different ranges", () => {
    const far = rankWeapons(WEAPONS.all(), situation({ distanceMeters: 800 }))[0];
    const close = rankWeapons(WEAPONS.all(), situation({ distanceMeters: 40 }))[0];
    expect(far?.weaponId).not.toBe(close?.weaponId);
    expect(far?.score).toBeGreaterThan(0);
    expect(close?.score).toBeGreaterThan(0);
  });

  it("finds weapons by tag rather than by name", () => {
    const signatures = weaponsWithTag(WEAPONS.all(), "signature");
    expect(signatures.map((weapon) => weapon.id)).toContain("weapon.plasma-caster");
    expect(signatures.length).toBeGreaterThan(2);
  });
});
