import type { ContentRegistry } from "../data/registry";
import {
  CONNECTION_SECONDS,
  FACILITY_CONNECTIONS,
  type ConnectionKind,
  type ConnectionSpec,
  type FacilityDefinition,
  type FacilityKind,
} from "../data/facilities";
import type { CrewMember } from "../data/personnel";
import { shiftAt } from "../data/personnel";
import type { WorkCapacity } from "./construction";
import type { EnvironmentEffects } from "../world/environment";
import {
  ShatterdomeState,
  type FacilityCompletion,
  type OrderResult,
  type ShatterdomeLocation,
} from "./facilityState";
import {
  arrivalPoint,
  generateInteriorLayout,
  roomById,
  type BerthOccupant,
  type Interactable,
  type InteriorLayout,
  type InteriorRoom,
} from "./interiorLayout";
import { cycleFocus, faceToward, resolveFocus, type FocusTarget } from "./interaction";
import {
  NEUTRAL_INPUT,
  effectsForRoom,
  poseAt,
  stepOnFoot,
  unstuck,
  type OnFootInput,
  type OnFootPose,
} from "./onFoot";
import {
  CHATTER_INTERVAL_TICKS,
  ambientChatter,
  lineFrom,
  shiftLoadFor,
  type ChatterContext,
  type RadioLine,
} from "./staff";

/**
 * The Shatterdome session.
 *
 * Everything that happens while the player is inside: which room they are in,
 * where they are standing, what they are looking at, what is being built, and
 * what is coming over the radio. It owns no Babylon objects and no DOM nodes;
 * the interior view reads it and the interface commands it, never the other way
 * round.
 *
 * The authoritative half of that state lives in `ShatterdomeState` and is saved.
 * Everything here that is not saved is derived: the layout comes back from the
 * facility records, and the player's position is written into the record on
 * every room change so a reload puts them back where they were standing.
 */

export const RADIO_LOG_LIMIT = 12;

export interface RoomTransition {
  readonly fromRoomId: string;
  readonly toRoomId: string;
  readonly kind: ConnectionKind;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  /** True once the room has actually changed, which happens at the darkest point. */
  readonly swapped: boolean;
}

export type InteractionOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "out-of-reach"; readonly message: string }
  | { readonly kind: "sealed"; readonly message: string }
  | { readonly kind: "transit"; readonly toRoomId: string; readonly travel: ConnectionKind }
  | { readonly kind: "terminal"; readonly facilityId: FacilityKind; readonly connPod: boolean }
  | { readonly kind: "berth"; readonly jaegerId: string | null; readonly label: string }
  | { readonly kind: "spoke"; readonly line: RadioLine };

export interface SessionUpdate {
  readonly deltaSeconds: number;
  /** Simulation ticks since the last update. Construction advances on these. */
  readonly ticks: number;
  readonly tick: number;
  readonly dayFraction: number;
  readonly timeLabel: string;
  readonly input: OnFootInput;
  readonly outsideEffects: EnvironmentEffects;
}

export interface ShatterdomeSessionOptions {
  readonly state: ShatterdomeState;
  readonly definitions: ContentRegistry<FacilityDefinition>;
  readonly crew: readonly CrewMember[];
  readonly berths: readonly BerthOccupant[];
  readonly seed: number;
  /** Injected so a test can lay out a two-room complex without the shipped graph. */
  readonly connections?: readonly ConnectionSpec[];
}

export class ShatterdomeSession {
  readonly state: ShatterdomeState;
  private readonly definitions: ContentRegistry<FacilityDefinition>;
  private readonly definitionMap: Map<FacilityKind, FacilityDefinition>;
  private readonly crew: readonly CrewMember[];
  private readonly berths: readonly BerthOccupant[];
  private readonly seed: number;
  private readonly connections: readonly ConnectionSpec[];

  private layoutValue: InteriorLayout;
  private roomId: string;
  private poseValue: OnFootPose;
  private focusValue: FocusTarget | null = null;
  private keyboardFocusId: string | null = null;
  private transitionValue: RoomTransition | null = null;
  private readonly log: RadioLine[] = [];
  private lastChatterBucket = -1;
  private lastAmbientText: string | null = null;
  private revisionValue = 0;
  private timeLabel = "";
  private dayFraction = 0.5;
  private tickValue = 0;

  constructor(options: ShatterdomeSessionOptions) {
    this.state = options.state;
    this.definitions = options.definitions;
    this.definitionMap = new Map(options.definitions.all().map((entry) => [entry.id, entry]));
    this.crew = options.crew;
    this.berths = options.berths;
    this.seed = options.seed;
    this.connections = options.connections ?? FACILITY_CONNECTIONS;
    this.layoutValue = this.buildLayout();

    const saved = this.state.playerLocation;
    const room = roomById(this.layoutValue, saved.roomId) ?? this.layoutValue.rooms[0];
    if (!room) throw new Error("Shatterdome layout produced no rooms; at least one facility must be built");
    this.roomId = room.id;
    this.poseValue =
      room.id === saved.roomId
        ? { ...poseAt({ x: saved.x, z: saved.z }, saved.yawDeg) }
        : poseAt(arrivalPoint(room, null));
  }

  get layout(): InteriorLayout {
    return this.layoutValue;
  }

  /** Increments whenever the rooms change shape, which is when the view rebuilds. */
  get revision(): number {
    return this.revisionValue;
  }

  get currentRoom(): InteriorRoom {
    const room = roomById(this.layoutValue, this.roomId);
    if (!room) throw new Error(`Current room "${this.roomId}" is not in the layout`);
    return room;
  }

  get pose(): OnFootPose {
    return this.poseValue;
  }

  get focus(): FocusTarget | null {
    return this.focusValue;
  }

  get transition(): RoomTransition | null {
    return this.transitionValue;
  }

  /** 0 while the view is clear, 1 at the darkest point of a transition. */
  get fade(): number {
    const transition = this.transitionValue;
    if (!transition) return 0;
    const half = transition.durationSeconds / 2;
    const t =
      transition.elapsedSeconds <= half
        ? transition.elapsedSeconds / half
        : 1 - (transition.elapsedSeconds - half) / half;
    return Math.min(1, Math.max(0, t));
  }

  get radioLog(): readonly RadioLine[] {
    return this.log;
  }

  /** People on shift in the room the player is standing in. */
  get roomShift(): ReturnType<typeof shiftLoadFor> {
    const room = this.currentRoom;
    return shiftLoadFor(room.facilityId, room.staffSlots, this.dayFraction);
  }

  /**
   * What the complex can bring to bear right now.
   *
   * Staffing follows the shift, so this is a different number at four in the
   * morning than at noon, and construction notices.
   */
  workCapacity(): WorkCapacity {
    let onShift = 0;
    for (const room of this.layoutValue.rooms) {
      onShift += shiftLoadFor(room.facilityId, room.staffSlots, this.dayFraction).onShift;
    }
    const rate = this.state.effects(onShift).constructionRate;
    return this.state.capacity(onShift, Number.isFinite(rate) && rate > 0 ? rate : 1);
  }

  /** How many people are on shift across the whole complex right now. */
  staffOnShiftTotal(): number {
    let onShift = 0;
    for (const room of this.layoutValue.rooms) {
      onShift += shiftLoadFor(room.facilityId, room.staffSlots, this.dayFraction).onShift;
    }
    return onShift;
  }

  /** Why the complex is not building at full speed, or null when it is. */
  constructionShortfall(): string | null {
    let onShift = 0;
    for (const room of this.layoutValue.rooms) {
      onShift += shiftLoadFor(room.facilityId, room.staffSlots, this.dayFraction).onShift;
    }
    return this.state.shortfall(onShift);
  }

  update(update: SessionUpdate): void {
    this.tickValue = update.tick;
    this.dayFraction = update.dayFraction;
    this.timeLabel = update.timeLabel;

    // Construction runs on simulation ticks whether or not the player is in the
    // room, so a build finishes while they are elsewhere and is finished when
    // they arrive. How fast it runs depends on the complex: a night shift with
    // half the posts filled builds more slowly than a full day, and a reactor
    // that cannot carry the draw slows everything rather than stopping it.
    for (const completion of this.state.advance(update.ticks, this.workCapacity())) {
      this.reportCompletion(completion);
    }

    if (this.transitionValue) {
      this.advanceTransition(update.deltaSeconds);
      // Input is ignored mid-transition: the player is in a lift, not walking.
      this.poseValue = stepOnFoot(
        this.poseValue,
        NEUTRAL_INPUT,
        update.deltaSeconds,
        this.currentRoom,
        effectsForRoom(this.currentRoom, update.outsideEffects),
      );
    } else {
      const room = this.currentRoom;
      this.poseValue = stepOnFoot(
        this.poseValue,
        update.input,
        update.deltaSeconds,
        room,
        effectsForRoom(room, update.outsideEffects),
      );
      // Looking around drops a keyboard-pinned target, so the two ways of
      // choosing something cannot disagree about what is focused.
      if (Math.abs(update.input.yawDeltaDeg) > 0.5) this.keyboardFocusId = null;
    }

    this.focusValue = resolveFocus(this.poseValue, this.currentRoom, this.keyboardFocusId);
    this.syncLocation();
    this.maybeChatter();
  }

  /** Uses whatever is focused. Returns what happened rather than acting on the world. */
  interact(): InteractionOutcome {
    if (this.transitionValue) return { kind: "none" };
    const focus = this.focusValue;
    if (!focus) return { kind: "none" };
    if (!focus.usable) {
      return { kind: "sealed", message: focus.interactable.sealedReason ?? "Sealed." };
    }
    if (!focus.inReach) {
      return {
        kind: "out-of-reach",
        message: `${focus.interactable.label} is ${focus.distanceMeters.toFixed(0)} m away.`,
      };
    }
    return this.use(focus.interactable);
  }

  private use(interactable: Interactable): InteractionOutcome {
    switch (interactable.kind) {
      case "transit":
      case "conn-pod": {
        const target = interactable.targetRoomId;
        if (target === null) return { kind: "none" };
        const kind = interactable.connectionKind ?? "door";
        this.beginTransition(target, kind);
        return { kind: "transit", toRoomId: target, travel: kind };
      }
      case "terminal":
        return {
          kind: "terminal",
          facilityId: interactable.facilityId,
          connPod: this.roomId === "conn-pod",
        };
      case "berth":
        this.state.selectJaeger(interactable.jaegerId);
        return { kind: "berth", jaegerId: interactable.jaegerId, label: interactable.label };
      case "staff-post": {
        const member = this.crew.find((entry) => entry.id === interactable.crewId);
        if (!member) return { kind: "none" };
        const line = lineFrom(member, this.chatterContext(), this.tickValue);
        this.push(line);
        return { kind: "spoke", line };
      }
      default:
        return { kind: "none" };
    }
  }

  /** Places a build order and reports it over the radio either way. */
  orderUpgrade(facilityId: FacilityKind): OrderResult {
    const result = this.state.order(facilityId);
    const definition = this.definitionMap.get(facilityId);
    const name = definition?.displayName ?? facilityId;
    if (result.ok) {
      const tier = definition?.tiers[result.record.targetTier - 1];
      this.push({
        id: `order.${facilityId}.${result.record.targetTier}`,
        tick: this.tickValue,
        speaker: "LOCCENT",
        role: "Command",
        text: `Work order accepted: ${name}, ${tier?.displayName ?? `tier ${result.record.targetTier}`}.`,
      });
      // Scaffolds go up the moment the order lands, so the room changes now.
      this.rebuildLayout();
    } else {
      this.push({
        id: `refusal.${facilityId}.${this.tickValue}`,
        tick: this.tickValue,
        speaker: "LOCCENT",
        role: "Command",
        text: `Work order refused: ${result.message}`,
      });
    }
    return result;
  }

  /** Keyboard focus: the mouse-free path through the interior. */
  cycleFocus(direction: 1 | -1 = 1): FocusTarget | null {
    const room = this.currentRoom;
    this.keyboardFocusId = cycleFocus(this.poseValue, room, this.keyboardFocusId, direction);
    const pinned = room.interactables.find((entry) => entry.id === this.keyboardFocusId);
    if (pinned) this.poseValue = faceToward(this.poseValue, pinned.position);
    this.focusValue = resolveFocus(this.poseValue, room, this.keyboardFocusId);
    return this.focusValue;
  }

  /** The safe action: always lands somewhere a person fits, in the same room. */
  unstuck(): void {
    this.poseValue = unstuck(this.poseValue, this.currentRoom);
    this.keyboardFocusId = null;
    this.focusValue = resolveFocus(this.poseValue, this.currentRoom, null);
    this.syncLocation();
    this.push({
      id: `unstuck.${this.tickValue}`,
      tick: this.tickValue,
      speaker: "LOCCENT",
      role: "Command",
      text: "Position reset to the nearest clear deck plate.",
    });
  }

  /** Rebuilds the rooms from the facility records. Cheap, and the only way rooms change. */
  rebuildLayout(): void {
    this.layoutValue = this.buildLayout();
    this.revisionValue += 1;
    const room = roomById(this.layoutValue, this.roomId);
    if (!room) {
      // The room the player was in no longer exists, which can only happen if a
      // facility were removed. Put them somewhere real rather than nowhere.
      const fallback = this.layoutValue.rooms[0];
      if (!fallback) throw new Error("Shatterdome layout produced no rooms");
      this.roomId = fallback.id;
      this.poseValue = poseAt(arrivalPoint(fallback, null));
    }
    this.focusValue = resolveFocus(this.poseValue, this.currentRoom, this.keyboardFocusId);
  }

  private buildLayout(): InteriorLayout {
    return generateInteriorLayout({
      seed: this.seed,
      facilities: this.state.all(),
      definitions: this.definitionMap,
      connections: this.connections,
      crew: this.crew,
      berths: this.berths,
    });
  }

  private beginTransition(toRoomId: string, kind: ConnectionKind): void {
    this.transitionValue = {
      fromRoomId: this.roomId,
      toRoomId,
      kind,
      elapsedSeconds: 0,
      durationSeconds: CONNECTION_SECONDS[kind],
      swapped: false,
    };
    this.keyboardFocusId = null;
  }

  private advanceTransition(deltaSeconds: number): void {
    const transition = this.transitionValue;
    if (!transition) return;
    const elapsedSeconds = transition.elapsedSeconds + Math.max(0, deltaSeconds);
    const half = transition.durationSeconds / 2;

    if (!transition.swapped && elapsedSeconds >= half) {
      const destination = roomById(this.layoutValue, transition.toRoomId);
      if (destination) {
        this.roomId = destination.id;
        const arrival = arrivalPoint(destination, transition.fromRoomId);
        // Face into the room rather than back at the door just walked through.
        const facing = Math.atan2(-arrival.x, -arrival.z);
        this.poseValue = poseAt(arrival, ((facing * 180) / Math.PI + 360) % 360);
        this.syncLocation();
        this.push({
          id: `arrive.${destination.id}.${this.tickValue}`,
          tick: this.tickValue,
          speaker: "LOCCENT",
          role: "Command",
          text: `${destination.displayName}. ${describeStatus(destination)}`,
        });
      }
      this.transitionValue = { ...transition, elapsedSeconds, swapped: true };
      return;
    }

    if (elapsedSeconds >= transition.durationSeconds) {
      this.transitionValue = null;
      return;
    }
    this.transitionValue = { ...transition, elapsedSeconds };
  }

  private syncLocation(): void {
    const location: ShatterdomeLocation = {
      roomId: this.roomId,
      x: this.poseValue.x,
      z: this.poseValue.z,
      yawDeg: this.poseValue.yawDeg,
    };
    this.state.setPlayerLocation(location);
  }

  private maybeChatter(): void {
    const bucket = Math.floor(this.tickValue / CHATTER_INTERVAL_TICKS);
    if (bucket === this.lastChatterBucket) return;
    this.lastChatterBucket = bucket;
    const line = ambientChatter(
      this.crew,
      this.chatterContext(),
      this.tickValue,
      this.dayFraction,
      this.lastAmbientText,
    );
    if (!line) return;
    this.lastAmbientText = line.text;
    this.push(line);
  }

  private reportCompletion(completion: FacilityCompletion): void {
    const definition = this.definitionMap.get(completion.facilityId);
    const name = definition?.displayName ?? completion.facilityId;
    this.push({
      id: `complete.${completion.facilityId}.${completion.tier}`,
      tick: this.tickValue,
      speaker: "LOCCENT",
      role: "Command",
      text: completion.firstBuild
        ? `${name} is built and on the board: ${completion.tierName}.`
        : `${name} upgraded to ${completion.tierName}.`,
    });
    // The room genuinely changes shape when a build lands: scaffolds come down
    // and the new fixtures are standing there.
    this.rebuildLayout();
  }

  chatterContext(): ChatterContext {
    const room = this.currentRoom;
    const record = this.state.recordFor(room.facilityId);
    const power = this.state.power();
    const crews = this.state.crews();
    const load = this.roomShift;
    return {
      facilityId: room.facilityId,
      facilityName: room.displayName,
      tier: record?.tier ?? room.tier,
      status: describeStatus(room),
      powerText: `${power.drawMw} of ${power.outputMw} MW`,
      crewText: `${crews.free} of ${crews.capacity}`,
      staffText: `${load.onShift}`,
      timeText: this.timeLabel || shiftAt(this.dayFraction),
    };
  }

  private push(line: RadioLine): void {
    if (this.log.length > 0 && this.log[this.log.length - 1]?.id === line.id) return;
    this.log.push(line);
    while (this.log.length > RADIO_LOG_LIMIT) this.log.shift();
  }
}

function describeStatus(room: InteriorRoom): string {
  if (room.underConstruction) return "under construction";
  return room.tier > 1 ? `operational, tier ${room.tier}` : "operational";
}
