/// <reference lib="webworker" />
import { generateSectorTerrain, terrainTransferables } from "../world/terrain";
import {
  TERRAIN_PROTOCOL_VERSION,
  rejectRequest,
  type TerrainGenerateRequest,
  type TerrainResponse,
} from "./protocol";

/**
 * Terrain generation worker.
 *
 * Generation is the one part of streaming that is genuinely expensive, and it is
 * pure arithmetic over a seed, so it belongs off the render thread. This file is
 * the only thing in the project that runs outside the main thread; it imports
 * the same generator the inline path uses, so worker and fallback cannot drift.
 *
 * Jobs are queued and drained one at a time rather than started on arrival. A
 * burst of twenty five sector requests must not turn into twenty five
 * interleaved generations that all finish late.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

const queue: TerrainGenerateRequest[] = [];
const cancelled = new Set<number>();
let draining = false;

function post(response: TerrainResponse, transfer: ArrayBuffer[] = []): void {
  scope.postMessage(response, transfer);
}

function runOne(request: TerrainGenerateRequest): void {
  if (cancelled.delete(request.requestId)) {
    post({ type: "cancelled", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: request.requestId });
    return;
  }

  const startedAt = performance.now();
  try {
    const terrain = generateSectorTerrain(request.params);
    post(
      {
        type: "generated",
        protocolVersion: TERRAIN_PROTOCOL_VERSION,
        requestId: request.requestId,
        terrain,
        generationMs: performance.now() - startedAt,
      },
      // Handing the buffers over rather than copying them: the worker has no use
      // for the arrays once they are sent, and a 33x33 sector is ~35 KB of
      // positions alone.
      terrainTransferables(terrain),
    );
  } catch (error) {
    post({
      type: "failed",
      protocolVersion: TERRAIN_PROTOCOL_VERSION,
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function drain(): void {
  if (draining) return;
  draining = true;
  // A macrotask between jobs lets cancel messages land, which is the whole point
  // of cancellation: a sector the player has already flown past must be dropped
  // before it is generated, not after.
  const step = (): void => {
    const next = queue.shift();
    if (!next) {
      draining = false;
      return;
    }
    runOne(next);
    setTimeout(step, 0);
  };
  step();
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const problem = rejectRequest(event.data);
  if (problem) {
    // No requestId can be trusted here, so there is nobody to reply to. Say it
    // loudly in the worker console rather than dropping it silently.
    console.error(`terrainWorker: ignoring message (${problem})`);
    return;
  }

  const request = event.data as import("./protocol").TerrainRequest;
  if (request.type === "cancel") {
    const pendingIndex = queue.findIndex((job) => job.requestId === request.requestId);
    if (pendingIndex >= 0) {
      queue.splice(pendingIndex, 1);
      post({ type: "cancelled", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: request.requestId });
      return;
    }
    cancelled.add(request.requestId);
    return;
  }

  queue.push(request);
  drain();
});
