import type { Interactable, InteractableKind, InteriorRoom, RoomPoint } from "./interiorLayout";
import { normalizeDegrees, type OnFootPose } from "./onFoot";

/**
 * Interaction focus.
 *
 * What the player is looking at, whether they can use it, and what the prompt
 * should say. Pure geometry over the room's own list, so the same question can
 * be answered in a test with no scene, no camera and no pointer.
 *
 * Two ways to choose a target, deliberately. Looking at something is the one
 * most players will use. Cycling with a key is the one that makes the interior
 * playable without a mouse at all, which is the difference between an
 * accessible prompt and a decorative one.
 */

/** How far off centre a fixture can be and still be what the player means. */
export const FOCUS_CONE_DEG = 62;

export interface FocusTarget {
  readonly interactable: Interactable;
  readonly distanceMeters: number;
  /** Degrees between where the player is looking and the fixture. */
  readonly angleDeg: number;
  readonly inReach: boolean;
  /** False for a sealed door: still focusable, so it can explain itself. */
  readonly usable: boolean;
  readonly prompt: string;
  /** Longer sentence for the screen reader line, which has no picture to lean on. */
  readonly announcement: string;
}

/** Verb per fixture kind. A table, so a new kind is a row rather than a branch. */
const VERBS: Readonly<Record<InteractableKind, string>> = {
  terminal: "Use",
  "staff-post": "Speak to",
  berth: "Inspect",
  "conn-pod": "Board",
  transit: "Enter",
};

export function resolveFocus(
  pose: OnFootPose,
  room: InteriorRoom,
  keyboardFocusId: string | null = null,
): FocusTarget | null {
  if (keyboardFocusId !== null) {
    const pinned = room.interactables.find((entry) => entry.id === keyboardFocusId);
    if (pinned) return describe(pose, pinned);
  }

  let best: FocusTarget | null = null;
  for (const interactable of room.interactables) {
    const target = describe(pose, interactable);
    if (target.angleDeg > FOCUS_CONE_DEG) continue;
    if (target.distanceMeters > interactable.reachMeters * 2.5) continue;
    // Nearest wins, and a tie goes to whatever is closest to the centre of view.
    if (
      best === null ||
      target.distanceMeters < best.distanceMeters - 0.05 ||
      (Math.abs(target.distanceMeters - best.distanceMeters) <= 0.05 && target.angleDeg < best.angleDeg)
    ) {
      best = target;
    }
  }
  return best;
}

/**
 * Next fixture in the room, ordered by distance.
 *
 * This is the keyboard path: no mouse, no aiming, and the player is turned to
 * face whatever is selected so the world still agrees with the prompt.
 */
export function cycleFocus(
  pose: OnFootPose,
  room: InteriorRoom,
  currentId: string | null,
  direction: 1 | -1 = 1,
): string | null {
  const ordered = [...room.interactables].sort(
    (a, b) => distanceTo(pose, a.position) - distanceTo(pose, b.position),
  );
  if (ordered.length === 0) return null;
  const index = currentId === null ? -1 : ordered.findIndex((entry) => entry.id === currentId);
  const next = (index + direction + ordered.length * 2) % ordered.length;
  return ordered[next]?.id ?? null;
}

/** Turns the player to face a point, used when focus is chosen with a key. */
export function faceToward(pose: OnFootPose, point: RoomPoint): OnFootPose {
  const yawDeg = normalizeDegrees((Math.atan2(point.x - pose.x, point.z - pose.z) * 180) / Math.PI);
  return { ...pose, yawDeg };
}

function describe(pose: OnFootPose, interactable: Interactable): FocusTarget {
  const distanceMeters = distanceTo(pose, interactable.position);
  const bearing = normalizeDegrees(
    (Math.atan2(interactable.position.x - pose.x, interactable.position.z - pose.z) * 180) / Math.PI,
  );
  const angleDeg = angleBetween(pose.yawDeg, bearing);
  const inReach = distanceMeters <= interactable.reachMeters;
  const usable = interactable.sealedReason === null;

  const verb = VERBS[interactable.kind];
  const prompt = !usable
    ? `${interactable.label}. ${interactable.sealedReason ?? ""}`.trim()
    : inReach
      ? `E — ${verb} ${interactable.label}`
      : `${interactable.label} — ${distanceMeters.toFixed(0)} m away`;

  const announcement = !usable
    ? `${interactable.label}. ${interactable.sealedReason ?? ""}`.trim()
    : inReach
      ? `${interactable.label} within reach. Press E to ${verb.toLowerCase()}.`
      : `${interactable.label}, ${distanceMeters.toFixed(0)} metres away. Walk closer to use it.`;

  return { interactable, distanceMeters, angleDeg, inReach, usable, prompt, announcement };
}

function distanceTo(pose: OnFootPose, point: RoomPoint): number {
  return Math.hypot(point.x - pose.x, point.z - pose.z);
}

function angleBetween(fromDeg: number, toDeg: number): number {
  const difference = Math.abs(normalizeDegrees(toDeg) - normalizeDegrees(fromDeg)) % 360;
  return difference > 180 ? 360 - difference : difference;
}
