import { createSeededRng, type Rng } from "../simulation/rng";
import { channelFor, validateMessage, type NetChannel, type NetMessage } from "./protocol";

/**
 * The seam between "two players are in a battle" and "how the bytes get there".
 *
 * Everything above this interface works the same whether the other player is in
 * another tab, on the same network, or on the other side of a WebRTC connection
 * somebody set up by hand. That is the point: the session logic is testable
 * without a browser, and a better transport can be written later without
 * touching a line of the fight.
 *
 * Nothing here knows about WebRTC, BroadcastChannel, Babylon or the DOM.
 */

export const TRANSPORT_STATES = ["idle", "connecting", "open", "closed", "failed"] as const;
export type TransportState = (typeof TRANSPORT_STATES)[number];

export interface TransportStatus {
  readonly state: TransportState;
  /** What happened, in words. Empty while nothing has gone wrong. */
  readonly detail: string;
}

export interface BattleSessionTransport {
  /** Stable id for logs and for telling two transports apart. */
  readonly id: string;
  readonly status: TransportStatus;
  /**
   * Sends a message.
   *
   * The channel is not the caller's choice: it comes from the message type, so
   * a consequence can never be sent unreliably by mistake.
   */
  send(message: NetMessage): void;
  /** Subscribes to arriving messages. Returns an unsubscribe. */
  onMessage(handler: (message: NetMessage) => void): () => void;
  /** Subscribes to state changes. Returns an unsubscribe. */
  onStatus(handler: (status: TransportStatus) => void): () => void;
  /** Releases everything. Safe to call twice. */
  close(reason?: string): void;
}

/** Bad packets are dropped rather than thrown, and counted so they are visible. */
export interface TransportCounters {
  readonly sent: number;
  readonly received: number;
  readonly droppedByNetwork: number;
  readonly droppedAsInvalid: number;
}

/**
 * Conditions to put a connection under.
 *
 * Used by the tests and the debug scenario to prove that latency, jitter and
 * loss cannot duplicate damage, ammunition, rewards or finishers. Real
 * transports ignore this; it exists so the failure mode can be reproduced on
 * demand rather than waited for.
 */
export interface LinkConditions {
  /** Milliseconds every message waits before arriving. */
  readonly latencyMs: number;
  /** Milliseconds of random variation either side of the latency. */
  readonly jitterMs: number;
  /** 0 to 1 of unreliable messages that never arrive at all. */
  readonly lossRate: number;
  /**
   * 0 to 1 of reliable messages delivered twice.
   *
   * Not a real network behaviour so much as a retransmission that was not
   * actually needed, which is exactly the case that would double a hit if
   * anything applied a reliable message more than once.
   */
  readonly duplicateRate: number;
}

export const PERFECT_LINK: LinkConditions = {
  latencyMs: 0,
  jitterMs: 0,
  lossRate: 0,
  duplicateRate: 0,
};

/** A nasty but survivable connection. What the acceptance test runs on. */
export const HOSTILE_LINK: LinkConditions = {
  latencyMs: 180,
  jitterMs: 90,
  lossRate: 0.2,
  duplicateRate: 0.15,
};

interface Queued {
  readonly deliverAtMs: number;
  readonly message: NetMessage;
  readonly ordinal: number;
  /**
   * Position in the reliable stream, or -1 for an unreliable message.
   *
   * Separate from `ordinal` because reliable ordering is a property of the
   * reliable channel alone: an unreliable pose sent in between two events must
   * not leave a hole that the reliable stream then waits on.
   */
  readonly reliableIndex: number;
}

/**
 * Two transports wired to each other, in one process.
 *
 * Deliberately clock-free: nothing is delivered until `pump(nowMs)` is called,
 * so a test advances time by hand and gets the same result every run. That is
 * what makes "this fight survived 20 percent packet loss" a repeatable
 * assertion rather than something that passed once on a fast machine.
 *
 * Reliable messages are never dropped and are delivered in order, because that
 * is what reliable means. Unreliable messages are dropped and reordered
 * according to the conditions, because that is what unreliable means.
 */
export class LoopbackTransport implements BattleSessionTransport {
  private peer: LoopbackTransport | null = null;
  private readonly handlers = new Set<(message: NetMessage) => void>();
  private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
  private inbox: Queued[] = [];
  private statusValue: TransportStatus = { state: "idle", detail: "" };
  private conditions: LinkConditions;
  private rng: Rng;
  private ordinal = 0;
  private counters = { sent: 0, received: 0, droppedByNetwork: 0, droppedAsInvalid: 0 };
  /** Next reliable index this side will accept. Everything after it waits. */
  private nextReliableIndex = 0;
  /** Reliable messages sent to the peer so far, which is their index. */
  private reliableSent = 0;

  private constructor(
    readonly id: string,
    conditions: LinkConditions,
    seed: number,
  ) {
    this.conditions = conditions;
    this.rng = createSeededRng(seed);
  }

  /** Builds a linked pair. Both start open, because a loopback cannot fail to connect. */
  static pair(
    conditions: LinkConditions = PERFECT_LINK,
    seed = 20260905,
  ): readonly [LoopbackTransport, LoopbackTransport] {
    const host = new LoopbackTransport("loopback.host", conditions, seed);
    const guest = new LoopbackTransport("loopback.guest", conditions, seed ^ 0x9e37);
    host.peer = guest;
    guest.peer = host;
    host.setStatus({ state: "open", detail: "Loopback link open." });
    guest.setStatus({ state: "open", detail: "Loopback link open." });
    return [host, guest];
  }

  get status(): TransportStatus {
    return this.statusValue;
  }

  stats(): TransportCounters {
    return { ...this.counters };
  }

  /** Changes the conditions mid-session, for a test that degrades a link. */
  setConditions(conditions: LinkConditions): void {
    this.conditions = conditions;
  }

  send(message: NetMessage): void {
    const peer = this.peer;
    if (!peer || this.statusValue.state !== "open") return;
    this.counters.sent += 1;
    peer.enqueue(message, this.conditions, this.rng);
  }

  onMessage(handler: (message: NetMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  /**
   * Delivers everything due by `nowMs`.
   *
   * Reliable messages are re-sorted into the order they were sent, whatever
   * jitter did to their arrival times, because a reliable channel that
   * reordered would not be one.
   */
  pump(nowMs: number): number {
    if (this.inbox.length === 0) return 0;
    const due = this.inbox.filter((entry) => entry.deliverAtMs <= nowMs);
    if (due.length === 0) return 0;
    const held = this.inbox.filter((entry) => entry.deliverAtMs > nowMs);

    // Reliable messages are delivered strictly in the order they were sent.
    // Jitter can make a later one arrive first, and a real ordered channel holds
    // it back until the gap is filled rather than handing it over early. Getting
    // this wrong looks exactly like a duplicate to the receiver, because a
    // sequence number that goes backwards is indistinguishable from a repeat.
    const reliable = due
      .filter((entry) => channelFor(entry.message.type) === "reliable")
      .sort((a, b) => a.reliableIndex - b.reliableIndex);
    const unreliable = due.filter((entry) => channelFor(entry.message.type) !== "reliable");

    const ready: Queued[] = [];
    const blocked: Queued[] = [];
    for (const entry of reliable) {
      if (entry.reliableIndex === this.nextReliableIndex) {
        ready.push(entry);
        this.nextReliableIndex += 1;
      } else if (entry.reliableIndex < this.nextReliableIndex) {
        // A genuine duplicate: this index has already been handed over. It is
        // still delivered, because proving the receiver ignores it is the point
        // of sending it twice.
        ready.push(entry);
      } else {
        blocked.push(entry);
      }
    }
    // Anything still waiting on a gap goes back, to be tried again next pump.
    this.inbox = [...held, ...blocked];

    let delivered = 0;
    for (const entry of [...ready, ...unreliable]) {
      // Everything off a wire is untrusted, loopback included: the validator has
      // to be in the path a test exercises, or it is not in the path at all.
      if (validateMessage(entry.message).length > 0) {
        this.counters.droppedAsInvalid += 1;
        continue;
      }
      this.counters.received += 1;
      delivered += 1;
      for (const handler of this.handlers) handler(entry.message);
    }
    return delivered;
  }

  /** Messages still in flight. A test uses this to drain a link completely. */
  get inFlight(): number {
    return this.inbox.length;
  }

  close(reason = "Closed."): void {
    if (this.statusValue.state === "closed") return;
    this.inbox = [];
    this.setStatus({ state: "closed", detail: reason });
    const peer = this.peer;
    this.peer = null;
    this.handlers.clear();
    if (peer) peer.close("The other side closed the link.");
    this.statusHandlers.clear();
  }

  private enqueue(message: NetMessage, conditions: LinkConditions, rng: Rng): void {
    const channel: NetChannel = channelFor(message.type);
    if (channel === "unreliable" && rng() < conditions.lossRate) {
      this.counters.droppedByNetwork += 1;
      return;
    }

    const jitter = conditions.jitterMs > 0 ? (rng() * 2 - 1) * conditions.jitterMs : 0;
    const delay = Math.max(0, conditions.latencyMs + jitter);
    const ordinal = this.ordinal;
    this.ordinal += 1;
    const reliableIndex = channel === "reliable" ? this.reliableSent : -1;
    if (channel === "reliable") this.reliableSent += 1;
    this.inbox.push({ deliverAtMs: this.clockBase + delay, message, ordinal, reliableIndex });

    // A duplicate of a reliable message, which is the case that would double a
    // hit if anything applied one more than once. It carries the same index, so
    // the receiver sees a sequence number it has already passed.
    if (channel === "reliable" && rng() < conditions.duplicateRate) {
      this.inbox.push({
        deliverAtMs: this.clockBase + delay + 5,
        message,
        ordinal: this.ordinal,
        reliableIndex,
      });
      this.ordinal += 1;
    }
  }

  /** The sender's idea of now. Set by `pump` so delays are measured from it. */
  private clockBase = 0;

  /** Moves this transport's clock, which is what delays are measured against. */
  setClock(nowMs: number): void {
    this.clockBase = nowMs;
  }

  private setStatus(status: TransportStatus): void {
    this.statusValue = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}

/**
 * Advances a linked pair by one step and delivers whatever is due.
 *
 * Both transports share the caller's clock, so a test says "eight hundred
 * milliseconds passed" once rather than nudging two objects separately.
 */
export function pumpPair(pair: readonly [LoopbackTransport, LoopbackTransport], nowMs: number): number {
  for (const transport of pair) transport.setClock(nowMs);
  return pair[0].pump(nowMs) + pair[1].pump(nowMs);
}
