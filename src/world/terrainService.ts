import { generateSectorTerrain, type SectorTerrain, type TerrainRequestParams } from "./terrain";

/**
 * The boundary between the streamer and whatever actually generates terrain.
 *
 * The streamer never learns whether generation happened in a worker, on the main
 * thread, or from a fixture. That is what makes the streaming state machine
 * testable without a browser, and what lets the app degrade to inline generation
 * when workers are unavailable instead of shipping no terrain at all.
 */

export interface GenerationResult {
  readonly terrain: SectorTerrain;
  readonly generationMs: number;
}

export interface SectorGenerationService {
  /** Reported in diagnostics so it is visible when the worker path is not in use. */
  readonly kind: string;
  generate(requestId: number, params: TerrainRequestParams): Promise<GenerationResult>;
  cancel(requestId: number): void;
  dispose(): void;
}

/** Thrown when a request was cancelled before it produced anything. Not a failure. */
export class SectorGenerationCancelled extends Error {
  constructor(readonly requestId: number) {
    super(`Terrain request ${requestId} was cancelled`);
    this.name = "SectorGenerationCancelled";
  }
}

export function isCancellation(error: unknown): error is SectorGenerationCancelled {
  return error instanceof SectorGenerationCancelled;
}

/**
 * Generates on the calling thread.
 *
 * Used by tests, by the headless stress route, and as the fallback when a worker
 * cannot be constructed. It yields once before generating so a cancel issued in
 * the same turn is still honoured, which keeps cancellation semantics identical
 * to the worker path rather than subtly better or worse.
 */
export class InlineTerrainService implements SectorGenerationService {
  readonly kind = "inline";
  private readonly cancelled = new Set<number>();
  private disposed = false;

  async generate(requestId: number, params: TerrainRequestParams): Promise<GenerationResult> {
    await Promise.resolve();
    if (this.disposed) throw new SectorGenerationCancelled(requestId);
    if (this.cancelled.delete(requestId)) throw new SectorGenerationCancelled(requestId);

    const startedAt = now();
    const terrain = generateSectorTerrain(params);
    return { terrain, generationMs: now() - startedAt };
  }

  cancel(requestId: number): void {
    this.cancelled.add(requestId);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelled.clear();
  }
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
