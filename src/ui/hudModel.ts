import { ICON_TOKENS, SEVERITY_TOKENS, type Severity } from "./hudTokens";

/**
 * What the interface should say, worked out from what is actually happening.
 *
 * Pure. Authoritative state goes in, a ranked list of things worth showing comes
 * out. Nothing here touches the DOM or Babylon, so the decision about what
 * matters can be tested directly rather than by looking at a screen.
 *
 * The rule that shapes it: **nothing critical is ever hidden for the sake of a
 * clean picture.** The HUD is minimal because most of the time there is little
 * worth saying, not because anything is being withheld. When a reactor is
 * failing or a leg is gone, that is on screen at the top, whatever else is.
 *
 * The second rule: **an instrument moves because a system moved.** Every value
 * here is read from authoritative state. There is no idle animation and nothing
 * that ticks on its own, which is why a cockpit that looks alive is a cockpit
 * that is telling you something.
 */

/** One thing worth saying. */
export interface HudAlert {
  readonly id: string;
  readonly severity: Severity;
  /** Short enough to read while something is trying to kill you. */
  readonly label: string;
  /** What to do about it, when there is something to do. */
  readonly detail: string;
  /** Icon token name, so the glyph is the same everywhere it appears. */
  readonly icon: string;
}

/** One component, as the condition strip shows it. */
export interface HudComponent {
  readonly id: string;
  readonly name: string;
  /** 0 to 1. */
  readonly fraction: number;
  readonly severity: Severity;
  /** True when the component has stopped working entirely. */
  readonly offline: boolean;
}

/** One zone on the thing being fought. */
export interface HudTargetZone {
  readonly id: string;
  readonly fraction: number;
  readonly severity: Severity;
  /** True when the player is currently aiming here. */
  readonly aimed: boolean;
}

/** One weapon, as the ammunition strip shows it. */
export interface HudWeapon {
  readonly id: string;
  readonly name: string;
  /** Words rather than a bare number, because feeds differ. */
  readonly readout: string;
  readonly severity: Severity;
  readonly ready: boolean;
}

/** One instrument in the cockpit. */
export interface HudInstrument {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly severity: Severity;
  readonly icon: string;
  /**
   * The reading as a fraction, where that makes sense, for a dial or a bar.
   * Null for anything that is not a proportion, such as a heading.
   */
  readonly fraction: number | null;
}

export interface HudModel {
  /** Everything worth saying, most urgent first. */
  readonly alerts: readonly HudAlert[];
  /** The single most urgent thing, or null when nothing is wrong. */
  readonly topAlert: HudAlert | null;
  readonly components: readonly HudComponent[];
  readonly targetZones: readonly HudTargetZone[];
  readonly weapons: readonly HudWeapon[];
  readonly instruments: readonly HudInstrument[];
  /** Reactor load, 0 to 1, and what that means. */
  readonly reactor: { readonly fraction: number; readonly severity: Severity };
  readonly heat: { readonly fraction: number; readonly severity: Severity };
  /** What the squad was last told to do. Null when nobody came. */
  readonly squadOrder: string | null;
  /** The objective, in one line. */
  readonly objective: string;
  /** How the city is doing, in one line. */
  readonly citySafety: { readonly text: string; readonly severity: Severity };
  /** Ability state, in one line each. */
  readonly abilities: readonly string[];
  /**
   * Whether the display should be showing anything at all beyond the critical.
   *
   * False during a quiet moment, which is what makes the HUD minimal without
   * hiding anything: it is empty because nothing is happening.
   */
  readonly busy: boolean;
}

/** Everything the model reads. All of it authoritative, none of it invented. */
export interface HudInput {
  readonly machine: {
    readonly integrity: number;
    readonly components: readonly {
      readonly id: string;
      readonly name: string;
      readonly fraction: number;
      readonly offline: boolean;
    }[];
    readonly stamina: number;
    readonly staminaMax: number;
    readonly heat: number;
    readonly overheated: boolean;
    readonly reactorLoad: number;
    readonly driftStability: number;
  };
  readonly target: {
    readonly name: string;
    readonly distanceMeters: number;
    readonly lockedOn: boolean;
    readonly aimZoneId: string | null;
    readonly zones: readonly { readonly id: string; readonly health: number; readonly maxHealth: number }[];
  } | null;
  readonly weapons: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly magazine: number;
    readonly magazineSize: number;
    readonly feed: "rounds" | "heat" | "reactor";
    readonly reserve: number;
    readonly ready: boolean;
    readonly reloading: boolean;
  }[];
  readonly navigation: {
    readonly headingDeg: number;
    readonly speedMps: number;
    readonly depthMeters: number;
    readonly submerged: boolean;
  };
  readonly conditions: {
    readonly weather: string;
    /** 0 to 1 of ordinary sight. Below one is rain, fog or spray. */
    readonly visibility: number;
  };
  readonly squadOrder: string | null;
  readonly objective: string;
  /** 0 to 1. One is untouched. */
  readonly citySafety: number;
  readonly abilities: readonly { readonly name: string; readonly state: string }[];
  /** The last radio line, or null when nothing has been said. */
  readonly radio: string | null;
}

/** Fractions below these read as the matching severity. */
export const COMPONENT_CRITICAL = 0.2;
export const COMPONENT_WARNING = 0.45;
export const COMPONENT_CAUTION = 0.75;

/** A value that falls is worse the lower it goes. */
export function fallingSeverity(fraction: number): Severity {
  if (fraction <= 0) return "critical";
  if (fraction < COMPONENT_CRITICAL) return "critical";
  if (fraction < COMPONENT_WARNING) return "warning";
  if (fraction < COMPONENT_CAUTION) return "caution";
  return "nominal";
}

/** A value that rises is worse the higher it goes. Heat and reactor load. */
export function risingSeverity(fraction: number): Severity {
  if (fraction >= 1) return "critical";
  if (fraction > 0.85) return "warning";
  if (fraction > 0.6) return "caution";
  return "nominal";
}

/**
 * Works out what the interface should be saying.
 *
 * Alerts are sorted by severity and then by how bad the reading is, so the
 * worst thing is always first and two equally severe things are ordered by
 * which is closer to killing you.
 */
export function buildHud(input: HudInput): HudModel {
  const alerts: HudAlert[] = [];

  // --- the machine ---------------------------------------------------------
  const components: HudComponent[] = input.machine.components.map((component) => ({
    id: component.id,
    name: component.name,
    fraction: clamp01(component.fraction),
    severity: component.offline ? "critical" : fallingSeverity(component.fraction),
    offline: component.offline,
  }));

  for (const component of components) {
    if (component.offline) {
      alerts.push({
        id: `component.${component.id}`,
        severity: "critical",
        label: `${component.name} offline`,
        detail: "That system has stopped. Get out of contact or fight without it.",
        icon: "fault",
      });
    } else if (component.severity === "critical" || component.severity === "warning") {
      alerts.push({
        id: `component.${component.id}`,
        severity: component.severity,
        label: `${component.name} ${Math.round(component.fraction * 100)}%`,
        detail: "Another solid hit here takes it out.",
        icon: "structure",
      });
    }
  }

  const integritySeverity = fallingSeverity(input.machine.integrity);
  if (integritySeverity === "critical" || integritySeverity === "warning") {
    alerts.push({
      id: "machine.integrity",
      severity: integritySeverity,
      label: `Hull ${Math.round(input.machine.integrity * 100)}%`,
      detail: "The machine is coming apart.",
      icon: "structure",
    });
  }

  // --- heat and the reactor ------------------------------------------------
  const heatFraction = clamp01(input.machine.heat / 100);
  const heatSeverity = input.machine.overheated ? "critical" : risingSeverity(heatFraction);
  if (input.machine.overheated) {
    alerts.push({
      id: "machine.overheat",
      severity: "critical",
      label: "Overheated",
      detail: "Weapons are locked out until it comes down.",
      icon: "heat",
    });
  } else if (heatSeverity === "warning") {
    alerts.push({
      id: "machine.heat",
      severity: "warning",
      label: `Heat ${Math.round(heatFraction * 100)}%`,
      detail: "One more sustained burst and it locks out.",
      icon: "heat",
    });
  }

  const reactorFraction = clamp01(input.machine.reactorLoad);
  const reactorSeverity = risingSeverity(reactorFraction);
  if (reactorSeverity === "critical" || reactorSeverity === "warning") {
    alerts.push({
      id: "machine.reactor",
      severity: reactorSeverity,
      label: `Reactor ${Math.round(reactorFraction * 100)}%`,
      detail: "Drawing more than it can make. Something will brown out.",
      icon: "reactor",
    });
  }

  // --- the crew ------------------------------------------------------------
  const driftSeverity = fallingSeverity(input.machine.driftStability);
  if (driftSeverity === "critical" || driftSeverity === "warning") {
    alerts.push({
      id: "crew.drift",
      severity: driftSeverity,
      label: `Drift ${Math.round(input.machine.driftStability * 100)}%`,
      detail: "The link is slipping. Disengage before it goes.",
      icon: "drift",
    });
  }

  // --- ammunition ----------------------------------------------------------
  const weapons: HudWeapon[] = input.weapons.map((weapon) => {
    const readout =
      weapon.feed === "rounds"
        ? `${weapon.magazine}/${weapon.magazineSize} (${weapon.reserve})`
        : weapon.feed === "heat"
          ? "heat fed"
          : "reactor fed";
    const fraction = weapon.magazineSize > 0 ? weapon.magazine / weapon.magazineSize : 1;
    const severity: Severity =
      weapon.feed !== "rounds"
        ? "info"
        : weapon.magazine === 0 && weapon.reserve === 0
          ? "critical"
          : fallingSeverity(fraction);
    return {
      id: weapon.id,
      name: weapon.displayName,
      readout: weapon.reloading ? "reloading" : readout,
      severity,
      ready: weapon.ready,
    };
  });

  for (const weapon of weapons) {
    if (weapon.severity !== "critical") continue;
    alerts.push({
      id: `weapon.${weapon.id}`,
      severity: "critical",
      label: `${weapon.name} dry`,
      detail: "Nothing left to feed it.",
      icon: "ammunition",
    });
  }

  // --- the city ------------------------------------------------------------
  const safety = clamp01(input.citySafety);
  const safetySeverity = fallingSeverity(safety);
  if (safetySeverity === "critical" || safetySeverity === "warning") {
    alerts.push({
      id: "city.safety",
      severity: safetySeverity,
      label: `City ${Math.round(safety * 100)}%`,
      detail: "The fight is going through the city rather than past it.",
      icon: "civilians",
    });
  }

  // --- the target ----------------------------------------------------------
  const targetZones: HudTargetZone[] = (input.target?.zones ?? []).map((zone) => {
    const fraction = zone.maxHealth > 0 ? clamp01(zone.health / zone.maxHealth) : 0;
    return {
      id: zone.id,
      fraction,
      severity: fallingSeverity(fraction),
      aimed: input.target?.aimZoneId === zone.id,
    };
  });

  // --- instruments ---------------------------------------------------------
  // Every one of these reads a system. None of them moves on its own.
  const instruments: HudInstrument[] = [
    {
      id: "heading",
      label: "Heading",
      value: `${Math.round(((input.navigation.headingDeg % 360) + 360) % 360)}°`,
      severity: "info",
      icon: "heading",
      fraction: null,
    },
    {
      id: "speed",
      label: "Speed",
      value: `${input.navigation.speedMps.toFixed(1)} m/s`,
      severity: "info",
      icon: "speed",
      fraction: null,
    },
    {
      id: "depth",
      label: input.navigation.submerged ? "Depth" : "Altitude",
      value: `${Math.round(input.navigation.depthMeters)} m`,
      severity: input.navigation.submerged ? "caution" : "info",
      icon: "depth",
      fraction: null,
    },
    {
      id: "reactor",
      label: "Reactor",
      value: `${Math.round(reactorFraction * 100)}%`,
      severity: reactorSeverity,
      icon: "reactor",
      fraction: reactorFraction,
    },
    {
      id: "heat",
      label: "Heat",
      value: input.machine.overheated ? "locked out" : `${Math.round(heatFraction * 100)}%`,
      severity: heatSeverity,
      icon: "heat",
      fraction: heatFraction,
    },
    {
      id: "drift",
      label: "Drift",
      value: `${Math.round(clamp01(input.machine.driftStability) * 100)}%`,
      severity: driftSeverity,
      icon: "drift",
      fraction: clamp01(input.machine.driftStability),
    },
    {
      id: "faults",
      label: "Faults",
      value:
        components.filter((component) => component.offline).length > 0
          ? components
              .filter((component) => component.offline)
              .map((component) => component.name)
              .join(", ")
          : "none",
      severity: components.some((component) => component.offline) ? "critical" : "nominal",
      icon: "fault",
      fraction: null,
    },
    {
      id: "targeting",
      label: "Targeting",
      value: input.target
        ? input.target.lockedOn
          ? `locked, ${Math.round(input.target.distanceMeters)} m`
          : `${input.target.name}, ${Math.round(input.target.distanceMeters)} m`
        : "no contact",
      severity: input.target?.lockedOn ? "nominal" : input.target ? "caution" : "info",
      icon: "target",
      fraction: null,
    },
    {
      id: "weather",
      label: "Weather",
      value: `${input.conditions.weather}, sight ${Math.round(clamp01(input.conditions.visibility) * 100)}%`,
      severity: input.conditions.visibility < 0.6 ? "caution" : "info",
      icon: "weather",
      fraction: clamp01(input.conditions.visibility),
    },
    {
      id: "radio",
      label: "Radio",
      value: input.radio ?? "quiet",
      severity: "info",
      icon: "radio",
      fraction: null,
    },
  ];

  // Weapon status belongs in the cockpit too, one line for the whole loadout.
  instruments.push({
    id: "weapons",
    label: "Weapons",
    value:
      weapons.length === 0
        ? "none fitted"
        : weapons.map((weapon) => `${weapon.name} ${weapon.readout}`).join(" · "),
    severity: weapons.some((weapon) => weapon.severity === "critical") ? "critical" : "info",
    icon: "ammunition",
    fraction: null,
  });

  alerts.sort((a, b) => {
    const rank = SEVERITY_TOKENS[a.severity].rank - SEVERITY_TOKENS[b.severity].rank;
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });

  return {
    alerts,
    topAlert: alerts[0] ?? null,
    components,
    targetZones,
    weapons,
    instruments,
    reactor: { fraction: reactorFraction, severity: reactorSeverity },
    heat: { fraction: heatFraction, severity: heatSeverity },
    squadOrder: input.squadOrder,
    objective: input.objective,
    citySafety: {
      text: `${Math.round(safety * 100)}% intact`,
      severity: safetySeverity,
    },
    abilities: input.abilities.map((ability) => `${ability.name}: ${ability.state}`),
    busy: alerts.length > 0 || input.target !== null,
  };
}

/** Every icon the model can ask for actually exists in the token table. */
export function iconFor(name: string): string {
  return ICON_TOKENS[name] ?? ICON_TOKENS["fault"]!;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
