import type { ContentRegistry } from "../data/registry";
import {
  COMBAT_TICK_SECONDS,
  moveLengthTicks,
  phaseAt,
  type CancelTag,
  type MoveDefinition,
} from "../data/moves";
import type { BodyZone, KaijuDefinition } from "../data/kaiju";
import type { JaegerDefinition } from "../data/jaegers";
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
import { zoneAtPoint, zonePosition, type TargetingPose } from "./targeting";

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
export function combatProfileFor(jaeger: JaegerDefinition): CombatProfile {
  const mass = jaeger.massBudget;
  return {
    staminaMax: 100,
    staminaRegenPerSecond: 11,
    heatMax: 100,
    heatDissipationPerSecond: 6 + mass.coolingCapacity * 14,
    poiseCapacity: 90 + mass.massTons / 24,
    guardMax: 120 + mass.massTons / 30,
    guardRegenPerSecond: 7,
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
  /** Fraction of core health at or below which a finisher becomes legal. */
  readonly finisherThreshold: number;
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
}

export const COMBAT_EVENT_TYPES = [
  "attack-started",
  "attack-cancelled",
  "attack-rejected",
  "hit",
  "guarded",
  "whiffed",
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
}

export type AttackRejection =
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
 * A Jaeger's zones.
 *
 * One hull zone for now. Per-component armour and repair is its own milestone;
 * what matters here is that a Jaeger takes damage through the same path a kaiju
 * does, so nothing has to be written twice later.
 */
export function jaegerZones(jaeger: JaegerDefinition): ZoneState[] {
  const hull = 2_400 + jaeger.massBudget.massTons;
  return [
    {
      id: "core",
      displayName: "Hull",
      maxHealth: hull,
      health: hull,
      armor: 0.35,
      damageMultiplier: 1,
      onDestroyed: "kill",
      shock: 0,
    },
  ];
}

export class CombatArena {
  private readonly moves: ContentRegistry<MoveDefinition>;
  private readonly fighters = new Map<string, FighterState>();
  private tickValue = 0;
  private readonly events: CombatEvent[] = [];

  constructor(options: ArenaOptions) {
    this.moves = options.moves;
    for (const spec of options.fighters) this.add(spec);
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
      if (!target || !this.finisherOpen(target)) {
        return reject("finisher-not-open", `${move.displayName} needs a target that is already finished.`);
      }
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

    for (const fighter of this.fighters.values()) this.consumeBuffer(fighter);
    for (const fighter of this.fighters.values()) this.advanceMovement(fighter);
    for (const fighter of this.fighters.values()) this.resolveHits(fighter);
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
    // A machine with no zone layout is one body-sized sphere at chest height.
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
    let zoneId = zonePick?.zone.id ?? "core";

    // An aimed zone wins if the blow actually reached it. The reach allowance is
    // generous, because a pilot aiming for the core and connecting with the
    // chest plate has hit what they were aiming at.
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
    const zone = target.zones.find((entry) => entry.id === zoneId) ?? target.zones[0];

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
    const guardFactor = target.guarding && !outcome.guardBroken ? 0.25 : 1;
    let dealt = 0;
    const wasIntact = zone ? zone.health > 0 : false;
    if (zone) {
      const throughArmor = packet.amount * (1 - zone.armor) * zone.damageMultiplier * guardFactor;
      dealt = Math.max(0, throughArmor);
      zone.health = Math.max(0, zone.health - dealt);
      zone.shock = Math.min(1, zone.shock + packet.componentShock * guardFactor);
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
  readonly activeMove: string | null;
  readonly activeMoveTick: number;
  readonly activePhase: string | null;
  readonly buffered: readonly string[];
  readonly zones: readonly ArenaZoneView[];
  readonly finisherOpen: boolean;
}

export interface ArenaSnapshot {
  readonly tick: number;
  readonly fighters: readonly ArenaFighterView[];
}

function reject(reason: AttackRejection, message: string): AttackRequest {
  return { ok: false, reason, message };
}

function fold(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), 0x01000193) >>> 0;
}
