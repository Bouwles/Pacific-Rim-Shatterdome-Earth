import { createDefaultRegionRegistry } from "../data/regions";
import { AttackDirector, type Incident, type Resolution } from "../world/director";

/**
 * A campaign, run headlessly.
 *
 * What this proves: the same seed and the same decisions produce the same war,
 * a different decision produces a different one, the director does not spam
 * alerts, and every resolution comes with the reasons behind it.
 *
 * Decisions are a policy rather than a script, so the same run can be replayed
 * with "defend everything", "ignore everything" or anything in between and
 * compared.
 */

export const DIRECTOR_SCENARIO_SEED = 20260825;

export type DirectorPolicy = "defend-all" | "ignore-all" | "defend-home" | "abandon-all";

export interface DirectorScenarioOptions {
  readonly seed?: number;
  readonly ticks?: number;
  readonly policy?: DirectorPolicy;
  readonly crisisFrequency?: number;
  /** Strength a defended incident is met with. */
  readonly playerStrength?: number;
  /** Region the player treats as home, for the defend-home policy. */
  readonly homeRegionId?: string;
}

export interface DirectorScenarioResult {
  readonly ticks: number;
  readonly alerts: readonly { readonly tick: number; readonly regionId: string; readonly id: string }[];
  readonly resolutions: readonly Resolution[];
  readonly escalation: number;
  readonly breachPressure: number;
  /** Highest number of incidents running at the same time. */
  readonly peakSimultaneous: number;
  /** Longest run of ticks with nothing happening at all. */
  readonly longestQuietTicks: number;
  /** How often the same region was chosen twice in a row. */
  readonly backToBackRepeats: number;
  readonly regionsHit: readonly string[];
  readonly digest: number;
}

/** One campaign under one policy. */
export function runDirectorScenario(options: DirectorScenarioOptions = {}): DirectorScenarioResult {
  const regions = createDefaultRegionRegistry();
  const director = new AttackDirector({
    regions,
    seed: options.seed ?? DIRECTOR_SCENARIO_SEED,
    crisisFrequency: options.crisisFrequency ?? 1,
  });
  const ticks = options.ticks ?? 400_000;
  const policy = options.policy ?? "ignore-all";
  const home = options.homeRegionId ?? "hong-kong";
  const step = 600;

  const alerts: { tick: number; regionId: string; id: string }[] = [];
  const resolutions: Resolution[] = [];
  const regionsHit: string[] = [];
  let peak = 0;
  let quiet = 0;
  let longestQuiet = 0;
  let repeats = 0;

  for (let tick = 0; tick <= ticks; tick += step) {
    const created = director.advance(tick, step);
    for (const incident of created) {
      alerts.push({ tick, regionId: incident.regionId, id: incident.id });
      if (regionsHit[regionsHit.length - 1] === incident.regionId) repeats += 1;
      regionsHit.push(incident.regionId);
    }
    if (created.length === 0) {
      quiet += step;
      longestQuiet = Math.max(longestQuiet, quiet);
    } else {
      quiet = 0;
    }
    peak = Math.max(peak, director.active().length);

    // Anything that has landed is answered according to the policy.
    for (const incident of director.incidents()) {
      if (incident.status !== "landed") continue;
      resolutions.push(resolveUnder(director, incident, policy, home, options.playerStrength ?? 60));
    }
    director.prune(tick);
  }

  const text = alerts
    .map((alert) => `${alert.tick}:${alert.regionId}`)
    .concat(resolutions.map((entry) => `${entry.incidentId}:${entry.held ? "held" : "lost"}`))
    .join("|");

  return {
    ticks,
    alerts,
    resolutions,
    escalation: director.escalation,
    breachPressure: director.breachPressure,
    peakSimultaneous: peak,
    longestQuietTicks: longestQuiet,
    backToBackRepeats: repeats,
    regionsHit,
    digest: digestOf(text),
  };
}

function resolveUnder(
  director: AttackDirector,
  incident: Incident,
  policy: DirectorPolicy,
  home: string,
  playerStrength: number,
): Resolution {
  if (policy === "abandon-all") {
    return director.expire(incident.id) ?? director.resolve(incident, "abandoned");
  }
  if (policy === "defend-all" || (policy === "defend-home" && incident.regionId === home)) {
    return director.resolve(incident, "player-defended", { playerStrength });
  }
  return director.resolve(incident, "ignored");
}

/** Two campaigns that differ only in what the player did. */
export function comparePolicies(seed = DIRECTOR_SCENARIO_SEED): {
  readonly defended: DirectorScenarioResult;
  readonly ignored: DirectorScenarioResult;
} {
  return {
    defended: runDirectorScenario({ seed, policy: "defend-all" }),
    ignored: runDirectorScenario({ seed, policy: "ignore-all" }),
  };
}

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
