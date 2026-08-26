import { ContentRegistry, type RegistryEntry } from "./registry";
import type { DistrictKind, DistrictPlacement } from "./districts";
import type { MissionModifierId } from "./missionModifiers";

/**
 * What makes one place different from another.
 *
 * Every region gets a plan, a skyline, a shoreline, a traffic mix, a defence
 * posture, landmark slots, an ambience, an industry, a rebuilding capability and
 * the bearings creatures actually arrive on. All of it is data, and all of it
 * reaches the world through systems that already exist: the same district
 * registry, the same layout generator, the same destruction and streaming.
 * There is no bespoke scene code for any city.
 *
 * Two rules this file is written against.
 *
 * **Places are described by geography and infrastructure, never by the people
 * who live there.** A port is busy because of its shipping lanes, a city is
 * built low because of its seismic code, a shore is hard to fight on because of
 * its shelf depth. Nothing here characterises a culture, and the validator
 * refuses a profile whose identity is only a name and a colour.
 *
 * **Everything is a stylised approximation.** These are not real maps and do
 * not claim to be: they are proportions, bearings and material palettes chosen
 * to read as recognisably different at a glance. No commercial map data is used
 * anywhere in this project.
 *
 * No Babylon, no DOM, no RNG. This is a table.
 */

/** How a city is built upward. Changes the silhouette, not just the palette. */
export interface SkylineLanguage {
  /** Multiplier on every district's height range here. */
  readonly heightScale: number;
  /** Multiplier on how densely blocks are packed. */
  readonly coverageScale: number;
  /** Multiplier on how many towers stand on a block. */
  readonly towersScale: number;
  /** Multiplier on how irregular the street grid is. */
  readonly irregularityScale: number;
  /** Multiplier on lit signage at night. */
  readonly neonScale: number;
  /**
   * Linear RGB tint applied to every district colour here.
   *
   * A material and weathering difference rather than a flag: wet concrete reads
   * differently from sun-bleached render or ice-glazed steel.
   */
  readonly paletteTint: readonly [number, number, number];
  /** What it looks like from the water, in words. */
  readonly notes: string;
}

/** The water and the ground it meets. */
export interface ShorelineProfile {
  /** Metres of water depth a kilometre out. Drives whether anything can dive. */
  readonly shelfDepthMeters: number;
  /** 0 to 1. One is a deep enclosed bay, zero is open coast. */
  readonly enclosure: number;
  /** Metres of relief within the region radius. Flat deltas against hillsides. */
  readonly reliefMeters: number;
  readonly notes: string;
}

/** What moves through the region on an ordinary day. */
export interface TrafficMix {
  /** Shipping movements per hour through the lanes. */
  readonly harbourPerHour: number;
  /** Aircraft movements per hour through the corridors. */
  readonly airPerHour: number;
  /** Relative road traffic, one being ordinary. */
  readonly roadScale: number;
}

/** What the region can do about a creature before anybody deploys. */
export interface DefencePosture {
  /** Coastal gun batteries. Drives how much a stand-down accomplishes. */
  readonly batteries: number;
  /** Interceptor flights on standby. */
  readonly interceptors: number;
  /** Minutes before local defences engage. */
  readonly responseMinutes: number;
  readonly notes: string;
}

/** A named place a landmark can stand. Slots, not buildings. */
export interface LandmarkSlotSpec {
  readonly id: string;
  readonly displayName: string;
  /** 0 to 1 of the region radius. */
  readonly radiusFraction: number;
  /** Degrees from the seaward bearing. */
  readonly bearingOffsetDeg: number;
  /** Metres tall. Drives whether it is a silhouette feature or a detail. */
  readonly heightMeters: number;
  readonly notes: string;
}

/** What the region makes, and what that is worth to the programme. */
export interface IndustryProfile {
  readonly id: string;
  readonly displayName: string;
  /** Multiplier on contract funding earned defending here. */
  readonly contractScale: number;
  /** Multiplier on salvage recovered here. */
  readonly salvageScale: number;
  /** Multiplier on research data produced here. */
  readonly researchScale: number;
  readonly notes: string;
}

export interface RegionProfileDefinition extends RegistryEntry {
  /** Matches a region id exactly. */
  readonly id: string;
  readonly skyline: SkylineLanguage;
  readonly shoreline: ShorelineProfile;
  readonly traffic: TrafficMix;
  readonly defence: DefencePosture;
  readonly industry: IndustryProfile;
  /** The district wedges that make this city's plan. */
  readonly plan: readonly DistrictPlacement[];
  readonly landmarks: readonly LandmarkSlotSpec[];
  /** Ambient audio tags. Weather and machinery, never music. */
  readonly ambience: readonly string[];
  /**
   * How fast this place puts itself back together, one being ordinary.
   *
   * A function of construction capacity and access, so a small port with one
   * crane rebuilds slowly whatever else is true about it.
   */
  readonly rebuildRate: number;
  /** Bearings, degrees from the seaward direction, creatures arrive on. */
  readonly approachBearingsDeg: readonly number[];
  readonly modifiers: readonly MissionModifierId[];
  readonly notes: string;
}

/** Shorthand for a district wedge, so a plan reads as a shape. */
function wedge(
  districtId: DistrictKind,
  inner: number,
  outer: number,
  bearing: number,
  arc: number,
): DistrictPlacement {
  return {
    districtId,
    innerRadiusFraction: inner,
    outerRadiusFraction: outer,
    bearingOffsetDeg: bearing,
    arcDeg: arc,
  };
}

const PROFILES: readonly RegionProfileDefinition[] = [
  // ============================ hong kong =================================
  {
    id: "hong-kong",
    skyline: {
      heightScale: 1,
      coverageScale: 1,
      towersScale: 1,
      irregularityScale: 1,
      neonScale: 1,
      paletteTint: [1, 1, 1],
      notes: "Towers straight out of the water with hills immediately behind them.",
    },
    shoreline: {
      shelfDepthMeters: 34,
      enclosure: 0.7,
      reliefMeters: 480,
      notes: "A deep enclosed harbour with high ground on both sides.",
    },
    traffic: { harbourPerHour: 42, airPerHour: 14, roadScale: 1.3 },
    defence: {
      batteries: 6,
      interceptors: 4,
      responseMinutes: 8,
      notes: "The best defended stretch of coast anywhere, because it has had to be.",
    },
    industry: {
      id: "industry.port-finance",
      displayName: "Container port and finance",
      contractScale: 1.25,
      salvageScale: 1,
      researchScale: 1.05,
      notes: "Contracts are worth more here because the tonnage moving through is worth more.",
    },
    plan: [
      wedge("waterfront", 0.1, 0.34, 0, 92),
      wedge("downtown", 0.16, 0.52, 34, 86),
      wedge("docks", 0.22, 0.6, -68, 62),
      wedge("shatterdome", 0.12, 0.42, 96, 54),
      wedge("slums", 0.34, 0.66, 132, 70),
      wedge("industrial", 0.48, 0.82, -140, 88),
      wedge("hillside", 0.6, 0.96, 178, 120),
    ],
    landmarks: [
      {
        id: "landmark.hk.span",
        displayName: "Harbour span",
        radiusFraction: 0.2,
        bearingOffsetDeg: 8,
        heightMeters: 210,
        notes: "The crossing everything else is measured against.",
      },
      {
        id: "landmark.hk.peak",
        displayName: "The peak mast",
        radiusFraction: 0.82,
        bearingOffsetDeg: 176,
        heightMeters: 540,
        notes: "On the ridge, visible from every district.",
      },
    ],
    ambience: ["harbour-traffic", "city-hum", "ferry-horns"],
    rebuildRate: 1.2,
    approachBearingsDeg: [0, 24, -30],
    modifiers: ["dense-harbour", "typhoon"],
    notes: "The home Shatterdome. Deep water, high ground, and more shipping than anywhere.",
  },

  // ============================== tokyo ===================================
  {
    id: "tokyo",
    skyline: {
      heightScale: 0.82,
      coverageScale: 1.18,
      towersScale: 1.4,
      irregularityScale: 0.6,
      neonScale: 1.15,
      paletteTint: [0.96, 0.98, 1.02],
      notes: "Very dense and deliberately low: seismic code caps height across the whole plain.",
    },
    shoreline: {
      shelfDepthMeters: 18,
      enclosure: 0.55,
      reliefMeters: 90,
      notes: "A wide shallow bay on a flat alluvial plain.",
    },
    traffic: { harbourPerHour: 58, airPerHour: 26, roadScale: 1.6 },
    defence: {
      batteries: 8,
      interceptors: 6,
      responseMinutes: 6,
      notes: "Layered batteries across the bay mouth and interceptors on permanent alert.",
    },
    industry: {
      id: "industry.precision-manufacturing",
      displayName: "Precision manufacturing",
      contractScale: 1.15,
      salvageScale: 1.1,
      researchScale: 1.35,
      notes: "Component fabrication close by, so research and salvage both go further.",
    },
    plan: [
      wedge("waterfront", 0.08, 0.28, 0, 110),
      wedge("docks", 0.18, 0.5, -74, 78),
      wedge("downtown", 0.14, 0.46, 40, 104),
      wedge("industrial", 0.4, 0.74, -134, 96),
      wedge("slums", 0.44, 0.78, 118, 88),
      wedge("downtown", 0.5, 0.88, 168, 120),
    ],
    landmarks: [
      {
        id: "landmark.tokyo.tower",
        displayName: "Broadcast tower",
        radiusFraction: 0.42,
        bearingOffsetDeg: 62,
        heightMeters: 620,
        notes: "The one thing that breaks the height cap, and it is a mast rather than a building.",
      },
      {
        id: "landmark.tokyo.barrier",
        displayName: "Bay barrier",
        radiusFraction: 0.14,
        bearingOffsetDeg: -6,
        heightMeters: 60,
        notes: "A surge wall the length of the waterfront.",
      },
    ],
    ambience: ["dense-city", "rail-rumble", "shallow-surf"],
    rebuildRate: 1.35,
    approachBearingsDeg: [0, 18],
    modifiers: ["shallow-bay", "shipping-congestion"],
    notes: "Flat, low, extremely dense, and impossible to submerge in. Everything comes in on the surface.",
  },

  // ============================== sydney ==================================
  {
    id: "sydney",
    skyline: {
      heightScale: 0.9,
      coverageScale: 0.72,
      towersScale: 0.8,
      irregularityScale: 1.4,
      neonScale: 0.6,
      paletteTint: [1.08, 1.04, 0.94],
      notes: "A small tight core with low sprawl around it, broken up by inlets.",
    },
    shoreline: {
      shelfDepthMeters: 46,
      enclosure: 0.82,
      reliefMeters: 160,
      notes: "A deep drowned river valley with headlands and many separate arms.",
    },
    traffic: { harbourPerHour: 24, airPerHour: 12, roadScale: 0.9 },
    defence: {
      batteries: 4,
      interceptors: 3,
      responseMinutes: 11,
      notes: "Batteries on the heads, which means a narrow field of fire but a very good one.",
    },
    industry: {
      id: "industry.shipyards",
      displayName: "Shipyards and dry docks",
      contractScale: 1,
      salvageScale: 1.35,
      researchScale: 0.95,
      notes: "Heavy lift and hull work on hand, so salvage comes back in better condition.",
    },
    plan: [
      wedge("waterfront", 0.12, 0.36, 0, 76),
      wedge("downtown", 0.14, 0.4, 44, 62),
      wedge("docks", 0.2, 0.52, -58, 54),
      wedge("hillside", 0.34, 0.66, 96, 84),
      wedge("slums", 0.44, 0.8, -128, 92),
      wedge("industrial", 0.5, 0.86, 156, 104),
    ],
    landmarks: [
      {
        id: "landmark.sydney.arch",
        displayName: "Harbour arch",
        radiusFraction: 0.18,
        bearingOffsetDeg: -14,
        heightMeters: 140,
        notes: "A single steel arch across the main arm.",
      },
      {
        id: "landmark.sydney.heads",
        displayName: "The heads",
        radiusFraction: 0.9,
        bearingOffsetDeg: 2,
        heightMeters: 90,
        notes: "Two sandstone cliffs either side of the entrance.",
      },
    ],
    ambience: ["open-surf", "gull-cry", "quiet-city"],
    rebuildRate: 1,
    approachBearingsDeg: [0, -8],
    modifiers: ["dense-harbour"],
    notes: "Deep water inside a very narrow entrance. What gets in is trapped, and so are you.",
  },

  // ============================== manila ==================================
  {
    id: "manila",
    skyline: {
      heightScale: 0.68,
      coverageScale: 1.32,
      towersScale: 2.1,
      irregularityScale: 1.75,
      neonScale: 0.85,
      paletteTint: [1.04, 0.98, 0.9],
      notes: "Enormous low-rise density with a handful of towers standing out of it.",
    },
    shoreline: {
      shelfDepthMeters: 22,
      enclosure: 0.6,
      reliefMeters: 70,
      notes: "A wide bay on a flood plain, with volcanic ground inland.",
    },
    traffic: { harbourPerHour: 36, airPerHour: 10, roadScale: 1.8 },
    defence: {
      batteries: 3,
      interceptors: 2,
      responseMinutes: 16,
      notes: "Thin coverage over a very long shoreline.",
    },
    industry: {
      id: "industry.transshipment",
      displayName: "Transshipment and light assembly",
      contractScale: 0.95,
      salvageScale: 1.15,
      researchScale: 0.9,
      notes: "Volume rather than value: plenty to recover, less to be paid for defending it.",
    },
    plan: [
      wedge("waterfront", 0.1, 0.3, 0, 120),
      wedge("slums", 0.22, 0.62, 52, 130),
      wedge("docks", 0.16, 0.48, -70, 74),
      wedge("slums", 0.3, 0.72, -150, 118),
      wedge("downtown", 0.24, 0.46, 128, 44),
      wedge("industrial", 0.56, 0.9, 172, 96),
    ],
    landmarks: [
      {
        id: "landmark.manila.seawall",
        displayName: "Long seawall",
        radiusFraction: 0.16,
        bearingOffsetDeg: 0,
        heightMeters: 30,
        notes: "Kilometres of it, and the only thing between the bay and the low districts.",
      },
      {
        id: "landmark.manila.cone",
        displayName: "Inland cone",
        radiusFraction: 0.94,
        bearingOffsetDeg: 176,
        heightMeters: 700,
        notes: "A volcano on the skyline behind the city.",
      },
    ],
    ambience: ["heavy-rain", "dense-city", "harbour-traffic"],
    rebuildRate: 0.8,
    approachBearingsDeg: [0, 30, -34],
    modifiers: ["typhoon", "volcanic-risk", "shipping-congestion"],
    notes: "Huge, low, densely populated and thinly defended, with weather and geology both against it.",
  },

  // ============================ anchorage =================================
  {
    id: "anchorage",
    skyline: {
      heightScale: 0.55,
      coverageScale: 0.42,
      towersScale: 0.6,
      irregularityScale: 0.9,
      neonScale: 0.35,
      paletteTint: [0.9, 0.95, 1.12],
      notes: "Low, spread out and mostly single storey, against very large mountains.",
    },
    shoreline: {
      shelfDepthMeters: 12,
      enclosure: 0.75,
      reliefMeters: 1_400,
      notes: "A shallow silted inlet with an enormous tidal range and mountains straight off the water.",
    },
    traffic: { harbourPerHour: 6, airPerHour: 18, roadScale: 0.4 },
    defence: {
      batteries: 2,
      interceptors: 5,
      responseMinutes: 14,
      notes: "Few guns and a lot of aircraft, because the airfield is the reason the town is here.",
    },
    industry: {
      id: "industry.air-freight",
      displayName: "Air freight and resource staging",
      contractScale: 0.9,
      salvageScale: 0.9,
      researchScale: 1.2,
      notes: "A staging post rather than a market. Good for moving samples, poor for being paid.",
    },
    plan: [
      wedge("waterfront", 0.14, 0.3, 0, 70),
      wedge("docks", 0.18, 0.44, -46, 48),
      wedge("downtown", 0.2, 0.38, 40, 40),
      wedge("industrial", 0.36, 0.62, -120, 84),
      wedge("slums", 0.34, 0.58, 112, 62),
      wedge("hillside", 0.62, 1, 170, 150),
    ],
    landmarks: [
      {
        id: "landmark.anchorage.strip",
        displayName: "Long strip",
        radiusFraction: 0.38,
        bearingOffsetDeg: -96,
        heightMeters: 20,
        notes: "A runway longer than the town it serves.",
      },
      {
        id: "landmark.anchorage.range",
        displayName: "Coastal range",
        radiusFraction: 0.96,
        bearingOffsetDeg: 174,
        heightMeters: 1_800,
        notes: "Mountains straight up out of the inlet.",
      },
    ],
    ambience: ["wind-exposed", "ice-crack", "aircraft-idle"],
    rebuildRate: 0.55,
    approachBearingsDeg: [0],
    modifiers: ["ice", "shallow-bay", "mountainous-approach"],
    notes: "Cold, shallow, mountainous and small. Only one way in, and the ground is treacherous.",
  },

  // =============================== lima ===================================
  {
    id: "lima",
    skyline: {
      heightScale: 0.74,
      coverageScale: 1.05,
      towersScale: 1.2,
      irregularityScale: 1.5,
      neonScale: 0.55,
      paletteTint: [1.12, 1.06, 0.92],
      notes: "Pale render and flat roofs on a desert terrace above the sea.",
    },
    shoreline: {
      shelfDepthMeters: 64,
      enclosure: 0.15,
      reliefMeters: 320,
      notes: "A very narrow shelf falling away fast, under coastal cliffs.",
    },
    traffic: { harbourPerHour: 20, airPerHour: 9, roadScale: 1.1 },
    defence: {
      batteries: 3,
      interceptors: 2,
      responseMinutes: 13,
      notes: "Guns on the cliff line, which is the only ground worth putting them on.",
    },
    industry: {
      id: "industry.mineral-export",
      displayName: "Mineral export",
      contractScale: 1.05,
      salvageScale: 1.25,
      researchScale: 0.85,
      notes: "Smelters and ore handling on the dock, so recovered alloy goes further here.",
    },
    plan: [
      wedge("docks", 0.12, 0.36, 0, 68),
      wedge("waterfront", 0.1, 0.26, 44, 56),
      wedge("slums", 0.3, 0.68, 96, 124),
      wedge("downtown", 0.26, 0.52, -62, 70),
      wedge("industrial", 0.42, 0.78, -142, 92),
      wedge("hillside", 0.66, 0.98, 168, 96),
    ],
    landmarks: [
      {
        id: "landmark.lima.cliff",
        displayName: "Cliff terrace",
        radiusFraction: 0.24,
        bearingOffsetDeg: 20,
        heightMeters: 120,
        notes: "The whole city sits on top of it, a hundred metres above the water.",
      },
      {
        id: "landmark.lima.stack",
        displayName: "Smelter stack",
        radiusFraction: 0.6,
        bearingOffsetDeg: -138,
        heightMeters: 240,
        notes: "Visible from anywhere on the coast road.",
      },
    ],
    ambience: ["dry-wind", "heavy-surf", "industrial-hum"],
    rebuildRate: 0.9,
    approachBearingsDeg: [0, 16, -20],
    modifiers: ["mountainous-approach"],
    notes: "Deep water right up to a cliff, so anything arriving is already at the wall.",
  },

  // ============================ vladivostok ===============================
  {
    id: "vladivostok",
    skyline: {
      heightScale: 0.66,
      coverageScale: 0.6,
      towersScale: 0.9,
      irregularityScale: 1.25,
      neonScale: 0.4,
      paletteTint: [0.94, 0.96, 1.06],
      notes: "Blocks stepped up steep hillsides around a narrow inlet.",
    },
    shoreline: {
      shelfDepthMeters: 28,
      enclosure: 0.88,
      reliefMeters: 420,
      notes: "A long narrow horn of water with hills on both sides, frozen for part of the year.",
    },
    traffic: { harbourPerHour: 14, airPerHour: 6, roadScale: 0.6 },
    defence: {
      batteries: 5,
      interceptors: 2,
      responseMinutes: 10,
      notes: "Heavily gunned for its size, because the entrance is narrow enough to hold.",
    },
    industry: {
      id: "industry.naval-repair",
      displayName: "Naval repair yards",
      contractScale: 1,
      salvageScale: 1.3,
      researchScale: 1,
      notes: "Dry docks and heavy machining, so what comes back needs less work.",
    },
    plan: [
      wedge("docks", 0.1, 0.4, 0, 58),
      wedge("waterfront", 0.12, 0.3, 46, 48),
      wedge("downtown", 0.22, 0.44, -50, 46),
      wedge("hillside", 0.4, 0.78, 88, 96),
      wedge("hillside", 0.4, 0.78, -122, 96),
      wedge("industrial", 0.52, 0.88, 172, 80),
    ],
    landmarks: [
      {
        id: "landmark.vlad.bridge",
        displayName: "Inlet bridge",
        radiusFraction: 0.22,
        bearingOffsetDeg: 0,
        heightMeters: 320,
        notes: "One span across the horn, and the only quick way between the two sides.",
      },
      {
        id: "landmark.vlad.yard",
        displayName: "Dry dock gantry",
        radiusFraction: 0.44,
        bearingOffsetDeg: 12,
        heightMeters: 160,
        notes: "Big enough to lift a hull clear of the water.",
      },
    ],
    ambience: ["ice-crack", "wind-exposed", "shipyard-clang"],
    rebuildRate: 0.7,
    approachBearingsDeg: [0],
    modifiers: ["ice", "dense-harbour", "mountainous-approach"],
    notes: "A narrow frozen inlet with hills on both sides. One approach, and it is a corridor.",
  },
];

export function validateRegionProfile(entry: RegionProfileDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.trim()) errors.push("id is required");

  const { skyline } = entry;
  for (const key of [
    "heightScale",
    "coverageScale",
    "towersScale",
    "irregularityScale",
    "neonScale",
  ] as const) {
    if (!Number.isFinite(skyline[key]) || skyline[key] <= 0) errors.push(`skyline.${key} must be above zero`);
  }
  if (skyline.paletteTint.length !== 3) errors.push("skyline.paletteTint must be three channels");
  for (const channel of skyline.paletteTint) {
    if (!Number.isFinite(channel) || channel <= 0)
      errors.push("skyline.paletteTint channels must be above zero");
  }

  if (entry.shoreline.shelfDepthMeters <= 0) errors.push("shoreline.shelfDepthMeters must be above zero");
  if (entry.shoreline.enclosure < 0 || entry.shoreline.enclosure > 1) {
    errors.push("shoreline.enclosure must be between 0 and 1");
  }
  if (entry.shoreline.reliefMeters < 0) errors.push("shoreline.reliefMeters cannot be negative");

  for (const key of ["harbourPerHour", "airPerHour", "roadScale"] as const) {
    if (!Number.isFinite(entry.traffic[key]) || entry.traffic[key] < 0) {
      errors.push(`traffic.${key} cannot be negative`);
    }
  }

  if (entry.defence.batteries < 0) errors.push("defence.batteries cannot be negative");
  if (entry.defence.interceptors < 0) errors.push("defence.interceptors cannot be negative");
  if (entry.defence.responseMinutes <= 0) errors.push("defence.responseMinutes must be above zero");

  for (const key of ["contractScale", "salvageScale", "researchScale"] as const) {
    if (!Number.isFinite(entry.industry[key]) || entry.industry[key] <= 0) {
      errors.push(`industry.${key} must be above zero`);
    }
  }

  if (entry.plan.length < 4) errors.push("a city plan needs at least four districts to read as a city");
  for (const placement of entry.plan) {
    if (placement.innerRadiusFraction < 0 || placement.innerRadiusFraction >= placement.outerRadiusFraction) {
      errors.push(`${placement.districtId}: inner radius must be below outer`);
    }
    if (placement.outerRadiusFraction > 1) errors.push(`${placement.districtId}: outer radius above one`);
    if (placement.arcDeg <= 0 || placement.arcDeg > 180) {
      errors.push(`${placement.districtId}: arc must be between zero and 180 degrees`);
    }
  }

  if (entry.landmarks.length === 0)
    errors.push("a place with no landmark slots has no silhouette of its own");
  const landmarkIds = new Set<string>();
  for (const slot of entry.landmarks) {
    if (landmarkIds.has(slot.id)) errors.push(`duplicate landmark slot "${slot.id}"`);
    landmarkIds.add(slot.id);
    if (slot.radiusFraction < 0 || slot.radiusFraction > 1) {
      errors.push(`${slot.id}: radiusFraction must be between 0 and 1`);
    }
    if (slot.heightMeters <= 0) errors.push(`${slot.id}: heightMeters must be above zero`);
  }

  if (entry.ambience.length === 0) errors.push("a place with no ambience sounds like every other place");
  if (!Number.isFinite(entry.rebuildRate) || entry.rebuildRate <= 0)
    errors.push("rebuildRate must be above zero");
  if (entry.approachBearingsDeg.length === 0) errors.push("a place needs at least one approach bearing");

  // The rule against identity being a label. A profile that changes none of the
  // geometry, none of the palette and none of the conditions is a name.
  const shapesTheCity =
    skyline.heightScale !== 1 ||
    skyline.coverageScale !== 1 ||
    skyline.towersScale !== 1 ||
    skyline.irregularityScale !== 1;
  const shapesThePalette = skyline.paletteTint.some((channel) => channel !== 1);
  const shapesTheFight = entry.modifiers.length > 0;
  if (!shapesTheCity && !shapesThePalette && !shapesTheFight) {
    errors.push("a profile that changes no geometry, no palette and no conditions is only a label");
  }

  if (entry.notes.trim().length === 0) errors.push("notes are required");
  return errors;
}

export function createRegionProfileRegistry(): ContentRegistry<RegionProfileDefinition> {
  const registry = new ContentRegistry<RegionProfileDefinition>(validateRegionProfile);
  for (const entry of PROFILES) registry.register(entry);
  return registry;
}

export const REGION_PROFILES = PROFILES;
