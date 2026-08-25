import { createSeededRng, hashStringToSeed, type Rng } from "../simulation/rng";
import type { ConnectionKind, ConnectionSpec, FacilityDefinition, FacilityKind } from "../data/facilities";
import type { CrewMember } from "../data/personnel";
import type { FacilityRecord, FacilityStatus } from "./facilityState";

/**
 * Interior layout.
 *
 * Turns the facility records into the rooms a person can actually walk around
 * in: where the fixtures stand, where the terminals are, which walls have doors
 * and what is on the other side of them.
 *
 * The complex is a graph of separate rooms, not one enormous interior scene.
 * That is a deliberate structural choice rather than a budget: only the room the
 * player is in is ever built, so the Jaeger bay costs nothing while the player is
 * in the archive, and a facility that has not been built has no room at all.
 *
 * Pure and deterministic in its inputs, and derived rather than saved: a save
 * carries the facility records and the player's position, and the rooms are laid
 * out again from those.
 *
 * Coordinates are metres in the room's own frame: x across, z along, y up, with
 * the origin at the centre of the floor.
 */

export const INTERIOR_LAYOUT_SCHEMA_VERSION = 1;

/** The Conn-Pod is its own space, reachable only from the Jaeger bay. */
export const CONN_POD_ROOM_ID = "conn-pod";

/** Clearance kept between the player and any wall or fixture. */
export const PLAYER_CLEARANCE_METERS = 0.45;

export interface RoomPoint {
  readonly x: number;
  readonly z: number;
}

export const OBSTACLE_KINDS = ["fixture", "scaffold", "berth", "crate", "rail"] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

/** An axis-aligned block of room the player cannot walk through. */
export interface RoomObstacle {
  readonly id: string;
  readonly kind: ObstacleKind;
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly heightMeters: number;
}

export const INTERACTABLE_KINDS = ["terminal", "staff-post", "berth", "conn-pod", "transit"] as const;
export type InteractableKind = (typeof INTERACTABLE_KINDS)[number];

export interface Interactable {
  readonly id: string;
  readonly kind: InteractableKind;
  readonly label: string;
  readonly position: RoomPoint;
  /** Which way the fixture faces, so the renderer can turn it toward the room. */
  readonly facingDeg: number;
  /** How close the player must be for this to be usable. */
  readonly reachMeters: number;
  readonly facilityId: FacilityKind;
  /** Transit only: the room on the other side. */
  readonly targetRoomId: string | null;
  readonly connectionKind: ConnectionKind | null;
  /**
   * Transit only. A door to a facility that has not been built is sealed, and
   * says which facility and why rather than simply not working.
   */
  readonly sealedReason: string | null;
  /** Berth only: the roster machine standing in it, or null for an empty berth. */
  readonly jaegerId: string | null;
  /** Staff post only: the named character who holds it, or null for anonymous crew. */
  readonly crewId: string | null;
}

export interface InteriorRoom {
  readonly id: string;
  readonly facilityId: FacilityKind;
  readonly displayName: string;
  readonly deck: number;
  readonly status: FacilityStatus;
  readonly tier: number;
  readonly widthMeters: number;
  readonly depthMeters: number;
  readonly heightMeters: number;
  readonly floorColour: readonly [number, number, number];
  readonly accentColour: readonly [number, number, number];
  readonly ambience: string;
  readonly obstacles: readonly RoomObstacle[];
  readonly interactables: readonly Interactable[];
  /** Where staff stand and work. Positions only; nobody has state. */
  readonly staffPosts: readonly RoomPoint[];
  /** Safe standing places: the room centre first, then one inside each doorway. */
  readonly spawnPoints: readonly RoomPoint[];
  /** How many staff this room is posted at its current tier. */
  readonly staffSlots: number;
  /** Fixtures actually placed. This is the visible half of an upgrade. */
  readonly fixtureCount: number;
  /** True while scaffolds are up, whether the room is new or growing. */
  readonly underConstruction: boolean;
  /**
   * What the room looks like at the tier it is standing at.
   *
   * Presentation only: lighting, signage, how many cranes are up and how many
   * deliveries are still on the floor. An upgrade is meant to be something you
   * walk into and notice, not a number on a panel.
   */
  readonly lighting: "work" | "flood" | "full";
  readonly signage: "none" | "stencil" | "lit";
  readonly cranes: number;
  readonly deliveries: number;
  /** One line about what somebody walking in would see. */
  readonly stageNote: string;
  /** Workers on the site while something is being built here. */
  readonly builders: number;
}

export interface InteriorLayout {
  readonly schemaVersion: number;
  readonly seed: number;
  readonly rooms: readonly InteriorRoom[];
  /** Content digest. Two layouts of the same inputs must agree. */
  readonly digest: number;
}

export interface BerthOccupant {
  readonly jaegerId: string;
  readonly displayName: string;
}

export interface InteriorLayoutParams {
  readonly seed: number;
  readonly facilities: readonly FacilityRecord[];
  readonly definitions: ReadonlyMap<FacilityKind, FacilityDefinition>;
  readonly connections: readonly ConnectionSpec[];
  readonly crew: readonly CrewMember[];
  /** Roster machines standing in the bay, in berth order. */
  readonly berths: readonly BerthOccupant[];
}

/** The Conn-Pod: small, and deliberately not built at Jaeger scale inside. */
const CONN_POD_SIZE = { width: 5.2, depth: 4.4, height: 3.1 } as const;

export function generateInteriorLayout(params: InteriorLayoutParams): InteriorLayout {
  const built = new Map<FacilityKind, FacilityRecord>();
  for (const record of params.facilities) {
    if (record.tier >= 1) built.set(record.facilityId, record);
  }

  const rooms: InteriorRoom[] = [];
  for (const record of params.facilities) {
    const definition = params.definitions.get(record.facilityId);
    if (!definition || record.tier < 1) continue;
    rooms.push(buildRoom(record, definition, params, built));
  }

  if (built.has("jaeger-bay")) rooms.push(buildConnPod(params));

  rooms.sort((a, b) => a.id.localeCompare(b.id));

  let digest = 0x811c9dc5;
  digest = fold(digest, params.seed);
  for (const room of rooms) {
    digest = fold(digest, hashStringToSeed(room.id));
    digest = fold(digest, room.tier);
    digest = fold(digest, room.obstacles.length);
    digest = fold(digest, room.interactables.length);
    for (const obstacle of room.obstacles) {
      digest = fold(digest, Math.round(obstacle.x * 10));
      digest = fold(digest, Math.round(obstacle.z * 10));
    }
  }

  return {
    schemaVersion: INTERIOR_LAYOUT_SCHEMA_VERSION,
    seed: params.seed,
    rooms,
    digest: digest >>> 0,
  };
}

function buildRoom(
  record: FacilityRecord,
  definition: FacilityDefinition,
  params: InteriorLayoutParams,
  built: ReadonlyMap<FacilityKind, FacilityRecord>,
): InteriorRoom {
  const tier = definition.tiers[record.tier - 1];
  const fixtureCount = tier?.fixtures ?? 0;
  // What the room reads as. A room mid-build shows the stage it is working
  // toward with the lights still on the temporary rig, which is what makes a
  // half-finished room look half-finished rather than simply smaller.
  const targetTier = record.targetTier > 0 ? definition.tiers[record.targetTier - 1] : undefined;
  const stage = (targetTier ?? tier)?.stage;
  const building = record.status === "building" || record.status === "upgrading";
  const staffSlots = tier?.staffSlots ?? 0;
  const underConstruction = record.status === "building" || record.status === "upgrading";
  const rng = createSeededRng(
    hashStringToSeed(`${definition.id}|${record.tier}|${record.status}`) ^ (params.seed | 0),
  );

  const halfWidth = definition.widthMeters / 2;
  const halfDepth = definition.depthMeters / 2;

  const interactables: Interactable[] = [];
  const spawnPoints: RoomPoint[] = [{ x: 0, z: 0 }];

  // Transits first: they own wall slots, and their arrival points are what every
  // other placement has to keep clear.
  const connections = params.connections
    .filter((connection) => connection.from === definition.id || connection.to === definition.id)
    .map((connection) => ({
      kind: connection.kind,
      other: connection.from === definition.id ? connection.to : connection.from,
    }))
    .sort((a, b) => a.other.localeCompare(b.other));

  connections.forEach((connection, index) => {
    const slot = wallSlot(index, connections.length, halfWidth, halfDepth);
    const otherDefinition = params.definitions.get(connection.other);
    const otherBuilt = built.has(connection.other);
    interactables.push({
      id: `${definition.id}.transit.${connection.other}`,
      kind: "transit",
      label: otherBuilt
        ? `${transitVerb(connection.kind)} to ${otherDefinition?.displayName ?? connection.other}`
        : `Sealed bulkhead: ${otherDefinition?.displayName ?? connection.other}`,
      position: slot.position,
      facingDeg: slot.facingDeg,
      reachMeters: 2.6,
      facilityId: definition.id,
      targetRoomId: otherBuilt ? connection.other : null,
      connectionKind: connection.kind,
      sealedReason: otherBuilt
        ? null
        : `${otherDefinition?.displayName ?? connection.other} has not been built yet.`,
      jaegerId: null,
      crewId: null,
    });
    spawnPoints.push(slot.arrival);
  });

  if (definition.id === "jaeger-bay") {
    spawnPoints.push({ x: 0, z: -halfDepth * 0.55 });
  }

  // Stations. Counts come from the facility grammar; positions are generated.
  const crewHere = params.crew.filter((member) => member.facilityId === definition.id);
  let crewCursor = 0;
  const staffPosts: RoomPoint[] = [];

  for (const station of definition.stations) {
    const count = stationCount(station.kind, station.count, record.tier);
    for (let index = 0; index < count; index += 1) {
      const position = stationPosition(station.kind, index, count, halfWidth, halfDepth, rng);
      if (station.kind === "staff-post") {
        staffPosts.push(position);
        const member = crewHere[crewCursor];
        crewCursor += 1;
        interactables.push({
          id: `${definition.id}.post.${index}`,
          kind: "staff-post",
          label: member ? `${member.name}, ${member.role}` : `${station.label} ${index + 1}`,
          position,
          facingDeg: facingCentre(position),
          reachMeters: 2.4,
          facilityId: definition.id,
          targetRoomId: null,
          connectionKind: null,
          sealedReason: null,
          jaegerId: null,
          crewId: member?.id ?? null,
        });
        continue;
      }
      if (station.kind === "berth") {
        const occupant = params.berths[index];
        interactables.push({
          id: `${definition.id}.berth.${index}`,
          kind: "berth",
          label: occupant ? `${occupant.displayName}, berth ${index + 1}` : `Berth ${index + 1}, empty`,
          position,
          facingDeg: facingCentre(position),
          reachMeters: 9,
          facilityId: definition.id,
          targetRoomId: null,
          connectionKind: null,
          sealedReason: null,
          jaegerId: occupant?.jaegerId ?? null,
          crewId: null,
        });
        continue;
      }
      if (station.kind === "conn-pod") {
        interactables.push({
          id: `${definition.id}.connpod.${index}`,
          kind: "conn-pod",
          label: station.label,
          position,
          facingDeg: facingCentre(position),
          reachMeters: 4,
          facilityId: definition.id,
          targetRoomId: CONN_POD_ROOM_ID,
          connectionKind: "lift",
          sealedReason: null,
          jaegerId: null,
          crewId: null,
        });
        continue;
      }
      interactables.push({
        id: `${definition.id}.terminal.${index}`,
        kind: "terminal",
        label: station.label,
        position,
        facingDeg: facingCentre(position),
        reachMeters: 2.4,
        facilityId: definition.id,
        targetRoomId: null,
        connectionKind: null,
        sealedReason: null,
        jaegerId: null,
        crewId: null,
      });
    }
  }

  const obstacles = buildObstacles({
    facilityId: definition.id,
    fixtureCount,
    underConstruction,
    halfWidth,
    halfDepth,
    heightMeters: definition.heightMeters,
    berthCount: interactables.filter((entry) => entry.kind === "berth").length,
    rng,
    keepClear: [...spawnPoints, ...interactables.map((entry) => entry.position)],
  });

  return {
    id: definition.id,
    facilityId: definition.id,
    displayName: definition.displayName,
    deck: definition.deck,
    status: record.status,
    tier: record.tier,
    widthMeters: definition.widthMeters,
    depthMeters: definition.depthMeters,
    heightMeters: definition.heightMeters,
    floorColour: definition.floorColour,
    accentColour: definition.accentColour,
    ambience: definition.ambience,
    obstacles,
    interactables,
    staffPosts,
    spawnPoints,
    staffSlots,
    fixtureCount,
    underConstruction,
    lighting: building ? "work" : (stage?.lighting ?? "work"),
    signage: building ? "stencil" : (stage?.signage ?? "none"),
    // Cranes come out for the build and stay if the finished room has them.
    cranes: (stage?.cranes ?? 0) + (building ? 1 : 0),
    // Deliveries pile up while work is on and are unpacked once it is done.
    deliveries: (stage?.deliveries ?? 0) + (building ? 2 : 0),
    stageNote: stage?.note ?? "",
    // Crews on the site. Nobody is standing about in a finished room.
    builders: building ? Math.max(1, record.crewsHeld * 2) : 0,
  };
}

/**
 * The Conn-Pod.
 *
 * A separate room rather than a camera move: the player walks in, the door
 * closes behind them, and what they can see is instruments. It is person-sized
 * inside, which is the whole point of the acceptance check that on-foot spaces
 * never inherit Jaeger scale.
 */
function buildConnPod(params: InteriorLayoutParams): InteriorRoom {
  const bay = params.definitions.get("jaeger-bay");
  const interactables: Interactable[] = [
    {
      id: "conn-pod.transit.jaeger-bay",
      kind: "transit",
      label: `Disengage and return to ${bay?.displayName ?? "the bay"}`,
      position: { x: 0, z: -CONN_POD_SIZE.depth / 2 + 0.6 },
      facingDeg: 0,
      reachMeters: 2.2,
      facilityId: "jaeger-bay",
      targetRoomId: "jaeger-bay",
      connectionKind: "lift",
      sealedReason: null,
      jaegerId: null,
      crewId: null,
    },
    {
      id: "conn-pod.terminal.0",
      kind: "terminal",
      label: "Conn-Pod instruments",
      position: { x: 0, z: CONN_POD_SIZE.depth / 2 - 0.9 },
      facingDeg: 180,
      reachMeters: 2.2,
      facilityId: "jaeger-bay",
      targetRoomId: null,
      connectionKind: null,
      sealedReason: null,
      jaegerId: null,
      crewId: null,
    },
  ];

  return {
    id: CONN_POD_ROOM_ID,
    facilityId: "jaeger-bay",
    displayName: "Conn-Pod",
    deck: 0,
    status: "operational",
    tier: 1,
    widthMeters: CONN_POD_SIZE.width,
    depthMeters: CONN_POD_SIZE.depth,
    heightMeters: CONN_POD_SIZE.height,
    floorColour: [0.21, 0.23, 0.26],
    accentColour: [0.35, 0.85, 0.95],
    ambience: "coolant tick and the pilot harness creaking",
    obstacles: [
      // Two harness rigs, which is what makes a Conn-Pod a two-pilot space.
      {
        id: "conn-pod.rig.L",
        kind: "fixture",
        x: -1.2,
        z: 0.4,
        halfWidth: 0.5,
        halfDepth: 0.5,
        heightMeters: 1.9,
      },
      {
        id: "conn-pod.rig.R",
        kind: "fixture",
        x: 1.2,
        z: 0.4,
        halfWidth: 0.5,
        halfDepth: 0.5,
        heightMeters: 1.9,
      },
    ],
    interactables,
    staffPosts: [],
    spawnPoints: [{ x: 0, z: -0.9 }],
    staffSlots: 0,
    fixtureCount: 2,
    underConstruction: false,
    // The Conn-Pod is a fitted space rather than a room that grows: it is lit,
    // signed and finished the day the machine is.
    lighting: "full",
    signage: "lit",
    cranes: 0,
    deliveries: 0,
    stageNote: "Two harnesses, a wall of instruments, and no room to spare.",
    builders: 0,
  };
}

interface ObstacleParams {
  readonly facilityId: FacilityKind;
  readonly fixtureCount: number;
  readonly underConstruction: boolean;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly heightMeters: number;
  readonly berthCount: number;
  readonly rng: Rng;
  readonly keepClear: readonly RoomPoint[];
}

function buildObstacles(params: ObstacleParams): RoomObstacle[] {
  const obstacles: RoomObstacle[] = [];
  const { halfWidth, halfDepth, rng } = params;

  // Fixtures: the workstations, gantries and racks a tier brings with it. They
  // sit in the back two thirds so a doorway is never blocked by an upgrade.
  const columns = Math.max(1, Math.ceil(Math.sqrt(params.fixtureCount)));
  for (let index = 0; index < params.fixtureCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const spanX = (halfWidth * 1.4) / Math.max(1, columns);
    const spanZ = Math.min(6, halfDepth * 0.4);
    const x = -halfWidth * 0.7 + spanX * (column + 0.5) + (rng() - 0.5) * 0.6;
    const z = halfDepth * 0.15 + row * spanZ + (rng() - 0.5) * 0.4;
    if (Math.abs(z) > halfDepth - 1.5) continue;
    obstacles.push({
      id: `${params.facilityId}.fixture.${index}`,
      kind: "fixture",
      x,
      z,
      halfWidth: Math.min(1.6, spanX * 0.3),
      halfDepth: 0.9,
      heightMeters: Math.min(params.heightMeters * 0.35, 1.2 + rng() * 1.4),
    });
  }

  // Berth cradles: the machine's own footprint, which is why the bay is the one
  // room measured in tens of metres rather than metres.
  for (let index = 0; index < params.berthCount; index += 1) {
    const spacing = (halfWidth * 2) / (params.berthCount + 1);
    obstacles.push({
      id: `${params.facilityId}.cradle.${index}`,
      kind: "berth",
      x: -halfWidth + spacing * (index + 1),
      z: halfDepth * 0.35,
      halfWidth: 9,
      halfDepth: 7,
      heightMeters: 6,
    });
  }

  // Scaffolds are the construction state you can walk around: they are here
  // whenever an order is running and gone the moment it completes.
  if (params.underConstruction) {
    const count = 3 + Math.floor(rng() * 3);
    for (let index = 0; index < count; index += 1) {
      obstacles.push({
        id: `${params.facilityId}.scaffold.${index}`,
        kind: "scaffold",
        x: (rng() - 0.5) * halfWidth * 1.2,
        z: -halfDepth * 0.15 + (rng() - 0.5) * halfDepth * 0.6,
        halfWidth: 1.1,
        halfDepth: 1.1,
        heightMeters: Math.min(params.heightMeters * 0.6, 3 + rng() * 2),
      });
    }
    obstacles.push({
      id: `${params.facilityId}.crates`,
      kind: "crate",
      x: halfWidth * 0.6,
      z: -halfDepth * 0.5,
      halfWidth: 2.2,
      halfDepth: 1.6,
      heightMeters: 2.4,
    });
  }

  // Anything that landed on a doorway, a terminal or a spawn point is dropped
  // rather than nudged: a fixture fewer is invisible, a blocked door is not.
  return obstacles.filter((obstacle) =>
    params.keepClear.every((point) => !overlapsPoint(obstacle, point, 1.4)),
  );
}

function overlapsPoint(obstacle: RoomObstacle, point: RoomPoint, margin: number): boolean {
  return (
    Math.abs(point.x - obstacle.x) <= obstacle.halfWidth + margin &&
    Math.abs(point.z - obstacle.z) <= obstacle.halfDepth + margin
  );
}

/** Distributes portals around the four walls, front wall first. */
function wallSlot(
  index: number,
  total: number,
  halfWidth: number,
  halfDepth: number,
): { position: RoomPoint; arrival: RoomPoint; facingDeg: number } {
  const wall = index % 4;
  const onWall = Math.floor(index / 4);
  const perWall = Math.max(1, Math.ceil(total / 4));
  const spread = (offsetIndex: number, half: number): number =>
    perWall === 1 ? 0 : -half * 0.5 + (half / Math.max(1, perWall - 1)) * offsetIndex;
  const inset = 3.2;

  switch (wall) {
    case 0:
      return {
        position: { x: spread(onWall, halfWidth), z: -halfDepth + 0.4 },
        arrival: { x: spread(onWall, halfWidth), z: -halfDepth + inset },
        facingDeg: 0,
      };
    case 1:
      return {
        position: { x: spread(onWall, halfWidth), z: halfDepth - 0.4 },
        arrival: { x: spread(onWall, halfWidth), z: halfDepth - inset },
        facingDeg: 180,
      };
    case 2:
      return {
        position: { x: -halfWidth + 0.4, z: spread(onWall, halfDepth) },
        arrival: { x: -halfWidth + inset, z: spread(onWall, halfDepth) },
        facingDeg: 90,
      };
    default:
      return {
        position: { x: halfWidth - 0.4, z: spread(onWall, halfDepth) },
        arrival: { x: halfWidth - inset, z: spread(onWall, halfDepth) },
        facingDeg: 270,
      };
  }
}

/** Higher tiers post more people and open more berths; terminals stay singular. */
function stationCount(kind: string, base: number, tier: number): number {
  if (kind === "terminal") return base;
  if (kind === "conn-pod") return base;
  return base + (tier - 1);
}

function stationPosition(
  kind: string,
  index: number,
  count: number,
  halfWidth: number,
  halfDepth: number,
  rng: Rng,
): RoomPoint {
  if (kind === "terminal") {
    return { x: -halfWidth * 0.55, z: -halfDepth * 0.3 };
  }
  if (kind === "berth") {
    const spacing = (halfWidth * 2) / (count + 1);
    return { x: -halfWidth + spacing * (index + 1), z: halfDepth * 0.35 - 9 };
  }
  if (kind === "conn-pod") {
    const spacing = (halfWidth * 2) / 3;
    return { x: -halfWidth + spacing, z: halfDepth * 0.35 - 11 };
  }
  const spacing = (halfWidth * 1.4) / (count + 1);
  return {
    x: -halfWidth * 0.7 + spacing * (index + 1),
    z: -halfDepth * 0.45 + (rng() - 0.5) * 1.2,
  };
}

function facingCentre(position: RoomPoint): number {
  const degrees = (Math.atan2(-position.x, -position.z) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function transitVerb(kind: ConnectionKind): string {
  // A table rather than a branch chain, so adding a connection kind is a row.
  return TRANSIT_VERBS[kind];
}

const TRANSIT_VERBS: Readonly<Record<ConnectionKind, string>> = {
  door: "Door",
  lift: "Lift",
  tram: "Tram",
};

function fold(hash: number, value: number): number {
  let next = hash ^ (value | 0);
  next = Math.imul(next, 0x01000193);
  return next >>> 0;
}

/** Room ids this build can restore a saved position into. */
export function knownRoomIds(layout: InteriorLayout): Set<string> {
  return new Set(layout.rooms.map((room) => room.id));
}

export function roomById(layout: InteriorLayout, roomId: string): InteriorRoom | undefined {
  return layout.rooms.find((room) => room.id === roomId);
}

/**
 * Rooms reachable on foot from a starting room, walking through unsealed transits
 * only. Used to prove the acceptance path exists rather than assuming it does.
 */
export function reachableRooms(layout: InteriorLayout, fromRoomId: string): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [fromRoomId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const room = roomById(layout, current);
    if (!room) continue;
    for (const interactable of room.interactables) {
      if (interactable.targetRoomId === null) continue;
      if (interactable.sealedReason !== null) continue;
      if (!seen.has(interactable.targetRoomId)) queue.push(interactable.targetRoomId);
    }
  }
  return seen;
}

/** Where the player should stand on arriving in a room from a given room. */
export function arrivalPoint(room: InteriorRoom, fromRoomId: string | null): RoomPoint {
  if (fromRoomId !== null) {
    const back = room.interactables.find(
      (entry) => entry.kind === "transit" && entry.targetRoomId === fromRoomId,
    );
    if (back) {
      // Just inside the door the player came through, not on top of it.
      const inward = towardCentre(back.position, 3.2);
      return inward;
    }
  }
  return room.spawnPoints[0] ?? { x: 0, z: 0 };
}

function towardCentre(point: RoomPoint, distance: number): RoomPoint {
  const length = Math.hypot(point.x, point.z);
  if (length <= distance) return { x: 0, z: 0 };
  const scale = (length - distance) / length;
  return { x: point.x * scale, z: point.z * scale };
}
