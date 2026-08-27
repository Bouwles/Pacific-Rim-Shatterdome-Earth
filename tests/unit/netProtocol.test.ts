import { describe, expect, it } from "vitest";
import {
  channelFor,
  createMessageRegistry,
  MESSAGE_SPECS,
  NET_MESSAGE_TYPES,
  NET_PROTOCOL_VERSION,
  validateMessage,
  validateMessageSpec,
  type NetMessage,
} from "../../src/net/protocol";
import { HOSTILE_LINK, LoopbackTransport, PERFECT_LINK, pumpPair } from "../../src/net/transport";

const hello: NetMessage = {
  type: "hello",
  schemaVersion: 1,
  protocolVersion: NET_PROTOCOL_VERSION,
  buildVersion: "test",
  displayName: "Second player",
};

describe("the message catalogue", () => {
  it("has a row for every message type", () => {
    expect(createMessageRegistry().all()).toHaveLength(NET_MESSAGE_TYPES.length);
  });

  it("keeps consequence on the reliable channel and appearance on the unreliable one", () => {
    expect(channelFor("event")).toBe("reliable");
    expect(channelFor("input")).toBe("reliable");
    expect(channelFor("result")).toBe("reliable");
    expect(channelFor("snapshot")).toBe("unreliable");
    expect(channelFor("transform")).toBe("unreliable");
  });

  it("refuses a reliable message marked as droppable", () => {
    const spec = MESSAGE_SPECS.find((entry) => entry.id === "event")!;
    expect(validateMessageSpec({ ...spec, droppable: true }).join(" ")).toMatch(/cannot be droppable/);
  });

  it("refuses an unreliable message that claims it must arrive", () => {
    const spec = MESSAGE_SPECS.find((entry) => entry.id === "snapshot")!;
    expect(validateMessageSpec({ ...spec, droppable: false }).join(" ")).toMatch(/safe to lose/);
  });

  it("accepts a well-formed message", () => {
    expect(validateMessage(hello)).toEqual([]);
  });

  it("refuses a message with no type this build knows", () => {
    expect(validateMessage({ type: "nonsense", schemaVersion: 1 }).join(" ")).toMatch(/unknown message/);
  });

  it("refuses a message from a schema this build cannot read", () => {
    expect(validateMessage({ ...hello, schemaVersion: 7 }).join(" ")).toMatch(/schemaVersion must be 1/);
  });

  it("refuses a refusal that carries no explanation", () => {
    expect(
      validateMessage({ type: "reject", schemaVersion: 1, reason: "session-full", detail: "" }).length,
    ).toBeGreaterThan(0);
  });

  it("refuses an input with a sequence that is not a whole number", () => {
    expect(
      validateMessage({
        type: "input",
        schemaVersion: 1,
        seq: 1.5,
        tick: 0,
        intent: "guard",
        targetId: null,
        east: 0,
        north: 0,
        yawDeg: 0,
        pressed: true,
      }).join(" "),
    ).toMatch(/seq must be/);
  });

  it("refuses an intent nobody wrote", () => {
    expect(
      validateMessage({
        type: "input",
        schemaVersion: 1,
        seq: 0,
        tick: 0,
        intent: "self-destruct",
        targetId: null,
        east: 0,
        north: 0,
        yawDeg: 0,
        pressed: false,
      }).join(" "),
    ).toMatch(/unknown intent/);
  });

  it("refuses anything that is not an object at all", () => {
    expect(validateMessage(null).length).toBeGreaterThan(0);
    expect(validateMessage("hello").length).toBeGreaterThan(0);
  });
});

describe("the loopback link", () => {
  it("delivers nothing until time is advanced", () => {
    const pair = LoopbackTransport.pair(PERFECT_LINK);
    const seen: NetMessage[] = [];
    pair[1].onMessage((message) => seen.push(message));
    pair[0].send(hello);
    expect(seen).toHaveLength(0);
    pumpPair(pair, 0);
    expect(seen).toHaveLength(1);
    pair[0].close();
  });

  it("never drops a reliable message however bad the link is", () => {
    // Loss cranked right up, duplication off: this is about what the channel
    // guarantees to deliver, not about what a retransmission repeats.
    const pair = LoopbackTransport.pair({ ...HOSTILE_LINK, lossRate: 0.9, duplicateRate: 0 });
    const seen: NetMessage[] = [];
    pair[1].onMessage((message) => seen.push(message));
    for (let index = 0; index < 20; index += 1) {
      pumpPair(pair, index * 40);
      pair[0].send({ ...hello, displayName: `player-${index}` });
    }
    for (let step = 0; step < 40; step += 1) pumpPair(pair, 1_000 + step * 50);
    expect(seen).toHaveLength(20);
    pair[0].close();
  });

  it("delivers reliable messages in the order they were sent, whatever jitter does", () => {
    const pair = LoopbackTransport.pair({ latencyMs: 100, jitterMs: 90, lossRate: 0, duplicateRate: 0 });
    const seen: string[] = [];
    pair[1].onMessage((message) => {
      if (message.type === "hello") seen.push(message.displayName);
    });
    for (let index = 0; index < 12; index += 1) {
      pair[0].setClock(index * 10);
      pair[0].send({ ...hello, displayName: `p${index}` });
    }
    for (let step = 0; step < 60; step += 1) pumpPair(pair, 200 + step * 20);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, index) => `p${index}`));
    pair[0].close();
  });

  it("does drop unreliable messages, because that is what unreliable means", () => {
    const pair = LoopbackTransport.pair({ latencyMs: 0, jitterMs: 0, lossRate: 0.5, duplicateRate: 0 });
    let seen = 0;
    pair[1].onMessage(() => {
      seen += 1;
    });
    for (let index = 0; index < 200; index += 1) {
      pair[0].send({ type: "transform", schemaVersion: 1, tick: index, poses: [] });
    }
    pumpPair(pair, 10);
    expect(seen).toBeGreaterThan(50);
    expect(seen).toBeLessThan(200);
    expect(pair[1].stats().droppedByNetwork).toBeGreaterThan(0);
    pair[0].close();
  });

  it("throws away a message that fails validation rather than passing it on", () => {
    const pair = LoopbackTransport.pair(PERFECT_LINK);
    let seen = 0;
    pair[1].onMessage(() => {
      seen += 1;
    });
    pair[0].send({ type: "hello", schemaVersion: 1, protocolVersion: 1, buildVersion: "", displayName: "" });
    pumpPair(pair, 0);
    expect(seen).toBe(0);
    expect(pair[1].stats().droppedAsInvalid).toBe(1);
    pair[0].close();
  });

  it("closes both ends together and stops delivering", () => {
    const pair = LoopbackTransport.pair(PERFECT_LINK);
    let seen = 0;
    pair[1].onMessage(() => {
      seen += 1;
    });
    pair[0].close("Done.");
    expect(pair[0].status.state).toBe("closed");
    expect(pair[1].status.state).toBe("closed");
    pair[0].send(hello);
    pumpPair(pair, 100);
    expect(seen).toBe(0);
  });

  it("is safe to close twice", () => {
    const pair = LoopbackTransport.pair(PERFECT_LINK);
    pair[0].close();
    expect(() => pair[0].close()).not.toThrow();
  });
});
