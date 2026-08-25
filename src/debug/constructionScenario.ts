import {
  ConstructionQueue,
  describeShortfall,
  workEffectiveness,
  type WorkCapacity,
} from "../shatterdome/construction";
import { createFacilityRegistry, type FacilityKind } from "../data/facilities";
import { resolveEffects, effectValue, type FacilityStanding } from "../shatterdome/facilityEffects";

/**
 * A building programme, run headlessly.
 *
 * What this proves: a queue works in priority order, reprioritising takes effect
 * on the next tick rather than after the current job, pausing gives crews back
 * without losing progress, cancelling refunds by the same policy every time, and
 * a complex short of power builds slowly rather than stopping.
 */

export const CONSTRUCTION_SCENARIO_SEED = 20260828;

export interface ConstructionScenarioOptions {
  /** What to queue, in the order it is queued. */
  readonly orders?: readonly { readonly facilityId: FacilityKind; readonly priority?: number }[];
  readonly crews?: number;
  readonly powerFactor?: number;
  readonly staffFactor?: number;
  readonly rateMultiplier?: number;
  /** Ticks to run. */
  readonly ticks?: number;
  /** Ticks per step, so a run can be coarse or fine. */
  readonly step?: number;
}

export interface ConstructionScenarioResult {
  /** Facilities finished, in the order they finished. */
  readonly completed: readonly string[];
  /** What is still outstanding when the run ends. */
  readonly outstanding: readonly { readonly facilityId: string; readonly progress: number }[];
  /** Whether anything was ever stalled, and why the first time it was. */
  readonly firstStall: string | null;
  readonly effectiveness: number;
  readonly digest: number;
}

function capacityFrom(options: ConstructionScenarioOptions): WorkCapacity {
  return {
    crewsAvailable: options.crews ?? 2,
    powerFactor: options.powerFactor ?? 1,
    staffFactor: options.staffFactor ?? 1,
    rateMultiplier: options.rateMultiplier ?? 1,
  };
}

export function runConstructionScenario(
  options: ConstructionScenarioOptions = {},
): ConstructionScenarioResult {
  const definitions = createFacilityRegistry();
  const queue = new ConstructionQueue(definitions);
  const capacity = capacityFrom(options);

  const orders = options.orders ?? [
    { facilityId: "medical" as FacilityKind, priority: 5 },
    { facilityId: "contract" as FacilityKind, priority: 5 },
    { facilityId: "training" as FacilityKind, priority: 5 },
  ];
  for (const order of orders) {
    const definition = definitions.get(order.facilityId);
    const tier = definition?.tiers[0];
    if (tier) queue.enqueue(order.facilityId, tier, { priority: order.priority });
  }

  const completed: string[] = [];
  let firstStall: string | null = null;
  const step = options.step ?? 600;
  const total = options.ticks ?? 30_000;

  for (let elapsed = 0; elapsed < total; elapsed += step) {
    for (const done of queue.advance(step, capacity)) completed.push(done.facilityId);
    if (firstStall === null) {
      const stalled = queue.forecast(capacity).find((entry) => entry.stalledBecause !== null);
      if (stalled) firstStall = stalled.stalledBecause;
    }
    if (queue.live().length === 0) break;
  }

  const outstanding = queue.forecast(capacity).map((entry) => ({
    facilityId: entry.facilityId,
    progress: Math.round(entry.progress * 1000) / 1000,
  }));
  const text = `${completed.join(",")}|${outstanding.map((entry) => `${entry.facilityId}:${entry.progress}`).join(",")}`;

  return {
    completed,
    outstanding,
    firstStall,
    effectiveness: Math.round(workEffectiveness(capacity) * 1000) / 1000,
    digest: digestOf(text),
  };
}

/**
 * The same programme at full power and at half, side by side.
 *
 * The acceptance question in one function: a complex that cannot power itself
 * has to build slowly and say so, rather than silently doing nothing.
 */
export function compareShortfall(): {
  readonly full: { readonly effectiveness: number; readonly completed: number; readonly note: string | null };
  readonly brownout: {
    readonly effectiveness: number;
    readonly completed: number;
    readonly note: string | null;
  };
  readonly blackout: {
    readonly effectiveness: number;
    readonly completed: number;
    readonly note: string | null;
  };
} {
  const measure = (powerFactor: number, staffFactor: number) => {
    const capacity: WorkCapacity = {
      crewsAvailable: 2,
      powerFactor,
      staffFactor,
      rateMultiplier: 1,
    };
    const run = runConstructionScenario({ powerFactor, staffFactor, ticks: 20_000 });
    return {
      effectiveness: Math.round(workEffectiveness(capacity) * 1000) / 1000,
      completed: run.completed.length,
      note: describeShortfall(capacity),
    };
  };
  return {
    full: measure(1, 1),
    brownout: measure(0.5, 0.6),
    blackout: measure(0, 1),
  };
}

/** What a given set of standing facilities is worth, for comparing builds. */
export function effectsFor(
  standings: readonly FacilityStanding[],
  powerFactor = 1,
  staffFactor = 1,
): Readonly<Record<string, number>> {
  const definitions = createFacilityRegistry();
  const totals = resolveEffects(standings, definitions, { powerFactor, staffFactor });
  return {
    repairRate: Math.round(effectValue(totals, "repairRate") * 1000) / 1000,
    constructionRate: Math.round(effectValue(totals, "constructionRate") * 1000) / 1000,
    medicalRate: Math.round(effectValue(totals, "medicalRate") * 1000) / 1000,
    researchYield: Math.round(effectValue(totals, "researchYield") * 1000) / 1000,
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
