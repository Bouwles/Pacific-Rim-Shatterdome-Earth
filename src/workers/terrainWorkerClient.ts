import {
  InlineTerrainService,
  SectorGenerationCancelled,
  type GenerationResult,
  type SectorGenerationService,
} from "../world/terrainService";
import type { TerrainRequestParams } from "../world/terrain";
import { TERRAIN_PROTOCOL_VERSION, rejectResponse, type TerrainResponse } from "./protocol";

/**
 * Main-thread half of the terrain worker.
 *
 * Owns exactly one worker and every promise waiting on it. Disposal terminates
 * the worker and rejects everything still in flight, so a torn-down world screen
 * cannot leave a generation thread running or a promise that never settles.
 */
export class WorkerTerrainService implements SectorGenerationService {
  readonly kind = "worker";
  private readonly pending = new Map<
    number,
    { resolve(result: GenerationResult): void; reject(error: Error): void }
  >();
  private readonly listener: (event: MessageEvent<unknown>) => void;
  private readonly errorListener: (event: ErrorEvent) => void;
  private disposed = false;

  private constructor(private readonly worker: Worker) {
    this.listener = (event) => this.onMessage(event);
    this.errorListener = (event) => this.onWorkerError(event);
    this.worker.addEventListener("message", this.listener);
    this.worker.addEventListener("error", this.errorListener);
  }

  /**
   * Builds a worker-backed service, or an inline one when workers are not
   * available. The caller is told which it got rather than having to guess, and
   * a failure here is a performance degradation, not a broken game.
   */
  static create(): SectorGenerationService {
    if (typeof Worker === "undefined") return new InlineTerrainService();
    try {
      const worker = new Worker(new URL("./terrainWorker.ts", import.meta.url), {
        type: "module",
        name: "terrain",
      });
      return new WorkerTerrainService(worker);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Terrain worker unavailable (${message}); generating on the main thread instead. ` +
          "Frame pacing will suffer while sectors are built.",
      );
      return new InlineTerrainService();
    }
  }

  generate(requestId: number, params: TerrainRequestParams): Promise<GenerationResult> {
    if (this.disposed) return Promise.reject(new SectorGenerationCancelled(requestId));
    return new Promise<GenerationResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({
        type: "generate",
        protocolVersion: TERRAIN_PROTOCOL_VERSION,
        requestId,
        params,
      });
    });
  }

  cancel(requestId: number): void {
    if (this.disposed || !this.pending.has(requestId)) return;
    this.worker.postMessage({ type: "cancel", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.listener);
    this.worker.removeEventListener("error", this.errorListener);
    this.worker.terminate();
    for (const [requestId, handlers] of this.pending) {
      handlers.reject(new SectorGenerationCancelled(requestId));
    }
    this.pending.clear();
  }

  private onMessage(event: MessageEvent<unknown>): void {
    const problem = rejectResponse(event.data);
    if (problem) {
      console.error(`terrainWorkerClient: ignoring worker message (${problem})`);
      return;
    }
    const response = event.data as TerrainResponse;
    const handlers = this.pending.get(response.requestId);
    if (!handlers) return;
    this.pending.delete(response.requestId);

    if (response.type === "generated") {
      handlers.resolve({ terrain: response.terrain, generationMs: response.generationMs });
      return;
    }
    if (response.type === "cancelled") {
      handlers.reject(new SectorGenerationCancelled(response.requestId));
      return;
    }
    handlers.reject(new Error(`Terrain generation failed: ${response.message}`));
  }

  /**
   * A worker-level error kills every outstanding request; there is no way to
   * know which one caused it. Reject them all with the real message so the
   * streamer reports a failure instead of waiting forever.
   */
  private onWorkerError(event: ErrorEvent): void {
    const message = event.message || "terrain worker error";
    for (const [, handlers] of this.pending) handlers.reject(new Error(message));
    this.pending.clear();
  }
}
