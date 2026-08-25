import { Crew, LINK_EXPERIENCE_PER_LEVEL, type SortieOutcome } from "../pilots/crew";
import { assessDrift, createPilotRegistry, perkEffects, type DriftContext } from "../data/pilots";
import { jaegerRegistry } from "../data/jaegers";

/**
 * A campaign's worth of flying, from the crew's side, run headlessly.
 *
 * What this proves: the same seed produces the same injuries and the same links,
 * a link only grows from things the player did, one mission result can never be
 * banked twice, and two different pairs in the same machine come out with
 * genuinely different numbers rather than the same numbers with different names.
 */

export const CREW_SCENARIO_SEED = 20260826;

export interface CrewScenarioOptions {
  readonly seed?: number;
  /** How many sorties to fly. */
  readonly sorties?: number;
  /** Which two fly them. Defaults to the pair who already know each other. */
  readonly pilotIds?: readonly string[];
  /** How badly they go, 0 for clean and 1 for a disaster. */
  readonly severity?: number;
}

export interface CrewScenarioResult {
  readonly linkLevel: number;
  readonly linkExperience: number;
  readonly injuries: readonly string[];
  readonly stress: readonly { readonly pilotId: string; readonly stress: number }[];
  readonly groundedDays: number;
  readonly messages: readonly string[];
  readonly digest: number;
}

export function runCrewScenario(options: CrewScenarioOptions = {}): CrewScenarioResult {
  const pilots = createPilotRegistry();
  const crew = new Crew({ pilots, seed: options.seed ?? CREW_SCENARIO_SEED });
  const [firstId, secondId] = options.pilotIds ?? ["pilot.okonkwo", "pilot.varga"];
  const sorties = options.sorties ?? 12;
  const severity = options.severity ?? 0.5;

  const messages: string[] = [];
  const injuries: string[] = [];
  let groundedDays = 0;

  for (let index = 0; index < sorties; index += 1) {
    const day = index * 3;
    const outcome: SortieOutcome = {
      missionId: `scenario.sortie.${index}`,
      pilotIds: [firstId!, secondId!],
      score: Math.max(0, 1 - severity),
      machineDamage: severity,
      won: severity < 0.5,
      day,
    };
    const effect = crew.completeSortie(outcome);
    messages.push(...effect.messages);
    for (const entry of effect.injuries) injuries.push(entry.injuryId);

    // Three days between sorties, which is where injuries and stress unwind.
    for (const line of crew.advanceDays(3, day + 3)) messages.push(line);
    for (const id of [firstId!, secondId!]) {
      if (!crew.canDeploy(id).ok) groundedDays += 3;
    }
  }

  const track = crew.linkTrack(firstId!, secondId!);
  const text = `${track?.experience ?? 0}|${injuries.join(",")}|${messages.length}`;
  return {
    linkLevel: track?.level ?? 0,
    linkExperience: track?.experience ?? 0,
    injuries,
    stress: [firstId!, secondId!].map((id) => ({
      pilotId: id,
      stress: Math.round((crew.get(id)?.stress ?? 0) * 1000) / 1000,
    })),
    groundedDays,
    messages,
    digest: digestOf(text),
  };
}

export interface PairComparison {
  readonly pilotIds: readonly string[];
  readonly strength: number;
  readonly effectiveness: number;
  readonly firingDrawbacks: readonly string[];
  readonly perks: Readonly<Record<string, number>>;
}

/**
 * The same machine, flown by different pairs.
 *
 * This is the acceptance question in one function: put two crews in one Jaeger
 * and the numbers that reach the fight have to differ, and differ for reasons a
 * player could have predicted from the roster screen.
 */
export function comparePairs(
  chassisId = "heavy-mk4",
  linkLevel = 4,
  context: DriftContext = {},
): readonly PairComparison[] {
  const pilots = createPilotRegistry();
  const chassis = jaegerRegistry.get(chassisId);
  const pairs: readonly (readonly [string, string])[] = [
    ["pilot.okonkwo", "pilot.varga"],
    ["pilot.reyes", "pilot.sato"],
    ["pilot.ferrant", "pilot.sato"],
    ["pilot.reyes", "pilot.varga"],
  ];

  return pairs.map(([firstId, secondId]) => {
    const first = pilots.get(firstId);
    const second = pilots.get(secondId);
    const assessment = assessDrift(first, second, {
      machineRole: chassis?.role,
      linkLevel,
      ...context,
    });
    const perks = perkEffects(first, second, linkLevel);
    return {
      pilotIds: [firstId, secondId],
      strength: Math.round(assessment.strength * 1000) / 1000,
      effectiveness: Math.round(assessment.effectiveness * 1000) / 1000,
      firingDrawbacks: assessment.drawbacks.filter((entry) => entry.firing).map((entry) => entry.drawback.id),
      perks: Object.fromEntries(
        Object.entries(perks).map(([key, value]) => [key, Math.round(value * 1000) / 1000]),
      ),
    };
  });
}

/** Every way a link can be built, and what each is worth over one day. */
export function linkSourceBreakdown(): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const source of ["deployment", "compatible-choice", "training", "conversation"] as const) {
    const crew = new Crew({ seed: CREW_SCENARIO_SEED });
    // Bank it as many times as one day allows, which is the honest answer to
    // "how much is this worth", rather than the value of a single call.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      crew.addLink("pilot.okonkwo", "pilot.varga", source, 1);
    }
    out[source] = crew.linkTrack("pilot.okonkwo", "pilot.varga")?.experience ?? 0;
  }
  return out;
}

export { LINK_EXPERIENCE_PER_LEVEL };

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
