import type { CombatArena, CombatEvent } from "../combat/arena";
import {
  NET_PROTOCOL_VERSION,
  type AbortMessage,
  type EventMessage,
  type GuestLoadout,
  type HelloMessage,
  type InputMessage,
  type NetMessage,
  type PauseMessage,
  type RejectReason,
  type ResultMessage,
  type SnapshotFighter,
  type SnapshotMessage,
  type TransformMessage,
} from "./protocol";
import type { BattleSessionTransport } from "./transport";

/**
 * The host, which is the only thing in a co-op battle that decides anything.
 *
 * It owns the arena. A guest sends what it is trying to do; this applies that
 * to the arena or refuses it, and then announces what happened. Damage,
 * ammunition, finishers, rewards and the final result are all produced here,
 * exactly once, and sent out as statements of fact.
 *
 * That asymmetry is the whole anti-duplication design. A guest cannot double a
 * hit by lagging, because the guest never counted a hit in the first place. A
 * retransmitted input cannot fire a weapon twice, because inputs carry a
 * sequence number and anything at or below the highest already applied is
 * dropped, the same guard-by-reference the ledger and the crew already use for
 * mission payouts.
 *
 * No Babylon, no DOM. It drives an arena and a transport, both injected.
 */

/** How far behind the host a guest's input may claim to be before it is stale. */
export const MAX_INPUT_LAG_TICKS = 30;
/** How far *ahead* an input may claim to be. Anything more is a bad clock or a cheat. */
export const MAX_INPUT_LEAD_TICKS = 4;
/** Ticks without a word from a guest before it is treated as gone. */
export const GUEST_TIMEOUT_TICKS = 180;
/** Ticks between full snapshots. Between them, only poses go out. */
export const SNAPSHOT_INTERVAL_TICKS = 6;

export type GuestState = "absent" | "joining" | "active" | "stalled" | "left";

export interface GuestRecord {
  readonly id: string;
  readonly displayName: string;
  readonly fighterId: string;
  readonly loadout: GuestLoadout;
  state: GuestState;
  /** Highest input sequence already applied. The duplicate guard. */
  lastAppliedSeq: number;
  /** Host tick the last message arrived on, for the timeout. */
  lastHeardTick: number;
  /** Inputs that reached the arena. Exactly one effect each, by construction. */
  appliedInputs: number;
  /** Inputs refused for being too old or too far ahead. Shown, never hidden. */
  rejectedInputs: number;
  /** Inputs ignored because they had already been applied. */
  duplicateInputs: number;
}

export interface HostSessionOptions {
  readonly arena: CombatArena;
  readonly transport: BattleSessionTransport;
  /** Which fighter the guest drives, and what it is. The host's choice, always. */
  readonly guestFighterId: string;
  readonly guestLoadout: GuestLoadout;
  readonly sessionId: string;
  readonly buildVersion: string;
  /**
   * Whether the fight is at a point a guest may join.
   *
   * Late join is allowed only where it cannot corrupt anything: between rounds,
   * not in the middle of a finisher. Injected, because what counts as safe is
   * the fight's business rather than the network's.
   */
  readonly isSafePoint?: () => boolean;
}

export interface HostSessionStatus {
  readonly sessionId: string;
  readonly tick: number;
  readonly paused: boolean;
  readonly pauseDetail: string;
  readonly guest: GuestRecord | null;
  readonly finished: boolean;
  /** Reliable events announced so far. Also the next sequence number. */
  readonly eventsSent: number;
}

export class HostSession {
  private readonly arena: CombatArena;
  private readonly transport: BattleSessionTransport;
  private readonly sessionId: string;
  private readonly buildVersion: string;
  private readonly guestFighterId: string;
  private readonly guestLoadout: GuestLoadout;
  private readonly isSafePoint: () => boolean;
  private readonly unsubscribe: () => void;

  private guestRecord: GuestRecord | null = null;
  private tickValue = 0;
  private pausedValue = false;
  private pauseDetail = "";
  private eventSeq = 0;
  private finishedValue = false;
  private disposed = false;
  private readonly log: string[] = [];

  constructor(options: HostSessionOptions) {
    this.arena = options.arena;
    this.transport = options.transport;
    this.sessionId = options.sessionId;
    this.buildVersion = options.buildVersion;
    this.guestFighterId = options.guestFighterId;
    this.guestLoadout = options.guestLoadout;
    this.isSafePoint = options.isSafePoint ?? (() => true);
    this.unsubscribe = this.transport.onMessage((message) => this.receive(message));
  }

  status(): HostSessionStatus {
    return {
      sessionId: this.sessionId,
      tick: this.tickValue,
      paused: this.pausedValue,
      pauseDetail: this.pauseDetail,
      guest: this.guestRecord ? { ...this.guestRecord } : null,
      finished: this.finishedValue,
      eventsSent: this.eventSeq,
    };
  }

  /** What happened, in words, newest last. Shown in the co-op panel. */
  lines(): readonly string[] {
    return this.log;
  }

  /**
   * One tick of the fight.
   *
   * Steps the arena, turns whatever it produced into reliable announcements,
   * and sends the guest either a full snapshot or just the poses. Returns the
   * arena's own events so the single-player code path that already reads them
   * keeps working unchanged.
   */
  advance(): readonly CombatEvent[] {
    if (this.disposed || this.finishedValue) return [];
    if (this.pausedValue) return [];

    const events = this.arena.step();
    this.tickValue += 1;

    // Everything that changed the fight goes out reliably, once, in order.
    for (const event of events) this.announce(event);

    if (this.guestRecord?.state === "active" || this.guestRecord?.state === "stalled") {
      if (this.tickValue % SNAPSHOT_INTERVAL_TICKS === 0) this.sendSnapshot();
      else this.sendTransforms();
      this.checkTimeout();
    }
    return events;
  }

  /**
   * Pauses or resumes.
   *
   * Only the host may actually do it; a guest asking produces a request the
   * host answers. A paused fight steps nothing at all, so there is no window
   * where one side is simulating and the other is not.
   */
  setPaused(paused: boolean, detail: string): void {
    if (this.disposed) return;
    this.pausedValue = paused;
    this.pauseDetail = detail;
    this.note(paused ? `Paused: ${detail}` : `Resumed: ${detail}`);
    this.send({
      type: "pause",
      schemaVersion: 1,
      paused,
      by: "host",
      detail,
    } satisfies PauseMessage);
  }

  /**
   * Ends the session with the one authoritative result.
   *
   * Sent once. A second call does nothing, so a fight cannot be settled twice
   * by an abort racing a victory.
   */
  finish(outcome: ResultMessage["outcome"], summary: readonly string[]): ResultMessage | null {
    if (this.disposed || this.finishedValue) return null;
    this.finishedValue = true;
    const message: ResultMessage = {
      type: "result",
      schemaVersion: 1,
      tick: this.tickValue,
      outcome,
      digest: this.arena.digest(),
      summary: [...summary],
    };
    this.note(`Result: ${outcome}.`);
    this.send(message);
    return message;
  }

  /** Ends it because the host said so. The guest is told why. */
  abort(reason: string): void {
    if (this.disposed || this.finishedValue) return;
    this.send({ type: "abort", schemaVersion: 1, reason } satisfies AbortMessage);
    this.finish("aborted", [`Host ended the session: ${reason}`]);
  }

  /** Releases the subscription. The transport belongs to whoever built it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.guestRecord = null;
  }

  private receive(message: NetMessage): void {
    if (this.disposed) return;
    // Anything at all counts as a sign of life, a keepalive included. Recorded
    // before the message is handled so a rejoin is not immediately timed out.
    if (this.guestRecord) {
      // A hello is handled below as a rejoin, which says more than this would.
      if (this.guestRecord.state === "stalled" && message.type !== "abort" && message.type !== "hello") {
        this.guestRecord.state = "active";
        this.note(`${this.guestRecord.displayName} is responding again.`);
      }
      this.guestRecord.lastHeardTick = this.tickValue;
    }
    if (message.type === "hello") this.onHello(message);
    else if (message.type === "input") this.onInput(message);
    else if (message.type === "pause") this.onPauseRequest(message);
    else if (message.type === "abort") this.onGuestLeft(message.reason);
    else if (message.type === "ping") {
      this.send({
        type: "pong",
        schemaVersion: 1,
        sentAtTick: message.sentAtTick,
        hostTick: this.tickValue,
      });
    }
  }

  private onHello(hello: HelloMessage): void {
    if (hello.protocolVersion !== NET_PROTOCOL_VERSION) {
      // Named explicitly rather than "connection failed", because the fix is to
      // update one of the two builds and nobody can guess that from a timeout.
      this.refuse(
        "protocol-mismatch",
        `This build speaks protocol ${NET_PROTOCOL_VERSION} and the other speaks ` +
          `${hello.protocolVersion}. Both players need the same build. ` +
          `Host is on ${this.buildVersion}, guest on ${hello.buildVersion}.`,
      );
      return;
    }
    if (this.finishedValue) {
      this.refuse("session-closed", "That session has already finished.");
      return;
    }
    if (this.guestRecord && this.guestRecord.state === "active") {
      this.refuse("session-full", "Somebody is already in that seat.");
      return;
    }
    if (!this.isSafePoint()) {
      // Late join is allowed, but not mid-finisher: a fighter appearing during
      // a sequence would be a fighter appearing inside a cutscene.
      this.refuse("not-a-safe-point", "The fight is mid-sequence. Joining is possible again in a moment.");
      return;
    }

    // A record only exists once somebody has been seated, so its presence is
    // what makes this a rejoin rather than the state it happens to be in.
    const rejoining = this.guestRecord !== null;
    this.guestRecord = {
      id: hello.displayName,
      displayName: hello.displayName,
      fighterId: this.guestFighterId,
      loadout: this.guestLoadout,
      state: "active",
      // A rejoin keeps the sequence guard, so inputs from before the drop
      // cannot be replayed to fire a weapon a second time.
      lastAppliedSeq: rejoining ? (this.guestRecord?.lastAppliedSeq ?? -1) : -1,
      lastHeardTick: this.tickValue,
      appliedInputs: this.guestRecord?.appliedInputs ?? 0,
      rejectedInputs: this.guestRecord?.rejectedInputs ?? 0,
      duplicateInputs: this.guestRecord?.duplicateInputs ?? 0,
    };
    this.note(rejoining ? `${hello.displayName} rejoined.` : `${hello.displayName} joined.`);

    this.send({
      type: "welcome",
      schemaVersion: 1,
      protocolVersion: NET_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      fighterId: this.guestFighterId,
      loadout: this.guestLoadout,
      hostTick: this.tickValue,
      arenaSeed: this.arena.digest(),
    });
    this.sendSnapshot();
  }

  /**
   * Applies one guest input, or refuses it and says so.
   *
   * Three guards, in order: the session must be running, the sequence must be
   * new, and the tick must be close enough to now to mean anything. An input
   * that fails any of them is counted and dropped, never applied "just in
   * case".
   */
  private onInput(input: InputMessage): void {
    const guest = this.guestRecord;
    if (!guest || guest.state === "left" || this.finishedValue || this.pausedValue) return;

    if (input.seq <= guest.lastAppliedSeq) {
      guest.duplicateInputs += 1;
      return;
    }
    const lag = this.tickValue - input.tick;
    if (lag > MAX_INPUT_LAG_TICKS || lag < -MAX_INPUT_LEAD_TICKS) {
      guest.rejectedInputs += 1;
      guest.lastAppliedSeq = input.seq;
      return;
    }

    guest.lastAppliedSeq = input.seq;
    guest.state = "active";
    guest.appliedInputs += 1;
    this.apply(guest.fighterId, input);
  }

  /**
   * Turns an intent into an arena call.
   *
   * A lookup table rather than a switch, and every entry calls a method the
   * single-player path already calls, so a guest can do exactly what a local
   * player can do and nothing else.
   */
  private apply(fighterId: string, input: InputMessage): void {
    const arena = this.arena;
    const handlers: Readonly<Record<InputMessage["intent"], () => void>> = {
      move: () => arena.moveTo(fighterId, { east: input.east, north: input.north, yawDeg: input.yawDeg }),
      "press-move": () => {
        if (!input.targetId) return;
        const request = arena.request(fighterId, input.targetId);
        if (request.ok) arena.press(fighterId, input.targetId);
      },
      guard: () => arena.setGuard(fighterId, input.pressed),
      aim: () => arena.setAim(fighterId, input.targetId),
      fire: () => {
        if (input.targetId) arena.fireWeapon(fighterId, input.targetId);
      },
      reload: () => {
        if (input.targetId) arena.reloadWeapon(fighterId, input.targetId);
      },
      "charge-start": () => {
        if (input.targetId) arena.beginCharge(fighterId, input.targetId);
      },
      "charge-release": () => arena.releaseCharge(fighterId),
      "grapple-throw": () => arena.grappleThrow(fighterId),
      "grapple-slam": () => arena.grappleSlam(fighterId),
      "grapple-release": () => arena.grappleRelease(fighterId),
      "prop-drop": () => arena.dropProp(fighterId),
    };
    handlers[input.intent]();
  }

  private onPauseRequest(request: PauseMessage): void {
    if (request.by !== "guest") return;
    // A guest may ask. The host decides, and the answer is broadcast either way,
    // so nobody is left wondering whether the request was heard.
    this.setPaused(request.paused, `${this.guestRecord?.displayName ?? "Guest"} asked.`);
  }

  private onGuestLeft(reason: string): void {
    if (!this.guestRecord) return;
    this.guestRecord.state = "left";
    this.note(`${this.guestRecord.displayName} left: ${reason}`);
  }

  /**
   * Notices a guest that has stopped talking.
   *
   * Their machine is not removed and their damage is not undone: the fight
   * carries on with a machine standing still, which is honest about what
   * happened and leaves the seat open for a rejoin.
   */
  private checkTimeout(): void {
    const guest = this.guestRecord;
    if (!guest || guest.state !== "active") return;
    if (this.tickValue - guest.lastHeardTick <= GUEST_TIMEOUT_TICKS) return;
    guest.state = "stalled";
    this.arena.setGuard(guest.fighterId, true);
    this.arena.moveTo(guest.fighterId, {});
    this.note(`${guest.displayName} stopped responding. Their machine is holding position.`);
  }

  private announce(event: CombatEvent): void {
    const message: EventMessage = {
      type: "event",
      schemaVersion: 1,
      seq: this.eventSeq,
      tick: event.tick,
      eventType: event.type,
      actorId: event.actorId,
      targetId: event.targetId,
      zoneId: event.zoneId,
      damage: event.damage,
      moveId: event.moveId,
    };
    this.eventSeq += 1;
    this.send(message);
  }

  private sendSnapshot(): void {
    const snapshot = this.arena.snapshot();
    const fighters: SnapshotFighter[] = snapshot.fighters.map((fighter) => ({
      id: fighter.id,
      east: fighter.east,
      north: fighter.north,
      yawDeg: fighter.yawDeg,
      stamina: fighter.stamina,
      heat: fighter.heat,
      poise: fighter.poise,
      guarding: fighter.guarding,
      defeated: fighter.defeated,
      activeMove: fighter.activeMove,
      zones: fighter.zones.map((zone) => ({ id: zone.id, health: zone.health })),
    }));
    this.send({
      type: "snapshot",
      schemaVersion: 1,
      tick: this.tickValue,
      fighters,
      digest: this.arena.digest(),
    } satisfies SnapshotMessage);
  }

  /**
   * Poses only.
   *
   * Deliberately not debris, particles, civilians or any cosmetic body. Those
   * are grown from a seed on each client and have never been authoritative, so
   * sending them would be spending bandwidth to make two clients agree about
   * something neither of them decides anything from.
   */
  private sendTransforms(): void {
    const snapshot = this.arena.snapshot();
    this.send({
      type: "transform",
      schemaVersion: 1,
      tick: this.tickValue,
      poses: snapshot.fighters.map((fighter) => ({
        id: fighter.id,
        east: fighter.east,
        north: fighter.north,
        yawDeg: fighter.yawDeg,
      })),
    } satisfies TransformMessage);
  }

  private refuse(reason: RejectReason, detail: string): void {
    this.note(`Refused a join: ${detail}`);
    this.send({ type: "reject", schemaVersion: 1, reason, detail });
  }

  private send(message: NetMessage): void {
    if (this.transport.status.state !== "open") return;
    this.transport.send(message);
  }

  private note(line: string): void {
    this.log.push(line);
    while (this.log.length > 40) this.log.shift();
  }
}
