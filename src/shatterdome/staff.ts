import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import type { CrewMember, Shift } from "../data/personnel";
import { shiftAt, shiftCovers } from "../data/personnel";
import type { FacilityKind } from "../data/facilities";
import type { InteriorRoom, RoomPoint } from "./interiorLayout";

/**
 * Staff.
 *
 * A facility is a number of people on shift, not a list of them. That is the
 * structural answer to simulating every crew member at full fidelity: outside
 * the room the player is standing in there is nothing to simulate, because a
 * facility's population is one integer derived from its tier and the hour.
 *
 * Inside the active room, staff become positions. Those positions are a function
 * of index, tick and the room's own posts, so a working crew member has no state
 * to update, nothing to save, and costs one matrix.
 *
 * The named characters are the exception, and a small one: a handful of people
 * with a post, a shift and a few lines that report real facility state.
 */

/** How much of a facility's roster is present, by shift. Nights are skeleton crews. */
const SHIFT_OCCUPANCY: Readonly<Record<Shift, number>> = {
  morning: 1,
  evening: 0.78,
  night: 0.34,
};

/** In-game seconds between two ambient lines from the same room. */
export const CHATTER_INTERVAL_TICKS = 900;

export interface ShiftLoad {
  readonly facilityId: FacilityKind;
  readonly shift: Shift;
  readonly slots: number;
  /** People actually present. Never rounds a staffed facility down to nobody. */
  readonly onShift: number;
}

/**
 * How many people are in a facility right now.
 *
 * Constant time and allocation free, so asking it for every facility in the
 * complex every frame would still be cheap. Nothing here scales with population.
 */
export function shiftLoadFor(facilityId: FacilityKind, staffSlots: number, dayFraction: number): ShiftLoad {
  const shift = shiftAt(dayFraction);
  const occupancy = SHIFT_OCCUPANCY[shift];
  const onShift = staffSlots <= 0 ? 0 : Math.max(1, Math.round(staffSlots * occupancy));
  return { facilityId, shift, slots: staffSlots, onShift };
}

export const STAFF_ACTIVITIES = ["working", "walking", "idle"] as const;
export type StaffActivity = (typeof STAFF_ACTIVITIES)[number];

export interface StaffPose {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly yawDeg: number;
  readonly activity: StaffActivity;
}

/**
 * Where the staff in this room are standing.
 *
 * Derived every call from the tick, so there is no per-person state anywhere.
 * `budget` is the quality preset's ceiling: a busy room draws the first N and
 * reports honestly how many that was out of how many are on shift.
 */
export function activeStaffPoses(
  room: InteriorRoom,
  tick: number,
  dayFraction: number,
  budget: number,
): StaffPose[] {
  const load = shiftLoadFor(room.facilityId, room.staffSlots, dayFraction);
  const count = Math.min(load.onShift, Math.max(0, Math.floor(budget)));
  if (count === 0 || room.staffPosts.length === 0) return [];

  const poses: StaffPose[] = [];
  const seconds = tick;
  for (let index = 0; index < count; index += 1) {
    const rng = createSeededRng(hashStringToSeed(`${room.id}|staff|${index}`));
    const station = room.staffPosts[index % room.staffPosts.length] ?? { x: 0, z: 0 };
    // Stand at the desk, not inside it. A post is a piece of furniture with its
    // own footprint, so a person placed on the post itself is invisible: the
    // first look at a staffed room showed six people and an empty floor.
    const post = standingSpot(station, STANDING_OFFSET_METERS);
    // Two in five are moving between posts; the rest are working where they stand.
    const walker = index % 5 === 0 || index % 5 === 3;
    if (!walker) {
      const jitter = 0.7;
      poses.push({
        index,
        x: post.x + (rng() - 0.5) * jitter,
        z: post.z + (rng() - 0.5) * jitter,
        // A worked-at station sways rather than standing still, and does it on the
        // world clock so two viewers of the same tick see the same room.
        yawDeg: (rng() * 360 + Math.sin(seconds * 0.6 + index) * 12) % 360,
        activity: "working",
      });
      continue;
    }
    const nextStation = room.staffPosts[(index + 1) % room.staffPosts.length] ?? station;
    const target = standingSpot(nextStation, STANDING_OFFSET_METERS);
    // A slow there-and-back between two posts. Period varies per person so a
    // room does not pulse in unison.
    const period = 26 + rng() * 22;
    const phase = (seconds / period + rng()) % 1;
    const t = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    const point = lerpPoint(post, target, t);
    poses.push({
      index,
      x: point.x,
      z: point.z,
      yawDeg: headingBetween(post, target, phase < 0.5),
      activity: "walking",
    });
  }
  return poses;
}

export interface ChatterContext {
  readonly facilityId: FacilityKind;
  readonly facilityName: string;
  readonly tier: number;
  readonly status: string;
  readonly powerText: string;
  readonly crewText: string;
  readonly staffText: string;
  readonly timeText: string;
}

export interface RadioLine {
  readonly id: string;
  readonly tick: number;
  readonly speaker: string;
  readonly role: string;
  readonly text: string;
}

/**
 * Fills a line's placeholders from live facility state.
 *
 * This is the reason lines are templates rather than prose: a character cannot
 * claim a tier the facility is not at, or report power that is not on the board.
 */
export function fillLine(template: string, context: ChatterContext): string {
  return template
    .replaceAll("{facility}", context.facilityName)
    .replaceAll("{tier}", String(context.tier))
    .replaceAll("{status}", context.status)
    .replaceAll("{power}", context.powerText)
    .replaceAll("{crews}", context.crewText)
    .replaceAll("{staff}", context.staffText)
    .replaceAll("{time}", context.timeText);
}

/**
 * The ambient line for a room at a tick, or null when nobody who works here is
 * on shift. Deterministic: the same tick bucket always produces the same line,
 * so two runs of a scenario hear the same radio.
 */
export function ambientChatter(
  crew: readonly CrewMember[],
  context: ChatterContext,
  tick: number,
  dayFraction: number,
  /** Last thing said here. A radio that repeats itself reads as broken. */
  avoidText: string | null = null,
): RadioLine | null {
  const onShift = crew.filter(
    (member) => member.facilityId === context.facilityId && shiftCovers(member.shift, dayFraction),
  );
  const speakers = onShift.length > 0 ? onShift : crew.filter((m) => m.facilityId === context.facilityId);
  if (speakers.length === 0) return null;

  const bucket = Math.floor(tick / CHATTER_INTERVAL_TICKS);
  const rng = createSeededRng(hashStringToSeed(`${context.facilityId}|chatter|${bucket}`));
  const speaker = speakers[Math.floor(rng() * speakers.length) % speakers.length];
  if (!speaker) return null;

  // Walk the speaker's lines from the seeded starting point until one is not
  // what was just said. With two or three lines to a character, picking blind
  // repeats often enough that the radio sounds stuck.
  const start = Math.floor(rng() * speaker.lines.length) % speaker.lines.length;
  let chosen: string | undefined;
  for (let offset = 0; offset < speaker.lines.length; offset += 1) {
    const candidate = speaker.lines[(start + offset) % speaker.lines.length];
    if (candidate === undefined) continue;
    const text = fillLine(candidate, context);
    if (avoidText === null || text !== avoidText) {
      chosen = text;
      break;
    }
  }
  if (chosen === undefined) return null;

  return {
    id: `${speaker.id}.${bucket}`,
    tick,
    speaker: speaker.name,
    role: speaker.role,
    text: chosen,
  };
}

/** A named character's own line, used when the player speaks to them directly. */
export function lineFrom(member: CrewMember, context: ChatterContext, tick: number): RadioLine {
  const rng = createSeededRng(hashStringToSeed(`${member.id}|${Math.floor(tick / 60)}`));
  const line = member.lines[Math.floor(rng() * member.lines.length) % member.lines.length] ?? "";
  return {
    id: `${member.id}.${tick}`,
    tick,
    speaker: member.name,
    role: member.role,
    text: fillLine(line, context),
  };
}

/** How far in front of a workstation somebody stands. */
const STANDING_OFFSET_METERS = 1.3;

/** Moves a point toward the room centre, so a person stands clear of the furniture. */
function standingSpot(post: RoomPoint, offset: number): RoomPoint {
  const length = Math.hypot(post.x, post.z);
  if (length <= 1e-6) return post;
  const scale = Math.max(0, (length - offset) / length);
  return { x: post.x * scale, z: post.z * scale };
}

function lerpPoint(from: RoomPoint, to: RoomPoint, t: number): RoomPoint {
  return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
}

function headingBetween(from: RoomPoint, to: RoomPoint, forward: boolean): number {
  const dx = forward ? to.x - from.x : from.x - to.x;
  const dz = forward ? to.z - from.z : from.z - to.z;
  const degrees = (Math.atan2(dx, dz) * 180) / Math.PI;
  return (degrees + 360) % 360;
}
