import { describe, expect, it } from "vitest";
import { TERRAIN_PROTOCOL_VERSION, rejectRequest, rejectResponse } from "../../src/workers/protocol";
import {
  InlineTerrainService,
  SectorGenerationCancelled,
  isCancellation,
} from "../../src/world/terrainService";
import { createDefaultTerrainAnchors } from "../../src/data/regions";

const ANCHORS = createDefaultTerrainAnchors();
const PARAMS = { sectorId: "+X/3/4", lod: 2 as const, seed: 5, anchors: ANCHORS };

describe("terrain worker protocol", () => {
  it("accepts well formed messages in both directions", () => {
    expect(
      rejectRequest({ type: "generate", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: 1 }),
    ).toBeNull();
    expect(
      rejectRequest({ type: "cancel", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: 2 }),
    ).toBeNull();
    expect(
      rejectResponse({ type: "generated", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: 1 }),
    ).toBeNull();
    expect(
      rejectResponse({ type: "cancelled", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: 1 }),
    ).toBeNull();
  });

  it("rejects a message from a different protocol version", () => {
    // A worker built from a stale bundle is the realistic case, and silently
    // accepting it would mean terrain that quietly never arrives.
    expect(rejectRequest({ type: "generate", protocolVersion: 99, requestId: 1 })).toMatch(
      /protocol version 99, expected 1/,
    );
    expect(rejectResponse({ type: "generated", protocolVersion: 0, requestId: 1 })).toMatch(
      /protocol version 0/,
    );
  });

  it("rejects unknown types, non-objects and missing ids", () => {
    expect(rejectRequest(null)).toMatch(/must be an object/);
    expect(rejectRequest("generate")).toMatch(/must be an object/);
    expect(
      rejectRequest({ type: "demolish", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: 1 }),
    ).toMatch(/unknown request type "demolish"/);
    expect(
      rejectResponse({ type: "exploded", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: 1 }),
    ).toMatch(/unknown response type "exploded"/);
    expect(
      rejectRequest({ type: "generate", protocolVersion: TERRAIN_PROTOCOL_VERSION, requestId: 1.5 }),
    ).toMatch(/requestId must be an integer/);
  });
});

describe("inline terrain service", () => {
  it("generates terrain and reports how long it took", async () => {
    const service = new InlineTerrainService();
    const result = await service.generate(1, PARAMS);
    expect(result.terrain.sectorId).toBe("+X/3/4");
    expect(result.generationMs).toBeGreaterThanOrEqual(0);
    service.dispose();
  });

  it("honours a cancel issued in the same turn as the request", async () => {
    const service = new InlineTerrainService();
    const pending = service.generate(2, PARAMS);
    service.cancel(2);
    await expect(pending).rejects.toBeInstanceOf(SectorGenerationCancelled);
    service.dispose();
  });

  it("rejects work issued after disposal rather than doing it anyway", async () => {
    const service = new InlineTerrainService();
    const pending = service.generate(3, PARAMS);
    service.dispose();
    await expect(pending).rejects.toBeInstanceOf(SectorGenerationCancelled);
  });

  it("tells a cancellation apart from a real failure", () => {
    expect(isCancellation(new SectorGenerationCancelled(1))).toBe(true);
    expect(isCancellation(new Error("worker exploded"))).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });

  it("reports which path generation is taking", () => {
    expect(new InlineTerrainService().kind).toBe("inline");
  });
});
