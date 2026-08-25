import { describe, expect, it } from "vitest";
import { createFacilityRegistry } from "../../src/data/facilities";
import {
  ShatterdomeState,
  defaultLocation,
  emptyShatterdomeSnapshot,
  validateShatterdomeSnapshot,
  type ShatterdomeSnapshot,
} from "../../src/shatterdome/facilityState";
import { CONN_POD_ROOM_ID } from "../../src/shatterdome/interiorLayout";

const ROOMS = new Set([
  ...createFacilityRegistry()
    .all()
    .map((entry) => entry.id),
  CONN_POD_ROOM_ID,
]);

function freshState(): ShatterdomeState {
  return new ShatterdomeState(createFacilityRegistry());
}

/** Runs an order to completion, whatever the tier costs. */
function finish(state: ShatterdomeState, facilityId: Parameters<ShatterdomeState["order"]>[0]): void {
  const result = state.order(facilityId);
  if (!result.ok) throw new Error(`order refused: ${result.message}`);
  state.advance(result.record.workRemainingTicks);
}

describe("Shatterdome state", () => {
  it("starts with the facilities the grammar says start built", () => {
    const state = freshState();
    expect(state.isOperational("command")).toBe(true);
    expect(state.isOperational("jaeger-bay")).toBe(true);
    expect(state.isOperational("research")).toBe(false);
    expect(state.recordFor("research")?.status).toBe("absent");
  });

  it("balances power across the whole complex", () => {
    const power = freshState().power();
    expect(power.outputMw).toBeGreaterThan(0);
    expect(power.headroomMw).toBe(power.outputMw - power.drawMw);
    expect(power.headroomMw).toBeGreaterThanOrEqual(0);
  });

  it("holds crews for the length of an order and releases them when it lands", () => {
    const state = freshState();
    const before = state.crews();
    const result = state.order("research");
    expect(result.ok).toBe(true);
    // Crews are handed out by the queue on the tick work actually starts, not
    // at the moment an order is placed: a queued project is not using anybody.
    state.advance(1);
    expect(state.crews().free).toBe(before.free - 1);
    state.advance(999_999);
    expect(state.crews().free).toBe(before.free);
    expect(state.recordFor("research")?.status).toBe("operational");
  });

  it("refuses a second order on the same facility rather than restarting it", () => {
    const state = freshState();
    state.order("research");
    const second = state.order("research");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already-working");
  });

  it("queues an order with no crews free rather than refusing it", () => {
    const state = freshState();
    // Three at the start: two base, plus one mustered by the working stores.
    expect(state.crews().capacity).toBe(3);
    state.order("research");
    state.order("archive");
    state.order("contract");
    // A fourth order with nobody free is accepted and waits its turn. Being
    // short of crews is a scheduling problem the player solves by choosing what
    // matters, which is the whole point of having a queue.
    const fourth = state.order("training");
    expect(fourth.ok).toBe(true);
    state.advance(1);
    const waiting = state.projects(state.staffSlots()).find((entry) => entry.facilityId === "training");
    expect(waiting).toBeDefined();
    expect(waiting!.stalledBecause).toMatch(/Waiting for/);
  });

  it("refuses an order the reactor cannot carry, naming both numbers", () => {
    const state = freshState();
    // Manufacture is the first facility that genuinely does not fit on one loop.
    finish(state, "logistics");
    finish(state, "research");
    const refusal = state.checkOrder("manufacture");
    expect(refusal?.reason).toBe("no-power");
    expect(refusal?.message).toMatch(/MW against/);
    expect(refusal?.message).toMatch(/reactor/i);
  });

  it("lets the same order through once the reactor has been upgraded", () => {
    const state = freshState();
    finish(state, "logistics");
    finish(state, "research");
    expect(state.checkOrder("manufacture")?.reason).toBe("no-power");
    finish(state, "reactor");
    expect(state.checkOrder("manufacture")).toBeNull();
  });

  it("adds crews when logistics grows, which is what makes parallel building possible", () => {
    const state = freshState();
    const before = state.crews().capacity;
    finish(state, "logistics");
    expect(state.crews().capacity).toBeGreaterThan(before);
  });

  it("refuses to build past the top tier", () => {
    const state = freshState();
    finish(state, "archive");
    const refusal = state.checkOrder("archive");
    expect(refusal?.reason).toBe("at-max-tier");
  });

  it("reports progress that climbs and reaches completion exactly once", () => {
    const state = freshState();
    const result = state.order("research");
    if (!result.ok) throw new Error("order refused");
    const total = result.record.workRemainingTicks;
    state.advance(Math.floor(total / 2));
    expect(state.progressOf("research")).toBeGreaterThan(0.4);
    expect(state.progressOf("research")).toBeLessThan(0.6);
    const completions = state.advance(total);
    expect(completions.map((entry) => entry.facilityId)).toEqual(["research"]);
    expect(completions[0]?.firstBuild).toBe(true);
    expect(state.advance(total)).toEqual([]);
    expect(state.progressOf("research")).toBe(0);
  });

  it("distinguishes a first build from an upgrade in what it reports", () => {
    const state = freshState();
    // Research is not built at the start, so its first tier is a build and its
    // second is an upgrade. The reactor would do as well but its third tier now
    // waits on a fabrication hall, which is a different thing to test.
    const first = state.order("research");
    if (!first.ok) throw new Error(`order refused: ${first.message}`);
    const built = state.advance(first.record.workRemainingTicks);
    expect(built[0]?.firstBuild).toBe(true);
    expect(built[0]?.tier).toBe(1);

    // The laboratory's second tier wants an infirmary next door first, which is
    // exactly the kind of prerequisite this milestone added, so it is satisfied
    // rather than worked around.
    finish(state, "medical");
    const second = state.order("research");
    if (!second.ok) throw new Error(`order refused: ${second.message}`);
    const upgraded = state.advance(second.record.workRemainingTicks);
    expect(upgraded[0]?.firstBuild).toBe(false);
    expect(upgraded[0]?.tier).toBe(2);
  });

  it("advances nothing on a zero or negative tick count", () => {
    const state = freshState();
    state.order("research");
    const before = state.recordFor("research")?.workRemainingTicks;
    state.advance(0);
    state.advance(-50);
    expect(state.recordFor("research")?.workRemainingTicks).toBe(before);
  });

  it("round-trips through a snapshot with a build still running", () => {
    const state = freshState();
    state.order("research");
    state.advance(1_000);
    state.setPlayerLocation({ roomId: "jaeger-bay", x: 4, z: -12, yawDeg: 90 });
    state.selectJaeger("placeholder-mk0");
    const snapshot = state.serialize();

    const restored = freshState();
    restored.restore(snapshot, ROOMS);
    // Everything about the complex comes back, including what is outstanding
    // and how far along it is. What does not come back is a project holding
    // crews mid-tick: it is queued again and given crews on the next tick.
    expect(restored.recordFor("research")?.workRemainingTicks).toBe(
      state.recordFor("research")?.workRemainingTicks,
    );
    expect(restored.playerLocation).toEqual(snapshot.location);
    expect(restored.construction().live()).toHaveLength(1);
    expect(restored.recordFor("research")?.status).toBe("building");
    expect(restored.playerLocation.roomId).toBe("jaeger-bay");
    expect(restored.selectedJaegerId).toBe("placeholder-mk0");
    // And it keeps building from where it left off.
    restored.advance(999_999);
    expect(restored.isOperational("research")).toBe(true);
  });

  it("gives a facility added since the save was written its own default", () => {
    const state = freshState();
    const snapshot: ShatterdomeSnapshot = {
      ...state.serialize(),
      facilities: state.serialize().facilities.filter((record) => record.facilityId !== "training"),
    };
    const restored = freshState();
    restored.restore(snapshot, ROOMS);
    expect(restored.recordFor("training")?.status).toBe("absent");
  });

  it("rejects a snapshot whose room this build does not have", () => {
    const snapshot: ShatterdomeSnapshot = {
      ...emptyShatterdomeSnapshot(createFacilityRegistry()),
      location: { roomId: "swimming-pool", x: 0, z: 0, yawDeg: 0 },
    };
    const errors = validateShatterdomeSnapshot(snapshot, ROOMS);
    expect(errors.join(" ")).toMatch(/swimming-pool/);
    expect(() => freshState().restore(snapshot, ROOMS)).toThrow(/swimming-pool/);
  });

  it("rejects a record that claims to be operational at tier zero", () => {
    const base = emptyShatterdomeSnapshot(createFacilityRegistry());
    const first = base.facilities[0];
    if (!first) throw new Error("no facilities");
    const snapshot: ShatterdomeSnapshot = {
      ...base,
      facilities: [{ ...first, tier: 0, status: "operational" }, ...base.facilities.slice(1)],
    };
    expect(validateShatterdomeSnapshot(snapshot, ROOMS).join(" ")).toMatch(/operational at tier 0/);
  });

  it("rejects a record holding crews with no order running", () => {
    const base = emptyShatterdomeSnapshot(createFacilityRegistry());
    const first = base.facilities[0];
    if (!first) throw new Error("no facilities");
    const snapshot: ShatterdomeSnapshot = {
      ...base,
      facilities: [{ ...first, crewsHeld: 2 }, ...base.facilities.slice(1)],
    };
    expect(validateShatterdomeSnapshot(snapshot, ROOMS).join(" ")).toMatch(/holds crews/);
  });

  it("starts a fresh complex on the command floor", () => {
    expect(defaultLocation().roomId).toBe("command");
    expect(emptyShatterdomeSnapshot(createFacilityRegistry()).selectedJaegerId).toBeNull();
    expect(validateShatterdomeSnapshot(emptyShatterdomeSnapshot(createFacilityRegistry()), ROOMS)).toEqual(
      [],
    );
  });
});
