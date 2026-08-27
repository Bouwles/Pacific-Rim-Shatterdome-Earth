import { describe, expect, it } from "vitest";
import { CombatArena, combatProfileFor, jaegerLayout, jaegerZones } from "../../src/combat/arena";
import { createMoveRegistry } from "../../src/data/moves";
import { jaegerRegistry } from "../../src/data/jaegers";
import { GUEST_TIMEOUT_TICKS, HostSession, MAX_INPUT_LAG_TICKS } from "../../src/net/hostSession";
import { GuestSession, MAX_PREDICTION_TICKS } from "../../src/net/guestSession";
import { LoopbackTransport, PERFECT_LINK, pumpPair } from "../../src/net/transport";
import { NET_PROTOCOL_VERSION, type GuestLoadout } from "../../src/net/protocol";
import { compareLinks, runCoopBattle } from "../../src/debug/coopScenario";
import { HOSTILE_LINK } from "../../src/net/transport";

const LOADOUT: GuestLoadout = {
  jaegerId: "heavy-mk4",
  chassisId: "heavy-mk4",
  displayName: "Lent frame",
  weaponIds: [],
};

function arena(): CombatArena {
  const machine = jaegerRegistry.getOrThrow("heavy-mk4");
  const spec = (id: string, east: number) => ({
    id,
    kind: "jaeger" as const,
    displayName: machine.name,
    heightMeters: machine.locomotion.heightMeters,
    profile: combatProfileFor(machine),
    pose: { east, north: 0, up: 0, yawDeg: 0 },
    zones: jaegerZones(machine),
    layout: jaegerLayout(machine),
    finisherThreshold: 0.2,
  });
  return new CombatArena({
    moves: createMoveRegistry(),
    seed: 7,
    fighters: [spec("jaeger", 0), spec("guest", 30)],
  });
}

function build(options: { readonly safe?: boolean } = {}) {
  const pair = LoopbackTransport.pair(PERFECT_LINK);
  const host = new HostSession({
    arena: arena(),
    transport: pair[0],
    guestFighterId: "guest",
    guestLoadout: LOADOUT,
    sessionId: "session.test",
    buildVersion: "test",
    isSafePoint: () => options.safe ?? true,
  });
  const guest = new GuestSession({ transport: pair[1], displayName: "Player two", buildVersion: "test" });
  const settle = (): void => {
    for (let step = 0; step < 6; step += 1) pumpPair(pair, step * 10);
  };
  return { pair, host, guest, settle };
}

describe("joining", () => {
  it("hands the guest the machine the host chose", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    expect(guest.view().phase).toBe("playing");
    expect(guest.view().fighterId).toBe("guest");
    expect(guest.view().loadout?.displayName).toBe("Lent frame");
    expect(host.status().guest?.displayName).toBe("Player two");
    host.dispose();
    guest.dispose();
  });

  it("refuses a build that speaks a different protocol, and says which", () => {
    const { host, guest, pair, settle } = build();
    pair[1].send({
      type: "hello",
      schemaVersion: 1,
      protocolVersion: NET_PROTOCOL_VERSION + 1,
      buildVersion: "future",
      displayName: "Player two",
    });
    settle();
    expect(guest.view().phase).toBe("rejected");
    expect(guest.view().detail).toMatch(/protocol/);
    expect(guest.view().detail).toMatch(/same build/);
    expect(host.status().guest).toBeNull();
    host.dispose();
    guest.dispose();
  });

  it("refuses a join in the middle of a sequence, and says it can be tried again", () => {
    const { host, guest, settle } = build({ safe: false });
    guest.join();
    settle();
    expect(guest.view().phase).toBe("rejected");
    expect(guest.view().detail).toMatch(/mid-sequence/);
    host.dispose();
    guest.dispose();
  });

  it("refuses a second guest rather than seating two in one machine", () => {
    const { host, guest, pair, settle } = build();
    guest.join();
    settle();
    const gatecrasher = new GuestSession({
      transport: pair[1],
      displayName: "Player three",
      buildVersion: "test",
    });
    gatecrasher.join();
    settle();
    expect(gatecrasher.view().phase).toBe("rejected");
    expect(host.status().guest?.displayName).toBe("Player two");
    gatecrasher.dispose();
    host.dispose();
    guest.dispose();
  });

  it("refuses a join once the session has finished", () => {
    const { host, guest, settle } = build();
    host.finish("victory", ["Over."]);
    guest.join();
    settle();
    expect(guest.view().phase).toBe("rejected");
    host.dispose();
    guest.dispose();
  });
});

describe("host authority", () => {
  it("applies a guest input exactly once, however many times it arrives", () => {
    const { host, guest, pair, settle } = build();
    guest.join();
    settle();
    const seq = guest.send("guard", { pressed: true })!;
    settle();
    host.advance();
    const applied = host.status().guest!.appliedInputs;

    // The same message again, as a retransmission would deliver it.
    pair[1].send({
      type: "input",
      schemaVersion: 1,
      seq,
      tick: 0,
      intent: "guard",
      targetId: null,
      east: 0,
      north: 0,
      yawDeg: 0,
      pressed: true,
    });
    settle();
    expect(host.status().guest!.appliedInputs).toBe(applied);
    expect(host.status().guest!.duplicateInputs).toBe(1);
    host.dispose();
    guest.dispose();
  });

  it("refuses an input from too far in the past to mean anything", () => {
    const { host, guest, pair, settle } = build();
    guest.join();
    settle();
    for (let tick = 0; tick < MAX_INPUT_LAG_TICKS + 10; tick += 1) host.advance();
    pair[1].send({
      type: "input",
      schemaVersion: 1,
      seq: 99,
      tick: 0,
      intent: "press-move",
      targetId: "melee.light.jab",
      east: 0,
      north: 0,
      yawDeg: 0,
      pressed: false,
    });
    settle();
    expect(host.status().guest!.rejectedInputs).toBe(1);
    expect(host.status().guest!.appliedInputs).toBe(0);
    host.dispose();
    guest.dispose();
  });

  it("refuses an input claiming to be from the future", () => {
    const { host, guest, pair, settle } = build();
    guest.join();
    settle();
    pair[1].send({
      type: "input",
      schemaVersion: 1,
      seq: 5,
      tick: 500,
      intent: "guard",
      targetId: null,
      east: 0,
      north: 0,
      yawDeg: 0,
      pressed: true,
    });
    settle();
    expect(host.status().guest!.rejectedInputs).toBe(1);
    host.dispose();
    guest.dispose();
  });

  it("produces exactly one result, and a second attempt changes nothing", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    const first = host.finish("victory", ["It is down."]);
    const second = host.finish("defeat", ["No it is not."]);
    settle();
    expect(first?.outcome).toBe("victory");
    expect(second).toBeNull();
    expect(guest.view().result?.outcome).toBe("victory");
    host.dispose();
    guest.dispose();
  });

  it("steps nothing at all while paused", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    host.advance();
    const tick = host.status().tick;
    host.setPaused(true, "Host stepped away.");
    host.advance();
    host.advance();
    expect(host.status().tick).toBe(tick);
    settle();
    expect(guest.view().paused).toBe(true);
    host.setPaused(false, "Back.");
    host.advance();
    expect(host.status().tick).toBe(tick + 1);
    host.dispose();
    guest.dispose();
  });

  it("answers a guest's request to pause rather than ignoring it", () => {
    const { host, guest, pair, settle } = build();
    guest.join();
    settle();
    pair[1].send({
      type: "pause",
      schemaVersion: 1,
      paused: true,
      by: "guest",
      detail: "Need a moment.",
    });
    settle();
    expect(host.status().paused).toBe(true);
    expect(guest.view().paused).toBe(true);
    host.dispose();
    guest.dispose();
  });
});

describe("when a connection goes wrong", () => {
  it("holds a silent guest's machine in place rather than removing it", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    for (let tick = 0; tick <= GUEST_TIMEOUT_TICKS + 2; tick += 1) host.advance();
    expect(host.status().guest?.state).toBe("stalled");
    expect(host.lines().join(" ")).toMatch(/holding position/);
    host.dispose();
    guest.dispose();
  });

  it("lets a dropped guest rejoin without replaying its old inputs", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    guest.send("guard", { pressed: true });
    settle();
    host.advance();
    const applied = host.status().guest!.appliedInputs;
    for (let tick = 0; tick <= GUEST_TIMEOUT_TICKS + 2; tick += 1) host.advance();

    guest.join();
    settle();
    expect(host.status().guest?.state).toBe("active");
    // The sequence guard survived, so nothing from before the drop can be
    // replayed to press a button a second time.
    expect(host.status().guest!.appliedInputs).toBe(applied);
    expect(host.lines().join(" ")).toMatch(/rejoined/);
    host.dispose();
    guest.dispose();
  });

  it("stops predicting once it has been guessing too long, and says so", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    for (let tick = 0; tick <= MAX_PREDICTION_TICKS + 2; tick += 1) guest.advance();
    expect(guest.view().phase).toBe("stalled");
    expect(guest.view().detail).toMatch(/Nothing on screen is current/);
    host.dispose();
    guest.dispose();
  });

  it("tells the guest why when the host ends it", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    host.abort("Host had to go.");
    settle();
    expect(guest.view().phase).toBe("finished");
    expect(guest.view().result?.outcome).toBe("aborted");
    host.dispose();
    guest.dispose();
  });

  it("notices a guest that left on purpose", () => {
    const { host, guest, settle } = build();
    guest.join();
    settle();
    guest.leave("Called it a night.");
    settle();
    expect(host.status().guest?.state).toBe("left");
    host.dispose();
    guest.dispose();
  });
});

describe("a whole battle over a bad link", () => {
  const comparison = compareLinks();

  it("actually degraded the link, so the run means something", () => {
    expect(comparison.degraded).toBe(true);
    expect(comparison.hostile.droppedByNetwork).toBeGreaterThan(0);
  });

  it("duplicates nothing", () => {
    expect(comparison.violations).toEqual([]);
    expect(comparison.nothingDuplicated).toBe(true);
  });

  it("applies every announcement exactly once on both links", () => {
    expect(comparison.clean.guestApplied).toBe(comparison.clean.hostEvents);
    expect(comparison.hostile.guestApplied).toBe(comparison.hostile.hostEvents);
    expect(comparison.hostile.guestDuplicates).toBeGreaterThan(0);
  });

  it("feeds every input to the arena exactly once on both links", () => {
    expect(comparison.clean.appliedInputs).toBe(comparison.clean.inputsSent);
    expect(comparison.hostile.appliedInputs).toBe(comparison.hostile.inputsSent);
    expect(comparison.hostile.duplicateInputs).toBeGreaterThan(0);
  });

  it("never lets a worse link deal more damage or land more finishers", () => {
    expect(comparison.hostile.hostDamage).toBeLessThanOrEqual(comparison.clean.hostDamage);
    expect(comparison.hostile.hostFinishers).toBeLessThanOrEqual(comparison.clean.hostFinishers);
  });

  it("ends with one result, from the host", () => {
    expect(comparison.clean.outcome).toBe(comparison.hostile.outcome);
    expect(comparison.clean.hostDigest).toBeGreaterThan(0);
  });

  it("is deterministic: two runs of the same conditions agree exactly", () => {
    expect(runCoopBattle(HOSTILE_LINK)).toEqual(runCoopBattle(HOSTILE_LINK));
  });
});
