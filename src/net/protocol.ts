import { ContentRegistry, type RegistryEntry } from "../data/registry";

/**
 * What two clients are allowed to say to each other.
 *
 * Every message is plain serializable data with a type, a schema version and a
 * tick, exactly like `SimCommand` and `SimEvent` already are. That is not a
 * coincidence: the simulation was built to be sendable, and this is the
 * milestone that sends it.
 *
 * Two rules shape all of it.
 *
 * **The host is the only authority.** A guest sends what it is *trying* to do
 * and never what happened. Damage, ammunition, rewards and finishers are host
 * decisions announced to the guest, never guest decisions the host accepts. A
 * guest that lags, stutters or drops a packet therefore cannot double anything,
 * because it was never the thing counting.
 *
 * **Reliable carries consequence, unreliable carries appearance.** An event
 * that changed the fight goes on the reliable channel with a sequence number and
 * is applied exactly once. A pose goes on the unreliable channel and the newest
 * one wins; losing one costs a frame of smoothness and nothing else.
 *
 * No Babylon, no DOM, no WebRTC. This file only says what a message is.
 */

/**
 * Bumped whenever a message shape changes in a way an older build would
 * misread. Two builds with different numbers refuse to play rather than
 * desynchronising quietly halfway through a fight.
 */
export const NET_PROTOCOL_VERSION = 1;

/** Reliable is ordered and retried. Unreliable is neither, on purpose. */
export const NET_CHANNELS = ["reliable", "unreliable"] as const;
export type NetChannel = (typeof NET_CHANNELS)[number];

export const NET_MESSAGE_TYPES = [
  "hello",
  "welcome",
  "reject",
  "input",
  "snapshot",
  "transform",
  "event",
  "pause",
  "abort",
  "result",
  "ping",
  "pong",
] as const;
export type NetMessageType = (typeof NET_MESSAGE_TYPES)[number];

export interface NetMessageBase {
  readonly type: NetMessageType;
  readonly schemaVersion: number;
}

/** Guest to host, first thing said. */
export interface HelloMessage extends NetMessageBase {
  readonly type: "hello";
  readonly schemaVersion: 1;
  readonly protocolVersion: number;
  /** The build that is speaking. Reported in a mismatch so it is diagnosable. */
  readonly buildVersion: string;
  readonly displayName: string;
}

/** Host to guest, on acceptance. Carries everything the guest needs to draw. */
export interface WelcomeMessage extends NetMessageBase {
  readonly type: "welcome";
  readonly schemaVersion: 1;
  readonly protocolVersion: number;
  readonly sessionId: string;
  /** Which fighter the guest is allowed to drive. Chosen by the host. */
  readonly fighterId: string;
  /** What that machine is, so the guest can show it. Host owns the choice. */
  readonly loadout: GuestLoadout;
  readonly hostTick: number;
  /** Seed of the host's arena, so a guest can reproduce cosmetic scatter. */
  readonly arenaSeed: number;
}

/**
 * The machine the host is lending the guest.
 *
 * The host picks it, the host owns it, and the guest drives it only until the
 * session ends. The guest never chooses this and cannot change it: a co-op
 * partner cannot bring a machine the host's campaign does not own.
 */
export interface GuestLoadout {
  readonly jaegerId: string;
  readonly chassisId: string;
  readonly displayName: string;
  readonly weaponIds: readonly string[];
}

export const REJECT_REASONS = [
  "protocol-mismatch",
  "session-full",
  "session-closed",
  "not-a-safe-point",
  "host-aborted",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export interface RejectMessage extends NetMessageBase {
  readonly type: "reject";
  readonly schemaVersion: 1;
  readonly reason: RejectReason;
  /** A sentence a person can act on, never a code on its own. */
  readonly detail: string;
}

/** Everything a guest can be trying to do. Intents, never outcomes. */
export const INPUT_INTENTS = [
  "move",
  "press-move",
  "guard",
  "aim",
  "fire",
  "reload",
  "charge-start",
  "charge-release",
  "grapple-throw",
  "grapple-slam",
  "grapple-release",
  "prop-drop",
] as const;
export type InputIntent = (typeof INPUT_INTENTS)[number];

/**
 * Guest to host, reliable and sequenced.
 *
 * `seq` is what makes a retry harmless: the host remembers the highest sequence
 * it has applied per guest and ignores anything at or below it, so a packet
 * arriving twice is applied once.
 */
export interface InputMessage extends NetMessageBase {
  readonly type: "input";
  readonly schemaVersion: 1;
  readonly seq: number;
  /** The tick the guest believed it was on. Used to measure how far behind it is. */
  readonly tick: number;
  readonly intent: InputIntent;
  /** Move, weapon or zone id, depending on the intent. Null where none applies. */
  readonly targetId: string | null;
  /** Movement only. Metres per tick in the arena frame. */
  readonly east: number;
  readonly north: number;
  readonly yawDeg: number;
  /** Guard and charge use this; everything else ignores it. */
  readonly pressed: boolean;
}

/**
 * Host to guest, unreliable.
 *
 * The whole fight state, small enough to send often. It is unreliable because a
 * dropped one is replaced by the next: nothing is *applied* from a snapshot, it
 * is simply what the guest draws.
 */
export interface SnapshotMessage extends NetMessageBase {
  readonly type: "snapshot";
  readonly schemaVersion: 1;
  readonly tick: number;
  readonly fighters: readonly SnapshotFighter[];
  /** The host's own digest, so a guest can tell it has drifted. */
  readonly digest: number;
}

/** What a guest needs to draw a fighter. Deliberately not everything. */
export interface SnapshotFighter {
  readonly id: string;
  readonly east: number;
  readonly north: number;
  readonly yawDeg: number;
  readonly stamina: number;
  readonly heat: number;
  readonly poise: number;
  readonly guarding: boolean;
  readonly defeated: boolean;
  readonly activeMove: string | null;
  readonly zones: readonly { readonly id: string; readonly health: number }[];
}

/**
 * Host to guest, unreliable, and the cheapest message there is.
 *
 * Position only, sent between snapshots so movement stays smooth without
 * sending stamina and ammunition sixty times a second. Nothing authoritative
 * has ever travelled in one of these.
 */
export interface TransformMessage extends NetMessageBase {
  readonly type: "transform";
  readonly schemaVersion: 1;
  readonly tick: number;
  readonly poses: readonly {
    readonly id: string;
    readonly east: number;
    readonly north: number;
    readonly yawDeg: number;
  }[];
}

/**
 * Host to guest, reliable and sequenced. Things that actually happened.
 *
 * Damage, ammunition spent, a finisher landing, a fighter going down. The guest
 * applies each one exactly once, in order, and ignores any sequence it has
 * already seen, which is what stops a retransmission double-counting a hit.
 */
export interface EventMessage extends NetMessageBase {
  readonly type: "event";
  readonly schemaVersion: 1;
  readonly seq: number;
  readonly tick: number;
  readonly eventType: string;
  readonly actorId: string;
  readonly targetId: string | null;
  readonly zoneId: string | null;
  readonly damage: number;
  readonly moveId: string | null;
}

/** Either side may ask to pause; only the host's answer counts. */
export interface PauseMessage extends NetMessageBase {
  readonly type: "pause";
  readonly schemaVersion: 1;
  readonly paused: boolean;
  /** Who asked. A guest asking is a request; a host saying is a fact. */
  readonly by: "host" | "guest";
  readonly detail: string;
}

export interface AbortMessage extends NetMessageBase {
  readonly type: "abort";
  readonly schemaVersion: 1;
  readonly reason: string;
}

/**
 * The one authoritative outcome.
 *
 * Sent once, by the host, at the end. The guest displays it and never computes
 * its own: two clients that each decided who won would be two results, and the
 * milestone asks for one.
 */
export interface ResultMessage extends NetMessageBase {
  readonly type: "result";
  readonly schemaVersion: 1;
  readonly tick: number;
  readonly outcome: "victory" | "defeat" | "aborted";
  readonly digest: number;
  /** What happened, in plain lines. The host's ledger, not a recomputation. */
  readonly summary: readonly string[];
}

export interface PingMessage extends NetMessageBase {
  readonly type: "ping";
  readonly schemaVersion: 1;
  readonly sentAtTick: number;
}

export interface PongMessage extends NetMessageBase {
  readonly type: "pong";
  readonly schemaVersion: 1;
  readonly sentAtTick: number;
  readonly hostTick: number;
}

export type NetMessage =
  | HelloMessage
  | WelcomeMessage
  | RejectMessage
  | InputMessage
  | SnapshotMessage
  | TransformMessage
  | EventMessage
  | PauseMessage
  | AbortMessage
  | ResultMessage
  | PingMessage
  | PongMessage;

/**
 * One row per message type: which channel it belongs on and how to check it.
 *
 * A registry rather than a switch, so adding a message is a row and a message
 * with no row is refused instead of being handled by a default case nobody
 * wrote deliberately.
 */
export interface MessageSpec extends RegistryEntry {
  readonly id: NetMessageType;
  readonly channel: NetChannel;
  /** True when losing one costs appearance rather than correctness. */
  readonly droppable: boolean;
  validate(message: NetMessage): string[];
}

function requireFinite(value: unknown, name: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${name} must be a finite number`);
}

function requireText(value: unknown, name: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${name} must be a non-empty string`);
}

const SPECS: readonly MessageSpec[] = [
  {
    id: "hello",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const hello = message as HelloMessage;
      const errors: string[] = [];
      requireFinite(hello.protocolVersion, "protocolVersion", errors);
      requireText(hello.buildVersion, "buildVersion", errors);
      requireText(hello.displayName, "displayName", errors);
      return errors;
    },
  },
  {
    id: "welcome",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const welcome = message as WelcomeMessage;
      const errors: string[] = [];
      requireText(welcome.sessionId, "sessionId", errors);
      requireText(welcome.fighterId, "fighterId", errors);
      requireFinite(welcome.hostTick, "hostTick", errors);
      requireFinite(welcome.arenaSeed, "arenaSeed", errors);
      if (!welcome.loadout || typeof welcome.loadout !== "object") {
        errors.push("welcome must carry the loadout the host is lending");
      } else {
        requireText(welcome.loadout.jaegerId, "loadout.jaegerId", errors);
        requireText(welcome.loadout.displayName, "loadout.displayName", errors);
        if (!Array.isArray(welcome.loadout.weaponIds)) errors.push("loadout.weaponIds must be an array");
      }
      return errors;
    },
  },
  {
    id: "reject",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const reject = message as RejectMessage;
      const errors: string[] = [];
      if (!REJECT_REASONS.includes(reject.reason)) errors.push(`unknown reject reason "${reject.reason}"`);
      // A refusal with no sentence in it is a refusal nobody can act on.
      requireText(reject.detail, "detail", errors);
      return errors;
    },
  },
  {
    id: "input",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const input = message as InputMessage;
      const errors: string[] = [];
      if (!Number.isInteger(input.seq) || input.seq < 0) errors.push("seq must be a non-negative integer");
      requireFinite(input.tick, "tick", errors);
      if (!INPUT_INTENTS.includes(input.intent)) errors.push(`unknown intent "${input.intent}"`);
      requireFinite(input.east, "east", errors);
      requireFinite(input.north, "north", errors);
      requireFinite(input.yawDeg, "yawDeg", errors);
      return errors;
    },
  },
  {
    id: "snapshot",
    channel: "unreliable",
    droppable: true,
    validate: (message) => {
      const snapshot = message as SnapshotMessage;
      const errors: string[] = [];
      requireFinite(snapshot.tick, "tick", errors);
      if (!Array.isArray(snapshot.fighters)) errors.push("fighters must be an array");
      return errors;
    },
  },
  {
    id: "transform",
    channel: "unreliable",
    droppable: true,
    validate: (message) => {
      const transform = message as TransformMessage;
      const errors: string[] = [];
      requireFinite(transform.tick, "tick", errors);
      if (!Array.isArray(transform.poses)) errors.push("poses must be an array");
      return errors;
    },
  },
  {
    id: "event",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const event = message as EventMessage;
      const errors: string[] = [];
      if (!Number.isInteger(event.seq) || event.seq < 0) errors.push("seq must be a non-negative integer");
      requireFinite(event.tick, "tick", errors);
      requireText(event.eventType, "eventType", errors);
      requireText(event.actorId, "actorId", errors);
      requireFinite(event.damage, "damage", errors);
      return errors;
    },
  },
  {
    id: "pause",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const pause = message as PauseMessage;
      const errors: string[] = [];
      if (pause.by !== "host" && pause.by !== "guest") errors.push("pause.by must be host or guest");
      requireText(pause.detail, "detail", errors);
      return errors;
    },
  },
  {
    id: "abort",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const errors: string[] = [];
      requireText((message as AbortMessage).reason, "reason", errors);
      return errors;
    },
  },
  {
    id: "result",
    channel: "reliable",
    droppable: false,
    validate: (message) => {
      const result = message as ResultMessage;
      const errors: string[] = [];
      requireFinite(result.tick, "tick", errors);
      if (!["victory", "defeat", "aborted"].includes(result.outcome)) {
        errors.push(`unknown outcome "${result.outcome}"`);
      }
      requireFinite(result.digest, "digest", errors);
      if (!Array.isArray(result.summary)) errors.push("summary must be an array");
      return errors;
    },
  },
  {
    id: "ping",
    channel: "unreliable",
    droppable: true,
    validate: (message) => {
      const errors: string[] = [];
      requireFinite((message as PingMessage).sentAtTick, "sentAtTick", errors);
      return errors;
    },
  },
  {
    id: "pong",
    channel: "unreliable",
    droppable: true,
    validate: (message) => {
      const pong = message as PongMessage;
      const errors: string[] = [];
      requireFinite(pong.sentAtTick, "sentAtTick", errors);
      requireFinite(pong.hostTick, "hostTick", errors);
      return errors;
    },
  },
];

export function validateMessageSpec(entry: MessageSpec): string[] {
  const errors: string[] = [];
  if (!NET_MESSAGE_TYPES.includes(entry.id)) errors.push(`unknown message type "${entry.id}"`);
  if (!NET_CHANNELS.includes(entry.channel)) errors.push(`unknown channel "${entry.channel}"`);
  // The rule the whole design rests on: nothing that changes the fight may be
  // droppable, and nothing droppable may change the fight.
  if (entry.channel === "reliable" && entry.droppable) {
    errors.push("a reliable message cannot be droppable");
  }
  if (entry.channel === "unreliable" && !entry.droppable) {
    errors.push("an unreliable message must be safe to lose");
  }
  return errors;
}

export function createMessageRegistry(): ContentRegistry<MessageSpec> {
  const registry = new ContentRegistry<MessageSpec>(validateMessageSpec);
  for (const spec of SPECS) registry.register(spec);
  return registry;
}

export const MESSAGE_SPECS = SPECS;

/** Which channel a message belongs on. Used by both sides, so they agree. */
export function channelFor(type: NetMessageType): NetChannel {
  return SPECS.find((spec) => spec.id === type)?.channel ?? "reliable";
}

/**
 * Checks a message that arrived from somewhere else.
 *
 * Everything off the wire is untrusted, including a message from a build one
 * version older that thinks it is being helpful. A message that fails this is
 * dropped with a reason rather than fed to the arena.
 */
export function validateMessage(
  message: unknown,
  registry: ContentRegistry<MessageSpec> = createMessageRegistry(),
): string[] {
  if (typeof message !== "object" || message === null) return ["message must be an object"];
  const candidate = message as NetMessage;
  const spec = registry.get(candidate.type);
  if (!spec) return [`unknown message type "${String(candidate.type)}"`];
  if (candidate.schemaVersion !== 1) {
    return [`${candidate.type} schemaVersion must be 1, got ${String(candidate.schemaVersion)}`];
  }
  return spec.validate(candidate);
}
