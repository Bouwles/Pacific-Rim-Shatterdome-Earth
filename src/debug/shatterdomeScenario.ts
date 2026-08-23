import { createFacilityRegistry, type FacilityKind } from "../data/facilities";
import { CREW_MEMBERS } from "../data/personnel";
import { jaegerRegistry } from "../data/jaegers";
import { hashStringToSeed } from "../simulation/rng";
import { ShatterdomeState } from "../shatterdome/facilityState";
import { ShatterdomeSession } from "../shatterdome/session";
import { CONN_POD_ROOM_ID, type Interactable } from "../shatterdome/interiorLayout";
import { ON_FOOT, normalizeDegrees, type OnFootInput } from "../shatterdome/onFoot";
import type { EnvironmentEffects } from "../world/environment";

/**
 * A deterministic walk through the Shatterdome.
 *
 * The acceptance path this milestone claims, run headlessly: from the command
 * floor to a machine in the bay, inspect it, board the Conn-Pod, and come back,
 * with a build ordered on the way. Nothing teleports; every metre is walked
 * through the same controller the player drives, so if walking breaks, this
 * breaks.
 *
 * Runs with no Babylon and no DOM, so it is a unit test as much as a debug tool.
 */

/** Sixty steps a second, the same fixed step the simulation uses. */
const STEP_SECONDS = 1 / 60;

/** Indoors, and the walk is short: a scenario should not depend on the weather. */
const CALM_EFFECTS: EnvironmentEffects = {
  visibilityMeters: 20_000,
  tractionMultiplier: 1,
  movementMultiplier: 1,
  windPushMps: 0,
  rangedAccuracyPenalty: 0,
  hazardous: false,
};

export interface ShatterdomeScenarioOptions {
  readonly seed?: number;
  /** Facility to order on the way past a terminal. */
  readonly orderFacility?: FacilityKind;
  /** How long the scenario may run before giving up on a leg, in seconds. */
  readonly legTimeoutSeconds?: number;
}

export interface ShatterdomeScenarioStep {
  readonly label: string;
  readonly roomId: string;
  readonly seconds: number;
  readonly reached: boolean;
}

export interface ShatterdomeScenarioResult {
  readonly seed: number;
  readonly steps: readonly ShatterdomeScenarioStep[];
  readonly roomsVisited: readonly string[];
  readonly ticks: number;
  readonly finalRoomId: string;
  readonly inspectedJaegerId: string | null;
  readonly orderPlaced: boolean;
  readonly orderRefusal: string | null;
  readonly facilities: readonly { readonly id: string; readonly tier: number }[];
  readonly radioLines: number;
  /** Two runs of the same seed must agree on this. */
  readonly digest: number;
}

export function createScenarioSession(seed: number): ShatterdomeSession {
  const definitions = createFacilityRegistry();
  const state = new ShatterdomeState(definitions);
  return new ShatterdomeSession({
    state,
    definitions,
    crew: CREW_MEMBERS,
    berths: jaegerRegistry.all().map((jaeger) => ({ jaegerId: jaeger.id, displayName: jaeger.name })),
    seed,
  });
}

/**
 * Steering input toward a point: turn at the controller's own rate, walk forward
 * once roughly aimed. This is what a player does, expressed as input rather than
 * as a position assignment, so collision and acceleration still apply.
 */
export function steerToward(
  session: ShatterdomeSession,
  target: Interactable,
  deltaSeconds: number,
): OnFootInput {
  const pose = session.pose;
  const desired = normalizeDegrees(
    (Math.atan2(target.position.x - pose.x, target.position.z - pose.z) * 180) / Math.PI,
  );
  let difference = desired - normalizeDegrees(pose.yawDeg);
  if (difference > 180) difference -= 360;
  if (difference < -180) difference += 360;
  const maxTurn = ON_FOOT.keyboardTurnDegPerSecond * 2 * deltaSeconds;
  const yawDeltaDeg = Math.max(-maxTurn, Math.min(maxTurn, difference));
  // Walk once pointed roughly the right way, so the first step is not sideways.
  const forward = Math.abs(difference) < 35 ? 1 : 0;
  return { forward, strafe: 0, run: false, crouch: false, yawDeltaDeg, pitchDeltaDeg: 0 };
}

export interface WalkResult {
  readonly reached: boolean;
  readonly seconds: number;
  readonly ticks: number;
}

/**
 * Walks to a fixture in the current room and stops when it is in reach.
 *
 * Returns rather than throwing on failure: a scenario that could not reach
 * something should report which leg failed, not disappear into an exception.
 */
export function walkToInteractable(
  session: ShatterdomeSession,
  predicate: (entry: Interactable) => boolean,
  startTick: number,
  timeoutSeconds: number,
): WalkResult {
  let seconds = 0;
  let tick = startTick;
  while (seconds < timeoutSeconds) {
    const target = session.currentRoom.interactables.find(predicate);
    if (!target) break;
    const focus = session.focus;
    if (focus && focus.interactable.id === target.id && focus.inReach) {
      return { reached: true, seconds, ticks: tick - startTick };
    }
    const input = steerToward(session, target, STEP_SECONDS);
    tick += 1;
    session.update({
      deltaSeconds: STEP_SECONDS,
      ticks: 1,
      tick,
      dayFraction: 0.45,
      timeLabel: "10:48",
      input,
      outsideEffects: CALM_EFFECTS,
    });
    seconds += STEP_SECONDS;
  }
  return { reached: false, seconds, ticks: tick - startTick };
}

/** Advances without input, which is what a transition needs to finish. */
export function settle(session: ShatterdomeSession, startTick: number, seconds: number): number {
  let tick = startTick;
  const steps = Math.ceil(seconds / STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    tick += 1;
    session.update({
      deltaSeconds: STEP_SECONDS,
      ticks: 1,
      tick,
      dayFraction: 0.45,
      timeLabel: "10:48",
      input: { forward: 0, strafe: 0, run: false, crouch: false, yawDeltaDeg: 0, pitchDeltaDeg: 0 },
      outsideEffects: CALM_EFFECTS,
    });
  }
  return tick;
}

export function runShatterdomeScenario(options: ShatterdomeScenarioOptions = {}): ShatterdomeScenarioResult {
  const seed = options.seed ?? 20260824;
  const legTimeout = options.legTimeoutSeconds ?? 90;
  const session = createScenarioSession(seed);
  const steps: ShatterdomeScenarioStep[] = [];
  const roomsVisited: string[] = [session.currentRoom.id];
  let tick = 0;
  let inspectedJaegerId: string | null = null;
  let orderPlaced = false;
  let orderRefusal: string | null = null;

  const record = (label: string, result: WalkResult): void => {
    steps.push({
      label,
      roomId: session.currentRoom.id,
      seconds: Number(result.seconds.toFixed(3)),
      reached: result.reached,
    });
    tick += result.ticks;
  };

  // Order a facility from the command terminal before leaving, so a build is
  // running while the player walks and lands somewhere along the way.
  const orderTarget = options.orderFacility ?? "research";
  const toTerminal = walkToInteractable(session, (entry) => entry.kind === "terminal", tick, legTimeout);
  record("command terminal", toTerminal);
  if (toTerminal.reached) {
    const result = session.orderUpgrade(orderTarget);
    orderPlaced = result.ok;
    orderRefusal = result.ok ? null : result.message;
  }

  // Command to the bay: through the lift to the quarters, then the tram down.
  const legs: Array<{ label: string; roomId: string }> = [
    { label: "lift to quarters", roomId: "quarters" },
    { label: "tram to the bay", roomId: "jaeger-bay" },
  ];
  for (const leg of legs) {
    const walk = walkToInteractable(
      session,
      (entry) => entry.kind === "transit" && entry.targetRoomId === leg.roomId,
      tick,
      legTimeout,
    );
    record(leg.label, walk);
    if (!walk.reached) break;
    session.interact();
    tick = settle(session, tick, 4.2);
    roomsVisited.push(session.currentRoom.id);
  }

  // Inspect a machine, then board.
  if (session.currentRoom.id === "jaeger-bay") {
    const toBerth = walkToInteractable(
      session,
      (entry) => entry.kind === "berth" && entry.jaegerId !== null,
      tick,
      legTimeout,
    );
    record("berth", toBerth);
    if (toBerth.reached) {
      const outcome = session.interact();
      if (outcome.kind === "berth") inspectedJaegerId = outcome.jaegerId;
    }

    const toPod = walkToInteractable(session, (entry) => entry.kind === "conn-pod", tick, legTimeout);
    record("conn-pod gantry", toPod);
    if (toPod.reached) {
      session.interact();
      tick = settle(session, tick, 2.4);
      roomsVisited.push(session.currentRoom.id);
    }
  }

  // And back out of the Conn-Pod into the bay.
  if (session.currentRoom.id === CONN_POD_ROOM_ID) {
    const back = walkToInteractable(
      session,
      (entry) => entry.kind === "transit" && entry.targetRoomId === "jaeger-bay",
      tick,
      legTimeout,
    );
    record("return to the bay", back);
    if (back.reached) {
      session.interact();
      tick = settle(session, tick, 2.4);
      roomsVisited.push(session.currentRoom.id);
    }
  }

  const facilities = session.state.all().map((entry) => ({ id: entry.facilityId, tier: entry.tier }));

  let digest = 0x811c9dc5;
  digest = fold(digest, seed);
  for (const room of roomsVisited) digest = fold(digest, hashStringToSeed(room));
  for (const step of steps) {
    digest = fold(digest, hashStringToSeed(step.label));
    digest = fold(digest, Math.round(step.seconds * 100));
    digest = fold(digest, step.reached ? 1 : 0);
  }
  for (const facility of facilities) {
    digest = fold(digest, hashStringToSeed(facility.id));
    digest = fold(digest, facility.tier);
  }

  return {
    seed,
    steps,
    roomsVisited,
    ticks: tick,
    finalRoomId: session.currentRoom.id,
    inspectedJaegerId,
    orderPlaced,
    orderRefusal,
    facilities,
    radioLines: session.radioLog.length,
    digest: digest >>> 0,
  };
}

function fold(hash: number, value: number): number {
  let next = hash ^ (value | 0);
  next = Math.imul(next, 0x01000193);
  return next >>> 0;
}
