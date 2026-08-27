import { channelFor, validateMessage, type NetMessage } from "./protocol";
import type { BattleSessionTransport, TransportStatus } from "./transport";

/**
 * The two transports that involve a browser.
 *
 * Both implement the same interface the loopback does, so the host and guest
 * sessions cannot tell which one they are running on. That is what lets the
 * whole of the fight logic be tested without either of these existing.
 *
 * **A word about what WebRTC does and does not do.** WebRTC carries the data
 * once a connection exists. It does not create one. Before any packet moves,
 * the two peers must exchange an offer, an answer and their candidate addresses,
 * and something outside WebRTC has to carry that exchange. There is no
 * configuration of it that connects two strangers over the internet on its own.
 * This project has no server and will not have one, so the exchange here is done
 * by the two players copying two blocks of text to each other by whatever means
 * they already have. That is a real limitation, stated plainly, rather than a
 * feature described as seamless.
 *
 * On one machine, two browser windows on the same origin need none of that, and
 * that is what `BroadcastChannelTransport` is for.
 */

/** Channel name two windows of this game agree on. */
export const BATTLE_CHANNEL_NAME = "shatterdome.battle.v1";

interface ChannelEnvelope {
  readonly from: string;
  readonly message: NetMessage;
}

/**
 * Two windows, one machine, no signalling and no configuration.
 *
 * `BroadcastChannel` reaches every same-origin context in the browser, so two
 * tabs find each other with nothing in between. It is not a network transport
 * and never will be: it is how two people on one machine play, and how the
 * browser smoke test drives a real two-client battle.
 *
 * Every message carries the sender's id and a transport ignores its own, so one
 * channel carries both directions without echoing.
 */
export class BroadcastChannelTransport implements BattleSessionTransport {
  private channel: BroadcastChannel | null = null;
  private readonly handlers = new Set<(message: NetMessage) => void>();
  private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
  private statusValue: TransportStatus = { state: "idle", detail: "" };
  private readonly listener: (event: MessageEvent) => void;
  private invalid = 0;

  constructor(
    readonly id: string,
    channelName: string = BATTLE_CHANNEL_NAME,
  ) {
    this.listener = (event: MessageEvent) => this.onRaw(event);
    const Ctor = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    if (!Ctor) {
      // Reported, not thrown. A browser without it plays single-player exactly
      // as it always did, and the panel says why co-op is unavailable.
      this.setStatus({
        state: "failed",
        detail: "This browser cannot talk between windows, so same-machine co-op is unavailable.",
      });
      return;
    }
    this.channel = new Ctor(channelName);
    this.channel.addEventListener("message", this.listener);
    this.setStatus({ state: "open", detail: "Listening for the other window." });
  }

  get status(): TransportStatus {
    return this.statusValue;
  }

  /** Messages thrown away for failing validation. Shown, never swallowed. */
  get invalidCount(): number {
    return this.invalid;
  }

  send(message: NetMessage): void {
    if (!this.channel || this.statusValue.state !== "open") return;
    this.channel.postMessage({ from: this.id, message } satisfies ChannelEnvelope);
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

  close(reason = "Closed."): void {
    if (this.statusValue.state === "closed") return;
    this.channel?.removeEventListener("message", this.listener);
    this.channel?.close();
    this.channel = null;
    this.handlers.clear();
    this.setStatus({ state: "closed", detail: reason });
    this.statusHandlers.clear();
  }

  private onRaw(event: MessageEvent): void {
    const envelope = event.data as ChannelEnvelope | undefined;
    if (!envelope || typeof envelope !== "object") return;
    // Own messages come back on a BroadcastChannel's other listeners, not this
    // one, but a third window would reach here, so the check is real.
    if (envelope.from === this.id) return;
    if (validateMessage(envelope.message).length > 0) {
      this.invalid += 1;
      return;
    }
    for (const handler of this.handlers) handler(envelope.message);
  }

  private setStatus(status: TransportStatus): void {
    this.statusValue = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}

/** What a person has to copy to the other player, and what to paste back. */
export interface SignalBlock {
  /** The text to send to the other player. Base64 of the session description. */
  readonly text: string;
  /** What this block is, so nobody pastes an offer where an answer goes. */
  readonly kind: "offer" | "answer";
}

export interface WebRtcTransportOptions {
  readonly id: string;
  /**
   * ICE servers.
   *
   * Empty by default, which means host-candidate only: two machines on the same
   * local network find each other, and two machines on different networks do
   * not. Adding a public STUN server here makes more connections possible and
   * is the player's choice to make, since it means contacting a third party.
   */
  readonly iceServers?: readonly RTCIceServer[];
  /** Milliseconds to gather addresses before the block is offered. */
  readonly gatherTimeoutMs?: number;
}

/**
 * A direct peer connection, with the signalling done by hand.
 *
 * The flow, stated exactly as the players experience it:
 *
 * 1. The host calls `createOffer()` and gets a block of text.
 * 2. The host sends that text to the guest, by any means they already have.
 * 3. The guest calls `acceptOffer(text)` and gets an answer block back.
 * 4. The guest sends the answer to the host.
 * 5. The host calls `acceptAnswer(text)`, and the link opens.
 *
 * Steps 2 and 4 are the signalling, and no amount of WebRTC configuration
 * removes them. What it does buy, once done, is a direct connection with no
 * server in the middle for the rest of the session.
 *
 * Candidates are gathered before the block is produced, so one paste carries
 * everything and there is no second exchange.
 */
export class WebRtcTransport implements BattleSessionTransport {
  private connection: RTCPeerConnection | null = null;
  private reliable: RTCDataChannel | null = null;
  private unreliable: RTCDataChannel | null = null;
  private readonly handlers = new Set<(message: NetMessage) => void>();
  private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
  private statusValue: TransportStatus = { state: "idle", detail: "" };
  private readonly gatherTimeoutMs: number;
  private invalid = 0;
  private closed = false;

  constructor(options: WebRtcTransportOptions) {
    this.id = options.id;
    this.gatherTimeoutMs = options.gatherTimeoutMs ?? 3_000;
    const Ctor = (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
    if (!Ctor) {
      this.setStatus({
        state: "failed",
        detail: "This browser has no WebRTC, so direct co-op is unavailable. Single player is unaffected.",
      });
      return;
    }
    this.connection = new Ctor({ iceServers: [...(options.iceServers ?? [])] });
    this.connection.addEventListener("connectionstatechange", this.onConnectionState);
    this.connection.addEventListener("datachannel", this.onDataChannel);
  }

  readonly id: string;

  get status(): TransportStatus {
    return this.statusValue;
  }

  get invalidCount(): number {
    return this.invalid;
  }

  /** Host side, step one. Produces the text the other player needs. */
  async createOffer(): Promise<SignalBlock> {
    const connection = this.requireConnection();
    this.setStatus({ state: "connecting", detail: "Preparing an offer." });
    // Two channels, because the protocol genuinely uses two: consequences must
    // arrive and in order, poses must arrive quickly and may be lost.
    this.reliable = connection.createDataChannel("reliable", { ordered: true });
    this.unreliable = connection.createDataChannel("unreliable", {
      ordered: false,
      maxRetransmits: 0,
    });
    this.wire(this.reliable);
    this.wire(this.unreliable);

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await this.waitForCandidates(connection);
    return { kind: "offer", text: encode(connection.localDescription) };
  }

  /** Guest side. Takes the host's text and produces the answer to send back. */
  async acceptOffer(text: string): Promise<SignalBlock> {
    const connection = this.requireConnection();
    this.setStatus({ state: "connecting", detail: "Reading the offer." });
    await connection.setRemoteDescription(decode(text, "offer"));
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await this.waitForCandidates(connection);
    return { kind: "answer", text: encode(connection.localDescription) };
  }

  /** Host side, step two. Takes the guest's answer and opens the link. */
  async acceptAnswer(text: string): Promise<void> {
    const connection = this.requireConnection();
    await connection.setRemoteDescription(decode(text, "answer"));
    this.setStatus({ state: "connecting", detail: "Answer accepted. Waiting for the link." });
  }

  send(message: NetMessage): void {
    if (this.statusValue.state !== "open") return;
    const channel = channelIsReliable(message) ? this.reliable : (this.unreliable ?? this.reliable);
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(message));
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

  close(reason = "Closed."): void {
    if (this.closed) return;
    this.closed = true;
    for (const channel of [this.reliable, this.unreliable]) {
      if (!channel) continue;
      channel.onmessage = null;
      channel.onopen = null;
      channel.onclose = null;
      try {
        channel.close();
      } catch {
        // Already gone. Teardown never throws.
      }
    }
    this.reliable = null;
    this.unreliable = null;
    this.connection?.removeEventListener("connectionstatechange", this.onConnectionState);
    this.connection?.removeEventListener("datachannel", this.onDataChannel);
    try {
      this.connection?.close();
    } catch {
      // Already closed.
    }
    this.connection = null;
    this.handlers.clear();
    this.setStatus({ state: "closed", detail: reason });
    this.statusHandlers.clear();
  }

  private readonly onConnectionState = (): void => {
    const state = this.connection?.connectionState;
    if (state === "connected") this.setStatus({ state: "open", detail: "Connected." });
    else if (state === "failed") {
      this.setStatus({
        state: "failed",
        detail:
          "The direct connection could not be established. On different networks this usually needs " +
          "an ICE server, which this build does not contact without being told to.",
      });
    } else if (state === "disconnected") {
      this.setStatus({ state: "connecting", detail: "Connection dropped. Waiting for it to come back." });
    } else if (state === "closed") this.setStatus({ state: "closed", detail: "Connection closed." });
  };

  private readonly onDataChannel = (event: RTCDataChannelEvent): void => {
    if (event.channel.label === "unreliable") this.unreliable = event.channel;
    else this.reliable = event.channel;
    this.wire(event.channel);
  };

  private wire(channel: RTCDataChannel): void {
    channel.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        this.invalid += 1;
        return;
      }
      if (validateMessage(parsed).length > 0) {
        this.invalid += 1;
        return;
      }
      for (const handler of this.handlers) handler(parsed as NetMessage);
    };
    channel.onopen = () => {
      if (this.reliable?.readyState === "open") this.setStatus({ state: "open", detail: "Connected." });
    };
    channel.onclose = () => {
      if (this.statusValue.state === "open") {
        this.setStatus({ state: "connecting", detail: "A channel closed. Waiting." });
      }
    };
  }

  /**
   * Waits for address gathering, or gives up and sends what it has.
   *
   * Gathering can hang indefinitely behind some networks. A block with fewer
   * candidates still connects on a local network, so a timeout that produces
   * something is better than a promise that never resolves.
   */
  private async waitForCandidates(connection: RTCPeerConnection): Promise<void> {
    if (connection.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = (): void => {
        if (connection.iceGatheringState === "complete") finish();
      };
      const timer = setTimeout(finish, this.gatherTimeoutMs);
      connection.addEventListener("icegatheringstatechange", check);
    });
  }

  private requireConnection(): RTCPeerConnection {
    const connection = this.connection;
    if (!connection) throw new Error("This browser has no WebRTC, so there is nothing to connect with.");
    return connection;
  }

  private setStatus(status: TransportStatus): void {
    this.statusValue = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}

/** The protocol decides the channel, not this file, so both sides agree. */
function channelIsReliable(message: NetMessage): boolean {
  return channelFor(message.type) === "reliable";
}

function encode(description: RTCSessionDescription | null): string {
  if (!description) throw new Error("There is no session description to share yet.");
  return btoa(JSON.stringify({ type: description.type, sdp: description.sdp }));
}

function decode(text: string, expected: "offer" | "answer"): RTCSessionDescriptionInit {
  let parsed: { type?: string; sdp?: string };
  try {
    parsed = JSON.parse(atob(text.trim())) as { type?: string; sdp?: string };
  } catch {
    throw new Error("That is not a connection block from this game. Paste the whole thing, unmodified.");
  }
  if (parsed.type !== expected || typeof parsed.sdp !== "string") {
    throw new Error(`That block is ${parsed.type ?? "unreadable"}, and an ${expected} is needed here.`);
  }
  return { type: expected, sdp: parsed.sdp };
}
