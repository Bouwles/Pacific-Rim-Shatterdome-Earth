import { createRegionRegistry, type RegionDefinition } from "../world/regions";
import { REGION_DEFINITIONS } from "../data/regions";
import { Exploration, planRoute, travelHoursBetween } from "../world/exploration";
import { SITE_DEFINITIONS, candidatesFor, type RegionTraits, type SiteKind } from "../data/sites";
import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import type { GeoPosition } from "../world/coordinates";

/**
 * A world's worth of exploring, run headlessly.
 *
 * What this proves: that the planet has things in it worth going to, that what
 * a region carries follows what that region is rather than a quota, and that no
 * amount of walking away and back or reloading pays twice.
 *
 * Deterministic from a seed. No renderer, no clock, no world state.
 */

export const EXPLORATION_SCENARIO_SEED = 20260901;

export interface ExplorationScenarioResult {
  readonly seed: number;
  readonly regions: number;
  readonly placed: number;
  /** Regions carrying at least one site. */
  readonly regionsWithSites: number;
  /** Distinct site kinds placed anywhere in the world. */
  readonly kinds: readonly SiteKind[];
  /** Sites found by walking the world. */
  readonly discovered: number;
  /**
   * Sites walking alone can never find.
   *
   * Deliberately above zero: some places only exist on a chart somebody hands
   * you, which is what makes contracts, intelligence and allied governments
   * worth having rather than flavour text.
   */
  readonly needsIntelligence: number;
  /** Sites actually worked. */
  readonly claimed: number;
  /** What working them paid, in total. */
  readonly funding: number;
  readonly researchData: number;
  /** Places the carrier can now put a machine down. */
  readonly deployPoints: number;
  /** Credits a second pass over the same ground paid. Must be zero. */
  readonly repeatFunding: number;
  readonly digest: number;
}

/** Region traits, read off the shipped region table. */
export function traitsOf(region: RegionDefinition, damaged = false): RegionTraits {
  return {
    kind: region.kind,
    climate: region.climate,
    populationThousands: region.populationThousands,
    damaged,
  };
}

function worldRegions(damagedIds: ReadonlySet<string> = new Set()) {
  return REGION_DEFINITIONS.map((region) => ({
    id: region.id,
    centre: region.centre,
    traits: traitsOf(region, damagedIds.has(region.id)),
  }));
}

/**
 * One run.
 *
 * Walks a machine to every placed site in turn, which is the most thorough a
 * player could possibly be, and then does it all again to prove the second pass
 * is worth nothing.
 */
export function runExplorationScenario(seed = EXPLORATION_SCENARIO_SEED): ExplorationScenarioResult {
  // A couple of regions have been hit, so the sites that only appear in damaged
  // places have somewhere to be.
  const damaged = new Set(REGION_DEFINITIONS.slice(0, 2).map((region) => region.id));
  const regions = worldRegions(damaged);

  const exploration = new Exploration();
  exploration.place(seed, regions);
  const placed = exploration.placed();

  let funding = 0;
  let researchData = 0;
  for (const site of placed) {
    exploration.discoverNear(site.position);
    const result = exploration.claim(site.id, site.position);
    if (!result.ok || !result.reward) continue;
    funding += result.reward.funding;
    researchData += result.reward.researchData;
  }

  // The whole point: doing it again pays nothing.
  let repeatFunding = 0;
  for (const site of placed) {
    exploration.discoverNear(site.position);
    const again = exploration.claim(site.id, site.position);
    if (again.ok && again.reward) repeatFunding += again.reward.funding;
  }

  const kinds = new Set<SiteKind>();
  for (const site of placed) {
    const definition = SITE_DEFINITIONS.find((entry) => entry.id === site.siteId);
    if (definition) kinds.add(definition.kind);
  }
  const withSites = new Set(placed.map((site) => site.regionId));

  return {
    seed,
    regions: regions.length,
    placed: placed.length,
    regionsWithSites: withSites.size,
    kinds: [...kinds].sort(),
    discovered: exploration.discoveredCount(),
    needsIntelligence: placed.filter((site) => {
      const definition = SITE_DEFINITIONS.find((entry) => entry.id === site.siteId);
      return definition !== undefined && !definition.discoveredBy.includes("exploration");
    }).length,
    claimed: placed.filter((site) => exploration.isClaimed(site.id)).length,
    funding,
    researchData,
    deployPoints: exploration.deployPoints().length,
    repeatFunding,
    digest: (placed.length * 7919 + funding + researchData * 31) >>> 0,
  };
}

export interface PlacementSpreadResult {
  /** Site kinds seen per region kind, so nothing is uniform everywhere. */
  readonly byRegionKind: Readonly<Record<string, readonly SiteKind[]>>;
  /** Region kinds that carry a kind of site nothing else carries. */
  readonly exclusives: Readonly<Record<string, readonly SiteKind[]>>;
  /** True when at least one region kind carries something unique to it. */
  readonly distinct: boolean;
}

/**
 * What each kind of region can actually produce.
 *
 * The explicit failure mode this answers: generic collectibles scattered
 * uniformly. If every region kind could carry every site kind, the map would be
 * wallpaper, and this reports that rather than assuming it.
 */
export function placementSpread(): PlacementSpreadResult {
  const byRegionKind: Record<string, SiteKind[]> = {};
  for (const region of REGION_DEFINITIONS) {
    const traits = traitsOf(region, true);
    const kinds = new Set(candidatesFor(traits).map((site) => site.kind));
    const existing = new Set(byRegionKind[region.kind] ?? []);
    for (const kind of kinds) existing.add(kind);
    byRegionKind[region.kind] = [...existing].sort();
  }

  const exclusives: Record<string, SiteKind[]> = {};
  for (const [regionKind, kinds] of Object.entries(byRegionKind)) {
    const others = new Set(
      Object.entries(byRegionKind)
        .filter(([other]) => other !== regionKind)
        .flatMap(([, list]) => list),
    );
    exclusives[regionKind] = kinds.filter((kind) => !others.has(kind));
  }

  return {
    byRegionKind,
    exclusives,
    distinct: Object.values(exclusives).some((list) => list.length > 0),
  };
}

export interface RouteScenarioResult {
  readonly directHours: number;
  readonly assistedHours: number;
  readonly stops: number;
  /** True when going direct is genuinely faster, so the choice is real. */
  readonly directIsFaster: boolean;
}

/**
 * The route assist, measured.
 *
 * A route that stops at things has to cost time, or there is no decision: the
 * assist would simply be the correct answer and exploring would stop being a
 * choice about how to spend the trip.
 */
export function runRouteScenario(seed = EXPLORATION_SCENARIO_SEED): RouteScenarioResult {
  const regions = worldRegions();
  const exploration = new Exploration();
  exploration.place(seed, regions);
  const placed = exploration.placed();
  for (const site of placed) exploration.discover(site.id, "intelligence");

  const from = regions[0]!.centre;
  const to = regions[regions.length - 1]!.centre;
  const waypoints = placed.map((site) => ({
    id: site.id,
    name: site.siteId,
    position: site.position,
  }));

  const { direct, assisted } = planRoute(from, to, "destination", waypoints);
  return {
    directHours: direct.totalHours,
    assistedHours: assisted.totalHours,
    stops: Math.max(0, assisted.legs.length - 1),
    directIsFaster: direct.totalHours <= assisted.totalHours,
  };
}

/**
 * How long the planet takes to cross.
 *
 * The other explicit failure mode: a seamless Earth that means real-time
 * walking for hours. This reports what a carrier does against what a machine on
 * foot would, so the gap is a number rather than an assumption.
 */
export function crossingTimes(): {
  readonly farthestPairKm: number;
  readonly carrierHours: number;
  readonly onFootHours: number;
} {
  let farthest = 0;
  let pair: readonly [GeoPosition, GeoPosition] = [
    REGION_DEFINITIONS[0]!.centre,
    REGION_DEFINITIONS[0]!.centre,
  ];
  for (const first of REGION_DEFINITIONS) {
    for (const second of REGION_DEFINITIONS) {
      const hours = travelHoursBetween(first.centre, second.centre);
      if (hours > farthest) {
        farthest = hours;
        pair = [first.centre, second.centre];
      }
    }
  }
  const metres = farthest * 3_600 * 180;
  // A machine at a steady run, which is the fastest anything walks.
  const onFoot = metres / 14 / 3_600;
  void pair;
  void createRegionRegistry;
  void createSeededRng;
  void hashStringToSeed;
  return {
    farthestPairKm: Math.round(metres / 1_000),
    carrierHours: Math.round(farthest * 10) / 10,
    onFootHours: Math.round(onFoot * 10) / 10,
  };
}
