import { createAssetRegistry, type AssetManifest } from "../assets/manifest";

/**
 * Every entry here is an original procedural placeholder. `source.url` stays null
 * until a real model is dropped into public/assets/models, at which point only
 * this file changes and no gameplay code moves.
 */

const ORIGINAL = {
  author: "Shatterdome Earth project",
  license: "original-procedural",
  sourceUrl: null,
  notes: "Generated placeholder geometry. Not a film or canon design.",
} as const;

const STANDARD_ANIMATIONS = [
  { id: "idle", clipName: "Idle", loop: true },
  { id: "walk", clipName: "Walk", loop: true },
] as const;

/** Jaegers and bipedal kaiju share these attachment points. */
function bipedSockets(height: number) {
  const chest = height * 0.62;
  return [
    { id: "head" as const, position: { x: 0, y: height * 0.95, z: 0 }, nodeName: "socket_head" },
    { id: "chest" as const, position: { x: 0, y: chest, z: height * 0.08 }, nodeName: "socket_chest" },
    { id: "back" as const, position: { x: 0, y: chest, z: -height * 0.08 }, nodeName: "socket_back" },
    { id: "reactor" as const, position: { x: 0, y: chest, z: 0 }, nodeName: "socket_reactor" },
    {
      id: "hand.L" as const,
      position: { x: -height * 0.16, y: height * 0.4, z: 0 },
      nodeName: "socket_hand_L",
    },
    {
      id: "hand.R" as const,
      position: { x: height * 0.16, y: height * 0.4, z: 0 },
      nodeName: "socket_hand_R",
    },
    {
      id: "forearm.L" as const,
      position: { x: -height * 0.16, y: height * 0.5, z: 0 },
      nodeName: "socket_forearm_L",
    },
    {
      id: "forearm.R" as const,
      position: { x: height * 0.16, y: height * 0.5, z: 0 },
      nodeName: "socket_forearm_R",
    },
    { id: "foot.L" as const, position: { x: -height * 0.07, y: 0, z: 0 }, nodeName: "socket_foot_L" },
    { id: "foot.R" as const, position: { x: height * 0.07, y: 0, z: 0 }, nodeName: "socket_foot_R" },
  ];
}

function boxCollision(width: number, height: number, depth: number) {
  return {
    shape: "box" as const,
    size: { x: width, y: height, z: depth },
    center: { x: 0, y: height / 2, z: 0 },
  };
}

const MANIFESTS: readonly AssetManifest[] = [
  {
    id: "jaeger.placeholder-mk0",
    displayName: "Placeholder Sentinel",
    assetClass: "jaeger",
    source: { url: null, format: "glb" },
    fallbackGenerator: { id: "biped", params: { heightMeters: 75, shoulderRatio: 0.3, bulk: 1 } },
    nominalHeightMeters: 75,
    materials: [
      { id: "hull", baseColorHex: "#59626b", metallic: 0.8, roughness: 0.45, textureUrl: null },
      { id: "trim", baseColorHex: "#8d6a2f", metallic: 0.6, roughness: 0.5, textureUrl: null },
      { id: "glow", baseColorHex: "#4fd2ff", metallic: 0.1, roughness: 0.3, textureUrl: null },
    ],
    animations: [...STANDARD_ANIMATIONS, { id: "attack.light", clipName: "AttackLight", loop: false }],
    sockets: bipedSockets(75),
    collision: boxCollision(26, 75, 18),
    audio: [
      { id: "footstep", url: null },
      { id: "reactor.hum", url: null },
    ],
    portrait: { id: "roster", url: null },
    provenance: ORIGINAL,
    seed: 1001,
  },
  {
    id: "jaeger.heavy-mk4",
    displayName: "Heavy Frame Mk-4",
    assetClass: "jaeger",
    source: { url: null, format: "glb" },
    // Same generator, different numbers: bulkier, shorter, wider shouldered.
    fallbackGenerator: {
      id: "biped",
      params: { heightMeters: 68, shoulderRatio: 0.36, bulk: 1.35, legRatio: 0.42, torsoRatio: 0.38 },
    },
    nominalHeightMeters: 68,
    materials: [
      { id: "hull", baseColorHex: "#4a4f56", metallic: 0.85, roughness: 0.5, textureUrl: null },
      { id: "trim", baseColorHex: "#b23a2c", metallic: 0.5, roughness: 0.55, textureUrl: null },
      { id: "glow", baseColorHex: "#ffb54f", metallic: 0.1, roughness: 0.3, textureUrl: null },
    ],
    animations: [...STANDARD_ANIMATIONS],
    sockets: bipedSockets(68),
    collision: boxCollision(28, 68, 20),
    audio: [{ id: "footstep", url: null }],
    portrait: { id: "roster", url: null },
    provenance: ORIGINAL,
    seed: 1002,
  },
  {
    id: "kaiju.biped-alpha",
    displayName: "Bipedal Kaiju Archetype",
    assetClass: "kaiju",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "biped",
      params: { heightMeters: 82, shoulderRatio: 0.34, bulk: 1.2, legRatio: 0.5, headRatio: 0.13 },
    },
    nominalHeightMeters: 82,
    materials: [
      { id: "hull", baseColorHex: "#3d5646", metallic: 0.15, roughness: 0.85, textureUrl: null },
      { id: "trim", baseColorHex: "#2b3a33", metallic: 0.1, roughness: 0.9, textureUrl: null },
      { id: "glow", baseColorHex: "#7bf07b", metallic: 0.05, roughness: 0.4, textureUrl: null },
    ],
    animations: [...STANDARD_ANIMATIONS, { id: "roar", clipName: "Roar", loop: false }],
    sockets: bipedSockets(82),
    collision: boxCollision(30, 82, 22),
    audio: [{ id: "roar", url: null }],
    portrait: { id: "bestiary", url: null },
    provenance: ORIGINAL,
    seed: 2001,
  },
  {
    id: "kaiju.quadruped-alpha",
    displayName: "Quadruped Kaiju Archetype",
    assetClass: "kaiju",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "quadruped",
      params: { heightMeters: 55, lengthRatio: 1.8, legRatio: 0.42, tailSegments: 5 },
    },
    nominalHeightMeters: 55,
    materials: [{ id: "hide", baseColorHex: "#5a4632", metallic: 0.1, roughness: 0.9, textureUrl: null }],
    animations: [...STANDARD_ANIMATIONS],
    sockets: [
      { id: "head", position: { x: 0, y: 42, z: 52 }, nodeName: "socket_head" },
      { id: "chest", position: { x: 0, y: 34, z: 26 }, nodeName: "socket_chest" },
      { id: "back", position: { x: 0, y: 50, z: 0 }, nodeName: "socket_back" },
    ],
    collision: boxCollision(36, 55, 100),
    audio: [{ id: "roar", url: null }],
    portrait: { id: "bestiary", url: null },
    provenance: ORIGINAL,
    seed: 2002,
  },
  {
    id: "kaiju.serpentine-alpha",
    displayName: "Serpentine Kaiju Archetype",
    assetClass: "kaiju",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "serpentine",
      params: { heightMeters: 44, segmentCount: 9, girthRatio: 0.24 },
    },
    nominalHeightMeters: 44,
    materials: [{ id: "hide", baseColorHex: "#324a5e", metallic: 0.2, roughness: 0.75, textureUrl: null }],
    animations: [...STANDARD_ANIMATIONS],
    sockets: [
      { id: "head", position: { x: 0, y: 38, z: 9 }, nodeName: "socket_head" },
      { id: "chest", position: { x: 0, y: 30, z: 0 }, nodeName: "socket_chest" },
    ],
    collision: boxCollision(12, 44, 120),
    audio: [{ id: "roar", url: null }],
    portrait: { id: "bestiary", url: null },
    provenance: ORIGINAL,
    seed: 2003,
  },
  {
    id: "building.tower",
    displayName: "Coastal Tower",
    assetClass: "building",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "block-building",
      params: { heightMeters: 120, footprintX: 24, footprintZ: 24, setbacks: 3, roofPlant: 1 },
    },
    nominalHeightMeters: 120,
    materials: [
      { id: "concrete", baseColorHex: "#8e8b85", metallic: 0.05, roughness: 0.95, textureUrl: null },
      { id: "trim", baseColorHex: "#5c5f63", metallic: 0.4, roughness: 0.6, textureUrl: null },
    ],
    animations: [],
    sockets: [],
    collision: boxCollision(24, 120, 24),
    audio: [{ id: "collapse", url: null }],
    portrait: null,
    provenance: ORIGINAL,
    seed: 3001,
  },
  {
    id: "building.warehouse",
    displayName: "Dock Warehouse",
    assetClass: "building",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "block-building",
      params: { heightMeters: 14, footprintX: 44, footprintZ: 28, setbacks: 1, roofPlant: 0 },
    },
    nominalHeightMeters: 14,
    materials: [
      { id: "concrete", baseColorHex: "#9a9187", metallic: 0.05, roughness: 0.95, textureUrl: null },
      { id: "trim", baseColorHex: "#6b5a44", metallic: 0.3, roughness: 0.7, textureUrl: null },
    ],
    animations: [],
    sockets: [],
    collision: boxCollision(44, 14, 28),
    audio: [{ id: "collapse", url: null }],
    portrait: null,
    provenance: ORIGINAL,
    seed: 3002,
  },
  {
    id: "vehicle.civilian-car",
    displayName: "Civilian Car",
    assetClass: "vehicle",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "wheeled-vehicle",
      params: { lengthMeters: 4.6, widthMeters: 1.9, heightMeters: 1.5, wheelPairs: 2 },
    },
    nominalHeightMeters: 1.5,
    materials: [
      { id: "paint", baseColorHex: "#b8433a", metallic: 0.6, roughness: 0.35, textureUrl: null },
      { id: "glass", baseColorHex: "#2b3d4a", metallic: 0.2, roughness: 0.15, textureUrl: null },
      { id: "rubber", baseColorHex: "#1e1e20", metallic: 0.05, roughness: 0.95, textureUrl: null },
    ],
    animations: [],
    sockets: [],
    collision: boxCollision(1.9, 1.5, 4.6),
    audio: [{ id: "horn", url: null }],
    portrait: null,
    provenance: ORIGINAL,
    seed: 4001,
  },
  {
    id: "ship.container-freighter",
    displayName: "Container Freighter",
    assetClass: "ship",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "hull-ship",
      params: { lengthMeters: 210, beamMeters: 32, heightMeters: 24, superstructureDecks: 3 },
    },
    nominalHeightMeters: 24,
    materials: [
      { id: "steel", baseColorHex: "#3f4a52", metallic: 0.7, roughness: 0.6, textureUrl: null },
      { id: "trim", baseColorHex: "#c4c0b6", metallic: 0.3, roughness: 0.7, textureUrl: null },
    ],
    animations: [],
    sockets: [{ id: "back", position: { x: 0, y: 14, z: -58 }, nodeName: "socket_back" }],
    collision: boxCollision(32, 24, 210),
    audio: [{ id: "horn", url: null }],
    portrait: null,
    provenance: ORIGINAL,
    seed: 5001,
  },
  {
    id: "prop.cargo-crate",
    displayName: "Cargo Crate",
    assetClass: "prop",
    source: { url: null, format: "glb" },
    fallbackGenerator: { id: "prop", params: { kind: "crate", heightMeters: 2.6, radiusMeters: 1.3 } },
    nominalHeightMeters: 2.6,
    materials: [{ id: "paint", baseColorHex: "#7a6a3f", metallic: 0.3, roughness: 0.8, textureUrl: null }],
    animations: [],
    sockets: [],
    collision: boxCollision(2.6, 2.6, 2.6),
    audio: [],
    portrait: null,
    provenance: ORIGINAL,
    seed: 6001,
  },
  {
    id: "prop.shore-cannon",
    displayName: "Shore Defence Cannon",
    assetClass: "prop",
    source: { url: null, format: "glb" },
    fallbackGenerator: { id: "prop", params: { kind: "cannon", heightMeters: 4.2, radiusMeters: 1.1 } },
    nominalHeightMeters: 4.2,
    materials: [{ id: "steel", baseColorHex: "#4d5358", metallic: 0.75, roughness: 0.5, textureUrl: null }],
    animations: [{ id: "fire", clipName: "Fire", loop: false }],
    // The only asset with a muzzle: projectiles spawn from this node, not from a hard-coded offset.
    sockets: [{ id: "muzzle", position: { x: 0, y: 2.5, z: 9.2 }, nodeName: "socket_muzzle" }],
    collision: boxCollision(2.2, 4.2, 9.2),
    audio: [{ id: "fire", url: null }],
    portrait: null,
    provenance: ORIGINAL,
    seed: 6002,
  },
  {
    id: "shatterdome.jaeger-bay",
    displayName: "Jaeger Bay Module",
    assetClass: "shatterdome-module",
    source: { url: null, format: "glb" },
    fallbackGenerator: {
      id: "shatterdome-module",
      params: { widthMeters: 130, depthMeters: 96, heightMeters: 104, gantryCount: 3 },
    },
    nominalHeightMeters: 104,
    materials: [
      { id: "concrete", baseColorHex: "#6f7378", metallic: 0.05, roughness: 0.95, textureUrl: null },
      { id: "steel", baseColorHex: "#454b52", metallic: 0.8, roughness: 0.45, textureUrl: null },
      { id: "trim", baseColorHex: "#c8a032", metallic: 0.5, roughness: 0.6, textureUrl: null },
    ],
    animations: [{ id: "door.open", clipName: "DoorOpen", loop: false }],
    sockets: [],
    collision: boxCollision(130, 104, 96),
    audio: [{ id: "door", url: null }],
    portrait: null,
    provenance: ORIGINAL,
    seed: 7001,
  },
];

export function createDefaultAssetRegistry() {
  const registry = createAssetRegistry();
  for (const manifest of MANIFESTS) registry.register(manifest);
  return registry;
}

export const ASSET_MANIFESTS = MANIFESTS;
