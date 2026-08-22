import type { SectorTerrain, TerrainRequestParams } from "../world/terrain";

/**
 * Message protocol between the main thread and the terrain worker.
 *
 * Typed both ways and versioned, for the same reason simulation commands are:
 * a worker that silently receives a message shape it does not understand is a
 * bug that shows up much later as missing terrain. Every message carries the
 * protocol version and is rejected on mismatch.
 *
 * Pure types plus two validators. No Babylon, no DOM, no `Worker` — importing
 * this file must be safe from either side of the boundary.
 */

export const TERRAIN_PROTOCOL_VERSION = 1;

export interface TerrainGenerateRequest {
  readonly type: "generate";
  readonly protocolVersion: number;
  /** Cancellation token. Monotonic per client; never reused. */
  readonly requestId: number;
  readonly params: TerrainRequestParams;
}

export interface TerrainCancelRequest {
  readonly type: "cancel";
  readonly protocolVersion: number;
  readonly requestId: number;
}

export type TerrainRequest = TerrainGenerateRequest | TerrainCancelRequest;

export interface TerrainGeneratedResponse {
  readonly type: "generated";
  readonly protocolVersion: number;
  readonly requestId: number;
  readonly terrain: SectorTerrain;
  readonly generationMs: number;
}

export interface TerrainCancelledResponse {
  readonly type: "cancelled";
  readonly protocolVersion: number;
  readonly requestId: number;
}

export interface TerrainFailedResponse {
  readonly type: "failed";
  readonly protocolVersion: number;
  readonly requestId: number;
  readonly message: string;
}

export type TerrainResponse = TerrainGeneratedResponse | TerrainCancelledResponse | TerrainFailedResponse;

const REQUEST_TYPES: readonly TerrainRequest["type"][] = ["generate", "cancel"];
const RESPONSE_TYPES: readonly TerrainResponse["type"][] = ["generated", "cancelled", "failed"];

function describeVersion(value: unknown): string {
  return `protocol version ${String(value)}, expected ${TERRAIN_PROTOCOL_VERSION}`;
}

/** Validates an inbound worker message. Returns the reason it is unusable, or null. */
export function rejectRequest(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return "message must be an object";
  const candidate = message as Partial<TerrainRequest>;
  if (candidate.protocolVersion !== TERRAIN_PROTOCOL_VERSION)
    return describeVersion(candidate.protocolVersion);
  if (!REQUEST_TYPES.includes(candidate.type as TerrainRequest["type"])) {
    return `unknown request type "${String(candidate.type)}"`;
  }
  if (!Number.isInteger(candidate.requestId)) return "requestId must be an integer";
  return null;
}

/** Validates an inbound main-thread message. Returns the reason it is unusable, or null. */
export function rejectResponse(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return "message must be an object";
  const candidate = message as Partial<TerrainResponse>;
  if (candidate.protocolVersion !== TERRAIN_PROTOCOL_VERSION)
    return describeVersion(candidate.protocolVersion);
  if (!RESPONSE_TYPES.includes(candidate.type as TerrainResponse["type"])) {
    return `unknown response type "${String(candidate.type)}"`;
  }
  if (!Number.isInteger(candidate.requestId)) return "requestId must be an integer";
  return null;
}
