import { describe, expect, it } from "vitest";
import { FACILITY_CONNECTIONS, createFacilityRegistry } from "../../src/data/facilities";
import { CREW_MEMBERS } from "../../src/data/personnel";
import { ShatterdomeState } from "../../src/shatterdome/facilityState";
import {
  CONN_POD_ROOM_ID,
  arrivalPoint,
  generateInteriorLayout,
  knownRoomIds,
  reachableRooms,
  roomById,
  type InteriorLayout,
  type InteriorRoom,
} from "../../src/shatterdome/interiorLayout";
import { ON_FOOT, isClear } from "../../src/shatterdome/onFoot";

const BERTHS = [
  { jaegerId: "placeholder-mk0", displayName: "Gipsy Danger" },
  { jaegerId: "heavy-mk4", displayName: "Cherno Alpha" },
];

function layoutFor(state = new ShatterdomeState(createFacilityRegistry()), seed = 20260824): InteriorLayout {
  const definitions = createFacilityRegistry();
  return generateInteriorLayout({
    seed,
    facilities: state.all(),
    definitions: new Map(definitions.all().map((entry) => [entry.id, entry])),
    connections: FACILITY_CONNECTIONS,
    crew: CREW_MEMBERS,
    berths: BERTHS,
  });
}

function insideRoom(room: InteriorRoom, x: number, z: number): boolean {
  return Math.abs(x) <= room.widthMeters / 2 && Math.abs(z) <= room.depthMeters / 2;
}

describe("interior layout", () => {
  it("builds a room only for a facility that has actually been built", () => {
    const layout = layoutFor();
    const ids = layout.rooms.map((room) => room.id);
    expect(ids).toContain("command");
    expect(ids).toContain("jaeger-bay");
    // Research has not been built, so there is nowhere to walk to.
    expect(ids).not.toContain("research");
  });

  it("adds the room when the facility is built", () => {
    const state = new ShatterdomeState(createFacilityRegistry());
    const order = state.order("research");
    if (!order.ok) throw new Error("order refused");
    state.advance(order.record.workRemainingTicks);
    expect(layoutFor(state).rooms.map((room) => room.id)).toContain("research");
  });

  it("is deterministic in its inputs and differs by seed", () => {
    expect(layoutFor(undefined, 7).digest).toBe(layoutFor(undefined, 7).digest);
    expect(layoutFor(undefined, 7).digest).not.toBe(layoutFor(undefined, 8).digest);
  });

  it("lets a player walk from command to the Jaeger bay and into the Conn-Pod", () => {
    const layout = layoutFor();
    const reachable = reachableRooms(layout, "command");
    expect(reachable).toContain("jaeger-bay");
    expect(reachable).toContain(CONN_POD_ROOM_ID);
  });

  it("keeps every room reachable from every other, so nothing is stranded", () => {
    const layout = layoutFor();
    const reachable = reachableRooms(layout, "command");
    expect(reachable.size).toBe(layout.rooms.length);
  });

  it("seals a doorway to a facility that has not been built, and says which", () => {
    const layout = layoutFor();
    const bay = roomById(layout, "jaeger-bay");
    const sealed = bay?.interactables.filter((entry) => entry.sealedReason !== null) ?? [];
    expect(sealed.length).toBeGreaterThan(0);
    expect(sealed[0]?.sealedReason).toMatch(/has not been built/);
    expect(sealed[0]?.targetRoomId).toBeNull();
  });

  it("keeps every fixture inside the room it belongs to", () => {
    for (const room of layoutFor().rooms) {
      for (const interactable of room.interactables) {
        expect(insideRoom(room, interactable.position.x, interactable.position.z)).toBe(true);
      }
      for (const obstacle of room.obstacles) {
        expect(insideRoom(room, obstacle.x, obstacle.z)).toBe(true);
      }
    }
  });

  it("leaves every spawn point somewhere a person actually fits", () => {
    for (const room of layoutFor().rooms) {
      for (const spawn of room.spawnPoints) {
        expect(isClear(spawn.x, spawn.z, room)).toBe(true);
      }
    }
  });

  it("puts a machine in each occupied berth and names the empty ones", () => {
    const bay = roomById(layoutFor(), "jaeger-bay");
    const berths = bay?.interactables.filter((entry) => entry.kind === "berth") ?? [];
    expect(berths).toHaveLength(2);
    expect(berths.map((berth) => berth.jaegerId)).toEqual(["placeholder-mk0", "heavy-mk4"]);
  });

  it("posts the named crew at their own facility", () => {
    const layout = layoutFor();
    const bay = roomById(layout, "jaeger-bay");
    const crewIds = bay?.interactables.map((entry) => entry.crewId).filter(Boolean) ?? [];
    expect(crewIds).toContain("crew.bay-chief");
    const command = roomById(layout, "command");
    expect(command?.interactables.map((entry) => entry.crewId)).toContain("crew.marshal");
  });

  it("raises scaffolds while an order is running and takes them down when it lands", () => {
    const state = new ShatterdomeState(createFacilityRegistry());
    const order = state.order("logistics");
    if (!order.ok) throw new Error("order refused");
    const building = roomById(layoutFor(state), "logistics");
    expect(building?.underConstruction).toBe(true);
    expect(building?.obstacles.some((obstacle) => obstacle.kind === "scaffold")).toBe(true);

    state.advance(order.record.workRemainingTicks);
    const finished = roomById(layoutFor(state), "logistics");
    expect(finished?.underConstruction).toBe(false);
    expect(finished?.obstacles.some((obstacle) => obstacle.kind === "scaffold")).toBe(false);
  });

  it("shows more fixtures at a higher tier, which is what an upgrade looks like", () => {
    const state = new ShatterdomeState(createFacilityRegistry());
    const before = roomById(layoutFor(state), "logistics")?.fixtureCount ?? 0;
    const order = state.order("logistics");
    if (!order.ok) throw new Error("order refused");
    state.advance(order.record.workRemainingTicks);
    const after = roomById(layoutFor(state), "logistics")?.fixtureCount ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  it("builds the Conn-Pod at person scale, not at Jaeger scale", () => {
    const pod = roomById(layoutFor(), CONN_POD_ROOM_ID);
    const bay = roomById(layoutFor(), "jaeger-bay");
    expect(pod).toBeDefined();
    expect(pod?.heightMeters ?? 0).toBeLessThan(4);
    expect(pod?.heightMeters ?? 0).toBeGreaterThan(ON_FOOT.eyeHeightMeters);
    expect(bay?.heightMeters ?? 0).toBeGreaterThan(90);
  });

  it("lands an arriving player inside the room rather than in the doorway", () => {
    const layout = layoutFor();
    const bay = roomById(layout, "jaeger-bay");
    if (!bay) throw new Error("no bay");
    const arrival = arrivalPoint(bay, "quarters");
    expect(isClear(arrival.x, arrival.z, bay)).toBe(true);
    const door = bay.interactables.find((entry) => entry.targetRoomId === "quarters");
    if (door) {
      expect(Math.hypot(arrival.x - door.position.x, arrival.z - door.position.z)).toBeGreaterThan(1);
    }
  });

  it("gives every room and fixture a stable unique id", () => {
    const layout = layoutFor();
    const roomIds = layout.rooms.map((room) => room.id);
    expect(new Set(roomIds).size).toBe(roomIds.length);
    for (const room of layout.rooms) {
      const ids = room.interactables.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(knownRoomIds(layout).has("command")).toBe(true);
  });

  it("stays cheap: a room is tens of fixtures, not thousands", () => {
    for (const room of layoutFor().rooms) {
      expect(room.obstacles.length).toBeLessThan(40);
      expect(room.interactables.length).toBeLessThan(30);
    }
  });
});
