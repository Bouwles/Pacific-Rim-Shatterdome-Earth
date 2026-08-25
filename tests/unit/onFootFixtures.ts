import { stepOnFoot, type OnFootInput, type OnFootPose } from "../../src/shatterdome/onFoot";
import type { InteriorRoom } from "../../src/shatterdome/interiorLayout";

export type { EnvironmentEffects } from "../../src/world/environment";

/** A room is the only thing movement needs, so tests build one directly. */
export type InteriorRoomLike = InteriorRoom;

const EMPTY_ROOM: InteriorRoom = {
  id: "test-room",
  facilityId: "command",
  displayName: "Test room",
  deck: 0,
  status: "operational",
  tier: 1,
  widthMeters: 24,
  depthMeters: 24,
  heightMeters: 6,
  floorColour: [0.2, 0.2, 0.2],
  accentColour: [0.4, 0.6, 0.8],
  ambience: "test",
  obstacles: [],
  interactables: [],
  staffPosts: [],
  spawnPoints: [{ x: 0, z: 0 }],
  staffSlots: 4,
  fixtureCount: 0,
  underConstruction: false,
  lighting: "full",
  signage: "lit",
  cranes: 0,
  deliveries: 0,
  stageNote: "A finished room, for a test that does not care what it looks like.",
  builders: 0,
};

export function room(overrides: Partial<InteriorRoom> = {}): InteriorRoom {
  return { ...EMPTY_ROOM, ...overrides };
}

/** Steps at a fixed sixty frames a second, the way the game does. */
export function walkFor(
  pose: OnFootPose,
  input: OnFootInput,
  seconds: number,
  space: InteriorRoom,
  effects: Parameters<typeof stepOnFoot>[4],
): OnFootPose {
  let current = pose;
  const steps = Math.round(seconds * 60);
  for (let index = 0; index < steps; index += 1) {
    current = stepOnFoot(current, input, 1 / 60, space, effects);
  }
  return current;
}
