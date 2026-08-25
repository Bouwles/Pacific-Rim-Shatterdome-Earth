import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Facility grammar.
 *
 * A facility is a rule for making a room, the same way a district is a rule for
 * making blocks: how big the space is, which deck it sits on, what stations it
 * holds, what each tier costs in power and construction crews, and what that
 * tier actually gives back. Adding a facility is a row here plus a connection,
 * never a branch in room-building or interface code.
 *
 * Two resources shape every decision and neither of them is invented currency.
 * **Power** comes from the reactor and is drawn by everything else, so a new
 * laboratory can be refused because the reactor cannot carry it. **Crews** come
 * from logistics and are tied up for the length of a build, so two orders at
 * once is a choice rather than a formality. Money, contracts and research
 * unlocks are the economy's business, and the contracts office is where they are
 * dealt with; power and crews are still what a facility order costs.
 */

export const FACILITY_KINDS = [
  "command",
  "jaeger-bay",
  "repair",
  "research",
  "manufacture",
  "reactor",
  "logistics",
  "training",
  "quarters",
  "defense",
  "archive",
  "contract",
  "launch",
  "medical",
  "kaiju-containment",
] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/** What a player can walk up to and use. Placement is generated; the kinds are authored. */
export const STATION_KINDS = [
  /** Opens the facility management interface for the room it stands in. */
  "terminal",
  /** A named crew member's post. Talking to them reports real facility state. */
  "staff-post",
  /** A Jaeger berth: select and inspect the machine standing in it. */
  "berth",
  /** The way into a Conn-Pod. Only ever placed in the Jaeger bay. */
  "conn-pod",
] as const;
export type StationKind = (typeof STATION_KINDS)[number];

export interface StationSpec {
  readonly kind: StationKind;
  readonly label: string;
  /** How many of this station the room has at tier 1. Tiers add more. */
  readonly count: number;
}

export interface FacilityTier {
  /** 1-based. Tier 1 is the facility existing at all. */
  readonly tier: number;
  readonly displayName: string;
  /** In-game seconds of work. One tick is one in-game second. */
  readonly constructionTicks: number;
  /** Construction crews held for the whole build, then released. */
  readonly crewRequired: number;
  /** Continuous draw once operational, megawatts. */
  readonly powerDrawMw: number;
  /** Reactor only. Everything else is zero, so power balance is one sum. */
  readonly powerOutputMw: number;
  /** Construction crews this tier adds to the pool. Logistics only. */
  readonly crewProvided: number;
  /** Staff posted here on a full shift. Drives schedules and ambient work. */
  readonly staffSlots: number;
  /** Workstations, gantries or racks the room shows. This is the visible upgrade. */
  readonly fixtures: number;
  /** One honest sentence about what this tier does. Shown at the terminal. */
  readonly benefit: string;
  /**
   * Funding this tier costs to build, once.
   *
   * Money arrived with the market, so a facility order is now a decision about
   * what else that money was going to buy rather than only about crews.
   */
  readonly cost: number;
  /** Funding this tier costs every day once it is standing. */
  readonly upkeepPerDay: number;
  /**
   * What this tier is actually worth, as named multipliers.
   *
   * A fixed vocabulary, so a tier cannot promise something nothing reads. Every
   * one of these is consumed somewhere: a facility that only changed a sentence
   * would be a menu unlock, which is the thing this milestone exists to avoid.
   */
  readonly effects: Partial<Record<FacilityEffect, number>>;
  /**
   * Module slots this tier opens, for the fittings a facility carries.
   *
   * Footprint in the sense that matters: how much can be installed here, rather
   * than how many square metres the room claims.
   */
  readonly moduleSlots: number;
  /** Facilities that must already be standing at this tier before it can start. */
  readonly requires: readonly { readonly facilityId: FacilityKind; readonly tier: number }[];
  /**
   * What the room looks like at this tier, so an upgrade is visible rather than
   * a number. Read by the layout, never by the simulation.
   */
  readonly stage: StageVariant;
}

/**
 * What a facility can be worth.
 *
 * Named effects with somewhere in the game that already reads them. Anything
 * added here has to be consumed by something, which the registry checks.
 */
export const FACILITY_EFFECTS = [
  /** Multiplier on hours of repair work a shift puts into a machine. */
  "repairRate",
  /** Multiplier on how fast construction crews work. */
  "constructionRate",
  /** Multiplier on experience a sortie pays a machine. */
  "trainingRate",
  /** Multiplier on how fast injured pilots recover. */
  "medicalRate",
  /** Multiplier on salvage and samples recovered. */
  "researchYield",
  /** Multiplier on funding a sortie pays. */
  "contractYield",
  /** Multiplier on how quickly a bought machine is delivered. */
  "deliverySpeed",
  /** Multiplier on how much a contained specimen is worth in research. */
  "containmentYield",
  /** Multiplier on regional defence when the player does not go. */
  "defenceStrength",
] as const;
export type FacilityEffect = (typeof FACILITY_EFFECTS)[number];

/**
 * How a room reads at a given tier.
 *
 * Presentation only. The layout turns these into fixtures, scaffolds, cranes,
 * crates and light; nothing authoritative reads any of it.
 */
export interface StageVariant {
  /** Working lights, floodlights, or the full rig. Drives room brightness. */
  readonly lighting: "work" | "flood" | "full";
  /** Painted number, stencilled name, or a lit sign over the door. */
  readonly signage: "none" | "stencil" | "lit";
  /** Gantry cranes standing in the room. */
  readonly cranes: number;
  /** Pallets and crates waiting to be unpacked. */
  readonly deliveries: number;
  /** One line describing what somebody walking in would notice. */
  readonly note: string;
}

export interface FacilityDefinition extends RegistryEntry {
  readonly id: FacilityKind;
  readonly displayName: string;
  /** Vertical level. Negative is below the waterline, which is where the reactor lives. */
  readonly deck: number;
  readonly widthMeters: number;
  readonly depthMeters: number;
  readonly heightMeters: number;
  readonly floorColour: readonly [number, number, number];
  readonly accentColour: readonly [number, number, number];
  /** Ambience label the audio layer can key off later. Descriptive, not a file name. */
  readonly ambience: string;
  readonly stations: readonly StationSpec[];
  /** True when a new campaign starts with this facility already standing. */
  readonly startsBuilt: boolean;
  readonly tiers: readonly FacilityTier[];
  readonly description: string;
}

/** How two rooms are joined. Each kind has its own travel time and its own transition. */
export const CONNECTION_KINDS = ["door", "lift", "tram"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export interface ConnectionSpec {
  readonly from: FacilityKind;
  readonly to: FacilityKind;
  readonly kind: ConnectionKind;
}

/** Seconds a transition takes. A door is a step; a tram crosses the complex. */
export const CONNECTION_SECONDS: Readonly<Record<ConnectionKind, number>> = {
  door: 0.5,
  lift: 1.8,
  tram: 3.6,
};

/** Crews available before logistics adds any. Two orders of one crew, or one of two. */
export const BASE_CREW_CAPACITY = 2;

const DEFINITIONS: readonly FacilityDefinition[] = [
  {
    id: "command",
    displayName: "LOCCENT Command",
    deck: 2,
    widthMeters: 34,
    depthMeters: 26,
    heightMeters: 9,
    floorColour: [0.16, 0.19, 0.23],
    accentColour: [0.32, 0.72, 0.95],
    ambience: "console hum and radio traffic",
    stations: [
      { kind: "terminal", label: "Command console", count: 1 },
      { kind: "staff-post", label: "Watch station", count: 4 },
    ],
    startsBuilt: true,
    tiers: [
      {
        tier: 1,
        displayName: "Provisional LOCCENT",
        constructionTicks: 3_600,
        crewRequired: 1,
        powerDrawMw: 30,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 6,
        fixtures: 4,
        benefit: "Facility orders can be issued and the complex reports its own state.",
        cost: 900_000,
        upkeepPerDay: 900,
        effects: {},
        moduleSlots: 1,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 0,
          deliveries: 1,
          note: "Folding tables, taped cable runs and one working screen.",
        },
      },
      {
        tier: 2,
        displayName: "Full LOCCENT",
        constructionTicks: 10_800,
        crewRequired: 2,
        powerDrawMw: 46,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 11,
        fixtures: 8,
        benefit: "A full watch floor: every facility reports through one board instead of by runner.",
        cost: 2_400_000,
        upkeepPerDay: 2_100,
        effects: { constructionRate: 1.1, contractYield: 1.06 },
        moduleSlots: 2,
        requires: [{ facilityId: "logistics", tier: 1 }],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 0,
          deliveries: 0,
          note: "A proper watch floor, lit and quiet, with the board on the wall.",
        },
      },
    ],
    description: "The room the complex is run from. Everything else reports here.",
  },
  {
    id: "jaeger-bay",
    displayName: "Jaeger Bay",
    deck: 0,
    widthMeters: 130,
    depthMeters: 96,
    heightMeters: 104,
    floorColour: [0.2, 0.21, 0.22],
    accentColour: [0.85, 0.68, 0.22],
    ambience: "crane travel and deep structural noise",
    stations: [
      { kind: "terminal", label: "Bay control", count: 1 },
      { kind: "berth", label: "Jaeger berth", count: 2 },
      { kind: "conn-pod", label: "Conn-Pod access gantry", count: 1 },
      { kind: "staff-post", label: "Deck crew post", count: 3 },
    ],
    startsBuilt: true,
    tiers: [
      {
        tier: 1,
        displayName: "Two-berth bay",
        constructionTicks: 14_400,
        crewRequired: 2,
        powerDrawMw: 60,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 14,
        fixtures: 3,
        benefit: "Two berths with access gantries. Machines can be boarded and inspected.",
        cost: 1_800_000,
        upkeepPerDay: 2_400,
        effects: {},
        moduleSlots: 1,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 1,
          deliveries: 2,
          note: "One gantry, a hook, and a great deal of empty floor.",
        },
      },
      {
        tier: 2,
        displayName: "Four-berth bay",
        constructionTicks: 28_800,
        crewRequired: 2,
        powerDrawMw: 95,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 22,
        fixtures: 5,
        benefit: "Four berths and heavier cranes. More machines can stand ready at once.",
        cost: 4_800_000,
        upkeepPerDay: 4_600,
        effects: { repairRate: 1.12 },
        moduleSlots: 3,
        requires: [{ facilityId: "reactor", tier: 1 }],
        stage: {
          lighting: "flood",
          signage: "lit",
          cranes: 3,
          deliveries: 1,
          note: "Three gantries over three berths, and the floodlights are on.",
        },
      },
    ],
    description: "Where the machines stand. The one room built at Jaeger scale.",
  },
  {
    id: "repair",
    displayName: "Repair Gantries",
    deck: 0,
    widthMeters: 78,
    depthMeters: 62,
    heightMeters: 84,
    floorColour: [0.18, 0.18, 0.2],
    accentColour: [0.95, 0.5, 0.2],
    ambience: "arc welders and hydraulic release",
    stations: [
      { kind: "terminal", label: "Repair board", count: 1 },
      { kind: "staff-post", label: "Fitter post", count: 3 },
    ],
    startsBuilt: true,
    tiers: [
      {
        tier: 1,
        displayName: "Single gantry",
        constructionTicks: 7_200,
        crewRequired: 1,
        powerDrawMw: 45,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 10,
        fixtures: 2,
        benefit: "One gantry: armour panels and actuators can be worked on in place.",
        cost: 1_400_000,
        upkeepPerDay: 1_900,
        effects: { repairRate: 1.35 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 1,
          deliveries: 3,
          note: "Cutting gear on trolleys and a lot of spare plate.",
        },
      },
      {
        tier: 2,
        displayName: "Twin gantry with plate shop",
        constructionTicks: 18_000,
        crewRequired: 2,
        powerDrawMw: 72,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 17,
        fixtures: 4,
        benefit: "Two gantries and a plate shop, so structural damage no longer waits its turn.",
        cost: 3_900_000,
        upkeepPerDay: 3_800,
        effects: { repairRate: 1.9 },
        moduleSlots: 4,
        requires: [{ facilityId: "manufacture", tier: 1 }],
        stage: {
          lighting: "flood",
          signage: "lit",
          cranes: 2,
          deliveries: 1,
          note: "Two overhead cranes and a component line that never stops.",
        },
      },
    ],
    description: "Where damage is undone. Adjacent to the bay because the machines cannot walk far.",
  },
  {
    id: "research",
    displayName: "Kaiju Research",
    deck: 2,
    widthMeters: 30,
    depthMeters: 24,
    heightMeters: 7,
    floorColour: [0.15, 0.2, 0.19],
    accentColour: [0.4, 0.9, 0.62],
    ambience: "extractor fans and specimen chillers",
    stations: [
      { kind: "terminal", label: "Research console", count: 1 },
      { kind: "staff-post", label: "Analysis bench", count: 3 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Field laboratory",
        constructionTicks: 5_400,
        crewRequired: 1,
        powerDrawMw: 25,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 5,
        fixtures: 4,
        benefit: "Salvaged tissue can be held and catalogued instead of discarded.",
        cost: 1_200_000,
        upkeepPerDay: 1_600,
        effects: { researchYield: 1.3 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 0,
          deliveries: 3,
          note: "Benches, cold storage, and something in a tank.",
        },
      },
      {
        tier: 2,
        displayName: "Containment laboratory",
        constructionTicks: 16_200,
        crewRequired: 2,
        powerDrawMw: 40,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 9,
        fixtures: 7,
        benefit: "Sealed containment, so live samples stop being a reason to evacuate a deck.",
        cost: 3_400_000,
        upkeepPerDay: 3_400,
        effects: { researchYield: 1.75, containmentYield: 1.2 },
        moduleSlots: 4,
        requires: [{ facilityId: "medical", tier: 1 }],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 0,
          deliveries: 1,
          note: "Clean rooms behind glass, and the specimens are labelled.",
        },
      },
    ],
    description: "Where the biology is worked out. Built cold and vented hard.",
  },
  {
    id: "manufacture",
    displayName: "Fabrication Hall",
    deck: 1,
    widthMeters: 56,
    depthMeters: 44,
    heightMeters: 16,
    floorColour: [0.19, 0.18, 0.17],
    accentColour: [0.9, 0.75, 0.35],
    ambience: "press strikes and overhead conveyors",
    stations: [
      { kind: "terminal", label: "Fabrication control", count: 1 },
      { kind: "staff-post", label: "Machine post", count: 4 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Plate and frame line",
        constructionTicks: 9_000,
        crewRequired: 2,
        powerDrawMw: 55,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 12,
        fixtures: 4,
        benefit: "Armour plate and structural frame can be made here rather than shipped in.",
        cost: 2_100_000,
        upkeepPerDay: 2_800,
        effects: { repairRate: 1.1, deliverySpeed: 1.1 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 2,
          deliveries: 4,
          note: "A press, a lathe, and pallets of stock in the way.",
        },
      },
      {
        tier: 2,
        displayName: "Component works",
        constructionTicks: 21_600,
        crewRequired: 3,
        powerDrawMw: 92,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 20,
        fixtures: 8,
        benefit: "Actuators and weapon components as well as plate, which shortens every repair.",
        cost: 5_200_000,
        upkeepPerDay: 5_400,
        effects: { repairRate: 1.25, deliverySpeed: 1.3 },
        moduleSlots: 4,
        requires: [{ facilityId: "logistics", tier: 2 }],
        stage: {
          lighting: "flood",
          signage: "lit",
          cranes: 4,
          deliveries: 2,
          note: "A fabrication line under four cranes, running two shifts.",
        },
      },
    ],
    description: "Where parts come from. Loud, hot, and directly under the bay cranes.",
  },
  {
    id: "reactor",
    displayName: "Reactor and Utilities",
    deck: -1,
    widthMeters: 42,
    depthMeters: 36,
    heightMeters: 20,
    floorColour: [0.14, 0.15, 0.18],
    accentColour: [0.35, 0.85, 0.95],
    ambience: "coolant flow and turbine tone",
    stations: [
      { kind: "terminal", label: "Reactor board", count: 1 },
      { kind: "staff-post", label: "Watch post", count: 2 },
    ],
    startsBuilt: true,
    tiers: [
      {
        tier: 1,
        displayName: "Single loop",
        constructionTicks: 10_800,
        crewRequired: 2,
        powerDrawMw: 0,
        powerOutputMw: 220,
        crewProvided: 0,
        staffSlots: 6,
        fixtures: 3,
        benefit: "220 MW: enough for the bay, repair, quarters and a command floor.",
        cost: 2_600_000,
        upkeepPerDay: 1_200,
        effects: {},
        moduleSlots: 1,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 1,
          deliveries: 2,
          note: "One core, a lot of shielding, and a very loud room.",
        },
      },
      {
        tier: 2,
        displayName: "Twin loop",
        constructionTicks: 25_200,
        crewRequired: 3,
        powerDrawMw: 0,
        powerOutputMw: 480,
        crewProvided: 0,
        staffSlots: 10,
        fixtures: 5,
        benefit: "480 MW, which is what a laboratory and a fabrication hall together need.",
        cost: 5_800_000,
        upkeepPerDay: 2_400,
        effects: { constructionRate: 1.08 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "flood",
          signage: "lit",
          cranes: 2,
          deliveries: 1,
          note: "Two cores and a control room that can see both.",
        },
      },
      {
        tier: 3,
        displayName: "Twin loop with surge bank",
        constructionTicks: 43_200,
        crewRequired: 3,
        powerDrawMw: 0,
        powerOutputMw: 900,
        crewProvided: 0,
        staffSlots: 14,
        fixtures: 8,
        benefit: "900 MW and surge capacity: every facility at full tier with headroom to launch.",
        cost: 11_000_000,
        upkeepPerDay: 4_200,
        effects: { constructionRate: 1.15, repairRate: 1.05 },
        moduleSlots: 3,
        requires: [{ facilityId: "manufacture", tier: 2 }],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 2,
          deliveries: 0,
          note: "Three cores, and the complex stops worrying about power.",
        },
      },
    ],
    description: "The reason anything else runs. Sunk below the waterline and behind blast doors.",
  },
  {
    id: "logistics",
    displayName: "Logistics and Stores",
    deck: 1,
    widthMeters: 48,
    depthMeters: 38,
    heightMeters: 12,
    floorColour: [0.18, 0.19, 0.19],
    accentColour: [0.75, 0.78, 0.4],
    ambience: "forklift traffic and pallet handling",
    stations: [
      { kind: "terminal", label: "Stores terminal", count: 1 },
      { kind: "staff-post", label: "Loading post", count: 3 },
    ],
    startsBuilt: true,
    tiers: [
      {
        tier: 1,
        displayName: "Working stores",
        constructionTicks: 5_400,
        crewRequired: 1,
        powerDrawMw: 15,
        powerOutputMw: 0,
        crewProvided: 1,
        staffSlots: 8,
        fixtures: 4,
        benefit: "One extra construction crew and somewhere to put what arrives.",
        cost: 1_100_000,
        upkeepPerDay: 1_400,
        effects: { deliverySpeed: 1.15 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 1,
          deliveries: 4,
          note: "Racking, a forklift, and more pallets than floor.",
        },
      },
      {
        tier: 2,
        displayName: "Deep stores and crew hall",
        constructionTicks: 14_400,
        crewRequired: 2,
        powerDrawMw: 26,
        powerOutputMw: 0,
        crewProvided: 2,
        staffSlots: 14,
        fixtures: 8,
        benefit: "Two more crews again, so three orders can run at once instead of one.",
        cost: 3_100_000,
        upkeepPerDay: 2_900,
        effects: { deliverySpeed: 1.35, constructionRate: 1.12 },
        moduleSlots: 3,
        requires: [],
        stage: {
          lighting: "flood",
          signage: "lit",
          cranes: 2,
          deliveries: 2,
          note: "A loading floor that can take a whole delivery at once.",
        },
      },
    ],
    description: "Where everything the complex consumes is kept, and where crews are mustered.",
  },
  {
    id: "training",
    displayName: "Drift Training",
    deck: 3,
    widthMeters: 32,
    depthMeters: 28,
    heightMeters: 11,
    floorColour: [0.17, 0.17, 0.21],
    accentColour: [0.6, 0.55, 0.95],
    ambience: "mat impacts and instructor calls",
    stations: [
      { kind: "terminal", label: "Training board", count: 1 },
      { kind: "staff-post", label: "Instructor post", count: 2 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Kwoon and simulator",
        constructionTicks: 7_200,
        crewRequired: 1,
        powerDrawMw: 20,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 6,
        fixtures: 3,
        benefit: "A mat and a simulator rig, so candidates can be assessed before a real Drift.",
        cost: 1_000_000,
        upkeepPerDay: 1_300,
        effects: { trainingRate: 1.25 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 0,
          deliveries: 2,
          note: "Two drift rigs and a mat that has seen better days.",
        },
      },
      {
        tier: 2,
        displayName: "Full Drift rig",
        constructionTicks: 18_000,
        crewRequired: 2,
        powerDrawMw: 32,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 11,
        fixtures: 6,
        benefit: "A full neural rig: compatibility is measured rather than guessed at.",
        cost: 2_900_000,
        upkeepPerDay: 2_700,
        effects: { trainingRate: 1.6, medicalRate: 1.1 },
        moduleSlots: 3,
        requires: [{ facilityId: "medical", tier: 1 }],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 0,
          deliveries: 1,
          note: "A simulator floor with instrumented rigs and somebody watching.",
        },
      },
    ],
    description: "Where pilots are made compatible with each other, then with a machine.",
  },
  {
    id: "quarters",
    displayName: "Crew Quarters",
    deck: 3,
    widthMeters: 40,
    depthMeters: 30,
    heightMeters: 8,
    floorColour: [0.2, 0.18, 0.17],
    accentColour: [0.9, 0.62, 0.42],
    ambience: "ventilation and distant conversation",
    stations: [
      { kind: "terminal", label: "Roster board", count: 1 },
      { kind: "staff-post", label: "Mess table", count: 3 },
    ],
    startsBuilt: true,
    tiers: [
      {
        tier: 1,
        displayName: "Bunk rows",
        constructionTicks: 3_600,
        crewRequired: 1,
        powerDrawMw: 12,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 9,
        fixtures: 6,
        benefit: "Somewhere for the staff to sleep, which is why any of them are on shift at all.",
        cost: 800_000,
        upkeepPerDay: 1_100,
        effects: { medicalRate: 1.1 },
        moduleSlots: 1,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 0,
          deliveries: 2,
          note: "Bunks, lockers, and a kettle somebody brought in.",
        },
      },
      {
        tier: 2,
        displayName: "Quarters and mess",
        constructionTicks: 10_800,
        crewRequired: 1,
        powerDrawMw: 19,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 16,
        fixtures: 10,
        benefit: "A proper mess and more bunks: the complex can carry a larger standing crew.",
        cost: 2_200_000,
        upkeepPerDay: 2_300,
        effects: { medicalRate: 1.25, trainingRate: 1.1 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 0,
          deliveries: 1,
          note: "Real rooms, a mess that serves properly, and people sleeping.",
        },
      },
    ],
    description: "Bunks, mess and the only room in the complex that is ever quiet.",
  },
  {
    id: "defense",
    displayName: "Defense Control",
    deck: 1,
    widthMeters: 28,
    depthMeters: 22,
    heightMeters: 8,
    floorColour: [0.16, 0.16, 0.18],
    accentColour: [0.95, 0.35, 0.35],
    ambience: "target repeaters and battery status tones",
    stations: [
      { kind: "terminal", label: "Battery control", count: 1 },
      { kind: "staff-post", label: "Fire control post", count: 2 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Perimeter control",
        constructionTicks: 6_300,
        crewRequired: 1,
        powerDrawMw: 35,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 5,
        fixtures: 4,
        benefit: "The city defence positions report here instead of running independently.",
        cost: 1_600_000,
        upkeepPerDay: 2_000,
        effects: { defenceStrength: 1.2 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 1,
          deliveries: 3,
          note: "Two batteries, a radar mast, and cabling still on the deck.",
        },
      },
      {
        tier: 2,
        displayName: "Integrated fire control",
        constructionTicks: 16_200,
        crewRequired: 2,
        powerDrawMw: 56,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 9,
        fixtures: 7,
        benefit: "Batteries, sea wall and checkpoints are directed from one board.",
        cost: 4_100_000,
        upkeepPerDay: 4_000,
        effects: { defenceStrength: 1.5 },
        moduleSlots: 3,
        requires: [{ facilityId: "command", tier: 2 }],
        stage: {
          lighting: "flood",
          signage: "lit",
          cranes: 2,
          deliveries: 1,
          note: "A ring of batteries with their own fire control.",
        },
      },
    ],
    description: "Where the city's own defences are watched, whether or not a Jaeger is out.",
  },
  {
    id: "archive",
    displayName: "Memorial Archive",
    deck: 3,
    widthMeters: 24,
    depthMeters: 20,
    heightMeters: 7,
    floorColour: [0.18, 0.17, 0.16],
    accentColour: [0.85, 0.8, 0.65],
    ambience: "quiet, with the ventilation audible",
    stations: [
      { kind: "terminal", label: "Archive terminal", count: 1 },
      { kind: "staff-post", label: "Archivist desk", count: 1 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Record room",
        constructionTicks: 3_600,
        crewRequired: 1,
        powerDrawMw: 8,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 2,
        fixtures: 5,
        benefit: "Machines and crews that were lost are recorded rather than forgotten.",
        cost: 700_000,
        upkeepPerDay: 800,
        effects: { researchYield: 1.1, trainingRate: 1.05 },
        moduleSlots: 1,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 0,
          deliveries: 2,
          note: "Shelves, boxes, and the record of everything lost so far.",
        },
      },
    ],
    description: "The wall of names, and the paperwork behind it.",
  },
  {
    id: "contract",
    displayName: "Contracts Office",
    deck: 2,
    widthMeters: 26,
    depthMeters: 20,
    heightMeters: 7,
    floorColour: [0.17, 0.18, 0.2],
    accentColour: [0.55, 0.75, 0.9],
    ambience: "printers and one very persistent telephone",
    stations: [
      { kind: "terminal", label: "Contracts terminal", count: 1 },
      { kind: "staff-post", label: "Liaison desk", count: 2 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Liaison office",
        constructionTicks: 4_500,
        crewRequired: 1,
        powerDrawMw: 6,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 3,
        fixtures: 4,
        benefit: "Somewhere for manufacturers and governments to be dealt with in person.",
        cost: 900_000,
        upkeepPerDay: 1_000,
        effects: { contractYield: 1.15 },
        moduleSlots: 1,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 0,
          deliveries: 2,
          note: "Desks, a printer, and one very persistent telephone.",
        },
      },
      {
        tier: 2,
        displayName: "Procurement floor",
        constructionTicks: 12_600,
        crewRequired: 1,
        powerDrawMw: 11,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 6,
        fixtures: 7,
        benefit: "Several negotiations at once, which is what a rotating market needs.",
        cost: 2_600_000,
        upkeepPerDay: 2_400,
        effects: { contractYield: 1.4, deliverySpeed: 1.1 },
        moduleSlots: 2,
        requires: [{ facilityId: "command", tier: 2 }],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 0,
          deliveries: 1,
          note: "A procurement floor running several negotiations at once.",
        },
      },
    ],
    description:
      "Where the money and the machines are argued about. Its terminal is the contracts board: " +
      "what the yards are offering, what it costs to buy and to keep, and what is already on order.",
  },
  {
    id: "launch",
    displayName: "Launch Infrastructure",
    deck: 0,
    widthMeters: 60,
    depthMeters: 50,
    heightMeters: 90,
    floorColour: [0.17, 0.19, 0.21],
    accentColour: [0.35, 0.8, 0.75],
    ambience: "wind through the apron doors",
    stations: [
      { kind: "terminal", label: "Launch control", count: 1 },
      { kind: "staff-post", label: "Marshalling post", count: 2 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Apron and gantry",
        constructionTicks: 12_600,
        crewRequired: 2,
        powerDrawMw: 40,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 7,
        fixtures: 3,
        benefit: "A marshalling apron and the deployment corridor out through the waterfront.",
        cost: 2_300_000,
        upkeepPerDay: 2_600,
        effects: { deliverySpeed: 1.05 },
        moduleSlots: 1,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 1,
          deliveries: 3,
          note: "An apron, a gantry, and wind coming through the doors.",
        },
      },
      {
        tier: 2,
        displayName: "Carrier hardstand",
        constructionTicks: 27_000,
        crewRequired: 3,
        powerDrawMw: 68,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 13,
        fixtures: 6,
        benefit: "Hardstand for carrier lift, which is what long-range deployment will need.",
        cost: 5_600_000,
        upkeepPerDay: 5_000,
        effects: { deliverySpeed: 1.2, contractYield: 1.08 },
        moduleSlots: 2,
        requires: [{ facilityId: "jaeger-bay", tier: 2 }],
        stage: {
          lighting: "flood",
          signage: "lit",
          cranes: 3,
          deliveries: 1,
          note: "A launch floor that can turn a machine round without waiting.",
        },
      },
    ],
    description: "The way out. Opens onto the apron the city layout routes deployment along.",
  },
  {
    id: "medical",
    displayName: "Medical Bay",
    deck: 3,
    widthMeters: 24,
    depthMeters: 18,
    heightMeters: 6,
    floorColour: [0.2, 0.22, 0.23],
    accentColour: [0.75, 0.85, 0.9],
    ambience: "monitors and a centrifuge nobody turns off",
    stations: [
      { kind: "terminal", label: "Medical terminal", count: 1 },
      { kind: "staff-post", label: "Treatment bay", count: 3 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Infirmary",
        constructionTicks: 4_200,
        crewRequired: 1,
        powerDrawMw: 7,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 4,
        fixtures: 4,
        benefit: "Somewhere for a hurt pilot to be treated rather than told to rest.",
        cost: 1_000_000,
        upkeepPerDay: 1_500,
        effects: { medicalRate: 1.4 },
        moduleSlots: 2,
        requires: [],
        stage: {
          lighting: "work",
          signage: "stencil",
          cranes: 0,
          deliveries: 2,
          note: "Four beds, a drug cabinet, and a machine that beeps.",
        },
      },
      {
        tier: 2,
        displayName: "Trauma centre",
        constructionTicks: 11_800,
        crewRequired: 1,
        powerDrawMw: 13,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 8,
        fixtures: 7,
        benefit: "Serious injuries treated here instead of somewhere else, and sooner.",
        cost: 3_000_000,
        upkeepPerDay: 3_100,
        effects: { medicalRate: 1.9, trainingRate: 1.05 },
        moduleSlots: 3,
        requires: [{ facilityId: "quarters", tier: 2 }],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 0,
          deliveries: 1,
          note: "Two theatres behind sealed doors and a ward that is never empty.",
        },
      },
    ],
    description:
      "Where the crews go when the harness wins. Treatment shortens a recovery and never removes it.",
  },
  {
    id: "kaiju-containment",
    displayName: "Kaiju Containment",
    deck: -1,
    widthMeters: 30,
    depthMeters: 26,
    heightMeters: 14,
    floorColour: [0.13, 0.15, 0.14],
    accentColour: [0.55, 0.85, 0.5],
    ambience: "pumps, and something very large breathing",
    stations: [
      { kind: "terminal", label: "Containment terminal", count: 1 },
      { kind: "staff-post", label: "Observation post", count: 2 },
    ],
    startsBuilt: false,
    tiers: [
      {
        tier: 1,
        displayName: "Holding cells",
        constructionTicks: 9_600,
        crewRequired: 2,
        powerDrawMw: 22,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 4,
        fixtures: 5,
        benefit: "Specimens kept alive long enough to be worth studying.",
        cost: 2_800_000,
        upkeepPerDay: 3_400,
        effects: { containmentYield: 1.5, researchYield: 1.15 },
        moduleSlots: 2,
        requires: [
          { facilityId: "research", tier: 1 },
          { facilityId: "reactor", tier: 2 },
        ],
        stage: {
          lighting: "flood",
          signage: "stencil",
          cranes: 1,
          deliveries: 2,
          note: "Three cells, a lot of glass, and pumps running day and night.",
        },
      },
      {
        tier: 2,
        displayName: "Deep containment",
        constructionTicks: 21_000,
        crewRequired: 2,
        powerDrawMw: 40,
        powerOutputMw: 0,
        crewProvided: 0,
        staffSlots: 7,
        fixtures: 8,
        benefit: "A whole creature held below the waterline, and everything that comes of that.",
        cost: 7_400_000,
        upkeepPerDay: 7_800,
        effects: { containmentYield: 2.1, researchYield: 1.35 },
        moduleSlots: 3,
        requires: [{ facilityId: "research", tier: 2 }],
        stage: {
          lighting: "full",
          signage: "lit",
          cranes: 2,
          deliveries: 1,
          note: "One tank the size of the room, and nobody stands near the glass.",
        },
      },
    ],
    description:
      "Below the waterline, where the things that come through are kept while they are still useful.",
  },
];

/**
 * How the rooms are joined.
 *
 * Doors link rooms on one deck, lifts link decks, and one tram runs the length
 * of the complex from the bay to the accommodation wing so a walk from the
 * quarters to a machine is a journey rather than eight doors. Every kind is a
 * real edge with a real travel time; none of them is a menu.
 */
export const FACILITY_CONNECTIONS: readonly ConnectionSpec[] = [
  { from: "jaeger-bay", to: "repair", kind: "door" },
  { from: "jaeger-bay", to: "launch", kind: "door" },
  { from: "jaeger-bay", to: "manufacture", kind: "lift" },
  { from: "repair", to: "reactor", kind: "lift" },
  { from: "manufacture", to: "logistics", kind: "door" },
  { from: "logistics", to: "defense", kind: "door" },
  { from: "logistics", to: "command", kind: "lift" },
  { from: "command", to: "research", kind: "door" },
  { from: "command", to: "contract", kind: "door" },
  { from: "command", to: "quarters", kind: "lift" },
  { from: "quarters", to: "training", kind: "door" },
  { from: "quarters", to: "archive", kind: "door" },
  { from: "jaeger-bay", to: "quarters", kind: "tram" },
  { from: "quarters", to: "medical", kind: "door" },
  { from: "research", to: "kaiju-containment", kind: "lift" },
];

export function validateFacility(entry: FacilityDefinition): string[] {
  const errors: string[] = [];
  if (!FACILITY_KINDS.includes(entry.id)) {
    errors.push(`id must be one of: ${FACILITY_KINDS.join(", ")}`);
  }
  if (!entry.displayName) errors.push("displayName required");
  if (!Number.isInteger(entry.deck)) errors.push("deck must be an integer");
  for (const key of ["widthMeters", "depthMeters", "heightMeters"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be a positive number`);
  }
  // A room a person cannot stand up in is a modelling mistake, not a design.
  if (entry.heightMeters < 3) errors.push("heightMeters must leave headroom for a person");
  for (const [label, colour] of [
    ["floorColour", entry.floorColour],
    ["accentColour", entry.accentColour],
  ] as const) {
    if (colour.length !== 3 || colour.some((c) => !Number.isFinite(c) || c < 0 || c > 1)) {
      errors.push(`${label} must be three channels within 0 to 1`);
    }
  }
  if (entry.stations.length === 0) errors.push("a facility with no stations cannot be interacted with");
  for (const station of entry.stations) {
    if (!STATION_KINDS.includes(station.kind)) errors.push(`unknown station kind "${station.kind}"`);
    if (!Number.isInteger(station.count) || station.count < 1) {
      errors.push(`station "${station.label}" count must be a positive integer`);
    }
  }
  if (!entry.stations.some((station) => station.kind === "terminal")) {
    // Without a terminal the facility could be upgraded only from a menu, which
    // is the failure mode this milestone exists to avoid.
    errors.push("every facility needs a terminal so its management interface is reachable in world");
  }
  if (entry.tiers.length === 0) errors.push("at least one tier required");

  let previous: FacilityTier | undefined;
  entry.tiers.forEach((tier, index) => {
    if (tier.tier !== index + 1) errors.push(`tiers must be numbered 1..n in order, found ${tier.tier}`);
    if (!tier.displayName) errors.push(`tier ${tier.tier} needs a displayName`);
    if (!tier.benefit) errors.push(`tier ${tier.tier} needs a benefit sentence`);
    for (const key of [
      "constructionTicks",
      "crewRequired",
      "powerDrawMw",
      "powerOutputMw",
      "crewProvided",
      "staffSlots",
      "fixtures",
    ] as const) {
      const value = tier[key];
      if (!Number.isFinite(value) || value < 0) errors.push(`tier ${tier.tier} ${key} must be >= 0`);
    }
    if (tier.constructionTicks <= 0) errors.push(`tier ${tier.tier} must take real time to build`);
    if (tier.crewRequired < 1) errors.push(`tier ${tier.tier} must occupy at least one crew`);
    if (previous) {
      // An upgrade that shows nothing new is not an upgrade. Fixtures are the
      // visible half of the promise that facilities change appearance.
      if (tier.fixtures <= previous.fixtures) {
        errors.push(`tier ${tier.tier} must add fixtures over tier ${previous.tier} to be visible`);
      }
      if (tier.constructionTicks <= previous.constructionTicks) {
        errors.push(`tier ${tier.tier} must cost more time than tier ${previous.tier}`);
      }
    }
    previous = tier;
  });

  if (entry.id !== "reactor" && entry.tiers.some((tier) => tier.powerOutputMw > 0)) {
    errors.push("only the reactor may produce power, so the balance is one sum rather than a search");
  }
  return errors;
}

export function createFacilityRegistry(): ContentRegistry<FacilityDefinition> {
  const registry = new ContentRegistry<FacilityDefinition>(validateFacility);
  for (const definition of DEFINITIONS) registry.register(definition);
  return registry;
}

export const FACILITY_DEFINITIONS = DEFINITIONS;

/** Validates the shipped connection graph: real endpoints, no duplicates, no orphans. */
export function validateConnections(
  connections: readonly ConnectionSpec[],
  known: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const touched = new Set<string>();
  for (const connection of connections) {
    if (!known.has(connection.from)) errors.push(`connection from unknown facility "${connection.from}"`);
    if (!known.has(connection.to)) errors.push(`connection to unknown facility "${connection.to}"`);
    if (connection.from === connection.to) errors.push(`facility "${connection.from}" connects to itself`);
    if (!CONNECTION_KINDS.includes(connection.kind)) errors.push(`unknown connection kind`);
    const key = [connection.from, connection.to].sort().join("<->");
    if (seen.has(key)) errors.push(`duplicate connection ${key}`);
    seen.add(key);
    touched.add(connection.from);
    touched.add(connection.to);
  }
  for (const id of known) {
    if (!touched.has(id)) errors.push(`facility "${id}" is not reachable from anywhere`);
  }
  return errors;
}
