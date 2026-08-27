/**
 * The cheats.
 *
 * Everything here is an **overlay**, and that word is doing real work. A rule
 * set is a small object that travels with one sandbox run and is consulted where
 * a number is read. Nothing in this file writes to a registry, a definition, a
 * preset table or any other piece of shared state, which is why turning damage
 * off in the sandbox cannot leave the campaign with damage off.
 *
 * The test that matters is not that the toggles work. It is that a campaign run
 * after a sandbox run gets exactly the numbers it would have got if the sandbox
 * had never been opened, and that is provable because the only way a rule
 * reaches anything is by being passed in.
 *
 * Pure. No Babylon, no DOM, no clock, no RNG.
 */

export const SANDBOX_RULE_IDS = [
  "freeCosts",
  "noCooldowns",
  "noDamageTaken",
  "infiniteAmmunition",
  "stableDrift",
  "calmEnemies",
  "persistentDestruction",
  "slowMotion",
  "debugVisuals",
] as const;
export type SandboxRuleId = (typeof SANDBOX_RULE_IDS)[number];

export interface SandboxRuleDefinition {
  readonly id: SandboxRuleId;
  readonly displayName: string;
  /** What it does, in one sentence a player reads before flipping it. */
  readonly effect: string;
  /**
   * True for the ones that belong behind the advanced panel.
   *
   * Debug visualisation is a tool, not a toy: leaving it in the ordinary list
   * would make the normal sandbox look like a developer build.
   */
  readonly advanced: boolean;
}

const DEFINITIONS: readonly SandboxRuleDefinition[] = [
  {
    id: "freeCosts",
    displayName: "Free everything",
    effect: "Nothing costs funding, alloy or research data.",
    advanced: false,
  },
  {
    id: "noCooldowns",
    displayName: "No cooldowns",
    effect: "Moves, weapons and abilities are ready the moment they finish.",
    advanced: false,
  },
  {
    id: "noDamageTaken",
    displayName: "Invulnerable machines",
    effect: "Your side takes no damage. Everything else still hits and still reacts.",
    advanced: false,
  },
  {
    id: "infiniteAmmunition",
    displayName: "Infinite ammunition",
    effect: "Magazines never empty and nothing needs reloading.",
    advanced: false,
  },
  {
    id: "stableDrift",
    displayName: "Perfect drift",
    effect: "The neural link never slips, whatever the crew have been through.",
    advanced: false,
  },
  {
    id: "calmEnemies",
    displayName: "Passive creatures",
    effect: "Creatures move and react but do not attack, for looking at things.",
    advanced: false,
  },
  {
    id: "persistentDestruction",
    displayName: "Damage stays",
    effect: "Wrecked buildings are never cleared or rebuilt during the run.",
    advanced: false,
  },
  {
    id: "slowMotion",
    displayName: "Slow motion",
    effect: "Everything runs at a third speed, for watching a hit land.",
    advanced: false,
  },
  {
    id: "debugVisuals",
    displayName: "Debug visualisation",
    effect: "Draws hit volumes, navigation and spawn markers over the scene.",
    advanced: true,
  },
];

export type SandboxRules = Readonly<Record<SandboxRuleId, boolean>>;

/** Everything off. What a fresh sandbox opens with: a normal fight, unrestricted. */
export function defaultRules(): SandboxRules {
  const rules = {} as Record<SandboxRuleId, boolean>;
  for (const id of SANDBOX_RULE_IDS) rules[id] = false;
  return rules;
}

export const SANDBOX_RULE_DEFINITIONS = DEFINITIONS;

/** The ones an ordinary player sees, and the ones behind the advanced panel. */
export function rulesByPanel(advanced: boolean): readonly SandboxRuleDefinition[] {
  return DEFINITIONS.filter((rule) => rule.advanced === advanced);
}

export function validateRules(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null) return ["Rules must be an object."];
  const rules = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const id of SANDBOX_RULE_IDS) {
    if (typeof rules[id] !== "boolean") errors.push(`The ${id} rule must be on or off.`);
  }
  return errors;
}

/** Fills in anything missing rather than refusing, so an older file still opens. */
export function normaliseRules(value: Partial<SandboxRules> | undefined): SandboxRules {
  const base = defaultRules();
  if (!value) return base;
  const rules = {} as Record<SandboxRuleId, boolean>;
  for (const id of SANDBOX_RULE_IDS) rules[id] = value[id] === true;
  return rules;
}

/**
 * The numbers a run should use, given the rules.
 *
 * Returned as a new object every time. A caller that wants the unmodified
 * numbers simply does not call this, which is the entire mechanism keeping the
 * campaign untouched.
 */
export interface RuleAdjustments {
  /** Multiplier on every price. Zero with free costs on. */
  readonly costScale: number;
  /** Multiplier on every cooldown and reload. Zero means instantly ready. */
  readonly cooldownScale: number;
  /** Multiplier on damage taken by the player's side. */
  readonly incomingDamageScale: number;
  /** Multiplier on ammunition spent. Zero means a magazine never goes down. */
  readonly ammunitionUseScale: number;
  /** Multiplier on drift instability. Zero means a link that never slips. */
  readonly driftInstabilityScale: number;
  /** Multiplier on how readily a creature commits to an attack. */
  readonly aggressionScale: number;
  /** True when wrecked buildings are never cleared during the run. */
  readonly keepRubble: boolean;
  /** Multiplier on the simulation's time step. */
  readonly timeScale: number;
  readonly showDebugVisuals: boolean;
}

/** Slow motion runs at this fraction of normal speed. */
export const SLOW_MOTION_SCALE = 1 / 3;

export function adjustmentsFor(rules: SandboxRules): RuleAdjustments {
  return {
    costScale: rules.freeCosts ? 0 : 1,
    cooldownScale: rules.noCooldowns ? 0 : 1,
    incomingDamageScale: rules.noDamageTaken ? 0 : 1,
    ammunitionUseScale: rules.infiniteAmmunition ? 0 : 1,
    driftInstabilityScale: rules.stableDrift ? 0 : 1,
    aggressionScale: rules.calmEnemies ? 0 : 1,
    keepRubble: rules.persistentDestruction,
    timeScale: rules.slowMotion ? SLOW_MOTION_SCALE : 1,
    showDebugVisuals: rules.debugVisuals,
  };
}

/**
 * Applies the overlay to one number.
 *
 * Deliberately tiny and deliberately explicit. Every place a rule reaches the
 * simulation goes through a call like this, so grepping for it finds the
 * complete list of what the sandbox can change.
 */
export function scaled(value: number, scale: number): number {
  return value * scale;
}

/** What is switched on, in words, for the run summary and the tests. */
export function activeRules(rules: SandboxRules): readonly string[] {
  return DEFINITIONS.filter((rule) => rules[rule.id]).map((rule) => rule.displayName);
}

/**
 * Whether a run counted for anything.
 *
 * A run with any rule on is not a fair fight, and its statistics say so. This is
 * not a punishment: it is the difference between a time somebody set and a time
 * somebody set with invulnerability on, and a leaderboard that mixed the two
 * would be worth nothing.
 */
export function isFairRun(rules: SandboxRules): boolean {
  return SANDBOX_RULE_IDS.filter((id) => id !== "debugVisuals" && id !== "slowMotion").every(
    (id) => !rules[id],
  );
}
