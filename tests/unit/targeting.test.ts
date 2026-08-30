import { describe, expect, it } from "vitest";
import { createKaijuRegistry } from "../../src/data/kaiju";
import {
  INITIAL_TARGETING,
  SOFT_TARGET_CONE_DEG,
  TARGET_RANGE_METERS,
  cycleTarget,
  rankTargets,
  setAimMode,
  setAimZone,
  setLock,
  softTarget,
  zoneAtPoint,
  zonePosition,
  zoneUnderAim,
  type TargetCandidate,
} from "../../src/combat/targeting";

const KAIJU = createKaijuRegistry().getOrThrow("kaiju.biped-alpha");
const PLAYER = { east: 0, north: 0, up: 0, yawDeg: 0 };

function candidate(id: string, east: number, north: number, radius = 16): TargetCandidate {
  return { id, east, north, up: 0, radiusMeters: radius, displayName: id };
}

describe("soft targeting", () => {
  it("picks what the player is already facing", () => {
    const ahead = candidate("ahead", 0, 200);
    const behind = candidate("behind", 0, -120);
    const pick = softTarget(PLAYER, 0, [behind, ahead]);
    expect(pick?.candidate.id).toBe("ahead");
  });

  it("ignores anything outside the cone, however close it is", () => {
    const beside = candidate("beside", 60, 4);
    expect(softTarget(PLAYER, 0, [beside])).toBeNull();
    // Turn to look at it and it becomes the obvious answer.
    expect(softTarget(PLAYER, 86, [beside])?.candidate.id).toBe("beside");
  });

  it("ignores anything out of range", () => {
    expect(softTarget(PLAYER, 0, [candidate("far", 0, TARGET_RANGE_METERS + 50)])).toBeNull();
  });

  it("prefers what is closer to the centre of view over what is merely closer", () => {
    const nearButWide = candidate("wide", 120, 120);
    const farButAhead = candidate("ahead", 0, 320);
    const picks = rankTargets(PLAYER, 0, [nearButWide, farButAhead]);
    expect(picks[0]?.candidate.id).toBe("ahead");
  });

  it("keeps the cone narrow enough to mean something", () => {
    expect(SOFT_TARGET_CONE_DEG).toBeLessThan(70);
  });

  it("returns nothing when there is nothing", () => {
    expect(softTarget(PLAYER, 0, [])).toBeNull();
  });
});

describe("cycling a lock", () => {
  const left = candidate("left", -200, 200);
  const middle = candidate("middle", 0, 240);
  const right = candidate("right", 220, 200);

  it("walks left to right as the player sees them", () => {
    const first = cycleTarget(PLAYER, 0, [right, middle, left], null);
    expect(first).toBe("left");
    const second = cycleTarget(PLAYER, 0, [right, middle, left], first);
    expect(second).toBe("middle");
    expect(cycleTarget(PLAYER, 0, [right, middle, left], second)).toBe("right");
  });

  it("wraps, and goes backwards", () => {
    expect(cycleTarget(PLAYER, 0, [left, middle, right], "right")).toBe("left");
    expect(cycleTarget(PLAYER, 0, [left, middle, right], "left", -1)).toBe("right");
  });

  it("gives back nothing when there is nothing in range", () => {
    expect(cycleTarget(PLAYER, 0, [], null)).toBeNull();
    expect(cycleTarget(PLAYER, 0, [candidate("far", 0, 5_000)], null)).toBeNull();
  });
});

describe("body zones", () => {
  const kaijuPose = { east: 0, north: 120, up: 0, yawDeg: 180 };

  it("places zones around the creature rather than all at its feet", () => {
    const head = KAIJU.zones.find((zone) => zone.id === "head");
    const tail = KAIJU.zones.find((zone) => zone.id === "tail");
    if (!head || !tail) throw new Error("expected a head and a tail");
    const headAt = zonePosition(KAIJU, head, kaijuPose);
    const tailAt = zonePosition(KAIJU, tail, kaijuPose);
    expect(headAt.up).toBeGreaterThan(tailAt.up + 30);
    // Facing the player, so the tail is on the far side.
    expect(tailAt.north).toBeGreaterThan(headAt.north);
  });

  it("picks the head looking up, the torso looking level, and the tail looking well down", () => {
    expect(zoneUnderAim(KAIJU, kaijuPose, PLAYER, 75, 22)?.zone.id).toBe("head");
    // The torso is eighteen metres across, so it owns most of the middle of the
    // creature. A gentle downward look is still the torso, and that is correct.
    expect(zoneUnderAim(KAIJU, kaijuPose, PLAYER, 75, -6)?.zone.id).toBe("torso");
    // Well down from the front is a leg now that the creature has them; the tail sits behind.
    expect(["tail", "leg.left", "leg.right"]).toContain(
      zoneUnderAim(KAIJU, kaijuPose, PLAYER, 75, -30)?.zone.id,
    );
  });

  it("attributes a hit to the zone it actually landed on", () => {
    const arm = KAIJU.zones.find((zone) => zone.id === "limb.left");
    if (!arm) throw new Error("expected an arm");
    const at = zonePosition(KAIJU, arm, kaijuPose);
    expect(zoneAtPoint(KAIJU, kaijuPose, at)?.zone.id).toBe("limb.left");
  });
});

describe("targeting state", () => {
  it("holds a lock and lets it go", () => {
    const locked = setLock(INITIAL_TARGETING, "kaiju.1");
    expect(locked.lockedId).toBe("kaiju.1");
    expect(setLock(locked, null).lockedId).toBeNull();
  });

  it("drops the aimed zone when aim mode is left, rather than leaving it steering attacks", () => {
    const aiming = setAimZone(setAimMode(INITIAL_TARGETING, true), "head");
    expect(aiming.aimZoneId).toBe("head");
    const relaxed = setAimMode(aiming, false);
    expect(relaxed.aimMode).toBe(false);
    expect(relaxed.aimZoneId).toBeNull();
  });

  it("keeps the lock through an aim-mode change, because they are different questions", () => {
    const state = setAimMode(setLock(INITIAL_TARGETING, "kaiju.1"), true);
    expect(state.lockedId).toBe("kaiju.1");
    expect(setAimMode(state, false).lockedId).toBe("kaiju.1");
  });
});
