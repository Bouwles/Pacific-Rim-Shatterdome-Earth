import { describe, expect, it, vi } from "vitest";
import { EventBus, type SimEvent } from "../../src/simulation/events";

const ping: SimEvent = { type: "ping", schemaVersion: 1 };

describe("EventBus", () => {
  it("buffers on emit and only dispatches on drain", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe("ping", handler);

    bus.emit(ping);
    expect(handler).not.toHaveBeenCalled();
    expect(bus.pending).toBe(1);

    expect(bus.drain()).toBe(1);
    expect(handler).toHaveBeenCalledWith(ping);
    expect(bus.pending).toBe(0);
  });

  it("delivers only to subscribers of that event type", () => {
    const bus = new EventBus();
    const pingHandler = vi.fn();
    const otherHandler = vi.fn();
    bus.subscribe("ping", pingHandler);
    bus.subscribe("pong", otherHandler);

    bus.emit(ping);
    bus.drain();

    expect(pingHandler).toHaveBeenCalledOnce();
    expect(otherHandler).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("ping", handler);

    unsubscribe();
    bus.emit(ping);
    bus.drain();

    expect(handler).not.toHaveBeenCalled();
  });

  it("defers events emitted by a handler to the next drain, so drain terminates", () => {
    const bus = new EventBus();
    let reentrantEmits = 0;
    bus.subscribe("ping", () => {
      if (reentrantEmits < 3) {
        reentrantEmits += 1;
        bus.emit(ping);
      }
    });

    bus.emit(ping);
    expect(bus.drain()).toBe(1);
    expect(bus.pending).toBe(1);
  });

  it("drains to zero when nothing is queued", () => {
    expect(new EventBus().drain()).toBe(0);
  });

  it("dispose clears queued events and subscriptions", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe("ping", handler);
    bus.emit(ping);

    bus.dispose();

    expect(bus.pending).toBe(0);
    bus.emit(ping);
    bus.drain();
    expect(handler).not.toHaveBeenCalled();
  });
});
