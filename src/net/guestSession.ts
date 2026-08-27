import {
  NET_PROTOCOL_VERSION,
  type EventMessage,
  type GuestLoadout,
  type InputIntent,
  type NetMessage,
  type RejectReason,
  type ResultMessage,
  type SnapshotFighter,
} from "./protocol";
import type { BattleSessionTransport } from "./transport";

/**
 * The guest, which decides nothing and draws everything.
 *
 * It sends what the player is trying to do and shows what the host says
 * happened. It keeps a local view so movement is not stuck waiting for a round
 * trip, but that view is a *prediction*: the next snapshot overwrites it
 * without argument, and nothing the guest predicts is ever reported anywhere.
 *
 * Prediction is bounded. Past `MAX_PREDICTION_TICKS` with no word from the
 * host, it stops extrapolating and says so, because a machine that keeps
 * gliding through a wall for four seconds is a worse lie than a machine that
 * visibly froze.
 *
 * No Babylon, no DOM.
 */

/** Ticks the guest will predict ahead of the last snapshot before it gives up. */
export const MAX_PREDICTION_TICKS = 20;
/**
 * Ticks between keepalives.
 *
 * Without one, a guest who is watching rather than pressing looks exactly like
 * a guest whose connection died, and the host would keep declaring a perfectly
 * healthy player silent. Silence has to mean silence for the timeout to mean
 * anything.
 */
export const KEEPALIVE_INTERVAL_TICKS = 30;

export type GuestPhase = "idle" | "connecting" | "playing" | "stalled" | "rejected" | "finished";

export interface GuestView {
  readonly phase: GuestPhase;
  /** Which fighter this player drives, once the host has said. */
  readonly fighterId: string | null;
  readonly loadout: GuestLoadout | null;
  /** Tick of the last thing the host said. */
  readonly hostTick: number;
  /** How far ahead of that the guest is currently guessing. */
  readonly predictedTicks: number;
  readonly fighters: readonly SnapshotFighter[];
  readonly result: ResultMessage | null;
  readonly paused: boolean;
  /** What went wrong, in a sentence. Empty while nothing has. */
  readonly detail: string;
}

export interface GuestSessionOptions {
  readonly transport: BattleSessionTransport;
  readonly displayName: string;
  readonly buildVersion: string;
}

export class GuestSession {
  private readonly transport: BattleSessionTransport;
  private readonly displayName: string;
  private readonly buildVersion: string;
  private readonly unsubscribe: () => void;

  private phaseValue: GuestPhase = "idle";
  private fighterIdValue: string | null = null;
  private loadoutValue: GuestLoadout | null = null;
  private hostTickValue = 0;
  private localTick = 0;
  private fightersValue: readonly SnapshotFighter[] = [];
  private resultValue: ResultMessage | null = null;
  private pausedValue = false;
  private detailValue = "";
  private seq = 0;
  /** Highest reliable event already applied. The duplicate guard. */
  private lastEventSeq = -1;
  private lastKeepaliveTick = 0;
  private appliedEvents = 0;
  private duplicateEvents = 0;
  private disposed = false;
  private readonly log: string[] = [];

  constructor(options: GuestSessionOptions) {
    this.transport = options.transport;
    this.displayName = options.displayName;
    this.buildVersion = options.buildVersion;
    this.unsubscribe = this.transport.onMessage((message) => this.receive(message));
  }

  /** Says hello. Everything else waits for the host's answer. */
  join(): void {
    if (this.disposed) return;
    this.phaseValue = "connecting";
    this.detailValue = "";
    this.transport.send({
      type: "hello",
      schemaVersion: 1,
      protocolVersion: NET_PROTOCOL_VERSION,
      buildVersion: this.buildVersion,
      displayName: this.displayName,
    });
  }

  view(): GuestView {
    return {
      phase: this.phaseValue,
      fighterId: this.fighterIdValue,
      loadout: this.loadoutValue,
      hostTick: this.hostTickValue,
      predictedTicks: Math.max(0, this.localTick - this.hostTickValue),
      fighters: this.fightersValue,
      result: this.resultValue,
      paused: this.pausedValue,
      detail: this.detailValue,
    };
  }

  lines(): readonly string[] {
    return this.log;
  }

  /** How many announcements were applied, and how many were already seen. */
  eventCounters(): { readonly applied: number; readonly duplicates: number } {
    return { applied: this.appliedEvents, duplicates: this.duplicateEvents };
  }

  /**
   * One local tick.
   *
   * Advances the prediction clock only. It never damages anything, never spends
   * ammunition and never decides an outcome, because none of those are the
   * guest's to decide.
   */
  advance(): void {
    if (this.disposed || this.phaseValue === "finished") return;
    this.localTick += 1;
    if (
      (this.phaseValue === "playing" || this.phaseValue === "stalled") &&
      this.localTick - this.lastKeepaliveTick >= KEEPALIVE_INTERVAL_TICKS
    ) {
      this.lastKeepaliveTick = this.localTick;
      this.transport.send({ type: "ping", schemaVersion: 1, sentAtTick: this.localTick });
    }
    if (this.localTick - this.hostTickValue > MAX_PREDICTION_TICKS) {
      if (this.phaseValue === "playing") {
        this.phaseValue = "stalled";
        this.detailValue = "Waiting for the host. Nothing on screen is current.";
        this.note(this.detailValue);
      }
    }
  }

  /** Sends an intent. Refused silently once the session is over. */
  send(
    intent: InputIntent,
    options: {
      readonly targetId?: string | null;
      readonly east?: number;
      readonly north?: number;
      readonly yawDeg?: number;
      readonly pressed?: boolean;
    } = {},
  ): number | null {
    if (this.disposed || this.phaseValue === "finished" || this.phaseValue === "rejected") return null;
    if (this.pausedValue) return null;
    const seq = this.seq;
    this.seq += 1;
    this.transport.send({
      type: "input",
      schemaVersion: 1,
      seq,
      tick: this.localTick,
      intent,
      targetId: options.targetId ?? null,
      east: options.east ?? 0,
      north: options.north ?? 0,
      yawDeg: options.yawDeg ?? 0,
      pressed: options.pressed ?? false,
    });
    return seq;
  }

  /** Leaves, telling the host why rather than simply going quiet. */
  leave(reason = "Guest left."): void {
    if (this.disposed) return;
    this.transport.send({ type: "abort", schemaVersion: 1, reason });
    this.phaseValue = "finished";
    this.detailValue = reason;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
  }

  private receive(message: NetMessage): void {
    if (this.disposed) return;
    if (message.type === "welcome") this.onWelcome(message);
    else if (message.type === "reject") this.onReject(message.reason, message.detail);
    else if (message.type === "snapshot") this.onSnapshot(message.tick, message.fighters);
    else if (message.type === "transform") this.onTransform(message);
    else if (message.type === "event") this.onEvent(message);
    else if (message.type === "pause") {
      this.pausedValue = message.paused;
      this.detailValue = message.detail;
      this.note(message.paused ? `Paused: ${message.detail}` : `Resumed: ${message.detail}`);
    } else if (message.type === "abort") {
      this.phaseValue = "finished";
      this.detailValue = message.reason;
      this.note(`Host ended it: ${message.reason}`);
    } else if (message.type === "result") this.onResult(message);
  }

  private onWelcome(message: Extract<NetMessage, { type: "welcome" }>): void {
    this.fighterIdValue = message.fighterId;
    // The host chose this. The guest displays it and cannot change it: a co-op
    // partner drives the machine they were lent, for as long as they are lent it.
    this.loadoutValue = message.loadout;
    this.hostTickValue = message.hostTick;
    this.localTick = message.hostTick;
    this.phaseValue = "playing";
    this.detailValue = "";
    this.note(`Driving ${message.loadout.displayName}, lent by the host.`);
  }

  private onReject(reason: RejectReason, detail: string): void {
    this.phaseValue = "rejected";
    this.detailValue = detail;
    this.note(`Refused (${reason}): ${detail}`);
  }

  private onSnapshot(tick: number, fighters: readonly SnapshotFighter[]): void {
    // An older snapshot arriving after a newer one is discarded rather than
    // rewinding the display: unreliable means out of order, and the newest
    // picture is always the right one to draw.
    if (tick < this.hostTickValue) return;
    this.hostTickValue = tick;
    this.localTick = Math.max(this.localTick, tick);
    this.fightersValue = fighters;
    if (this.phaseValue === "stalled") {
      this.phaseValue = "playing";
      this.detailValue = "";
    }
  }

  private onTransform(message: Extract<NetMessage, { type: "transform" }>): void {
    if (message.tick < this.hostTickValue) return;
    this.hostTickValue = message.tick;
    this.localTick = Math.max(this.localTick, message.tick);
    const poses = new Map(message.poses.map((pose) => [pose.id, pose]));
    this.fightersValue = this.fightersValue.map((fighter) => {
      const pose = poses.get(fighter.id);
      return pose ? { ...fighter, east: pose.east, north: pose.north, yawDeg: pose.yawDeg } : fighter;
    });
    if (this.phaseValue === "stalled") {
      this.phaseValue = "playing";
      this.detailValue = "";
    }
  }

  /**
   * Applies one announcement, exactly once.
   *
   * The sequence guard is the entire reason a duplicated packet cannot double a
   * hit on the guest's display. The host has its own guard on inputs; this is
   * the mirror of it.
   */
  private onEvent(message: EventMessage): void {
    if (message.seq <= this.lastEventSeq) {
      this.duplicateEvents += 1;
      return;
    }
    this.lastEventSeq = message.seq;
    this.appliedEvents += 1;
    if (message.damage > 0 && message.zoneId) {
      this.fightersValue = this.fightersValue.map((fighter) =>
        fighter.id === message.targetId
          ? {
              ...fighter,
              zones: fighter.zones.map((zone) =>
                zone.id === message.zoneId
                  ? { ...zone, health: Math.max(0, zone.health - message.damage) }
                  : zone,
              ),
            }
          : fighter,
      );
    }
  }

  private onResult(message: ResultMessage): void {
    // One result, and it is the host's. The guest never computes its own, which
    // is what makes "one authoritative host result" true rather than hoped for.
    this.resultValue = message;
    this.phaseValue = "finished";
    this.note(`Result: ${message.outcome}.`);
  }

  private note(line: string): void {
    this.log.push(line);
    while (this.log.length > 40) this.log.shift();
  }
}
