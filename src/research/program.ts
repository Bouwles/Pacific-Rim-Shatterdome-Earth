import { ContentRegistry } from "../data/registry";
import { createResearchRegistry, type ResearchBranch, type ResearchNodeDefinition } from "../data/research";
import { SAMPLE_DEFINITIONS } from "../data/samples";

/**
 * The research programme.
 *
 * What is known, what is running, and what could be started. This is
 * authoritative state: it ticks on the simulation clock, it goes in the save,
 * and it never touches Babylon or the DOM.
 *
 * It deliberately looks like the construction queue, because it is the same
 * shape of problem: a limited number of people, several things somebody would
 * like at once, and a need to be able to stop one without losing it. Anything
 * learned there is reused here rather than reinvented, including handing the
 * researchers out fresh every tick so that reprioritising takes effect
 * immediately.
 *
 * Samples and money are taken when an experiment starts, not when it finishes.
 * That is what makes cancelling a decision with a cost rather than a free undo.
 */

export const RESEARCH_SCHEMA_VERSION = 1;

/** Fraction of an experiment's cost returned when it is cancelled part way. */
export const RESEARCH_REFUND = 0.5;

export type ExperimentState = "queued" | "running" | "paused";

export interface Experiment {
  readonly nodeId: string;
  state: ExperimentState;
  /** Ticks of work already put in. */
  progressTicks: number;
  /** Lower runs first. The player sets this. */
  priority: number;
  /** Researchers currently on it. Handed out fresh every tick. */
  staffAssigned: number;
}

export interface ResearchCapacity {
  /** Researchers available across the complex. */
  readonly researchers: number;
  /**
   * What the labs are worth, one being stock.
   *
   * Comes from the facility effects, so a better research wing genuinely runs
   * experiments faster rather than only unlocking them.
   */
  readonly researchRate: number;
  /** Facility tiers built, so a node's facility requirement can be checked. */
  readonly facilityTiers: Readonly<Record<string, number>>;
}

/** Everything a start has to be checked against. */
export interface StartContext extends ResearchCapacity {
  readonly samples: Readonly<Record<string, number>>;
  readonly researchData: number;
  readonly funding: number;
}

export interface StartResult {
  readonly ok: boolean;
  readonly message: string;
  /** What starting it consumed. Empty when it was refused. */
  readonly spent: {
    readonly samples: Readonly<Record<string, number>>;
    readonly researchData: number;
    readonly funding: number;
  } | null;
}

export interface ResearchSnapshot {
  readonly schemaVersion: number;
  readonly completed: readonly string[];
  readonly experiments: readonly {
    readonly nodeId: string;
    readonly state: ExperimentState;
    readonly progressTicks: number;
    readonly priority: number;
  }[];
  readonly samples: Readonly<Record<string, number>>;
  readonly familiarity: Readonly<Record<string, number>>;
}

export function emptyResearchSnapshot(): ResearchSnapshot {
  return {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    completed: [],
    experiments: [],
    samples: {},
    familiarity: {},
  };
}

export function validateResearchSnapshot(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["research snapshot must be an object"];
  const snapshot = value as Record<string, unknown>;
  if (snapshot["schemaVersion"] !== RESEARCH_SCHEMA_VERSION) {
    return [`research schemaVersion must be ${RESEARCH_SCHEMA_VERSION}`];
  }
  const errors: string[] = [];
  if (!Array.isArray(snapshot["completed"])) errors.push("research.completed must be an array");
  if (!Array.isArray(snapshot["experiments"])) errors.push("research.experiments must be an array");
  if (typeof snapshot["samples"] !== "object" || snapshot["samples"] === null) {
    errors.push("research.samples must be an object");
  }
  if (typeof snapshot["familiarity"] !== "object" || snapshot["familiarity"] === null) {
    errors.push("research.familiarity must be an object");
  }
  return errors;
}

/** What one experiment is doing, for the panel. */
export interface ExperimentReport {
  readonly nodeId: string;
  readonly displayName: string;
  readonly branch: ResearchBranch;
  readonly state: ExperimentState;
  readonly percent: number;
  readonly ticksRemaining: number;
  readonly staffAssigned: number;
  readonly staffRequired: number;
  /** What is happening in the lab right now. */
  readonly experiment: string;
  /** Null when it is proceeding; otherwise what it is short of. */
  readonly stalledReason: string | null;
}

/** Why a node cannot be started, or null when it can. */
export interface StartRefusal {
  readonly nodeId: string;
  readonly reason: string;
}

export class ResearchProgram {
  private readonly registry: ContentRegistry<ResearchNodeDefinition>;
  private readonly completedSet = new Set<string>();
  private readonly experimentList: Experiment[] = [];
  private readonly sampleCounts = new Map<string, number>();
  private readonly familiarityCounts = new Map<string, number>();
  private nextPriority = 1;

  constructor(registry: ContentRegistry<ResearchNodeDefinition> = createResearchRegistry()) {
    this.registry = registry;
  }

  get nodes(): ContentRegistry<ResearchNodeDefinition> {
    return this.registry;
  }

  completed(): readonly string[] {
    return [...this.completedSet];
  }

  isComplete(nodeId: string): boolean {
    return this.completedSet.has(nodeId);
  }

  experiments(): readonly Experiment[] {
    return [...this.experimentList].sort((a, b) => a.priority - b.priority);
  }

  /**
   * What is on the shelf.
   *
   * Nothing with a count of zero: a store holding none of something is a store
   * that does not hold it, and reporting the zero would make a saved programme
   * differ from the one that was saved.
   */
  samples(): Readonly<Record<string, number>> {
    return Object.fromEntries([...this.sampleCounts].filter(([, count]) => count > 0));
  }

  sampleCount(sampleId: string): number {
    return this.sampleCounts.get(sampleId) ?? 0;
  }

  familiarity(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.familiarityCounts);
  }

  /** Files samples recovered from a sortie. */
  addSamples(awards: readonly { readonly sampleId: string; readonly count: number }[]): void {
    for (const award of awards) {
      if (award.count <= 0) continue;
      // A sample this build has never heard of is dropped rather than stored, so
      // removing one cannot leave a save carrying something unusable.
      if (!SAMPLE_DEFINITIONS.some((entry) => entry.id === award.sampleId)) continue;
      this.sampleCounts.set(award.sampleId, this.sampleCount(award.sampleId) + Math.round(award.count));
    }
  }

  /** Records that a category has given up a sample, for the familiarity curve. */
  recordFamiliarity(familiarity: Readonly<Record<string, number>>): void {
    for (const [key, value] of Object.entries(familiarity)) {
      if (!Number.isFinite(value) || value < 0) continue;
      this.familiarityCounts.set(key, Math.round(value));
    }
  }

  /**
   * Whether a node could be started, and if not, why.
   *
   * Every refusal names the thing that is missing and how much of it, because a
   * greyed button that says nothing is the failure this whole project is trying
   * to avoid.
   */
  refusalFor(nodeId: string, context: StartContext): string | null {
    const node = this.registry.get(nodeId);
    if (!node) return "There is no such programme.";
    if (this.completedSet.has(nodeId)) return "Already finished.";
    if (this.experimentList.some((entry) => entry.nodeId === nodeId)) return "Already under way.";

    const missing = node.requires.filter((required) => !this.completedSet.has(required));
    if (missing.length > 0) {
      const names = missing.map((id) => this.registry.get(id)?.displayName ?? id);
      return `Waiting on ${names.join(" and ")}.`;
    }

    if (node.requiresFacility) {
      const tier = context.facilityTiers[node.requiresFacility.facilityId] ?? 0;
      if (tier < node.requiresFacility.tier) {
        return `Needs ${node.requiresFacility.facilityId} at tier ${node.requiresFacility.tier}.`;
      }
    }

    for (const requirement of node.samples) {
      const held = this.sampleCount(requirement.sampleId);
      if (held < requirement.count) {
        const name =
          SAMPLE_DEFINITIONS.find((entry) => entry.id === requirement.sampleId)?.displayName ??
          requirement.sampleId;
        return `Short ${requirement.count - held} of ${name}.`;
      }
    }

    if (context.researchData < node.dataCost) {
      return `Short ${Math.ceil(node.dataCost - context.researchData)} research data.`;
    }
    if (context.funding < node.fundingCost) {
      return `Short ${Math.round(node.fundingCost - context.funding).toLocaleString("en-GB")} credits.`;
    }
    if (context.researchers < node.staffRequired) {
      // Not a refusal to queue: it would run short-handed, which is slower rather
      // than impossible. Said out loud so the player knows what they are doing.
      return null;
    }
    return null;
  }

  /**
   * Starts an experiment.
   *
   * Takes the samples and the money now. The caller is handed exactly what was
   * consumed so it can charge the economy through the one path that owns it,
   * rather than this class reaching into the books itself.
   */
  start(nodeId: string, context: StartContext): StartResult {
    const refusal = this.refusalFor(nodeId, context);
    if (refusal) return { ok: false, message: refusal, spent: null };
    const node = this.registry.getOrThrow(nodeId);

    const spentSamples: Record<string, number> = {};
    for (const requirement of node.samples) {
      this.sampleCounts.set(requirement.sampleId, this.sampleCount(requirement.sampleId) - requirement.count);
      spentSamples[requirement.sampleId] = requirement.count;
    }

    this.experimentList.push({
      nodeId,
      state: "queued",
      progressTicks: 0,
      priority: this.nextPriority,
      staffAssigned: 0,
    });
    this.nextPriority += 1;

    return {
      ok: true,
      message: `${node.displayName} is under way. ${node.experiment}`,
      spent: { samples: spentSamples, researchData: node.dataCost, funding: node.fundingCost },
    };
  }

  setPriority(nodeId: string, priority: number): boolean {
    const experiment = this.experimentList.find((entry) => entry.nodeId === nodeId);
    if (!experiment) return false;
    experiment.priority = priority;
    return true;
  }

  /** Moves an experiment to the front. The common case, so it has a name. */
  prioritise(nodeId: string): boolean {
    const lowest = this.experimentList.reduce((least, entry) => Math.min(least, entry.priority), 1);
    return this.setPriority(nodeId, lowest - 1);
  }

  pause(nodeId: string): boolean {
    const experiment = this.experimentList.find((entry) => entry.nodeId === nodeId);
    if (!experiment || experiment.state === "paused") return false;
    experiment.state = "paused";
    experiment.staffAssigned = 0;
    return true;
  }

  resume(nodeId: string): boolean {
    const experiment = this.experimentList.find((entry) => entry.nodeId === nodeId);
    if (!experiment || experiment.state !== "paused") return false;
    experiment.state = "queued";
    return true;
  }

  /**
   * Cancels an experiment.
   *
   * Half of everything comes back, samples included, and the half that does not
   * is what was already consumed. It is always the same half, so cancelling is
   * never a way to store value and never a wait that can be paid off.
   */
  cancel(nodeId: string): {
    readonly ok: boolean;
    readonly message: string;
    readonly refund: {
      readonly samples: Readonly<Record<string, number>>;
      readonly researchData: number;
      readonly funding: number;
    } | null;
  } {
    const index = this.experimentList.findIndex((entry) => entry.nodeId === nodeId);
    if (index < 0) return { ok: false, message: "Nothing to cancel.", refund: null };
    const node = this.registry.getOrThrow(nodeId);
    this.experimentList.splice(index, 1);

    const samples: Record<string, number> = {};
    for (const requirement of node.samples) {
      const back = Math.floor(requirement.count * RESEARCH_REFUND);
      if (back <= 0) continue;
      samples[requirement.sampleId] = back;
      this.sampleCounts.set(requirement.sampleId, this.sampleCount(requirement.sampleId) + back);
    }

    return {
      ok: true,
      message: `${node.displayName} stopped. Half of what it took comes back.`,
      refund: {
        samples,
        researchData: Math.floor(node.dataCost * RESEARCH_REFUND),
        funding: Math.floor(node.fundingCost * RESEARCH_REFUND),
      },
    };
  }

  /**
   * A tick of work.
   *
   * Researchers are handed out fresh every tick against current priorities, so
   * moving something to the front takes effect on the next tick rather than
   * after the current experiment finishes. An experiment that cannot be fully
   * staffed runs at the fraction it did get, which is slower rather than
   * stopped: a complex short of people is degraded, never stuck.
   */
  advance(ticks: number, capacity: ResearchCapacity): readonly ResearchNodeDefinition[] {
    if (ticks <= 0) return [];
    let staffLeft = Math.max(0, Math.floor(capacity.researchers));
    const finished: ResearchNodeDefinition[] = [];

    for (const experiment of this.experiments()) {
      experiment.staffAssigned = 0;
      if (experiment.state === "paused") continue;
      const node = this.registry.get(experiment.nodeId);
      if (!node) continue;

      const assigned = Math.min(staffLeft, node.staffRequired);
      staffLeft -= assigned;
      experiment.staffAssigned = assigned;
      if (assigned <= 0) {
        experiment.state = "queued";
        continue;
      }
      experiment.state = "running";

      // Partly staffed is partly effective, with a floor so that one researcher
      // on a six-person job is still worth putting there.
      const staffing = 0.35 + 0.65 * (assigned / node.staffRequired);
      const rate = Math.max(0.1, capacity.researchRate) * staffing;
      experiment.progressTicks += ticks * rate;

      if (experiment.progressTicks >= node.researchTicks) {
        this.completedSet.add(node.id);
        finished.push(node);
      }
    }

    for (const node of finished) {
      const index = this.experimentList.findIndex((entry) => entry.nodeId === node.id);
      if (index >= 0) this.experimentList.splice(index, 1);
    }
    return finished;
  }

  /** What every running experiment is doing, for the panel. */
  report(capacity: ResearchCapacity): readonly ExperimentReport[] {
    return this.experiments().map((experiment) => {
      const node = this.registry.getOrThrow(experiment.nodeId);
      const rate =
        experiment.staffAssigned > 0
          ? Math.max(0.1, capacity.researchRate) *
            (0.35 + 0.65 * (experiment.staffAssigned / node.staffRequired))
          : 0;
      const left = Math.max(0, node.researchTicks - experiment.progressTicks);
      return {
        nodeId: node.id,
        displayName: node.displayName,
        branch: node.branch,
        state: experiment.state,
        percent: Math.min(100, Math.round((experiment.progressTicks / node.researchTicks) * 100)),
        ticksRemaining: rate > 0 ? Math.ceil(left / rate) : Number.POSITIVE_INFINITY,
        staffAssigned: experiment.staffAssigned,
        staffRequired: node.staffRequired,
        experiment: node.experiment,
        stalledReason:
          experiment.state === "paused"
            ? "Paused. The team is on something else."
            : experiment.staffAssigned <= 0
              ? "Waiting for researchers."
              : experiment.staffAssigned < node.staffRequired
                ? `Short handed: ${experiment.staffAssigned} of ${node.staffRequired} on it.`
                : null,
      };
    });
  }

  /** Everything that could be started right now, and everything that could not. */
  available(context: StartContext): {
    readonly ready: readonly ResearchNodeDefinition[];
    readonly blocked: readonly StartRefusal[];
  } {
    const ready: ResearchNodeDefinition[] = [];
    const blocked: StartRefusal[] = [];
    for (const node of this.registry.all()) {
      if (this.completedSet.has(node.id)) continue;
      if (this.experimentList.some((entry) => entry.nodeId === node.id)) continue;
      const refusal = this.refusalFor(node.id, context);
      if (refusal === null) ready.push(node);
      else blocked.push({ nodeId: node.id, reason: refusal });
    }
    return { ready, blocked };
  }

  snapshot(): ResearchSnapshot {
    return {
      schemaVersion: RESEARCH_SCHEMA_VERSION,
      completed: [...this.completedSet].sort(),
      experiments: this.experiments().map((entry) => ({
        nodeId: entry.nodeId,
        state: entry.state,
        progressTicks: Math.round(entry.progressTicks * 100) / 100,
        priority: entry.priority,
      })),
      samples: Object.fromEntries([...this.sampleCounts].filter(([, count]) => count > 0)),
      familiarity: Object.fromEntries(this.familiarityCounts),
    };
  }

  /**
   * Puts a saved programme back.
   *
   * Anything naming a node or a sample this build no longer has is dropped
   * rather than resurrected, so removing content cannot make an old save
   * unloadable. A running experiment comes back queued holding no researchers:
   * it is given them again on the first tick, so nothing is mid-tick across a
   * save.
   */
  restore(snapshot: ResearchSnapshot): void {
    this.completedSet.clear();
    this.experimentList.length = 0;
    this.sampleCounts.clear();
    this.familiarityCounts.clear();
    this.nextPriority = 1;

    for (const id of snapshot.completed) {
      if (this.registry.has(id)) this.completedSet.add(id);
    }
    for (const entry of snapshot.experiments) {
      const node = this.registry.get(entry.nodeId);
      if (!node) continue;
      this.experimentList.push({
        nodeId: entry.nodeId,
        state: entry.state === "paused" ? "paused" : "queued",
        progressTicks: Math.max(0, Math.min(node.researchTicks, entry.progressTicks)),
        priority: entry.priority,
        staffAssigned: 0,
      });
      this.nextPriority = Math.max(this.nextPriority, entry.priority + 1);
    }
    for (const [id, count] of Object.entries(snapshot.samples)) {
      if (!SAMPLE_DEFINITIONS.some((entry) => entry.id === id)) continue;
      if (!Number.isFinite(count) || count <= 0) continue;
      this.sampleCounts.set(id, Math.round(count));
    }
    for (const [key, count] of Object.entries(snapshot.familiarity)) {
      if (!Number.isFinite(count) || count < 0) continue;
      this.familiarityCounts.set(key, Math.round(count));
    }
  }
}
