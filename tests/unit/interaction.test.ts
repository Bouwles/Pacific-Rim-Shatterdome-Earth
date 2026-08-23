import { describe, expect, it } from "vitest";
import { FOCUS_CONE_DEG, cycleFocus, faceToward, resolveFocus } from "../../src/shatterdome/interaction";
import { poseAt } from "../../src/shatterdome/onFoot";
import type { Interactable } from "../../src/shatterdome/interiorLayout";
import { room } from "./onFootFixtures";

function fixture(overrides: Partial<Interactable> = {}): Interactable {
  return {
    id: "terminal.0",
    kind: "terminal",
    label: "Command console",
    position: { x: 0, z: 2 },
    facingDeg: 180,
    reachMeters: 2.4,
    facilityId: "command",
    targetRoomId: null,
    connectionKind: null,
    sealedReason: null,
    jaegerId: null,
    crewId: null,
    ...overrides,
  };
}

describe("interaction focus", () => {
  it("focuses what the player is looking at and says how to use it", () => {
    const target = fixture();
    const focus = resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [target] }));
    expect(focus?.interactable.id).toBe("terminal.0");
    expect(focus?.inReach).toBe(true);
    expect(focus?.prompt).toMatch(/^E — Use Command console$/);
    expect(focus?.announcement).toMatch(/Press E/);
  });

  it("ignores what is behind the player", () => {
    const behind = fixture({ position: { x: 0, z: -2 } });
    expect(resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [behind] }))).toBeNull();
  });

  it("focuses a fixture out of reach and reports the distance rather than nothing", () => {
    const far = fixture({ position: { x: 0, z: 5 } });
    const focus = resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [far] }));
    expect(focus?.inReach).toBe(false);
    expect(focus?.prompt).toMatch(/5 m away/);
  });

  it("drops a fixture far beyond its own reach entirely", () => {
    const veryFar = fixture({ position: { x: 0, z: 40 } });
    expect(resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [veryFar] }))).toBeNull();
  });

  it("prefers the nearer of two things in view", () => {
    const near = fixture({ id: "near", position: { x: 0.4, z: 1.4 } });
    const far = fixture({ id: "far", position: { x: 0, z: 3 } });
    const focus = resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [far, near] }));
    expect(focus?.interactable.id).toBe("near");
  });

  it("keeps the focus cone narrow enough to mean something", () => {
    expect(FOCUS_CONE_DEG).toBeGreaterThan(30);
    expect(FOCUS_CONE_DEG).toBeLessThan(90);
    const offToTheSide = fixture({ position: { x: 3, z: 0.2 } });
    expect(resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [offToTheSide] }))).toBeNull();
  });

  it("focuses a sealed door and explains it rather than staying silent", () => {
    const sealed = fixture({
      id: "sealed",
      kind: "transit",
      label: "Sealed bulkhead: Fabrication Hall",
      sealedReason: "Fabrication Hall has not been built yet.",
    });
    const focus = resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [sealed] }));
    expect(focus?.usable).toBe(false);
    expect(focus?.prompt).toMatch(/has not been built/);
  });

  it("uses the right verb for each kind of fixture", () => {
    const cases: Array<[Interactable["kind"], RegExp]> = [
      ["terminal", /Use/],
      ["staff-post", /Speak to/],
      ["berth", /Inspect/],
      ["conn-pod", /Board/],
      ["transit", /Enter/],
    ];
    for (const [kind, verb] of cases) {
      const focus = resolveFocus(
        poseAt({ x: 0, z: 0 }),
        room({ interactables: [fixture({ kind, position: { x: 0, z: 1.5 } })] }),
      );
      expect(focus?.prompt).toMatch(verb);
    }
  });
});

describe("keyboard focus", () => {
  it("cycles through the fixtures in the room, nearest first", () => {
    const near = fixture({ id: "near", position: { x: 0, z: 1 } });
    const far = fixture({ id: "far", position: { x: 0, z: 6 } });
    const space = room({ interactables: [far, near] });
    const first = cycleFocus(poseAt({ x: 0, z: 0 }), space, null);
    expect(first).toBe("near");
    expect(cycleFocus(poseAt({ x: 0, z: 0 }), space, first)).toBe("far");
    // And wraps rather than running off the end.
    expect(cycleFocus(poseAt({ x: 0, z: 0 }), space, "far")).toBe("near");
  });

  it("cycles backwards too", () => {
    const a = fixture({ id: "a", position: { x: 0, z: 1 } });
    const b = fixture({ id: "b", position: { x: 0, z: 4 } });
    const space = room({ interactables: [a, b] });
    expect(cycleFocus(poseAt({ x: 0, z: 0 }), space, "a", -1)).toBe("b");
  });

  it("returns nothing in a room with nothing in it", () => {
    expect(cycleFocus(poseAt({ x: 0, z: 0 }), room(), null)).toBeNull();
  });

  it("pins a keyboard-chosen target even when it is behind the player", () => {
    const behind = fixture({ id: "behind", position: { x: 0, z: -2 } });
    const focus = resolveFocus(poseAt({ x: 0, z: 0 }), room({ interactables: [behind] }), "behind");
    expect(focus?.interactable.id).toBe("behind");
  });

  it("turns the player to face what they picked, so the world agrees with the prompt", () => {
    const east = faceToward(poseAt({ x: 0, z: 0 }), { x: 5, z: 0 });
    expect(east.yawDeg).toBeCloseTo(90, 4);
    const south = faceToward(poseAt({ x: 0, z: 0 }), { x: 0, z: -5 });
    expect(south.yawDeg).toBeCloseTo(180, 4);
  });
});
