import type { ContentRegistry } from "../data/registry";
import {
  neutralCountermeasures,
  readTelegraph,
  resistedDuration,
  type CountermeasureProfile,
  type TelegraphReadout,
} from "../research/countermeasures";
import {
  COMBAT_TICK_SECONDS,
  moveLengthTicks,
  phaseAt,
  type CancelTag,
  type MoveDefinition,
} from "../data/moves";
import type { BodyZone, KaijuDefinition } from "../data/kaiju";
import type { JaegerDefinition } from "../data/jaegers";
import type { MachineGrowth } from "../jaegers/progression";
import {
  componentHealth,
  createComponentRegistry,
  type ComponentDefinition,
  type WeaponMount,
} from "../data/components";
import type { JaegerDamageState } from "../jaegers/damage";
import { InputBuffer } from "../jaegers/inputBuffer";
import { normalizeDegrees, signedDelta } from "../jaegers/locomotion";
import {
  OverlapHistory,
  placeVolume,
  sweepCapsuleAgainstSphere,
  type Capsule,
  type Point3,
  type TargetSphere,
} from "./hitVolumes";
import { resolveReaction, type ReactionDefinition } from "./reactions";
import {
  NO_COMBO,
  NO_DEFENSE,
  OPENING_TICKS,
  advanceDefense,
  beginDefense,
  expireCombo,
  isInvulnerable,
  registerHit,
  resolveDefense,
  type ComboState,
  type DefenseState,
} from "./defense";
import {
  NO_GRAPPLE,
  advanceGrapple,
  beginGrapple,
  checkGrapple,
  describeGrapple,
  releaseGrapple,
  slamTarget,
  throwTarget,
  type GrappleState,
} from "./grapple";
import {
  DEFAULT_FINISHER_SETTINGS,
  NO_FINISHER,
  OPEN_GROUND,
  advanceFinisher,
  beginFinisher,
  checkFinisher,
  type FinisherSettings,
  type FinisherState,
  type SpaceQuery,
} from "./finisher";
import { chargeScale, type DamageKind } from "../data/moves";
import { firesProjectiles, resolvesInstantly, type WeaponDefinition } from "../data/weapons";
import { ProjectilePool, spreadStream, type ProjectileTargets } from "./projectiles";
import {
  advanceStatuses,
  applyStatus,
  createStatusRegistry,
  type ActiveStatus,
  type StatusDefinition,
} from "./abilities";
import type { PropDefinition, PropInstance } from "../data/props";
import {
  nearestPlacedZone,
  placedZone,
  zoneAtPoint,
  zonePosition,
  type TargetingPose,
  type ZonePlacement,
} from "./targeting";

/**
 * The combat arena.
 *
 * One authoritative object holding every fighter, running on its own fixed tick,
 * with no Babylon, no DOM and no wall clock anywhere in it. Attacks are data,
 * hits are geometry, reactions are a shared table, and everything that happens
 * comes out as an event carrying enough detail to explain itself: which volume
 * connected, on which tick, against which body zone, with which packet.
 *
 * Both sides run the same code. A kaiju swinging a claw and a Jaeger throwing a
 * cross are the same function with different rows.
 */

export const FIGHTER_KINDS = ["jaeger", "kaiju"] as const;
export type FighterKind = (typeof FIGHTER_KINDS)[number];

/** Combat resources. Derived from a machine's own numbers, never hand-written per fighter. */
export interface CombatProfile {
  readonly staminaMax: number;
  readonly staminaRegenPerSecond: number;
  readonly heatMax: number;
  readonly heatDissipationPerSecond: number;
  /** Poise capacity. Enough poise damage inside a window staggers the fighter. */
  readonly poiseCapacity: number;
  readonly guardMax: number;
  readonly guardRegenPerSecond: number;
  /** Heat above this fraction locks out attacks until it comes back down. */
  readonly overheatFraction: number;
}

/**
 * A Jaeger's combat numbers, read off the machine rather than invented.
 *
 * Cooling capacity is already on every roster entry and is exactly the thing
 * that decides how long a machine can keep swinging, so it is what heat
 * dissipation is built from.
 */
export function combatProfileFor(jaeger: JaegerDefinition, growth?: MachineGrowth): CombatProfile {
  const mass = jaeger.massBudget;
  // Levels and rank arrive as multipliers on the numbers already derived here,
  // rather than as a second set of numbers layered on top. A machine that has
  // never been flown passes nothing and gets exactly what it always got.
  const heat = growth?.heat ?? 1;
  const structure = growth?.structure ?? 1;
  return {
    staminaMax: 100,
    staminaRegenPerSecond: 11,
    heatMax: 100,
    heatDissipationPerSecond: (6 + mass.coolingCapacity * 14) * heat,
    poiseCapacity: (90 + mass.massTons / 24) * structure * (growth?.poise ?? 1),
    guardMax: (120 + mass.massTons / 30) * structure,
    guardRegenPerSecond: 7 * heat,
    overheatFraction: 0.92,
  };
}

export function kaijuCombatProfile(kaiju: KaijuDefinition): CombatProfile {
  return {
    staminaMax: 100,
    staminaRegenPerSecond: 9,
    heatMax: 100,
    heatDissipationPerSecond: 12,
    poiseCapacity: kaiju.poise,
    guardMax: 0,
    guardRegenPerSecond: 0,
    overheatFraction: 1,
  };
}

/** A part with its own health, on either kind of fighter. */
export interface ZoneState {
  readonly id: string;
  readonly displayName: string;
  readonly maxHealth: number;
  health: number;
  readonly armor: number;
  readonly damageMultiplier: number;
  readonly onDestroyed: BodyZone["onDestroyed"];
  /** 0 to 1 of accumulated shock. Past one, the part stops working. */
  shock: number;
}

export interface FighterSpec {
  readonly id: string;
  readonly kind: FighterKind;
  readonly displayName: string;
  readonly heightMeters: number;
  readonly profile: CombatProfile;
  readonly pose: TargetingPose;
  readonly zones: readonly ZoneState[];
  /** Kaiju only: how the zones are laid out, so hits can be placed on them. */
  readonly kaiju?: KaijuDefinition;
  /**
   * Where this fighter's zones sit, for anything that is not a kaiju. A machine
   * built out of components carries one of these so a hit lands on an arm rather
   * than on "the machine".
   */
  readonly layout?: readonly ZonePlacement[];
  /** Fraction of core health at or below which a finisher becomes legal. */
  readonly finisherThreshold: number;
  /**
   * Multiplier on everything this fighter deals, from levels, rank, passives
   * and modules. Defaults to one, so a fighter with no progression behind it is
   * unaffected and every existing caller keeps its numbers.
   */
  readonly damageScale?: number;
}

interface ActiveAttack {
  readonly move: MoveDefinition;
  readonly startedTick: number;
  tick: number;
  connected: boolean;
  readonly history: OverlapHistory;
  /** Where each volume was last tick, so the sweep has somewhere to sweep from. */
  readonly lastPlacement: Map<string, Capsule>;
}

interface FighterState extends FighterSpec {
  pose: TargetingPose;
  stamina: number;
  heat: number;
  guard: number;
  guarding: boolean;
  poise: number;
  reaction: ReactionDefinition | null;
  reactionTicksLeft: number;
  attack: ActiveAttack | null;
  overheated: boolean;
  defeated: boolean;
  readonly buffer: InputBuffer;
  aimZoneId: string | null;
  knockbackMps: number;
  knockbackDirectionDeg: number;
  /** Defensive move running now: a dodge, a block or a parry. */
  defense: DefenseState;
  /** Hits landed in a row, for the interface and for nothing else. */
  combo: ComboState;
  /** A charge being held, with the ticks it has been held for. */
  charge: { readonly moveId: string; ticks: number } | null;
  /** Ticks this fighter is left open for after somebody timed a guard on them. */
  openingTicksLeft: number;
  /** Prop in hand, with what is left of it. */
  wielding: { readonly definition: PropDefinition; readonly instance: PropInstance } | null;
  grapple: GrappleState;
  finisher: FinisherState;
  finisherSettings: FinisherSettings;
  /** True while the player is holding the finisher input. */
  finisherHolding: boolean;
  /** Set for one tick when this fighter was hit, so a finisher can be interrupted. */
  hitThisTick: boolean;
  /** Weapons this fighter carries, with what is left in each. */
  readonly weapons: Map<string, WeaponState>;
  /** Status effects burning, shocking or corroding away on this fighter. */
  readonly statuses: ActiveStatus[];
  /** Reactor draw committed to a sustained weapon right now, megawatts. */
  channelDrawMw: number;
  /** Weapon being held down, or null. */
  channelWeaponId: string | null;
}

/** Everything that changes about a weapon while it is being used. */
export interface WeaponState {
  readonly weapon: WeaponDefinition;
  /** Rounds in the magazine. Weapons with no magazine sit at zero and ignore it. */
  magazine: number;
  reserve: number;
  cooldownTicksLeft: number;
  reloadTicksLeft: number;
  /** Rounds of a salvo still to leave the tube, and when the next one goes. */
  salvoLeft: number;
  salvoTicksLeft: number;
  /** Ticks this weapon has been held down, for sustained fire. */
  channelTicks: number;
  shotsFired: number;
}

export const COMBAT_EVENT_TYPES = [
  "attack-started",
  "attack-cancelled",
  "attack-rejected",
  "hit",
  "guarded",
  "whiffed",
  "evaded",
  "perfect-guard",
  "parried",
  "combo",
  "grapple-started",
  "grapple-ended",
  "finisher-started",
  "finisher-beat",
  "finisher-ended",
  "prop-taken",
  "prop-broken",
  "weapon-fired",
  "weapon-refused",
  "weapon-reloading",
  "weapon-reloaded",
  "weapon-dry",
  "projectile-hit",
  "projectile-refused",
  "status-applied",
  "status-ended",
  "reaction",
  "zone-destroyed",
  "defeated",
  "overheated",
  "recovered",
] as const;
export type CombatEventType = (typeof COMBAT_EVENT_TYPES)[number];

/**
 * Everything that happens, in enough detail to debug it.
 *
 * A hit says which volume, which zone, on which tick, with which packet and how
 * much actually got through the armour. That is the debug view's whole content,
 * and it exists as data rather than as a drawing.
 */
export interface CombatEvent {
  readonly tick: number;
  readonly type: CombatEventType;
  readonly actorId: string;
  readonly targetId: string | null;
  readonly moveId: string | null;
  readonly volumeId: string | null;
  readonly zoneId: string | null;
  readonly damage: number;
  readonly reaction: string | null;
  readonly contact: Point3 | null;
  /** Says why, for the events that are a refusal. */
  readonly reason: string | null;
  /** What kind of damage it was, so routing and scarring can read it. */
  readonly damageKind: DamageKind | null;
}

export type AttackRejection =
  | "no-ammo"
  | "reloading"
  | "weapon-cooling"
  | "out-of-range"
  | "too-close"
  | "needs-lock"
  | "no-weapon"
  | "grapple-refused"
  | "no-prop"
  | "no-space"
  | "already-attacking"
  | "not-cancellable"
  | "cancel-window-closed"
  | "cancel-needs-a-hit"
  | "no-stamina"
  | "overheated"
  | "no-control"
  | "defeated"
  | "unknown-move"
  | "finisher-not-open";

export type AttackRequest =
  | { readonly ok: true; readonly move: MoveDefinition; readonly cancelled: string | null }
  | { readonly ok: false; readonly reason: AttackRejection; readonly message: string };

export interface ArenaOptions {
  readonly moves: ContentRegistry<MoveDefinition>;
  readonly fighters: readonly FighterSpec[];
  /**
   * Where a body may legally stand. Injected, so the arena never reads terrain,
   * a city layout or a scene, and a test can hand it open ground.
   */
  readonly space?: SpaceQuery;
  /**
   * Ceiling on live projectiles. The pool is allocated once at this size and
   * never grows, so a barrage is refused rather than allowed to eat a frame.
   */
  readonly projectileCapacity?: number;
  /** Seed for spread, so a barrage is reproducible. */
  readonly seed?: number;
  /** Ground height for a point, used to retire rounds that hit the deck. */
  readonly groundHeight?: (east: number, north: number) => number | null;
  /** Which component carries which weapon mount. Injected so a test can vary it. */
  readonly components?: ContentRegistry<ComponentDefinition>;
  /**
   * What research has learned about fighting these things.
   *
   * Injected with a neutral default, so an arena built without one behaves
   * exactly as it always has. Nothing in here is a damage bonus: it shortens a
   * status the crews now know how to deal with, and it decides how much of a
   * wind-up the display is allowed to call.
   */
  readonly countermeasures?: CountermeasureProfile;
}

/** Turns a kaiju definition into fighter zones. */
export function kaijuZones(kaiju: KaijuDefinition): ZoneState[] {
  return kaiju.zones.map((zone) => ({
    id: zone.id,
    displayName: zone.displayName,
    maxHealth: zone.health,
    health: zone.health,
    armor: zone.armor,
    damageMultiplier: zone.damageMultiplier,
    onDestroyed: zone.onDestroyed,
    shock: 0,
  }));
}

/**
 * A Jaeger's zones, one per component.
 *
 * This is the whole difference between "the machine has 3,000 health" and "the
 * right arm is gone". Health comes from the machine's own damage record when one
 * is passed, so a machine that walked into the fight with a bent leg starts the
 * fight with a bent leg.
 */
export function jaegerZones(
  jaeger: JaegerDefinition,
  damage?: JaegerDamageState,
  registry: ContentRegistry<ComponentDefinition> = createComponentRegistry(),
  growth?: MachineGrowth,
): ZoneState[] {
  return registry.all().map((component) => {
    // Structure growth raises the ceiling rather than healing what is broken:
    // damage carried in is still carried in, it is just a smaller share of a
    // bigger component.
    const max = componentHealth(jaeger, component) * (growth?.structure ?? 1);
    const carried = damage?.components.find((entry) => entry.componentId === component.id);
    return {
      id: component.id,
      displayName: component.displayName,
      maxHealth: max,
      health: carried ? Math.min(max, Math.max(0, carried.health)) : max,
      armor: component.armor,
      damageMultiplier: component.damageMultiplier,
      // What losing it does is read from the table rather than switched on an id.
      onDestroyed: component.critical
        ? "kill"
        : component.disables.includes("movement")
          ? "cripple-movement"
          : component.mounts.length > 0
            ? "cripple-attack"
            : "none",
      shock: 0,
    };
  });
}

/** Where a machine's components sit, so hits can be placed on them. */
export function jaegerLayout(
  jaeger: JaegerDefinition,
  registry: ContentRegistry<ComponentDefinition> = createComponentRegistry(),
): ZonePlacement[] {
  const height = jaeger.locomotion.heightMeters;
  return registry.all().map((component) => ({
    id: component.id,
    heightFraction: component.heightFraction,
    forwardMeters: component.forwardFraction * height,
    lateralMeters: component.lateralFraction * height,
    radiusMeters: component.radiusFraction * height,
  }));
}

export class CombatArena {
  private readonly moves: ContentRegistry<MoveDefinition>;
  private readonly space: SpaceQuery;
  private readonly fighters = new Map<string, FighterState>();
  private readonly projectiles: ProjectilePool;
  private readonly statusRegistry: ContentRegistry<StatusDefinition>;
  /** Which component carries which mount. Read when a weapon is fired. */
  private readonly componentsRegistry: ContentRegistry<ComponentDefinition>;
  private readonly seedValue: number;
  private readonly groundHeight: (east: number, north: number) => number | null;
  /** What research knows. Neutral until something has been finished. */
  private countermeasures: CountermeasureProfile;
  private tickValue = 0;
  private readonly events: CombatEvent[] = [];
  /** How far the panel has already read. See `drain`. */
  private drainIndex = 0;

  constructor(options: ArenaOptions) {
    this.moves = options.moves;
    this.space = options.space ?? OPEN_GROUND;
    this.projectiles = new ProjectilePool(options.projectileCapacity ?? 96);
    this.statusRegistry = createStatusRegistry();
    this.seedValue = options.seed ?? 20260824;
    this.groundHeight = options.groundHeight ?? (() => null);
    this.componentsRegistry = options.components ?? createComponentRegistry();
    this.countermeasures = options.countermeasures ?? neutralCountermeasures();
    for (const spec of options.fighters) this.add(spec);
  }

  /**
   * Swaps in what research has learned.
   *
   * Called when a programme finishes mid-campaign, so the next fight is fought
   * with what was just learned rather than the one after the next reload.
   */
  setCountermeasures(profile: CountermeasureProfile): void {
    this.countermeasures = profile;
  }

  /**
   * What the display is allowed to say about wind-ups in progress.
   *
   * Empty without research, which is the fight everybody had before: a player
   * reads the animation. With the nervous system map it flags a commit; with the
   * behavioural model it names the move and marks what it is about to threaten.
   */
  telegraphs(): readonly (TelegraphReadout & { readonly fighterId: string })[] {
    const readouts: (TelegraphReadout & { readonly fighterId: string })[] = [];
    for (const fighter of this.fighters.values()) {
      const attack = fighter.attack;
      if (!attack) continue;
      const readout = readTelegraph(
        {
          moveDisplayName: attack.move.displayName,
          startupTicks: attack.move.startupTicks,
          ticksElapsed: attack.tick,
          threatenedZones: attack.move.volumes.map((volume) => volume.id),
        },
        this.countermeasures,
      );
      if (!readout.visible) continue;
      readouts.push({ ...readout, fighterId: fighter.id });
    }
    return readouts;
  }

  get tick(): number {
    return this.tickValue;
  }

  add(spec: FighterSpec): void {
    if (this.fighters.has(spec.id)) throw new Error(`Duplicate fighter id "${spec.id}"`);
    this.fighters.set(spec.id, {
      ...spec,
      pose: { ...spec.pose },
      stamina: spec.profile.staminaMax,
      heat: 0,
      guard: spec.profile.guardMax,
      guarding: false,
      poise: 0,
      reaction: null,
      reactionTicksLeft: 0,
      attack: null,
      overheated: false,
      defeated: false,
      buffer: new InputBuffer(),
      aimZoneId: null,
      knockbackMps: 0,
      knockbackDirectionDeg: 0,
      defense: NO_DEFENSE,
      combo: NO_COMBO,
      charge: null,
      openingTicksLeft: 0,
      wielding: null,
      grapple: NO_GRAPPLE,
      finisher: NO_FINISHER,
      finisherSettings: DEFAULT_FINISHER_SETTINGS,
      finisherHolding: false,
      hitThisTick: false,
      weapons: new Map(),
      statuses: [],
      channelDrawMw: 0,
      channelWeaponId: null,
    });
  }

  fighter(id: string): FighterState | undefined {
    return this.fighters.get(id);
  }

  ids(): readonly string[] {
    return [...this.fighters.keys()];
  }

  /** Records a press for the fighter, to be taken when it becomes legal. */
  press(fighterId: string, moveId: string): void {
    this.fighters.get(fighterId)?.buffer.press(moveId, this.tickValue);
  }

  setGuard(fighterId: string, guarding: boolean): void {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return;
    // Guard is defensive, so it is allowed out of anything that lists it as a
    // cancel, and always allowed when nothing is running.
    if (guarding && fighter.attack && !this.canCancelInto(fighter, "guard")) return;
    if (guarding && fighter.attack) {
      this.pushEvent({
        type: "attack-cancelled",
        actorId: fighter.id,
        moveId: fighter.attack.move.id,
        reason: "guard",
      });
      fighter.attack = null;
    }
    fighter.guarding = guarding && !fighter.defeated;
  }

  /**
   * Aims at a body zone.
   *
   * Without this a swing lands on whatever is biggest, which on something eighty
   * metres tall is always the torso. Aiming is what lets a pilot go for the core
   * and is the whole reason zone selection exists; the hit still has to reach
   * the zone, so aiming at a head does not make a low sweep hit one.
   */
  setAim(fighterId: string, zoneId: string | null): void {
    const fighter = this.fighters.get(fighterId);
    if (fighter) fighter.aimZoneId = zoneId;
  }

  /**
   * Starts holding a charge.
   *
   * The move does not come out until it is released, and the damage it does
   * scales with how long it was held. Charging is the only way a heavy attack
   * gets better rather than only slower.
   */
  beginCharge(fighterId: string, moveId: string): AttackRequest {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return reject("unknown-move", `No fighter "${fighterId}".`);
    const move = this.moves.get(moveId);
    if (!move || !(move.chargeTicks ?? 0)) {
      return reject("unknown-move", `"${moveId}" is not a move that can be charged.`);
    }
    const request = this.request(fighterId, moveId);
    if (!request.ok) return request;
    fighter.charge = { moveId, ticks: 0 };
    return request;
  }

  /** Releases a held charge, throwing the move at whatever charge it reached. */
  releaseCharge(fighterId: string): AttackRequest | null {
    const fighter = this.fighters.get(fighterId);
    if (!fighter || !fighter.charge) return null;
    const { moveId } = fighter.charge;
    const outcome = this.start(fighterId, moveId);
    fighter.charge = null;
    return outcome;
  }

  /** How far through a charge the fighter is, 0 to 1. */
  chargeProgress(fighterId: string): number {
    const fighter = this.fighters.get(fighterId);
    if (!fighter?.charge) return 0;
    const move = this.moves.get(fighter.charge.moveId);
    const ticks = move?.chargeTicks ?? 0;
    return ticks <= 0 ? 0 : Math.min(1, fighter.charge.ticks / ticks);
  }

  /** Picks up a prop lying nearby. Refuses when it is already held or out of reach. */
  takeProp(
    fighterId: string,
    definition: PropDefinition,
    instance: PropInstance,
    distanceMeters: number,
  ): AttackRequest {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return reject("unknown-move", `No fighter "${fighterId}".`);
    if (instance.heldBy !== null) return reject("no-prop", "Something else already has that.");
    if (distanceMeters > definition.reachMeters + fighter.heightMeters * 0.5) {
      return reject("no-prop", `Too far from the ${definition.displayName.toLowerCase()} to pick it up.`);
    }
    if (this.clearanceAt(fighter) < definition.clearanceMeters) {
      return reject("no-space", `No room to swing a ${definition.displayName.toLowerCase()} here.`);
    }
    instance.heldBy = fighterId;
    fighter.wielding = { definition, instance };
    this.pushEvent({ type: "prop-taken", actorId: fighterId, reason: definition.displayName });
    return { ok: true, move: this.moves.getOrThrow("env.swing.prop"), cancelled: null };
  }

  dropProp(fighterId: string): void {
    const fighter = this.fighters.get(fighterId);
    if (!fighter?.wielding) return;
    fighter.wielding.instance.heldBy = null;
    fighter.wielding = null;
  }

  /** Throws whoever is being held, if there is room for it. */
  grappleThrow(fighterId: string): string {
    return this.resolveGrapple(fighterId, throwTarget);
  }

  /** Slams whoever is being held into whatever is behind them. */
  grappleSlam(fighterId: string): string {
    return this.resolveGrapple(fighterId, slamTarget);
  }

  grappleRelease(fighterId: string): void {
    const fighter = this.fighters.get(fighterId);
    if (!fighter || fighter.grapple.phase !== "held") return;
    const victim = fighter.grapple.victimId ? this.fighters.get(fighter.grapple.victimId) : undefined;
    fighter.grapple = releaseGrapple(fighter.grapple);
    if (victim) victim.grapple = NO_GRAPPLE;
    this.pushEvent({
      type: "grapple-ended",
      actorId: fighterId,
      targetId: victim?.id ?? null,
      reason: describeGrapple(fighter.grapple),
    });
    fighter.grapple = NO_GRAPPLE;
  }

  setFinisherSettings(fighterId: string, settings: Partial<FinisherSettings>): FinisherSettings {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return DEFAULT_FINISHER_SETTINGS;
    fighter.finisherSettings = { ...fighter.finisherSettings, ...settings };
    return fighter.finisherSettings;
  }

  /** Whether the player is holding the finisher input. Checked every beat that asks. */
  setFinisherHold(fighterId: string, holding: boolean): void {
    const fighter = this.fighters.get(fighterId);
    if (fighter) fighter.finisherHolding = holding;
  }

  /** Gives a fighter a weapon, loaded. */
  equipWeapon(fighterId: string, weapon: WeaponDefinition): void {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return;
    fighter.weapons.set(weapon.id, {
      weapon,
      magazine: weapon.magazine,
      reserve: Math.max(0, weapon.reserve - weapon.magazine),
      cooldownTicksLeft: 0,
      reloadTicksLeft: 0,
      salvoLeft: 0,
      salvoTicksLeft: 0,
      channelTicks: 0,
      shotsFired: 0,
    });
  }

  weaponState(fighterId: string, weaponId: string): WeaponState | undefined {
    return this.fighters.get(fighterId)?.weapons.get(weaponId);
  }

  /**
   * Whether a weapon may be fired right now, and why not when it may not.
   *
   * Every reason is a sentence, because a weapon that silently does nothing is
   * indistinguishable from a bug.
   */
  checkWeapon(fighterId: string, weaponId: string): AttackRequest {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return reject("unknown-move", `No fighter "${fighterId}".`);
    const state = fighter.weapons.get(weaponId);
    if (!state) return reject("no-weapon", `${fighter.displayName} is not carrying that.`);
    const weapon = state.weapon;

    if (fighter.defeated) return reject("defeated", `${fighter.displayName} is out of the fight.`);
    if (fighter.reaction?.losesControl && fighter.reactionTicksLeft > 0) {
      return reject("no-control", `${fighter.displayName} is ${fighter.reaction.displayName.toLowerCase()}.`);
    }
    if (fighter.grapple.phase === "held" && fighter.grapple.victimId === fighter.id) {
      return reject("no-control", `${fighter.displayName} is being held.`);
    }
    // A weapon on a component that is gone is gone with it. This is the whole
    // point of localized damage: losing the right arm silences what was on it.
    const mount = this.mountedOn(fighter, weapon.mount);
    if (mount && mount.health <= 0) {
      return reject("no-weapon", `${weapon.displayName} went with the ${mount.displayName.toLowerCase()}.`);
    }
    if (state.reloadTicksLeft > 0) {
      return reject("reloading", `${weapon.displayName} is reloading.`);
    }
    if (state.cooldownTicksLeft > 0) {
      return reject("weapon-cooling", `${weapon.displayName} is not ready yet.`);
    }
    if (fighter.overheated) {
      return reject("overheated", `${fighter.displayName} is over temperature.`);
    }
    if (weapon.magazine > 0 && state.magazine <= 0) {
      return reject("no-ammo", `${weapon.displayName} is empty. Reload, or use something else.`);
    }

    const target = this.firstOpponent(fighterId);
    if (target) {
      const distance = Math.hypot(
        target.pose.east - fighter.pose.east,
        target.pose.north - fighter.pose.north,
      );
      if (distance > weapon.rangeMeters) {
        return reject(
          "out-of-range",
          `${Math.round(distance)} m is past the ${weapon.displayName.toLowerCase()}'s reach of ${weapon.rangeMeters} m.`,
        );
      }
      if (distance < weapon.minimumRangeMeters) {
        return reject(
          "too-close",
          `Too close for the ${weapon.displayName.toLowerCase()}: it needs ${weapon.minimumRangeMeters} m.`,
        );
      }
      if (weapon.aim === "forward-arc") {
        const bearing = normalizeDegrees(
          (Math.atan2(target.pose.east - fighter.pose.east, target.pose.north - fighter.pose.north) * 180) /
            Math.PI,
        );
        if (Math.abs(signedDelta(fighter.pose.yawDeg, bearing)) > 60) {
          return reject("out-of-range", `${weapon.displayName} only fires forward. Turn to face it.`);
        }
      }
    }
    if (weapon.aim === "locked-only" && !target) {
      return reject("needs-lock", `${weapon.displayName} needs a lock.`);
    }

    return { ok: true, move: this.moves.getOrThrow("melee.light.jab"), cancelled: null };
  }

  /**
   * Fires a weapon.
   *
   * Instant behaviours resolve here; anything that puts a body in the world goes
   * through the pool, and a salvo queues the rest of its rounds rather than
   * spawning them all on one tick.
   */
  fireWeapon(fighterId: string, weaponId: string): AttackRequest {
    const check = this.checkWeapon(fighterId, weaponId);
    const fighter = this.fighters.get(fighterId);
    const state = fighter?.weapons.get(weaponId);
    if (!fighter || !state) return check;
    if (!check.ok) {
      this.pushEvent({
        type: "weapon-refused",
        actorId: fighterId,
        moveId: weaponId,
        reason: check.message,
      });
      return check;
    }

    const weapon = state.weapon;
    state.cooldownTicksLeft = weapon.cooldownTicks;
    fighter.heat = Math.min(fighter.profile.heatMax, fighter.heat + weapon.heatCost);
    if (fighter.heat >= fighter.profile.heatMax * fighter.profile.overheatFraction) {
      fighter.overheated = true;
      this.pushEvent({ type: "overheated", actorId: fighterId, moveId: weaponId });
    }
    // Recoil pushes the machine back, which is what stops a heavy weapon being
    // free to fire while advancing.
    if (weapon.recoilMps > 0) {
      fighter.knockbackMps = Math.max(fighter.knockbackMps, weapon.recoilMps);
      fighter.knockbackDirectionDeg = normalizeDegrees(fighter.pose.yawDeg + 180);
    }
    if (weapon.behavior === "channel") {
      fighter.channelWeaponId = weaponId;
      fighter.channelDrawMw = weapon.reactorDrawMw;
      state.channelTicks = 0;
    }

    this.spendAmmunition(fighter, state);
    this.pushEvent({
      type: "weapon-fired",
      actorId: fighterId,
      moveId: weaponId,
      reason: `${weapon.displayName} fires.`,
    });

    if (resolvesInstantly(weapon)) {
      this.resolveInstantWeapon(fighter, weapon);
    } else if (firesProjectiles(weapon)) {
      state.salvoLeft = Math.max(1, weapon.salvoCount);
      state.salvoTicksLeft = 0;
    }
    return check;
  }

  /** Stops a sustained weapon. */
  releaseWeapon(fighterId: string): void {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return;
    fighter.channelWeaponId = null;
    fighter.channelDrawMw = 0;
  }

  /** Starts a reload. Refuses when there is nothing left to load. */
  reloadWeapon(fighterId: string, weaponId: string): AttackRequest {
    const fighter = this.fighters.get(fighterId);
    const state = fighter?.weapons.get(weaponId);
    if (!fighter || !state) return reject("no-weapon", "Not carrying that.");
    const weapon = state.weapon;
    if (weapon.magazine <= 0) return reject("no-weapon", `${weapon.displayName} has no magazine to reload.`);
    if (state.reserve <= 0) {
      return reject("no-ammo", `No ${weapon.displayName.toLowerCase()} rounds left at all.`);
    }
    if (state.magazine >= weapon.magazine) {
      return reject("no-ammo", `${weapon.displayName} is already full.`);
    }
    state.reloadTicksLeft = weapon.reloadTicks;
    this.pushEvent({ type: "weapon-reloading", actorId: fighterId, moveId: weaponId });
    return { ok: true, move: this.moves.getOrThrow("melee.light.jab"), cancelled: null };
  }

  /** Live projectiles, for the renderer and for the stress test. */
  /**
   * Damage straight onto one zone.
   *
   * The honest way for anything outside a swing to hurt a fighter: a hazard, a
   * scripted event, or a test that needs an arm gone without throwing punches
   * for a minute. It goes through the same destruction bookkeeping a fist does.
   */
  damageZone(fighterId: string, zoneId: string, amount: number, kind: DamageKind = "impact"): boolean {
    const fighter = this.fighters.get(fighterId);
    const zone = fighter?.zones.find((entry) => entry.id === zoneId);
    if (!fighter || !zone || amount <= 0) return false;
    const wasIntact = zone.health > 0;
    zone.health = Math.max(0, zone.health - amount);
    this.pushEvent({
      type: "hit",
      actorId: fighterId,
      targetId: fighterId,
      zoneId: zone.id,
      damage: Math.round(amount),
      reaction: "none",
      damageKind: kind,
      reason: "direct damage",
    });
    if (wasIntact && zone.health <= 0) {
      this.pushEvent({
        type: "zone-destroyed",
        actorId: fighterId,
        zoneId: zone.id,
        reason: zone.displayName,
      });
      if (zone.onDestroyed === "kill") {
        fighter.defeated = true;
        this.pushEvent({ type: "defeated", actorId: fighterId });
      }
    }
    return true;
  }

  projectilePool(): ProjectilePool {
    return this.projectiles;
  }

  moveTo(fighterId: string, pose: Partial<TargetingPose>): void {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return;
    fighter.pose = { ...fighter.pose, ...pose };
  }

  /**
   * Asks for a move. Refuses with a reason rather than silently doing nothing,
   * so an interface can grey a button and explain it in the same breath.
   */
  request(fighterId: string, moveId: string): AttackRequest {
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return reject("unknown-move", `No fighter "${fighterId}".`);
    if (fighter.defeated) return reject("defeated", `${fighter.displayName} is out of the fight.`);

    const move = this.moves.get(moveId);
    if (!move) return reject("unknown-move", `No move "${moveId}".`);

    if (fighter.reaction && fighter.reaction.losesControl && fighter.reactionTicksLeft > 0) {
      return reject("no-control", `${fighter.displayName} is ${fighter.reaction.displayName.toLowerCase()}.`);
    }
    // Something being held cannot swing. That is what being held means, and it
    // is what makes a grapple worth the commitment rather than a slow punch.
    if (fighter.grapple.phase === "held" && fighter.grapple.victimId === fighter.id) {
      return reject("no-control", `${fighter.displayName} is being held.`);
    }
    if (fighter.overheated) {
      return reject("overheated", `${fighter.displayName} is over temperature and cannot commit to a move.`);
    }
    if (fighter.stamina < move.staminaCost) {
      return reject(
        "no-stamina",
        `${move.displayName} needs ${move.staminaCost} stamina and ${Math.floor(fighter.stamina)} is left.`,
      );
    }

    if (move.kind === "finisher") {
      const target = this.firstOpponent(fighter.id);
      // A hold counts as an opening in its own right: something being held is
      // exactly as available as something reeling.
      const held = fighter.grapple.phase === "held" && fighter.grapple.victimId === target?.id;
      if (
        !target ||
        (!this.finisherOpen(target) && !(held && this.coreFraction(target) <= target.finisherThreshold))
      ) {
        return reject("finisher-not-open", `${move.displayName} needs a target that is already finished.`);
      }
      if (target) {
        const check = checkFinisher(
          move,
          fighter.finisher,
          {
            attackerEast: fighter.pose.east,
            attackerNorth: fighter.pose.north,
            targetEast: target.pose.east,
            targetNorth: target.pose.north,
          },
          this.space,
          fighter.heightMeters * 0.25,
        );
        if (!check.ok) return reject("no-space", check.message);
      }
    }

    // A move that needs something in hand is refused when there is nothing in
    // hand, rather than swinging an invisible crane.
    if (move.requiresPropTag) {
      const held = fighter.wielding;
      if (!held) {
        return reject("no-prop", `${move.displayName} needs something in hand. Pick something up first.`);
      }
      if (move.requiresPropTag !== "any" && held.definition.tag !== move.requiresPropTag) {
        return reject(
          "no-prop",
          `${move.displayName} needs a ${move.requiresPropTag}, and you are holding a ${held.definition.tag}.`,
        );
      }
    }

    if (move.grapple) {
      const target = this.firstOpponent(fighter.id);
      if (!target) return reject("grapple-refused", "Nothing to take hold of.");
      const check = checkGrapple({
        holderId: fighter.id,
        victimId: target.id,
        spec: move.grapple,
        distanceMeters: Math.hypot(
          target.pose.east - fighter.pose.east,
          target.pose.north - fighter.pose.north,
        ),
        victimHeld: target.grapple.phase === "held",
        victimDown: target.reaction?.id === "knockdown" && target.reactionTicksLeft > 0,
        massRatio: fighter.heightMeters / Math.max(1, target.heightMeters),
        clearanceMeters: this.clearanceAt(fighter),
      });
      if (!check.ok) return reject("grapple-refused", check.message);
    }

    let cancelled: string | null = null;
    if (fighter.attack) {
      const current = fighter.attack;
      const elapsed = current.tick;
      if (!current.move.cancelInto.includes(move.tag)) {
        return reject(
          "not-cancellable",
          `${current.move.displayName} does not cancel into ${move.displayName}.`,
        );
      }
      if (elapsed < current.move.cancelFromTick || elapsed > current.move.cancelToTick) {
        return reject(
          "cancel-window-closed",
          `${current.move.displayName} can only cancel between ticks ${current.move.cancelFromTick} and ${current.move.cancelToTick}; it is at ${elapsed}.`,
        );
      }
      if (current.move.cancelRequiresHit && !current.connected) {
        return reject("cancel-needs-a-hit", `${current.move.displayName} has to land before it cancels.`);
      }
      cancelled = current.move.id;
    }

    return { ok: true, move, cancelled };
  }

  /** Places a move, refusing the same way `request` does. */
  start(fighterId: string, moveId: string): AttackRequest {
    const outcome = this.request(fighterId, moveId);
    const fighter = this.fighters.get(fighterId);
    if (!fighter) return outcome;
    if (!outcome.ok) {
      this.pushEvent({
        type: "attack-rejected",
        actorId: fighterId,
        moveId,
        reason: outcome.message,
      });
      return outcome;
    }

    if (outcome.cancelled) {
      this.pushEvent({
        type: "attack-cancelled",
        actorId: fighterId,
        moveId: outcome.cancelled,
        reason: `cancelled into ${outcome.move.id}`,
      });
    }

    fighter.attack = {
      move: outcome.move,
      startedTick: this.tickValue,
      tick: 0,
      connected: false,
      history: new OverlapHistory(),
      lastPlacement: new Map(),
    };
    // A defensive move puts the fighter into its own window rather than being
    // resolved as an attack that happens to do nothing.
    fighter.defense = outcome.move.defense ? beginDefense(outcome.move) : NO_DEFENSE;
    if (outcome.move.defense?.kind === "dodge") {
      // The step carries the machine sideways, which is the whole move.
      const radians = ((fighter.pose.yawDeg + 90) * Math.PI) / 180;
      const distance = outcome.move.defense.travelMeters;
      const east = fighter.pose.east + Math.sin(radians) * distance;
      const north = fighter.pose.north + Math.cos(radians) * distance;
      // A dodge into a building is a dodge that does not move: the frames still
      // happen, the travel does not.
      if (this.space.isClear(east, north, fighter.heightMeters * 0.25)) {
        fighter.pose = { ...fighter.pose, east, north };
      }
    }
    if (outcome.move.finisher) {
      const target = this.firstOpponent(fighter.id);
      if (target) {
        fighter.finisher = beginFinisher(outcome.move, fighter.id, target.id, fighter.finisherSettings);
        this.pushEvent({
          type: "finisher-started",
          actorId: fighter.id,
          targetId: target.id,
          moveId: outcome.move.id,
          reason: fighter.finisherSettings.skipSequences ? "skipped" : "running",
        });
        if (fighter.finisher.phase === "skipped") this.settleFinisher(fighter);
      }
    }
    fighter.guarding = false;
    fighter.stamina -= outcome.move.staminaCost;
    fighter.heat = Math.min(fighter.profile.heatMax, fighter.heat + outcome.move.heatCost);
    if (fighter.heat >= fighter.profile.heatMax * fighter.profile.overheatFraction) {
      fighter.overheated = true;
      this.pushEvent({ type: "overheated", actorId: fighterId, moveId: outcome.move.id });
    }
    this.pushEvent({ type: "attack-started", actorId: fighterId, moveId: outcome.move.id });
    return outcome;
  }

  /**
   * Advances one combat tick.
   *
   * Order matters and is fixed: buffered presses first, so an input made a
   * moment early takes effect the instant it becomes legal; then movement from
   * attack curves; then hit detection; then resources and reaction timers.
   */
  step(): readonly CombatEvent[] {
    const start = this.events.length;

    for (const fighter of this.fighters.values()) fighter.hitThisTick = false;
    for (const fighter of this.fighters.values()) this.consumeBuffer(fighter);
    for (const fighter of this.fighters.values()) this.advanceMovement(fighter);
    for (const fighter of this.fighters.values()) this.resolveHits(fighter);
    for (const fighter of this.fighters.values()) this.advanceHolds(fighter);
    for (const fighter of this.fighters.values()) this.advanceWeapons(fighter);
    this.advanceProjectiles();
    for (const fighter of this.fighters.values()) this.advanceStatusEffects(fighter);
    for (const fighter of this.fighters.values()) this.advanceResources(fighter);

    this.tickValue += 1;
    return this.events.slice(start);
  }

  /** Runs a number of ticks and returns everything that happened. */
  run(ticks: number): readonly CombatEvent[] {
    const start = this.events.length;
    for (let index = 0; index < ticks; index += 1) this.step();
    return this.events.slice(start);
  }

  log(): readonly CombatEvent[] {
    return this.events;
  }

  /**
   * Everything that has happened since the last drain.
   *
   * A step can only report what a step produced, and firing a weapon happens
   * between steps: pressing a trigger, a reload and an immediate refusal all
   * land here. Anything showing the player what happened reads this rather than
   * the return of `step`, so a shot cannot go missing from the log it caused.
   */
  drain(): readonly CombatEvent[] {
    const since = this.drainIndex;
    this.drainIndex = this.events.length;
    return this.events.slice(since);
  }

  private consumeBuffer(fighter: FighterState): void {
    if (fighter.defeated) return;
    const press = fighter.buffer.consume((moveId) => this.request(fighter.id, moveId).ok, this.tickValue);
    if (press) this.start(fighter.id, press.action);
  }

  private advanceMovement(fighter: FighterState): void {
    // Knockback carries whether or not the fighter is in control of itself.
    if (fighter.knockbackMps > 0) {
      const radians = (fighter.knockbackDirectionDeg * Math.PI) / 180;
      const distance = fighter.knockbackMps * COMBAT_TICK_SECONDS;
      fighter.pose = {
        ...fighter.pose,
        east: fighter.pose.east + Math.sin(radians) * distance,
        north: fighter.pose.north + Math.cos(radians) * distance,
      };
      fighter.knockbackMps = Math.max(0, fighter.knockbackMps - 28 * COMBAT_TICK_SECONDS);
    }

    const attack = fighter.attack;
    if (!attack) return;
    const curve = attack.move.movement;
    if (attack.tick >= curve.fromTick && attack.tick <= curve.toTick && curve.forwardMps !== 0) {
      const radians = (fighter.pose.yawDeg * Math.PI) / 180;
      const distance = curve.forwardMps * COMBAT_TICK_SECONDS;
      fighter.pose = {
        ...fighter.pose,
        east: fighter.pose.east + Math.sin(radians) * distance,
        north: fighter.pose.north + Math.cos(radians) * distance,
      };
    }
  }

  private resolveHits(fighter: FighterState): void {
    const attack = fighter.attack;
    if (!attack) return;

    const phase = phaseAt(attack.move, attack.tick);
    if (phase === "done") {
      this.finishAttack(fighter, attack);
      return;
    }

    if (phase === "active") {
      const activeTick = attack.tick - attack.move.startupTicks;
      for (const spec of attack.move.volumes) {
        if (activeTick < spec.activeFromTick || activeTick > spec.activeToTick) continue;
        const window = Math.max(1, spec.activeToTick - spec.activeFromTick);
        const progress = (activeTick - spec.activeFromTick) / window;
        const now = placeVolume(spec, fighter.pose, fighter.heightMeters, progress);
        const before = attack.lastPlacement.get(spec.id) ?? now;
        attack.lastPlacement.set(spec.id, now);

        for (const target of this.fighters.values()) {
          if (target.id === fighter.id || target.defeated) continue;
          const spheres = this.targetSpheres(target);
          for (const sphere of spheres) {
            if (!attack.history.has(spec.id, target.id)) {
              const result = sweepCapsuleAgainstSphere(before, now, sphere, sphere);
              if (!result.hit) continue;
              if (!attack.history.register(spec.id, target.id)) continue;
              attack.connected = true;
              this.applyHit(fighter, target, attack, spec.id, result.contact);
              break;
            }
          }
        }
      }
    }

    attack.tick += 1;
    if (attack.tick >= moveLengthTicks(attack.move)) this.finishAttack(fighter, attack);
  }

  /**
   * Ends an attack, reporting a miss as a miss.
   *
   * A whiff is information: it is the half of the log that explains why a
   * cancel was refused, and the cue presentation plays when a fist goes past
   * something rather than through it.
   */
  private finishAttack(fighter: FighterState, attack: ActiveAttack): void {
    if (!attack.connected) {
      this.pushEvent({
        type: "whiffed",
        actorId: fighter.id,
        moveId: attack.move.id,
        reason: attack.move.cues.whiff,
      });
    }
    fighter.attack = null;
  }

  private targetSpheres(target: FighterState): TargetSphere[] {
    if (target.kaiju) {
      return target.kaiju.zones.map((zone) => ({
        id: zone.id,
        centre: zonePosition(target.kaiju as KaijuDefinition, zone, target.pose),
        radiusMeters: zone.radiusMeters,
      }));
    }
    if (target.layout && target.layout.length > 0) {
      return target.layout.map((zone) => ({
        id: zone.id,
        centre: placedZone(target.heightMeters, zone, target.pose),
        radiusMeters: zone.radiusMeters,
      }));
    }
    // A fighter with no layout at all is one body-sized sphere at chest height.
    return [
      {
        id: "core",
        centre: {
          east: target.pose.east,
          north: target.pose.north,
          up: target.pose.up + target.heightMeters * 0.55,
        },
        radiusMeters: target.heightMeters * 0.22,
      },
    ];
  }

  private applyHit(
    attacker: FighterState,
    target: FighterState,
    attack: ActiveAttack,
    volumeId: string,
    contact: Point3,
  ): void {
    const packet = attack.move.damage;
    const zonePick = target.kaiju ? zoneAtPoint(target.kaiju, target.pose, contact) : null;
    const placedPick =
      !target.kaiju && target.layout
        ? nearestPlacedZone(target.heightMeters, target.layout, target.pose, contact)
        : null;
    let zoneId = zonePick?.zone.id ?? placedPick?.zone.id ?? target.zones[0]?.id ?? "core";

    // An aimed zone wins if the blow actually reached it. The reach allowance is
    // generous, because a pilot aiming for the core and connecting with the
    // chest plate has hit what they were aiming at.
    if (attacker.aimZoneId && !target.kaiju && target.layout) {
      const aimed = target.layout.find((entry) => entry.id === attacker.aimZoneId);
      if (aimed) {
        const centre = placedZone(target.heightMeters, aimed, target.pose);
        const reach = Math.hypot(
          centre.east - contact.east,
          centre.up - contact.up,
          centre.north - contact.north,
        );
        const allowance = Math.max(aimed.radiusMeters * 3, target.heightMeters * 0.35);
        if (reach <= allowance) zoneId = aimed.id;
      }
    }
    if (attacker.aimZoneId && target.kaiju) {
      const aimed = target.kaiju.zones.find((entry) => entry.id === attacker.aimZoneId);
      if (aimed) {
        const centre = zonePosition(target.kaiju, aimed, target.pose);
        const reach = Math.hypot(
          centre.east - contact.east,
          centre.up - contact.up,
          centre.north - contact.north,
        );
        // Generous on purpose, and scaled by how big the creature is: an
        // overhead hammer aimed at the core connects with the chest plate above
        // it, and calling that a torso hit would make aiming pointless against
        // exactly the targets it exists for.
        const allowance = Math.max(aimed.radiusMeters * 3, target.heightMeters * 0.35);
        if (reach <= allowance) zoneId = aimed.id;
      }
    }
    let zone = target.zones.find((entry) => entry.id === zoneId) ?? target.zones[0];
    // A zone that is already gone cannot absorb anything. Hits fall through to
    // whatever is behind it, which is why taking a creature's armour apart is
    // worth doing rather than only cosmetic: once the plate is off, everything
    // lands on the thing that matters.
    if (zone && zone.health <= 0) {
      const core = target.zones.find((entry) => entry.onDestroyed === "kill" && entry.health > 0);
      zone = core ?? zone;
    }

    // Defence first. A dodge with live frames means nothing happened at all,
    // which is the only outcome in the game that produces no damage anywhere.
    const defence = resolveDefense(target.defense, target.guarding);
    if (defence.outcome === "evaded" || isInvulnerable(target.defense)) {
      this.pushEvent({
        type: "evaded",
        actorId: target.id,
        targetId: attacker.id,
        moveId: attack.move.id,
        volumeId,
        reason: defence.coaching || "Clean evade.",
        contact,
      });
      return;
    }

    const outcome = resolveReaction(packet, {
      poiseAccumulated: target.poise,
      poiseCapacity: target.profile.poiseCapacity,
      guardRemaining: target.guarding ? target.guard : null,
      alreadyReeling: target.reactionTicksLeft > 0,
      coreHealthFraction: this.coreFraction(target),
      finisherThreshold: target.finisherThreshold,
    });

    target.poise = outcome.poiseAccumulated;
    if (outcome.guardRemaining !== null) target.guard = outcome.guardRemaining;
    if (outcome.guardBroken) target.guarding = false;

    // Guarded damage still hurts, it just hurts much less. A guard that made a
    // fighter invulnerable would end the fight rather than shape it.
    // Guarding, blocking and a perfect answer are three different things. The
    // defence resolution owns the difference; the guard flag is only the fallback.
    const perfect = defence.outcome === "perfect" || defence.outcome === "parried";
    const guardFactor = perfect
      ? 0
      : defence.outcome === "blocked"
        ? defence.damageScale
        : target.guarding && !outcome.guardBroken
          ? 0.25
          : defence.damageScale;

    // A prop in hand and a held charge both scale what lands. Both are the
    // attacker's own doing, so they multiply the packet rather than the target's
    // armour.
    const propScale = attacker.wielding?.definition.damageScale ?? 1;
    const chargeHeld = attacker.charge?.ticks ?? 0;
    const chargeMultiplier = chargeScale(attack.move, chargeHeld);
    let dealt = 0;
    const wasIntact = zone ? zone.health > 0 : false;
    if (zone) {
      const throughArmor =
        packet.amount *
        (1 - zone.armor) *
        zone.damageMultiplier *
        guardFactor *
        propScale *
        chargeMultiplier *
        (attacker.damageScale ?? 1);
      dealt = Math.max(0, throughArmor);
      zone.health = Math.max(0, zone.health - dealt);
      zone.shock = Math.min(1, zone.shock + packet.componentShock * guardFactor);
    }

    if (perfect) {
      // Whoever timed it gets the opening, and the attacker eats the recovery.
      attacker.openingTicksLeft = OPENING_TICKS;
      attacker.attack = null;
      this.pushEvent({
        type: defence.outcome === "parried" ? "parried" : "perfect-guard",
        actorId: target.id,
        targetId: attacker.id,
        moveId: attack.move.id,
        volumeId,
        reason: defence.coaching,
        contact,
      });
      target.defense = NO_DEFENSE;
      if (defence.counterMoveId) {
        // A parry answers for free, so the counter steps outside the cancel
        // rules: the parry's own recovery is cleared first. Leaving it in place
        // meant the arena refused the counter the parry had just promised.
        target.attack = null;
        this.start(target.id, defence.counterMoveId);
      }
      return;
    }

    target.hitThisTick = true;
    attacker.combo = registerHit(attacker.combo, this.tickValue);

    // A seize takes hold when it connects, not when it is thrown. The attack is
    // over at that point and the hold takes its place, which is what lets a
    // finisher come straight out of a grapple rather than being refused as a
    // cancel out of a move that is technically still running.
    if (attack.move.grapple && target.grapple.phase !== "held") {
      attacker.grapple = beginGrapple(
        {
          holderId: attacker.id,
          victimId: target.id,
          spec: attack.move.grapple,
          distanceMeters: 0,
          victimHeld: false,
          victimDown: false,
          massRatio: 1,
          clearanceMeters: this.clearanceAt(attacker),
        },
        attack.move.id,
      );
      target.grapple = { ...attacker.grapple };
      attacker.attack = null;
      this.pushEvent({
        type: "grapple-started",
        actorId: attacker.id,
        targetId: target.id,
        moveId: attack.move.id,
        reason: describeGrapple(attacker.grapple),
      });
    }
    if (attacker.combo.hits > 1) {
      this.pushEvent({
        type: "combo",
        actorId: attacker.id,
        targetId: target.id,
        damage: attacker.combo.hits,
        reason: `${attacker.combo.hits} in a row`,
      });
    }

    // A prop wears out on the swings that connect, not on the ones that miss.
    if (attacker.wielding && attacker.wielding.definition.swingsBeforeBreaking > 0) {
      attacker.wielding.instance.swingsLeft -= 1;
      if (attacker.wielding.instance.swingsLeft <= 0) {
        this.pushEvent({
          type: "prop-broken",
          actorId: attacker.id,
          reason: attacker.wielding.definition.displayName,
        });
        attacker.wielding.instance.heldBy = null;
        attacker.wielding = null;
      }
    }

    this.pushEvent({
      type: target.guarding && !outcome.guardBroken ? "guarded" : "hit",
      actorId: attacker.id,
      targetId: target.id,
      moveId: attack.move.id,
      volumeId,
      zoneId: zone?.id ?? null,
      damage: Math.round(dealt),
      reaction: outcome.reaction.id,
      contact,
      damageKind: packet.kind,
    });

    if (outcome.reaction.durationTicks > 0) {
      target.reaction = outcome.reaction;
      target.reactionTicksLeft = outcome.reaction.durationTicks;
      if (outcome.reaction.losesControl) target.attack = null;
      target.knockbackMps = outcome.knockbackMps;
      target.knockbackDirectionDeg = normalizeDegrees(
        (Math.atan2(target.pose.east - attacker.pose.east, target.pose.north - attacker.pose.north) * 180) /
          Math.PI,
      );
      this.pushEvent({
        type: "reaction",
        actorId: target.id,
        targetId: attacker.id,
        moveId: attack.move.id,
        reaction: outcome.reaction.id,
        zoneId: zone?.id ?? null,
      });
    }

    // Only on the crossing. A zone that is already gone would otherwise report
    // itself destroyed again on every hit that lands anywhere near it.
    if (zone && wasIntact && zone.health <= 0) {
      this.pushEvent({
        type: "zone-destroyed",
        actorId: target.id,
        targetId: attacker.id,
        zoneId: zone.id,
        reason: zone.onDestroyed,
      });
      if (zone.onDestroyed === "kill") {
        target.defeated = true;
        target.attack = null;
        this.pushEvent({ type: "defeated", actorId: target.id, targetId: attacker.id });
      }
    }
  }

  /**
   * Everything that runs alongside an attack: defensive windows, charges, holds
   * and finisher beats. Split out so `step` reads as an order of operations
   * rather than as one long function.
   */
  private advanceHolds(fighter: FighterState): void {
    if (fighter.defense.spec) {
      fighter.defense = advanceDefense(fighter.defense);
      // A defensive window closes when its move ends; the recovery is the
      // attack state's business, which is what stops a dodge being free.
      if (!fighter.attack) fighter.defense = NO_DEFENSE;
    }
    fighter.combo = expireCombo(fighter.combo, this.tickValue);
    if (fighter.openingTicksLeft > 0) fighter.openingTicksLeft -= 1;
    if (fighter.charge) fighter.charge.ticks += 1;

    if (fighter.grapple.phase === "held" && fighter.grapple.holderId === fighter.id) {
      const victim = fighter.grapple.victimId ? this.fighters.get(fighter.grapple.victimId) : undefined;
      const before = fighter.grapple;
      fighter.grapple = advanceGrapple(fighter.grapple, {
        // A victim with poise left fights harder; one that is reeling barely does.
        victimEffort: victim ? (victim.reactionTicksLeft > 0 ? 0.25 : 0.85) : 0,
        holderGrip: fighter.reactionTicksLeft > 0 ? 0.3 : 1,
        holderInterrupted: fighter.hitThisTick && fighter.reactionTicksLeft > 0,
      });
      if (victim) victim.grapple = { ...fighter.grapple };
      if (before.phase === "held" && fighter.grapple.phase !== "held") {
        this.pushEvent({
          type: "grapple-ended",
          actorId: fighter.id,
          targetId: victim?.id ?? null,
          reason: describeGrapple(fighter.grapple),
        });
        fighter.grapple = NO_GRAPPLE;
        if (victim) victim.grapple = NO_GRAPPLE;
      }
    }

    if (fighter.finisher.phase === "running") {
      const step = advanceFinisher(fighter.finisher, {
        holding: fighter.finisherSettings.holdToComplete ? fighter.finisherHolding : fighter.finisherHolding,
        attackerHit: fighter.hitThisTick,
        settings: fighter.finisherSettings,
      });
      const beatChanged = step.state.beatIndex !== fighter.finisher.beatIndex;
      fighter.finisher = step.state;
      if (beatChanged && !step.finished) {
        this.pushEvent({
          type: "finisher-beat",
          actorId: fighter.id,
          targetId: fighter.finisher.targetId,
          reason: fighter.finisher.camera ?? "",
        });
      }
      if (step.damage > 0) this.applyGuaranteedDamage(fighter, Math.round(step.damage));
      if (step.finished) {
        this.pushEvent({
          type: "finisher-ended",
          actorId: fighter.id,
          targetId: fighter.finisher.targetId,
          reason: step.coaching || fighter.finisher.phase,
        });
        fighter.finisher = NO_FINISHER;
      }
    }
  }

  /**
   * Damage a finisher promised, applied to the zone that decides the fight.
   *
   * Guaranteed means guaranteed: it does not go through armour, a guard or a
   * reaction, because the sequence that earned it already answered all three.
   */
  private applyGuaranteedDamage(attacker: FighterState, amount: number): void {
    const targetId = attacker.finisher.targetId;
    const target = targetId ? this.fighters.get(targetId) : undefined;
    if (!target) return;
    this.damageKillZone(attacker, target, amount, attacker.finisher.moveId, "finisher");
  }

  /**
   * Damage straight to the zone that decides the fight, with the bookkeeping.
   *
   * Finishers and grapple impacts both bypass armour and reactions, and both
   * have to go through the same destruction and defeat checks. Reducing a zone's
   * health without them left a creature at zero core health still fighting.
   */
  private damageKillZone(
    attacker: FighterState,
    target: FighterState,
    amount: number,
    moveId: string | null,
    reason: string,
  ): void {
    if (amount <= 0) return;
    const zone = target.zones.find((entry) => entry.onDestroyed === "kill") ?? target.zones[0];
    if (!zone) return;
    const wasIntact = zone.health > 0;
    zone.health = Math.max(0, zone.health - amount);
    this.pushEvent({
      type: "hit",
      actorId: attacker.id,
      targetId: target.id,
      moveId,
      zoneId: zone.id,
      damage: amount,
      reaction: "none",
      // A finisher or a slam is crushing force, whatever the move that led to it.
      damageKind: "crush",
      reason,
    });
    if (wasIntact && zone.health <= 0) {
      this.pushEvent({
        type: "zone-destroyed",
        actorId: target.id,
        targetId: attacker.id,
        zoneId: zone.id,
        reason: zone.onDestroyed,
      });
      if (zone.onDestroyed === "kill") {
        target.defeated = true;
        target.attack = null;
        this.pushEvent({ type: "defeated", actorId: target.id, targetId: attacker.id });
      }
    }
  }

  /** Applies a skipped finisher's outcome at once. */
  private settleFinisher(fighter: FighterState): void {
    const damage = Math.round(fighter.finisher.earnedDamage);
    this.applyGuaranteedDamage(fighter, damage);
    this.pushEvent({
      type: "finisher-ended",
      actorId: fighter.id,
      targetId: fighter.finisher.targetId,
      damage,
      reason: "skipped",
    });
    fighter.finisher = NO_FINISHER;
  }

  /** Shared body for a throw and a slam: both resolve a hold into a position. */
  private resolveGrapple(fighterId: string, resolver: typeof throwTarget): string {
    const fighter = this.fighters.get(fighterId);
    if (!fighter || fighter.grapple.phase !== "held") return "Nothing in hand.";
    const victim = fighter.grapple.victimId ? this.fighters.get(fighter.grapple.victimId) : undefined;
    if (!victim) return "Nothing in hand.";

    const result = resolver({
      state: fighter.grapple,
      holderEast: fighter.pose.east,
      holderNorth: fighter.pose.north,
      holderYawDeg: fighter.pose.yawDeg,
      isClear: (east, north, radius) => this.space.isClear(east, north, radius),
      victimRadiusMeters: victim.heightMeters * 0.25,
    });

    if (result.thrown) {
      victim.pose = { ...victim.pose, east: result.east, north: result.north };
      // A throw or a slam is a knockdown wherever it lands.
      const reaction = reactionFor(result.state.outcome);
      victim.reaction = null;
      victim.reactionTicksLeft = 0;
      const zone = victim.zones.find((entry) => entry.onDestroyed === "kill") ?? victim.zones[0];
      // A slam into a standing structure is the single hardest thing in the game,
      // and a throw is not far behind: both are the machine's whole mass arriving
      // at once, which is why a grapple route is worth taking at all.
      const impact = result.state.outcome === "slammed" ? 900 : 620;
      void zone;
      this.damageKillZone(fighter, victim, impact, fighter.grapple.moveId, result.message);
      this.pushEvent({
        type: "reaction",
        actorId: victim.id,
        targetId: fighter.id,
        moveId: fighter.grapple.moveId,
        reaction,
        reason: result.message,
      });
    }

    // A refusal is not an ending. A slam with nothing solid behind the victim
    // fails safely and leaves the hold exactly as it was, so the player can
    // throw instead; dropping the hold on a refused slam threw away the whole
    // commitment for free.
    if (!result.thrown && result.state.outcome === null) return result.message;

    this.pushEvent({
      type: "grapple-ended",
      actorId: fighter.id,
      targetId: victim.id,
      reason: result.message,
    });
    fighter.grapple = NO_GRAPPLE;
    victim.grapple = NO_GRAPPLE;
    return result.message;
  }

  private clearanceAt(fighter: FighterState): number {
    // Probe outward until something is in the way. Cheap, deterministic, and it
    // answers the only question a grapple or a prop swing actually has.
    const steps = [20, 40, 60, 80, 110];
    let clear = 0;
    for (const distance of steps) {
      const radians = (fighter.pose.yawDeg * Math.PI) / 180;
      const east = fighter.pose.east + Math.sin(radians) * distance;
      const north = fighter.pose.north + Math.cos(radians) * distance;
      if (!this.space.isClear(east, north, fighter.heightMeters * 0.25)) break;
      if (!this.space.inLoadedWorld(east, north)) break;
      clear = distance;
    }
    return clear;
  }

  /**
   * Weapons, tick by tick: cooldowns, reloads, the rest of a salvo, and the
   * running cost of anything being held down.
   */
  private advanceWeapons(fighter: FighterState): void {
    for (const state of fighter.weapons.values()) {
      if (state.cooldownTicksLeft > 0) state.cooldownTicksLeft -= 1;
      if (state.reloadTicksLeft > 0) {
        state.reloadTicksLeft -= 1;
        if (state.reloadTicksLeft === 0) {
          const wanted = state.weapon.magazine - state.magazine;
          const loaded = Math.min(wanted, state.reserve);
          state.magazine += loaded;
          state.reserve -= loaded;
          this.pushEvent({
            type: "weapon-reloaded",
            actorId: fighter.id,
            moveId: state.weapon.id,
            damage: state.magazine,
          });
        }
      }

      // The rest of a salvo leaves the tube over the next few ticks rather than
      // all at once, which is what makes a salvo readable in the air.
      if (state.salvoLeft > 0) {
        if (state.salvoTicksLeft > 0) {
          state.salvoTicksLeft -= 1;
        } else {
          this.launchProjectile(fighter, state.weapon, state.weapon.salvoCount - state.salvoLeft);
          state.salvoLeft -= 1;
          state.salvoTicksLeft = state.weapon.salvoIntervalTicks;
        }
      }
    }

    // A sustained weapon spends while it runs and stops when it cannot pay.
    const channelId = fighter.channelWeaponId;
    if (channelId) {
      const state = fighter.weapons.get(channelId);
      if (!state) {
        fighter.channelWeaponId = null;
      } else {
        state.channelTicks += 1;
        fighter.heat = Math.min(fighter.profile.heatMax, fighter.heat + state.weapon.heatCost);
        if (fighter.heat >= fighter.profile.heatMax * fighter.profile.overheatFraction) {
          fighter.overheated = true;
          fighter.channelWeaponId = null;
          fighter.channelDrawMw = 0;
          this.pushEvent({ type: "overheated", actorId: fighter.id, moveId: channelId });
        } else {
          this.resolveInstantWeapon(fighter, state.weapon);
        }
      }
    }
  }

  /** Puts one round of a weapon in the world. */
  private launchProjectile(fighter: FighterState, weapon: WeaponDefinition, shotIndex: number): void {
    const target = this.firstOpponent(fighter.id);
    const spawned = this.projectiles.spawn({
      weapon,
      ownerId: fighter.id,
      targetId: target?.id ?? null,
      east: fighter.pose.east,
      north: fighter.pose.north,
      up: fighter.pose.up + fighter.heightMeters * 0.6,
      yawDeg: fighter.pose.yawDeg,
      pitchDeg: 0,
      shotIndex,
      rng: spreadStream(this.seedValue + this.tickValue + shotIndex, weapon.id),
    });
    if (!spawned) {
      // A refused shot is reported rather than swallowed: a weapon quietly
      // firing nothing because a pool was full is the worst kind of bug.
      this.pushEvent({
        type: "projectile-refused",
        actorId: fighter.id,
        moveId: weapon.id,
        reason: "Too many rounds in the air already. Wait for some to land.",
      });
    }
  }

  /** Advances every round and turns what connected into damage. */
  private advanceProjectiles(): void {
    const ids = [...this.fighters.keys()];
    const targets: ProjectileTargets = {
      spheresFor: (fighterId) => {
        const fighter = this.fighters.get(fighterId);
        return fighter && !fighter.defeated ? this.targetSpheres(fighter) : [];
      },
      fighterIds: ids,
      groundHeight: this.groundHeight,
      bubbleCentre: () => {
        const first = this.fighters.values().next().value as FighterState | undefined;
        return { east: first?.pose.east ?? 0, north: first?.pose.north ?? 0 };
      },
    };

    const result = this.projectiles.advance(COMBAT_TICK_SECONDS, targets);
    for (const hit of result.hits) {
      const attacker = this.fighters.get(hit.projectile.ownerId);
      const target = this.fighters.get(hit.targetId);
      const weapon = this.weaponById(hit.projectile.weaponId);
      if (!attacker || !target || !weapon) continue;
      this.applyWeaponHit(attacker, target, weapon, hit.contact);
      this.pushEvent({
        type: "projectile-hit",
        actorId: attacker.id,
        targetId: target.id,
        moveId: weapon.id,
        contact: hit.contact,
      });
    }
  }

  /** Beams, cones and tethers land the moment they are fired. */
  private resolveInstantWeapon(fighter: FighterState, weapon: WeaponDefinition): void {
    const target = this.firstOpponent(fighter.id);
    if (!target) return;
    const distance = Math.hypot(target.pose.east - fighter.pose.east, target.pose.north - fighter.pose.north);
    if (distance > weapon.rangeMeters) return;

    if (weapon.behavior === "cone") {
      const bearing = normalizeDegrees(
        (Math.atan2(target.pose.east - fighter.pose.east, target.pose.north - fighter.pose.north) * 180) /
          Math.PI,
      );
      // The wedge is the weapon's own spread, so a cone weapon's spread is its
      // width rather than its inaccuracy.
      if (Math.abs(signedDelta(fighter.pose.yawDeg, bearing)) > weapon.spreadDeg * 0.5) return;
    }

    const contact = {
      east: target.pose.east,
      up: target.pose.up + target.heightMeters * 0.55,
      north: target.pose.north,
    };
    this.applyWeaponHit(fighter, target, weapon, contact);

    // A tether holds rather than only hurting.
    if (weapon.behavior === "tether") {
      applyStatus(target.statuses, "status.tethered", 180, 1);
      this.pushEvent({
        type: "status-applied",
        actorId: target.id,
        targetId: fighter.id,
        moveId: weapon.id,
        reason: this.statusSentence("status.tethered", target.displayName),
      });
    }
  }

  /**
   * Damage from a weapon.
   *
   * Goes through the same zone, armour and reaction path a fist does, with the
   * weapon's own underwater scale applied first: this is the one place the sea
   * reaches directly into what a weapon is worth.
   */
  private applyWeaponHit(
    attacker: FighterState,
    target: FighterState,
    weapon: WeaponDefinition,
    contact: Point3,
  ): void {
    const packet = weapon.damage;
    const zonePick = target.kaiju ? zoneAtPoint(target.kaiju, target.pose, contact) : null;
    const zone = target.zones.find((entry) => entry.id === (zonePick?.zone.id ?? "core")) ?? target.zones[0];

    const outcome = resolveReaction(packet, {
      poiseAccumulated: target.poise,
      poiseCapacity: target.profile.poiseCapacity,
      guardRemaining: target.guarding ? target.guard : null,
      alreadyReeling: target.reactionTicksLeft > 0,
      coreHealthFraction: this.coreFraction(target),
      finisherThreshold: target.finisherThreshold,
    });
    target.poise = outcome.poiseAccumulated;
    if (outcome.guardRemaining !== null) target.guard = outcome.guardRemaining;

    const underwater = this.space.waterDepthMeters(target.pose.east, target.pose.north) > 20;
    const scale = underwater ? weapon.underwaterScale : 1;
    let dealt = 0;
    if (zone && zone.health > 0) {
      dealt = Math.max(
        0,
        packet.amount * (1 - zone.armor) * zone.damageMultiplier * scale * (attacker.damageScale ?? 1),
      );
      zone.health = Math.max(0, zone.health - dealt);
      zone.shock = Math.min(1, zone.shock + packet.componentShock);
    }
    target.hitThisTick = true;

    if (weapon.status) {
      applyStatus(
        target.statuses,
        weapon.status.statusId,
        // Research does not stop a status landing. It decides how long the crews
        // have to live with it once it has.
        resistedDuration(weapon.status.durationTicks, weapon.status.statusId, this.countermeasures),
        weapon.status.maxStacks,
      );
      this.pushEvent({
        type: "status-applied",
        actorId: target.id,
        targetId: attacker.id,
        moveId: weapon.id,
        reason: this.statusSentence(weapon.status.statusId, target.displayName),
      });
    }

    this.pushEvent({
      type: "hit",
      actorId: attacker.id,
      targetId: target.id,
      moveId: weapon.id,
      zoneId: zone?.id ?? null,
      damage: Math.round(dealt),
      reaction: outcome.reaction.id,
      contact,
      damageKind: weapon.damage.kind,
      reason: underwater ? "underwater" : null,
    });

    if (outcome.reaction.durationTicks > 0) {
      target.reaction = outcome.reaction;
      target.reactionTicksLeft = outcome.reaction.durationTicks;
      if (outcome.reaction.losesControl) target.attack = null;
      target.knockbackMps = outcome.knockbackMps;
      target.knockbackDirectionDeg = normalizeDegrees(
        (Math.atan2(target.pose.east - attacker.pose.east, target.pose.north - attacker.pose.north) * 180) /
          Math.PI,
      );
    }

    if (zone && zone.health <= 0) {
      this.pushEvent({
        type: "zone-destroyed",
        actorId: target.id,
        targetId: attacker.id,
        zoneId: zone.id,
        reason: zone.onDestroyed,
      });
      if (zone.onDestroyed === "kill" && !target.defeated) {
        target.defeated = true;
        target.attack = null;
        this.pushEvent({ type: "defeated", actorId: target.id, targetId: attacker.id });
      }
    }
  }

  /** Burning, shocked and the rest, ticking on whoever is carrying them. */
  private advanceStatusEffects(fighter: FighterState): void {
    if (fighter.statuses.length === 0) return;
    const inWater = this.space.waterDepthMeters(fighter.pose.east, fighter.pose.north) > 12;
    const tick = advanceStatuses(fighter.statuses, this.statusRegistry, inWater);

    if (tick.damage > 0) {
      const zone = fighter.zones.find((entry) => entry.health > 0) ?? fighter.zones[0];
      if (zone) zone.health = Math.max(0, zone.health - tick.damage);
    }
    for (const ended of tick.ended) {
      this.pushEvent({
        type: "status-ended",
        actorId: fighter.id,
        reason: `${fighter.displayName} is no longer ${this.statusWord(ended)}.`,
      });
    }
  }

  /** One status, in words, for the log and the coaching line. */
  private statusSentence(statusId: string, subject: string): string {
    return `${subject} is ${this.statusWord(statusId)}.`;
  }

  private statusWord(statusId: string): string {
    return (this.statusRegistry.get(statusId)?.displayName ?? statusId).toLowerCase();
  }

  /** The zone carrying a mount, when this fighter is built out of components. */
  private mountedOn(fighter: FighterState, mount: WeaponMount): ZoneState | undefined {
    const owner = this.componentsRegistry.all().find((component) => component.mounts.includes(mount));
    if (!owner) return undefined;
    return fighter.zones.find((zone) => zone.id === owner.id);
  }

  private weaponById(weaponId: string): WeaponDefinition | undefined {
    for (const fighter of this.fighters.values()) {
      const state = fighter.weapons.get(weaponId);
      if (state) return state.weapon;
    }
    return undefined;
  }

  /** Takes a round out of the magazine, and reports the moment it runs dry. */
  private spendAmmunition(fighter: FighterState, state: WeaponState): void {
    const weapon = state.weapon;
    if (weapon.magazine <= 0) return;
    state.magazine = Math.max(0, state.magazine - 1);
    state.shotsFired += 1;
    if (state.magazine === 0) {
      this.pushEvent({
        type: "weapon-dry",
        actorId: fighter.id,
        moveId: weapon.id,
        reason:
          state.reserve > 0
            ? `${weapon.displayName} is empty. Reload.`
            : `${weapon.displayName} is out of ammunition entirely.`,
      });
    }
  }

  private advanceResources(fighter: FighterState): void {
    const profile = fighter.profile;
    fighter.stamina = Math.min(
      profile.staminaMax,
      fighter.stamina + profile.staminaRegenPerSecond * COMBAT_TICK_SECONDS,
    );
    fighter.heat = Math.max(0, fighter.heat - profile.heatDissipationPerSecond * COMBAT_TICK_SECONDS);
    if (fighter.overheated && fighter.heat <= profile.heatMax * 0.55) {
      fighter.overheated = false;
      this.pushEvent({ type: "recovered", actorId: fighter.id, reason: "cooled" });
    }
    if (!fighter.guarding) {
      fighter.guard = Math.min(
        profile.guardMax,
        fighter.guard + profile.guardRegenPerSecond * COMBAT_TICK_SECONDS,
      );
    }
    // Poise recovers between exchanges, so a stagger takes sustained pressure
    // rather than patience. Twelve percent of capacity a second means a heavy
    // every second builds toward a stagger, and a heavy every three seconds
    // never gets there, which is the pacing the whole poise system is for.
    fighter.poise = Math.max(0, fighter.poise - profile.poiseCapacity * 0.12 * COMBAT_TICK_SECONDS);

    if (fighter.reactionTicksLeft > 0) {
      fighter.reactionTicksLeft -= 1;
      if (fighter.reactionTicksLeft === 0) {
        this.pushEvent({ type: "recovered", actorId: fighter.id, reason: fighter.reaction?.id ?? null });
        fighter.reaction = null;
      }
    }
  }

  private canCancelInto(fighter: FighterState, tag: CancelTag): boolean {
    const attack = fighter.attack;
    if (!attack) return true;
    if (!attack.move.cancelInto.includes(tag)) return false;
    if (attack.tick < attack.move.cancelFromTick || attack.tick > attack.move.cancelToTick) return false;
    if (attack.move.cancelRequiresHit && !attack.connected) return false;
    return true;
  }

  private coreFraction(fighter: FighterState): number {
    const core = fighter.zones.find((zone) => zone.onDestroyed === "kill") ?? fighter.zones[0];
    if (!core) return 1;
    return core.maxHealth <= 0 ? 1 : core.health / core.maxHealth;
  }

  private finisherOpen(target: FighterState): boolean {
    const reeling = target.reactionTicksLeft > 0 && (target.reaction?.finisherWindow ?? false);
    return this.coreFraction(target) <= target.finisherThreshold && reeling;
  }

  private firstOpponent(fighterId: string): FighterState | undefined {
    for (const fighter of this.fighters.values()) {
      if (fighter.id !== fighterId && !fighter.defeated) return fighter;
    }
    return undefined;
  }

  private pushEvent(event: Partial<CombatEvent> & { type: CombatEventType; actorId: string }): void {
    this.events.push({
      tick: this.tickValue,
      targetId: null,
      moveId: null,
      volumeId: null,
      zoneId: null,
      damage: 0,
      reaction: null,
      contact: null,
      reason: null,
      damageKind: null,
      ...event,
    });
  }

  /** Flat state for a readout or a digest. Everything here is read back. */
  snapshot(): ArenaSnapshot {
    return {
      tick: this.tickValue,
      fighters: [...this.fighters.values()].map((fighter) => ({
        id: fighter.id,
        displayName: fighter.displayName,
        kind: fighter.kind,
        east: fighter.pose.east,
        north: fighter.pose.north,
        yawDeg: fighter.pose.yawDeg,
        stamina: fighter.stamina,
        heat: fighter.heat,
        guard: fighter.guard,
        guarding: fighter.guarding,
        poise: fighter.poise,
        overheated: fighter.overheated,
        defeated: fighter.defeated,
        reaction: fighter.reaction?.id ?? null,
        reactionTicksLeft: fighter.reactionTicksLeft,
        aimZoneId: fighter.aimZoneId,
        comboHits: fighter.combo.hits,
        bestCombo: fighter.combo.bestHits,
        chargeProgress: this.chargeProgress(fighter.id),
        wieldingPropId: fighter.wielding?.definition.id ?? null,
        wieldingSwingsLeft: fighter.wielding?.instance.swingsLeft ?? 0,
        grapplePhase: fighter.grapple.phase,
        grappleStruggle: fighter.grapple.struggle,
        finisherPhase: fighter.finisher.phase,
        finisherBeat: fighter.finisher.beatIndex,
        finisherCamera: fighter.finisher.camera,
        openingTicksLeft: fighter.openingTicksLeft,
        weapons: [...fighter.weapons.values()].map((state) => ({
          id: state.weapon.id,
          displayName: state.weapon.displayName,
          behavior: state.weapon.behavior,
          magazine: state.magazine,
          magazineSize: state.weapon.magazine,
          reserve: state.reserve,
          cooldownTicksLeft: state.cooldownTicksLeft,
          reloadTicksLeft: state.reloadTicksLeft,
          shotsFired: state.shotsFired,
          feed: state.weapon.magazine > 0 ? "rounds" : state.weapon.heatCost > 0 ? "heat" : "reactor",
          channelling: fighter.channelWeaponId === state.weapon.id,
        })),
        statuses: fighter.statuses.map((entry) => ({
          statusId: entry.statusId,
          ticksLeft: entry.ticksLeft,
          stacks: entry.stacks,
        })),
        channelDrawMw: fighter.channelDrawMw,
        activeMove: fighter.attack?.move.id ?? null,
        activeMoveTick: fighter.attack?.tick ?? 0,
        activePhase: fighter.attack ? phaseAt(fighter.attack.move, fighter.attack.tick) : null,
        buffered: fighter.buffer.snapshot().pending.map((entry) => entry.action),
        zones: fighter.zones.map((zone) => ({
          id: zone.id,
          displayName: zone.displayName,
          health: zone.health,
          maxHealth: zone.maxHealth,
          shock: zone.shock,
        })),
        finisherOpen: this.finisherOpen(fighter),
      })),
    };
  }

  /** Content digest of the whole arena. Two identical runs must agree. */
  digest(): number {
    let hash = 0x811c9dc5;
    const snapshot = this.snapshot();
    hash = fold(hash, snapshot.tick);
    for (const fighter of snapshot.fighters) {
      hash = fold(hash, Math.round(fighter.east * 100));
      hash = fold(hash, Math.round(fighter.north * 100));
      hash = fold(hash, Math.round(fighter.stamina * 10));
      hash = fold(hash, Math.round(fighter.heat * 10));
      for (const zone of fighter.zones) hash = fold(hash, Math.round(zone.health));
    }
    for (const event of this.events) {
      hash = fold(hash, event.tick);
      hash = fold(hash, event.damage);
    }
    hash = fold(hash, this.projectiles.spawned);
    hash = fold(hash, this.projectiles.retired);
    return hash >>> 0;
  }

  /** Turns a fighter to face another, at a rate rather than instantly. */
  faceToward(fighterId: string, targetId: string, degreesPerTick: number): void {
    const fighter = this.fighters.get(fighterId);
    const target = this.fighters.get(targetId);
    if (!fighter || !target) return;
    const bearing = normalizeDegrees(
      (Math.atan2(target.pose.east - fighter.pose.east, target.pose.north - fighter.pose.north) * 180) /
        Math.PI,
    );
    const authority = fighter.attack ? fighter.attack.move.turnAuthority : 1;
    const allowed = degreesPerTick * authority;
    const delta = signedDelta(fighter.pose.yawDeg, bearing);
    fighter.pose = {
      ...fighter.pose,
      yawDeg: normalizeDegrees(fighter.pose.yawDeg + Math.max(-allowed, Math.min(allowed, delta))),
    };
  }
}

export interface ArenaZoneView {
  readonly id: string;
  readonly displayName: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly shock: number;
}

export interface ArenaFighterView {
  readonly id: string;
  readonly displayName: string;
  readonly kind: FighterKind;
  readonly east: number;
  readonly north: number;
  readonly yawDeg: number;
  readonly stamina: number;
  readonly heat: number;
  readonly guard: number;
  readonly guarding: boolean;
  readonly poise: number;
  readonly overheated: boolean;
  readonly defeated: boolean;
  readonly reaction: string | null;
  readonly reactionTicksLeft: number;
  readonly aimZoneId: string | null;
  readonly comboHits: number;
  readonly bestCombo: number;
  readonly chargeProgress: number;
  readonly wieldingPropId: string | null;
  readonly wieldingSwingsLeft: number;
  readonly grapplePhase: string;
  readonly grappleStruggle: number;
  readonly finisherPhase: string;
  readonly finisherBeat: number;
  readonly finisherCamera: string | null;
  readonly openingTicksLeft: number;
  readonly weapons: readonly ArenaWeaponView[];
  readonly statuses: readonly ArenaStatusView[];
  readonly channelDrawMw: number;
  readonly activeMove: string | null;
  readonly activeMoveTick: number;
  readonly activePhase: string | null;
  readonly buffered: readonly string[];
  readonly zones: readonly ArenaZoneView[];
  readonly finisherOpen: boolean;
}

export interface ArenaWeaponView {
  readonly id: string;
  readonly displayName: string;
  readonly behavior: string;
  readonly magazine: number;
  readonly magazineSize: number;
  readonly reserve: number;
  readonly cooldownTicksLeft: number;
  readonly reloadTicksLeft: number;
  readonly shotsFired: number;
  /** What firing it costs. A heat weapon is not an empty one. */
  readonly feed: "rounds" | "heat" | "reactor";
  readonly channelling: boolean;
}

export interface ArenaStatusView {
  readonly statusId: string;
  readonly ticksLeft: number;
  readonly stacks: number;
}

export interface ArenaSnapshot {
  readonly tick: number;
  readonly fighters: readonly ArenaFighterView[];
}

/** What a throw or a slam leaves the victim in. */
function reactionFor(outcome: string | null): string {
  return outcome === "slammed" ? "wall-impact" : "knockdown";
}

function reject(reason: AttackRejection, message: string): AttackRequest {
  return { ok: false, reason, message };
}

function fold(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), 0x01000193) >>> 0;
}
