import { describe, expect, it } from "vitest";
import { DEFAULT_BUFFER_TICKS, InputBuffer } from "../../src/jaegers/inputBuffer";

const ALWAYS = (): boolean => true;

describe("the input buffer", () => {
  it("hands back a press made slightly too early", () => {
    const buffer = new InputBuffer(10);
    buffer.press("booster", 100);
    // Illegal for a few ticks, then legal: the press has to survive the wait.
    expect(buffer.consume(() => false, 101)).toBeNull();
    const taken = buffer.consume(ALWAYS, 104);
    expect(taken?.action).toBe("booster");
  });

  it("drops a press whose window has closed rather than firing it late", () => {
    const buffer = new InputBuffer(6);
    buffer.press("booster", 0);
    expect(buffer.consume(ALWAYS, 20)).toBeNull();
    expect(buffer.snapshot().dropped).toBe(1);
  });

  it("keeps order, because light-light-heavy is not a set", () => {
    const buffer = new InputBuffer(30);
    buffer.press("light", 0);
    buffer.press("light", 1);
    buffer.press("heavy", 2);
    expect(buffer.consume(ALWAYS, 3)?.action).toBe("light");
    expect(buffer.consume(ALWAYS, 3)?.action).toBe("light");
    expect(buffer.consume(ALWAYS, 3)?.action).toBe("heavy");
    expect(buffer.consume(ALWAYS, 3)).toBeNull();
  });

  it("takes the oldest legal press, skipping one that is not", () => {
    const buffer = new InputBuffer(30);
    buffer.press("heavy", 0);
    buffer.press("light", 1);
    const taken = buffer.consume((action) => action === "light", 2);
    expect(taken?.action).toBe("light");
    // The illegal one is still waiting rather than having been thrown away.
    expect(buffer.has("heavy")).toBe(true);
  });

  it("bounds what a mashed key can queue", () => {
    const buffer = new InputBuffer(60, 3);
    for (let index = 0; index < 12; index += 1) buffer.press("light", index);
    expect(buffer.snapshot().pending).toHaveLength(3);
    expect(buffer.snapshot().dropped).toBe(9);
  });

  it("reports what it is holding, for the debug view", () => {
    const buffer = new InputBuffer();
    buffer.press("booster", 5);
    const snapshot = buffer.snapshot();
    expect(snapshot.pending[0]?.action).toBe("booster");
    expect(snapshot.pending[0]?.expiresAtTick).toBe(5 + DEFAULT_BUFFER_TICKS);
    buffer.consume(ALWAYS, 6);
    expect(buffer.snapshot().consumed[0]?.action).toBe("booster");
  });

  it("refuses a nonsense window or capacity rather than behaving oddly later", () => {
    expect(() => new InputBuffer(0)).toThrow(/positive integer tick count/);
    expect(() => new InputBuffer(10, 0)).toThrow(/positive integer/);
    expect(() => new InputBuffer(10).press("", 0)).toThrow(/action id/);
  });

  it("clears on demand, counting what it threw away", () => {
    const buffer = new InputBuffer();
    buffer.press("light", 0);
    buffer.press("heavy", 0);
    buffer.clear();
    expect(buffer.snapshot().pending).toHaveLength(0);
    expect(buffer.snapshot().dropped).toBe(2);
  });
});
