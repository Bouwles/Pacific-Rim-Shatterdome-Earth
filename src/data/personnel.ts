import { ContentRegistry, type RegistryEntry } from "./registry";
import { FACILITY_KINDS, type FacilityKind } from "./facilities";

/**
 * Named crew.
 *
 * These are original characters written for this project, not film characters.
 * Each one is posted to a facility, keeps a shift, and has a small set of lines
 * that report something true about the state of their own facility. That is the
 * whole extent of it: they are not a dialogue system and they do not claim to
 * be one.
 *
 * Everyone else in the complex is anonymous shift staff, generated from the
 * facility's staff slots and never given a record. A hundred people on shift
 * cost one number per facility.
 */

/** Eight-hour shifts. A day is one clock rotation, so these are thirds of it. */
export const SHIFTS = ["morning", "evening", "night"] as const;
export type Shift = (typeof SHIFTS)[number];

/** Fraction of the day each shift covers, start inclusive, end exclusive. */
export const SHIFT_WINDOWS: Readonly<Record<Shift, readonly [number, number]>> = {
  morning: [0.25, 0.583],
  evening: [0.583, 0.917],
  night: [0.917, 0.25],
};

export interface CrewMember extends RegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly facilityId: FacilityKind;
  readonly shift: Shift;
  /**
   * Lines this character can say. Placeholders in braces are filled from live
   * facility state, so a line cannot claim something the complex is not doing.
   * Supported: {facility} {tier} {status} {power} {crews} {staff} {time}.
   */
  readonly lines: readonly string[];
  readonly notes: string;
}

const CREW: readonly CrewMember[] = [
  {
    id: "crew.marshal",
    name: "Marshal Adaeze Okonjo",
    role: "Marshal",
    facilityId: "command",
    shift: "morning",
    lines: [
      "LOCCENT is {status}. {power} on the board and {crews} crews free.",
      "Everything in this complex reports through this room. Keep it that way.",
      "{staff} on shift. That is fewer than I would like and more than we can feed.",
    ],
    notes: "Runs the complex. Terse, unhurried, and never in the bay unless something is wrong.",
  },
  {
    id: "crew.loccent-officer",
    name: "Lieutenant Bo Ferrant",
    role: "LOCCENT officer",
    facilityId: "command",
    shift: "night",
    lines: [
      "Night watch. {facility} at tier {tier}, nothing moving out there.",
      "Radio is quiet. I will take quiet.",
    ],
    notes: "Holds the watch floor overnight. Most of the ambient radio traffic is his.",
  },
  {
    id: "crew.bay-chief",
    name: "Bay Chief Rosalind Vey",
    role: "Bay chief",
    facilityId: "jaeger-bay",
    shift: "morning",
    lines: [
      "Bay is {status} at tier {tier}. Watch the gantry line when you cross.",
      "You can board from the access gantry. Mind the drop, it is a long one.",
      "{staff} on the deck this shift. Cranes are yours if you need them.",
    ],
    notes: "Runs the bay floor. The one person who will tell a Marshal to move.",
  },
  {
    id: "crew.deck-hand",
    name: "Tomas Iriarte",
    role: "Deck crew",
    facilityId: "jaeger-bay",
    shift: "evening",
    lines: [
      "Evening shift on the deck. Berths are cold, machines are not going anywhere.",
      "If the alarm goes, get behind the yellow line and stay there.",
    ],
    notes: "Deck crew, evening shift. Cheerful in a way the bay does not deserve.",
  },
  {
    id: "crew.fitter",
    name: "Chief Fitter Nkemdi Baros",
    role: "Chief fitter",
    facilityId: "repair",
    shift: "morning",
    lines: [
      "Repair is {status}. Tier {tier}, {staff} hands, and a queue either way.",
      "Panels first, actuators second. Nothing goes out with a slow leg.",
    ],
    notes: "Runs the gantries. Believes every deadline is a suggestion.",
  },
  {
    id: "crew.reactor-watch",
    name: "Ivo Sandelin",
    role: "Reactor watch",
    facilityId: "reactor",
    shift: "night",
    lines: [
      "Reactor is {status}. {power} across the complex right now.",
      "Every light up there comes through this room. Do not touch anything.",
    ],
    notes: "Reactor watch officer. Has not been above deck 0 in a fortnight.",
  },
  {
    id: "crew.quartermaster",
    name: "Quartermaster Hana Belfour",
    role: "Quartermaster",
    facilityId: "logistics",
    shift: "morning",
    lines: [
      "Stores are {status}. {crews} construction crews free at the moment.",
      "Crews come from here. Build me more space and you get more of them.",
    ],
    notes: "Runs stores and musters the construction crews. Keeps a ledger nobody else can read.",
  },
  {
    id: "crew.researcher",
    name: "Dr Yusra Halim",
    role: "Lead researcher",
    facilityId: "research",
    shift: "evening",
    lines: [
      "Laboratory is {status}. Tier {tier}, which decides what we can keep alive in here.",
      "Bring me tissue and I will tell you what killed it and what it was going to do next.",
    ],
    notes: "Kaiju biology. Enthusiastic in a way most of the crew find alarming.",
  },
  {
    id: "crew.drift-instructor",
    name: "Instructor Kai Rennard",
    role: "Drift instructor",
    facilityId: "training",
    shift: "morning",
    lines: [
      "Training is {status}. Nobody drifts out of this room until the mat says they can.",
      "Compatibility is measured here, not guessed at in a Conn-Pod.",
    ],
    notes: "Runs the kwoon and the simulator rig. Retired pilot, does not discuss it.",
  },
  {
    id: "crew.defense-officer",
    name: "Captain Lior Damaskin",
    role: "Defense controller",
    facilityId: "defense",
    shift: "evening",
    lines: [
      "Defense control is {status}. The city batteries report through here.",
      "If a Jaeger is out, we hold the line behind it. If not, we are the line.",
    ],
    notes: "Directs the city's own defences. Was a coastal artillery officer before the war.",
  },
  {
    id: "crew.archivist",
    name: "Archivist Ondine Kesse",
    role: "Archivist",
    facilityId: "archive",
    shift: "morning",
    lines: [
      "The archive is {status}. Everything that was lost is written down in here.",
      "It is quiet. That is deliberate.",
    ],
    notes: "Keeps the memorial wall and the records behind it.",
  },
  {
    id: "crew.contracts",
    name: "Attaché Perrin Solvay",
    role: "Contracts attaché",
    facilityId: "contract",
    shift: "morning",
    lines: [
      "Contracts is {status}. Nothing is signed today, which is a kind of progress.",
      "Manufacturers rotate. Governments do not. Both of them want an answer.",
    ],
    notes: "Handles manufacturers and government liaison. There is no economy yet and he says so.",
  },
  {
    id: "crew.foreman",
    name: "Foreman Greta Aliyev",
    role: "Fabrication foreman",
    facilityId: "manufacture",
    shift: "evening",
    lines: [
      "Fabrication is {status} at tier {tier}. Plate goes up to repair on the lift.",
      "Everything the gantries put on a machine came off a press in this room.",
    ],
    notes: "Runs the fabrication hall. Speaks over the presses out of habit even when they stop.",
  },
  {
    id: "crew.launch-marshal",
    name: "Launch Marshal Efe Duran",
    role: "Launch marshal",
    facilityId: "launch",
    shift: "morning",
    lines: [
      "Launch is {status}. The corridor out through the waterfront is surveyed and clear.",
      "No deployment yet. When there is, it goes out through those doors.",
    ],
    notes:
      "Marshals the apron. Deployment itself belongs to a later milestone and he does not pretend otherwise.",
  },
  {
    id: "crew.quarters-steward",
    name: "Steward Malachy Prewitt",
    role: "Quarters steward",
    facilityId: "quarters",
    shift: "night",
    lines: [
      "Quarters are {status}. {staff} bunks made up, and the kettle is on.",
      "It is {time}. Half of this deck is asleep. Walk quietly.",
    ],
    notes: "Runs the quarters and the mess. Knows every name in the complex.",
  },
];

export function validateCrewMember(entry: CrewMember): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("crew.")) errors.push('id must start with "crew."');
  if (!entry.name) errors.push("name required");
  if (!entry.role) errors.push("role required");
  if (!FACILITY_KINDS.includes(entry.facilityId)) {
    errors.push(`facilityId must be a known facility, got "${entry.facilityId}"`);
  }
  if (!SHIFTS.includes(entry.shift)) errors.push(`shift must be one of: ${SHIFTS.join(", ")}`);
  if (entry.lines.length === 0) errors.push("a named character with no lines says nothing");
  for (const line of entry.lines) {
    const unknown = [...line.matchAll(/\{(\w+)\}/g)]
      .map((match) => match[1] ?? "")
      .filter((token) => !LINE_TOKENS.includes(token as LineToken));
    if (unknown.length > 0) errors.push(`line uses unknown placeholders: ${unknown.join(", ")}`);
  }
  return errors;
}

/** Placeholders a line may use. Anything else is a typo that would print raw. */
export const LINE_TOKENS = ["facility", "tier", "status", "power", "crews", "staff", "time"] as const;
export type LineToken = (typeof LINE_TOKENS)[number];

export function createCrewRegistry(): ContentRegistry<CrewMember> {
  const registry = new ContentRegistry<CrewMember>(validateCrewMember);
  for (const member of CREW) registry.register(member);
  return registry;
}

export const CREW_MEMBERS = CREW;

/** True when a shift covers a point in the day, handling the one window that wraps midnight. */
export function shiftCovers(shift: Shift, dayFraction: number): boolean {
  const [start, end] = SHIFT_WINDOWS[shift];
  return start <= end ? dayFraction >= start && dayFraction < end : dayFraction >= start || dayFraction < end;
}

export function shiftAt(dayFraction: number): Shift {
  return SHIFTS.find((shift) => shiftCovers(shift, dayFraction)) ?? "night";
}
