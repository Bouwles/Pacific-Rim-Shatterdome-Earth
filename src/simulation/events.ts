/**
 * Simulation events. Deliberately plain data with no reference to Babylon, the
 * DOM, or any host object — the bus must stay usable inside a Web Worker and
 * inside headless tests.
 */
export interface SimEvent {
  readonly type: string;
  readonly schemaVersion: number;
}

export type EventHandler<E extends SimEvent = SimEvent> = (event: E) => void;

/**
 * Buffered pub/sub. `emit` only queues; `drain` dispatches.
 *
 * Buffering keeps listener side effects out of the middle of a tick, so a
 * subscriber can never mutate simulation state that the running tick has
 * already read.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private queue: SimEvent[] = [];

  subscribe<E extends SimEvent = SimEvent>(type: string, handler: EventHandler<E>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set<EventHandler>();
      this.handlers.set(type, set);
    }
    const erased = handler as EventHandler;
    set.add(erased);
    return () => {
      set.delete(erased);
    };
  }

  emit(event: SimEvent): void {
    this.queue.push(event);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Dispatches everything queued so far and clears the queue. Returns count dispatched. */
  drain(): number {
    if (this.queue.length === 0) return 0;
    // Swap first: a handler that emits must land in the next drain, not this one.
    const batch = this.queue;
    this.queue = [];
    for (const event of batch) {
      const set = this.handlers.get(event.type);
      if (!set) continue;
      for (const handler of set) handler(event);
    }
    return batch.length;
  }

  /** Drops queued events and every subscription. */
  dispose(): void {
    this.queue = [];
    this.handlers.clear();
  }
}

export const ENTITY_SPAWNED = "entity-spawned";
export const ENTITY_DESPAWNED = "entity-despawned";

export interface EntitySpawnedEvent extends SimEvent {
  readonly type: typeof ENTITY_SPAWNED;
  readonly schemaVersion: 1;
  readonly entityId: number;
  readonly tick: number;
}

export interface EntityDespawnedEvent extends SimEvent {
  readonly type: typeof ENTITY_DESPAWNED;
  readonly schemaVersion: 1;
  readonly entityId: number;
  readonly tick: number;
}
