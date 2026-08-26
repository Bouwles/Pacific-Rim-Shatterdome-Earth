import { geo } from "../world/coordinates";
import { createRegionRegistry, type RegionDefinition, type RegionKind } from "../world/regions";
import { LAND_MASK_TARGET, OCEAN_MASK_TARGET, type TerrainAnchor } from "../world/terrain";

/**
 * Strategic regions.
 *
 * `seawardBearingDeg` is the direction open water lies from the region centre.
 * It is authored rather than derived, because terrain is generated and the
 * generator has no notion of which way a coast faces; the city plan rotates with
 * this so a harbour district ends up on the water.
 *
 * `cityPlanId` names the region profile the city is laid out from. Only a region with a plan
 * gets blocks, roads, lanes and evacuation zones; the rest remain strategic
 * records, which is the honest state for a region nobody has built yet.
 *
 * radiusMeters is the dense core that receives combat-grade geometry, not the
 * full metropolitan sprawl. On a globe shrunk to 1/50 the cities sit only tens
 * of kilometres apart, so a sprawl-sized radius would make neighbouring regions
 * overlap and leave the active region ambiguous. The tightest pair is Tokyo and
 * Vladivostok at 21 km, which is what caps these numbers.
 *
 * Coordinates are the real-world latitude and longitude of each place. The globe
 * they sit on is scaled down, so distances between them are compressed, but the
 * arrangement is recognisably Earth. Populations and radii are rounded
 * approximations chosen for gameplay, not survey data.
 */
const REGIONS: readonly RegionDefinition[] = [
  {
    id: "hong-kong",
    displayName: "Hong Kong",
    kind: "shatterdome",
    climate: "subtropical",
    centre: geo(22.3193, 114.1694),
    radiusMeters: 6_000,
    populationThousands: 7_500,
    deploymentPoint: true,
    seawardBearingDeg: 196,
    cityPlanId: "hong-kong",
    notes: "Home Shatterdome and the Bone Slums grown up around it.",
  },
  {
    id: "tokyo",
    displayName: "Tokyo",
    kind: "coastal-city",
    climate: "temperate",
    centre: geo(35.6762, 139.6503),
    radiusMeters: 7_000,
    populationThousands: 13_900,
    deploymentPoint: true,
    seawardBearingDeg: 150,
    cityPlanId: "tokyo",
    notes: "Dense bay-side sprawl; heavy civilian pressure in any breach.",
  },
  {
    id: "sydney",
    displayName: "Sydney",
    kind: "coastal-city",
    climate: "temperate",
    centre: geo(-33.8688, 151.2093),
    radiusMeters: 5_000,
    populationThousands: 5_300,
    deploymentPoint: true,
    seawardBearingDeg: 110,
    cityPlanId: "sydney",
    notes: "Harbour approach gives kaiju a sheltered run at the centre.",
  },
  {
    id: "manila",
    displayName: "Manila",
    kind: "coastal-city",
    climate: "tropical",
    centre: geo(14.5995, 120.9842),
    radiusMeters: 5_000,
    populationThousands: 13_500,
    deploymentPoint: true,
    seawardBearingDeg: 250,
    cityPlanId: "manila",
    notes: "Closest major population centre to the Breach approach lanes.",
  },
  {
    id: "anchorage",
    displayName: "Anchorage",
    kind: "coastal-city",
    climate: "subarctic",
    centre: geo(61.2181, -149.9003),
    radiusMeters: 3_500,
    populationThousands: 290,
    deploymentPoint: true,
    seawardBearingDeg: 200,
    cityPlanId: "anchorage",
    notes: "Cold-weather operations and the northern Pacific watch line.",
  },
  {
    id: "lima",
    displayName: "Lima",
    kind: "coastal-city",
    climate: "arid",
    centre: geo(-12.0464, -77.0428),
    radiusMeters: 5_000,
    populationThousands: 9_700,
    deploymentPoint: true,
    seawardBearingDeg: 240,
    cityPlanId: "lima",
    notes: "Eastern Pacific coverage.",
  },
  {
    id: "vladivostok",
    displayName: "Vladivostok",
    kind: "coastal-city",
    climate: "subarctic",
    centre: geo(43.1332, 131.9113),
    radiusMeters: 3_000,
    populationThousands: 600,
    deploymentPoint: true,
    seawardBearingDeg: 140,
    cityPlanId: "vladivostok",
    notes: "Northwest Pacific watch line.",
  },
  {
    id: "pacific-breach",
    displayName: "Breach Approach",
    kind: "ocean",
    climate: "oceanic",
    centre: geo(11.35, 142.2),
    radiusMeters: 25_000,
    populationThousands: 0,
    deploymentPoint: false,
    seawardBearingDeg: 0,
    cityPlanId: null,
    notes: "Open ocean over the deepest part of the trench. No civilians, no cover.",
  },
];

/**
 * How each kind of region shapes the terrain generated around it.
 *
 * A table rather than a branch, so adding a region kind is a row here instead of
 * an edit inside the generator, which must not know what a Shatterdome is.
 *
 * This mapping lives in the content layer, not in `world/regions.ts`. Putting it
 * there made `world/regions` import `world/terrain`, which imports `data/biomes`,
 * which imports `world/regions` again. The cycle left both mask constants
 * undefined at module-init time and every height came out NaN. Content depending
 * on the world layer is fine; the world layer depending on content is not.
 */
const KIND_TERRAIN_SHAPE: Readonly<Record<RegionKind, { maskTarget: number; populated: boolean }>> = {
  "coastal-city": { maskTarget: LAND_MASK_TARGET, populated: true },
  "inland-city": { maskTarget: LAND_MASK_TARGET, populated: true },
  shatterdome: { maskTarget: LAND_MASK_TARGET, populated: true },
  ocean: { maskTarget: OCEAN_MASK_TARGET, populated: false },
  wilderness: { maskTarget: LAND_MASK_TARGET, populated: false },
};

/**
 * The plain-data view of regions that terrain generation needs.
 *
 * Deliberately narrower than `RegionDefinition`: a place, a size, a population,
 * and what the terrain there should be. No gameplay fields. It also crosses a
 * worker boundary, so it must stay structured-cloneable.
 */
export function toTerrainAnchors(regions: readonly RegionDefinition[]): readonly TerrainAnchor[] {
  return regions.map((region) => {
    const shape = KIND_TERRAIN_SHAPE[region.kind];
    return {
      regionId: region.id,
      latitudeDeg: region.centre.latitudeDeg,
      longitudeDeg: region.centre.longitudeDeg,
      radiusMeters: region.radiusMeters,
      populationThousands: region.populationThousands,
      maskTarget: shape.maskTarget,
      climate: region.climate,
      populated: shape.populated,
    };
  });
}

/** The anchors the shipped regions produce. */
export function createDefaultTerrainAnchors(): readonly TerrainAnchor[] {
  return toTerrainAnchors(REGIONS);
}

export function createDefaultRegionRegistry() {
  const registry = createRegionRegistry();
  for (const region of REGIONS) registry.register(region);
  return registry;
}

export const REGION_DEFINITIONS = REGIONS;

/** The five locations the milestone's teleport acceptance test uses. */
export const TELEPORT_TEST_REGION_IDS = ["hong-kong", "sydney", "tokyo", "anchorage", "manila"] as const;
