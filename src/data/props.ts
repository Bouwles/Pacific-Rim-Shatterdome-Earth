import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Environmental weapons.
 *
 * The things lying around a fight that a machine can pick up and swing: a
 * gantry crane, a container ship, a bridge section, a fuel tanker. Each is a
 * tagged prop rather than a special case, so a move that says it needs a
 * `crane` works with any prop carrying that tag, and adding a new one is a row.
 *
 * A prop is not scenery with a damage number bolted on. It has a mass that
 * decides how slowly it swings, a durability that decides how many swings it
 * survives, and a footprint that decides whether there is room to use it at all.
 */

export const PROP_TAGS = ["crane", "ship", "bridge", "debris", "tanker"] as const;
export type PropTag = (typeof PROP_TAGS)[number];

export interface PropDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly tag: PropTag;
  readonly massTons: number;
  /** Metres of reach a machine gains while holding it. */
  readonly reachMeters: number;
  /** Multiplier on the damage of any move swung with it. */
  readonly damageScale: number;
  /** Extra ticks added to a move's startup, because the thing is enormous. */
  readonly startupPenaltyTicks: number;
  /** How many connecting swings it survives. Zero means it never breaks. */
  readonly swingsBeforeBreaking: number;
  /** Radius of clear ground a machine needs to swing it without fouling. */
  readonly clearanceMeters: number;
  /** Where it is found. Presentation uses this to pick a mesh; rules do not read it. */
  readonly sourceKind: string;
  readonly description: string;
}

const PROPS: readonly PropDefinition[] = [
  {
    id: "prop.gantry-crane",
    displayName: "Gantry crane",
    tag: "crane",
    massTons: 900,
    reachMeters: 42,
    damageScale: 1.9,
    startupPenaltyTicks: 8,
    swingsBeforeBreaking: 3,
    clearanceMeters: 55,
    sourceKind: "dockside",
    description: "Long, awkward and heavy enough to matter. Bends after a few connections.",
  },
  {
    id: "prop.container-ship",
    displayName: "Container ship",
    tag: "ship",
    massTons: 24_000,
    reachMeters: 70,
    damageScale: 3.4,
    startupPenaltyTicks: 22,
    swingsBeforeBreaking: 1,
    clearanceMeters: 110,
    sourceKind: "harbour",
    description: "One swing, and there is nothing left of it afterwards. Needs the room of a harbour.",
  },
  {
    id: "prop.bridge-section",
    displayName: "Bridge section",
    tag: "bridge",
    massTons: 4_200,
    reachMeters: 55,
    damageScale: 2.4,
    startupPenaltyTicks: 14,
    swingsBeforeBreaking: 2,
    clearanceMeters: 80,
    sourceKind: "span",
    description: "A length of roadway with the deck still on it. Unwieldy, and it hits like it looks.",
  },
  {
    id: "prop.fuel-tanker",
    displayName: "Fuel tanker",
    tag: "tanker",
    massTons: 600,
    reachMeters: 26,
    damageScale: 1.5,
    startupPenaltyTicks: 4,
    swingsBeforeBreaking: 1,
    clearanceMeters: 30,
    sourceKind: "street",
    description: "Light, quick, and it goes up on the first solid hit.",
  },
  {
    id: "prop.rubble-slab",
    displayName: "Rubble slab",
    tag: "debris",
    massTons: 180,
    reachMeters: 18,
    damageScale: 1.2,
    startupPenaltyTicks: 2,
    swingsBeforeBreaking: 2,
    clearanceMeters: 20,
    sourceKind: "street",
    description: "A slab of roadway. The one thing there is always some of.",
  },
];

export function validateProp(entry: PropDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("prop.")) errors.push('id must start with "prop."');
  if (!entry.displayName) errors.push("displayName required");
  if (!PROP_TAGS.includes(entry.tag)) errors.push(`unknown prop tag "${entry.tag}"`);
  for (const key of ["massTons", "reachMeters", "damageScale", "clearanceMeters"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] <= 0) errors.push(`${key} must be positive`);
  }
  for (const key of ["startupPenaltyTicks", "swingsBeforeBreaking"] as const) {
    if (!Number.isInteger(entry[key]) || entry[key] < 0) errors.push(`${key} must be a whole number`);
  }
  // A prop that swings as fast as a fist and hits harder would make every other
  // move pointless. Mass has to cost something.
  if (entry.damageScale > 1 && entry.startupPenaltyTicks < 1) {
    errors.push("a prop that adds damage must also add startup: mass has to cost time");
  }
  // Something the size of a ship needs the room of a harbour, or the rule that
  // refuses a swing in a tight street never fires.
  if (entry.reachMeters > entry.clearanceMeters) {
    errors.push("clearanceMeters must be at least the prop's own reach");
  }
  if (!entry.description) errors.push("description required");
  return errors;
}

export function createPropRegistry(): ContentRegistry<PropDefinition> {
  const registry = new ContentRegistry<PropDefinition>(validateProp);
  for (const prop of PROPS) registry.register(prop);
  return registry;
}

export const PROP_DEFINITIONS = PROPS;

/** A prop actually lying in the world, with what is left of it. */
export interface PropInstance {
  readonly instanceId: string;
  readonly propId: string;
  readonly east: number;
  readonly north: number;
  /** Swings left before it comes apart. Counts down from the definition. */
  swingsLeft: number;
  /** True once something has picked it up. */
  heldBy: string | null;
}

export function spawnProp(
  instanceId: string,
  prop: PropDefinition,
  east: number,
  north: number,
): PropInstance {
  return {
    instanceId,
    propId: prop.id,
    east,
    north,
    swingsLeft: prop.swingsBeforeBreaking,
    heldBy: null,
  };
}
