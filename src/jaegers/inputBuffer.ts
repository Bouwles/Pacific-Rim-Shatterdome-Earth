/**
 * Command buffering.
 *
 * A player who presses a button a fifth of a second before the machine can act
 * on it meant to press it. Dropping that input is what makes heavy controls
 * feel unresponsive, and holding it forever is what makes them feel haunted, so
 * every buffered press has a window and expires on its own.
 *
 * Pure and tick-based: no timers, no listeners, nothing to dispose. The input
 * source records presses, the controller consumes the next legal one, and both
 * halves are testable with no browser.
 */

/** Ticks a press stays live. One tick is one in-game second at 60 Hz sim rate. */
export const DEFAULT_BUFFER_TICKS = 12;

export interface BufferedPress {
  readonly action: string;
  readonly tick: number;
  /** Tick after which this press is stale and will never be consumed. */
  readonly expiresAtTick: number;
}

export interface BufferSnapshot {
  readonly pending: readonly BufferedPress[];
  readonly consumed: readonly BufferedPress[];
  readonly dropped: number;
}

/**
 * A short queue of presses waiting for a legal moment.
 *
 * Deliberately a queue rather than a set: pressing light, light, heavy has an
 * order, and a set would lose it.
 */
export class InputBuffer {
  private readonly pending: BufferedPress[] = [];
  /** Kept only so the debug view can show what was taken and when. */
  private readonly recent: BufferedPress[] = [];
  private droppedCount = 0;

  constructor(
    private readonly windowTicks: number = DEFAULT_BUFFER_TICKS,
    /** Beyond this the oldest press is dropped, so a mashed key cannot queue a minute of combat. */
    private readonly capacity: number = 4,
  ) {
    if (!Number.isInteger(windowTicks) || windowTicks <= 0) {
      throw new Error(`InputBuffer window must be a positive integer tick count, got ${windowTicks}`);
    }
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`InputBuffer capacity must be a positive integer, got ${capacity}`);
    }
  }

  press(action: string, tick: number): BufferedPress {
    if (!action) throw new Error("InputBuffer.press requires an action id");
    const entry: BufferedPress = { action, tick, expiresAtTick: tick + this.windowTicks };
    this.pending.push(entry);
    while (this.pending.length > this.capacity) {
      this.pending.shift();
      this.droppedCount += 1;
    }
    return entry;
  }

  /** Drops presses whose window has closed. Called once per tick before consuming. */
  expire(tick: number): number {
    let removed = 0;
    while (this.pending.length > 0 && (this.pending[0]?.expiresAtTick ?? 0) < tick) {
      this.pending.shift();
      removed += 1;
      this.droppedCount += 1;
    }
    return removed;
  }

  /**
   * Takes the oldest press the caller says is legal right now.
   *
   * The caller supplies the legality test rather than the buffer knowing the
   * rules, which is what lets the same buffer serve locomotion and combat.
   */
  consume(isLegal: (action: string) => boolean, tick: number): BufferedPress | null {
    this.expire(tick);
    for (let index = 0; index < this.pending.length; index += 1) {
      const entry = this.pending[index];
      if (!entry || !isLegal(entry.action)) continue;
      this.pending.splice(index, 1);
      this.recent.push(entry);
      if (this.recent.length > 8) this.recent.shift();
      return entry;
    }
    return null;
  }

  /** True when this action is waiting, without taking it. */
  has(action: string): boolean {
    return this.pending.some((entry) => entry.action === action);
  }

  clear(): void {
    this.droppedCount += this.pending.length;
    this.pending.length = 0;
  }

  snapshot(): BufferSnapshot {
    return { pending: [...this.pending], consumed: [...this.recent], dropped: this.droppedCount };
  }
}
