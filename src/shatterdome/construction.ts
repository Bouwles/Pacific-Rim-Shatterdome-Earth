import type { FacilityDefinition, FacilityKind, FacilityTier } from "../data/facilities";
import type { ContentRegistry } from "../data/registry";

/**
 * The construction queue.
 *
 * A complex has more it wants to build than crews to build it with, so the
 * interesting decision is not what to order but what to order first. Projects
 * are queued with a priority, worked in that order by whatever crews are free,
 * and every one of them can be paused, reprioritised or cancelled.
 *
 * Nothing here is on a wall clock. Work arrives as in-game ticks, and how fast
 * those ticks turn into progress depends on the crews, the power and the staff
 * the complex actually has. A project that cannot be worked stalls visibly and
 * says why: there is no path here that silently does nothing.
 *
 * No Babylon, no DOM, no timers. Cancelling refunds by policy rather than by
 * feel, and nothing about a queue creates pressure to spend real money, because
 * there is nothing to spend and no timer to skip.
 */

export const CONSTRUCTION_SCHEMA_VERSION = 1;

export const PROJECT_STATUSES = ["queued", "active", "paused", "done", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Highest priority first. Small numbers are urgent. */
export const MAX_PRIORITY = 9;
export const DEFAULT_PRIORITY = 5;

/**
 * How much of the money comes back when a project is cancelled.
 *
 * Work already done is work already paid for, so the refund is on what is left.
 * A project that has barely started returns nearly everything; one that is
 * almost finished returns almost nothing. That is the policy, and it is the same
 * policy every time rather than a judgement call.
 */
export const CANCELLATION_REFUND = 0.75;

export interface ConstructionProject {
  readonly id: string;
  readonly facilityId: FacilityKind;
  readonly targetTier: number;
  status: ProjectStatus;
  /** 1 is most urgent, 9 least. Ties break on the order they were queued. */
  priority: number;
  /** Ticks of work still owed. */
  workRemainingTicks: number;
  readonly workTotalTicks: number;
  /** Crews this project holds while it is active. */
  crewsHeld: number;
  readonly crewsRequired: number;
  /** Funding taken when it was queued. */
  readonly costPaid: number;
  /** Order it was queued in, so ties are stable. */
  readonly sequence: number;
}

/** What the complex can bring to bear this tick. */
export interface WorkCapacity {
  /** Construction crews free for new work. */
  readonly crewsAvailable: number;
  /**
   * 0 to 1 of the power the complex needs that it actually has.
   *
   * Below one, everything runs slower rather than stopping: a brownout is a bad
   * day, not a broken game.
   */
  readonly powerFactor: number;
  /** 0 to 1 of the staff the complex wants that it actually has. */
  readonly staffFactor: number;
  /** Multiplier from facilities that make building faster. */
  readonly rateMultiplier: number;
}

export interface QueueRefusal {
  readonly reason: string;
  /** What would have to change for it to be accepted. */
  readonly remedy: string;
}

export type QueueResult =
  { readonly ok: true; readonly project: ConstructionProject } | ({ readonly ok: false } & QueueRefusal);

export interface ProjectForecast {
  readonly projectId: string;
  readonly facilityId: FacilityKind;
  readonly targetTier: number;
  readonly status: ProjectStatus;
  readonly priority: number;
  /** 0 to 1 of the work done. */
  readonly progress: number;
  /** Ticks until this project finishes, counting everything ahead of it. */
  readonly etaTicks: number;
  /** In-game minutes, which is what the panel actually shows. */
  readonly etaMinutes: number;
  /** Null when it is being worked; otherwise why it is not. */
  readonly stalledBecause: string | null;
}

export interface ConstructionSnapshot {
  readonly schemaVersion: number;
  readonly projects: readonly {
    readonly id: string;
    readonly facilityId: FacilityKind;
    readonly targetTier: number;
    readonly status: ProjectStatus;
    readonly priority: number;
    readonly workRemainingTicks: number;
    readonly workTotalTicks: number;
    readonly crewsHeld: number;
    readonly crewsRequired: number;
    readonly costPaid: number;
    readonly sequence: number;
  }[];
  readonly sequence: number;
}

export interface CompletedProject {
  readonly facilityId: FacilityKind;
  readonly tier: number;
  readonly tierName: string;
  readonly firstBuild: boolean;
}

/**
 * Work order for one tick.
 *
 * Everything the queue needs to know that it cannot work out for itself: how
 * many crews are free, whether the lights are on, and how fast the complex
 * builds. Injected rather than read, so the queue can be tested against a
 * brownout without a reactor existing.
 */
export class ConstructionQueue {
  private readonly projects: ConstructionProject[] = [];
  private sequence = 0;

  constructor(private readonly definitions: ContentRegistry<FacilityDefinition>) {}

  all(): readonly ConstructionProject[] {
    return [...this.projects];
  }

  live(): readonly ConstructionProject[] {
    return this.projects.filter(
      (project) => project.status === "queued" || project.status === "active" || project.status === "paused",
    );
  }

  find(projectId: string): ConstructionProject | undefined {
    return this.projects.find((project) => project.id === projectId);
  }

  /** Whether anything is already queued or running for this facility. */
  pendingFor(facilityId: FacilityKind): ConstructionProject | undefined {
    return this.live().find((project) => project.facilityId === facilityId);
  }

  /**
   * Adds a project to the queue.
   *
   * Refusals carry a remedy, because "cannot build that" without saying what
   * would let you is the same as no message at all.
   */
  enqueue(
    facilityId: FacilityKind,
    tier: FacilityTier,
    options: {
      readonly priority?: number;
      readonly costPaid?: number;
    } = {},
  ): QueueResult {
    const definition = this.definitions.get(facilityId);
    if (!definition) {
      return { ok: false, reason: `No facility called "${facilityId}".`, remedy: "" };
    }
    if (this.pendingFor(facilityId)) {
      return {
        ok: false,
        reason: `${definition.displayName} already has work queued.`,
        remedy: "Finish or cancel that order first.",
      };
    }

    this.sequence += 1;
    const project: ConstructionProject = {
      id: `project.${facilityId}.${tier.tier}.${this.sequence}`,
      facilityId,
      targetTier: tier.tier,
      status: "queued",
      priority: clampPriority(options.priority ?? DEFAULT_PRIORITY),
      workRemainingTicks: tier.constructionTicks,
      workTotalTicks: tier.constructionTicks,
      crewsHeld: 0,
      crewsRequired: tier.crewRequired,
      costPaid: options.costPaid ?? tier.cost,
      sequence: this.sequence,
    };
    this.projects.push(project);
    return { ok: true, project };
  }

  /** Moves a project up or down the queue. Takes effect on the next tick. */
  setPriority(projectId: string, priority: number): boolean {
    const project = this.find(projectId);
    if (!project || project.status === "done" || project.status === "cancelled") return false;
    project.priority = clampPriority(priority);
    return true;
  }

  /**
   * Stops work without losing it.
   *
   * A paused project keeps its progress and gives its crews back, which is the
   * whole point: pausing the thing you no longer need most is how a crew gets
   * moved onto the thing you do.
   */
  pause(projectId: string): boolean {
    const project = this.find(projectId);
    if (!project || (project.status !== "active" && project.status !== "queued")) return false;
    project.status = "paused";
    project.crewsHeld = 0;
    return true;
  }

  resume(projectId: string): boolean {
    const project = this.find(projectId);
    if (!project || project.status !== "paused") return false;
    project.status = "queued";
    return true;
  }

  /**
   * Cancels a project and says what comes back.
   *
   * Refund is on the work not yet done, at a fixed rate. Nothing is ever lost
   * entirely and nothing is ever fully refunded, so cancelling is a real cost
   * rather than a free undo.
   */
  cancel(projectId: string): { readonly ok: boolean; readonly refund: number; readonly message: string } {
    const project = this.find(projectId);
    if (!project || project.status === "done" || project.status === "cancelled") {
      return { ok: false, refund: 0, message: "Nothing to cancel." };
    }
    const undone = project.workTotalTicks > 0 ? project.workRemainingTicks / project.workTotalTicks : 1;
    const refund = Math.round(project.costPaid * undone * CANCELLATION_REFUND);
    project.status = "cancelled";
    project.crewsHeld = 0;
    project.workRemainingTicks = 0;
    return {
      ok: true,
      refund,
      message: `Cancelled. ${refund} comes back from what was not spent yet.`,
    };
  }

  /**
   * Works the queue for a number of ticks.
   *
   * Projects are taken in priority order and given crews until the crews run
   * out. Whatever is left stays queued and says so. Power and staff scale how
   * much a tick is worth rather than whether it counts at all, so a complex
   * running short builds slowly instead of stopping dead.
   */
  advance(ticks: number, capacity: WorkCapacity): readonly CompletedProject[] {
    if (ticks <= 0) return [];
    const completed: CompletedProject[] = [];

    // Nothing holds crews between ticks: they are handed out fresh every time
    // against the current priorities, which is what makes reprioritising take
    // effect immediately rather than after the current job.
    let crewsLeft = Math.max(0, capacity.crewsAvailable);
    for (const project of this.ordered()) {
      if (project.status === "paused") continue;
      if (project.crewsRequired > crewsLeft) {
        project.status = "queued";
        project.crewsHeld = 0;
        continue;
      }
      crewsLeft -= project.crewsRequired;
      project.status = "active";
      project.crewsHeld = project.crewsRequired;
    }

    const effectiveness = workEffectiveness(capacity);
    if (effectiveness <= 0) return completed;

    for (const project of this.ordered()) {
      if (project.status !== "active") continue;
      const applied = ticks * effectiveness;
      project.workRemainingTicks -= applied;
      if (project.workRemainingTicks > 0) continue;

      project.workRemainingTicks = 0;
      project.status = "done";
      project.crewsHeld = 0;
      const definition = this.definitions.get(project.facilityId);
      const tier = definition?.tiers[project.targetTier - 1];
      completed.push({
        facilityId: project.facilityId,
        tier: project.targetTier,
        tierName: tier?.displayName ?? `Tier ${project.targetTier}`,
        firstBuild: project.targetTier === 1,
      });
    }
    return completed;
  }

  /**
   * What the queue is going to do, and when.
   *
   * Every live project with the time it will take counting everything ahead of
   * it, so the forecast answers "when will this be finished" rather than "how
   * long is this job". A stalled project says what is stalling it.
   */
  forecast(capacity: WorkCapacity, ticksPerMinute = 60): readonly ProjectForecast[] {
    const effectiveness = workEffectiveness(capacity);
    let crewsLeft = Math.max(0, capacity.crewsAvailable);
    let elapsed = 0;
    const out: ProjectForecast[] = [];

    for (const project of this.ordered()) {
      const progress =
        project.workTotalTicks > 0 ? 1 - project.workRemainingTicks / project.workTotalTicks : 1;
      let stalled: string | null = null;
      let eta = Number.POSITIVE_INFINITY;

      if (project.status === "paused") {
        stalled = "Paused.";
      } else if (project.crewsRequired > crewsLeft) {
        stalled = `Waiting for ${project.crewsRequired} crew. Everything ahead of it is using them.`;
        // It starts once whatever is ahead finishes, so its own estimate runs
        // from there rather than from now.
        eta = elapsed + (effectiveness > 0 ? project.workRemainingTicks / effectiveness : Infinity);
      } else if (effectiveness <= 0) {
        stalled = "No power and no crews. Nothing is moving.";
      } else {
        crewsLeft -= project.crewsRequired;
        eta = project.workRemainingTicks / effectiveness;
        elapsed = Math.max(elapsed, eta);
      }

      out.push({
        projectId: project.id,
        facilityId: project.facilityId,
        targetTier: project.targetTier,
        status: project.status,
        priority: project.priority,
        progress: Math.max(0, Math.min(1, progress)),
        etaTicks: eta,
        etaMinutes: Number.isFinite(eta)
          ? Math.max(1, Math.round(eta / ticksPerMinute))
          : Number.POSITIVE_INFINITY,
        stalledBecause: stalled,
      });
    }
    return out;
  }

  /** Live projects, most urgent first, ties broken by when they were queued. */
  private ordered(): readonly ConstructionProject[] {
    // A copy, because the live list is derived and sorting it in place would
    // reorder nothing that matters and confuse everything that reads it.
    return [...this.live()].sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
  }

  /** Forgets everything settled, so a long campaign does not grow the save. */
  prune(): void {
    for (let index = this.projects.length - 1; index >= 0; index -= 1) {
      const project = this.projects[index]!;
      if (project.status === "done" || project.status === "cancelled") this.projects.splice(index, 1);
    }
  }

  snapshot(): ConstructionSnapshot {
    return {
      schemaVersion: CONSTRUCTION_SCHEMA_VERSION,
      sequence: this.sequence,
      projects: this.live().map((project) => ({
        id: project.id,
        facilityId: project.facilityId,
        targetTier: project.targetTier,
        status: project.status,
        priority: project.priority,
        workRemainingTicks: Math.round(project.workRemainingTicks),
        workTotalTicks: project.workTotalTicks,
        crewsHeld: project.crewsHeld,
        crewsRequired: project.crewsRequired,
        costPaid: project.costPaid,
        sequence: project.sequence,
      })),
    };
  }

  restore(snapshot: ConstructionSnapshot): void {
    this.projects.length = 0;
    this.sequence = Math.max(0, Math.round(snapshot.sequence ?? 0));
    for (const entry of snapshot.projects ?? []) {
      // A facility this build no longer has is dropped rather than resurrected.
      if (!this.definitions.has(entry.facilityId)) continue;
      this.projects.push({
        id: entry.id,
        facilityId: entry.facilityId,
        targetTier: Math.max(1, Math.round(entry.targetTier)),
        // Nothing comes back mid-tick: an active project reverts to queued and
        // is given crews again on the first tick after loading.
        status: entry.status === "paused" ? "paused" : "queued",
        priority: clampPriority(entry.priority),
        workRemainingTicks: Math.max(0, entry.workRemainingTicks),
        workTotalTicks: Math.max(1, entry.workTotalTicks),
        crewsHeld: 0,
        crewsRequired: Math.max(0, Math.round(entry.crewsRequired)),
        costPaid: Math.max(0, Math.round(entry.costPaid)),
        sequence: Math.max(0, Math.round(entry.sequence)),
      });
      this.sequence = Math.max(this.sequence, entry.sequence);
    }
  }
}

/**
 * How much one tick of work is worth.
 *
 * Power and staff are floors rather than switches: a complex at half power
 * still builds, at half speed. That is what makes a brownout something to
 * manage rather than something that silently stops the game.
 */
export function workEffectiveness(capacity: WorkCapacity): number {
  const power = clamp01(capacity.powerFactor);
  const staff = clamp01(capacity.staffFactor);
  if (power <= 0) return 0;
  const rate = Number.isFinite(capacity.rateMultiplier) ? Math.max(0, capacity.rateMultiplier) : 1;
  // Staff never stops work outright, because a crew can always do it the slow
  // way. Power can, because nothing runs without it.
  return power * (0.4 + staff * 0.6) * rate;
}

/** A sentence about why the complex is not working at full speed, or null. */
export function describeShortfall(capacity: WorkCapacity): string | null {
  const power = clamp01(capacity.powerFactor);
  const staff = clamp01(capacity.staffFactor);
  if (power <= 0) return "The reactor cannot carry the complex. Nothing is being built.";
  const notes: string[] = [];
  if (power < 0.999) notes.push(`power at ${Math.round(power * 100)} percent`);
  if (staff < 0.999) notes.push(`${Math.round(staff * 100)} percent of the posts filled`);
  if (notes.length === 0) return null;
  return `Building at ${Math.round(workEffectiveness({ ...capacity, rateMultiplier: 1 }) * 100)} percent: ${notes.join(", ")}.`;
}

export function emptyConstructionSnapshot(): ConstructionSnapshot {
  return { schemaVersion: CONSTRUCTION_SCHEMA_VERSION, projects: [], sequence: 0 };
}

export function validateConstructionSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) {
    return ["construction snapshot must be an object"];
  }
  const record = snapshot as Record<string, unknown>;
  if (record["schemaVersion"] !== CONSTRUCTION_SCHEMA_VERSION) {
    return [
      `construction snapshot version ${String(record["schemaVersion"])} is not ${CONSTRUCTION_SCHEMA_VERSION}`,
    ];
  }
  if (!Array.isArray(record["projects"])) return ["construction.projects must be an array"];

  const errors: string[] = [];
  for (const entry of record["projects"] as unknown[]) {
    const line = entry as Record<string, unknown>;
    if (typeof line["id"] !== "string") errors.push("every project needs an id");
    if (typeof line["facilityId"] !== "string") errors.push("every project needs a facilityId");
    if (!PROJECT_STATUSES.includes(line["status"] as ProjectStatus)) {
      errors.push(`unknown project status "${String(line["status"])}"`);
    }
    const remaining = line["workRemainingTicks"];
    if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) {
      errors.push(`${String(line["id"])} workRemainingTicks must be a number that is not negative`);
    }
  }
  return errors;
}

function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRIORITY;
  return Math.max(1, Math.min(MAX_PRIORITY, Math.round(value)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
