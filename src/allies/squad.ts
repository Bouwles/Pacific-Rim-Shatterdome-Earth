import { createAllyCrewRegistry, perksAt, type AllyCrewDefinition, type GoalBias } from "../data/allyCrews";
import {
  DEFAULT_ORDER,
  createSquadOrderRegistry,
  type SquadOrderDefinition,
  type SquadOrderId,
} from "../data/squadOrders";
import type { ContentRegistry } from "../data/registry";
import type { AllyProfile } from "./allyBehavior";

/**
 * The squad, between and during deployments.
 *
 * Two jobs, kept in one place because they are the same state seen at two
 * moments. Before a sortie it answers who can go, in what, and whether that
 * covers the roles the mission needs. During one it holds the standing order
 * per ally and what each of them has learned.
 *
 * Like the roster and the crew: plain data, stable ids, snapshot and restore, no
 * Babylon, no DOM, no wall clock. What it does not hold is anything about the
 * fight itself, which belongs to the arena.
 */

export const SQUAD_SCHEMA_VERSION = 1;

/** The most allies that can go out at once, whatever the mission says. */
export const MAX_SQUAD_SIZE = 3;

export interface AllyRecord {
  readonly crewId: string;
  /** The owned machine they are flying, or null when they have not been assigned one. */
  machineId: string | null;
  /** Sorties flown beside the player. Drives what they have learned. */
  sorties: number;
  /** 0 to 1. Moves with how sorties went, and shifts how readily they commit. */
  confidence: number;
  /** Standing order right now. */
  order: SquadOrderId;
  /** Where the standing order pointed, when it needed a place. */
  anchor: { readonly east: number; readonly north: number } | null;
  /** What the order pointed at, when it needed a target. */
  markedTargetId: string | null;
  /** Ids of perks already learned, so a perk cannot be learned twice. */
  learned: string[];
  history: { readonly day: number; readonly event: string }[];
}

export interface SquadSnapshot {
  readonly schemaVersion: number;
  readonly members: readonly {
    readonly crewId: string;
    readonly machineId: string | null;
    readonly sorties: number;
    readonly confidence: number;
    readonly order: SquadOrderId;
    readonly learned: readonly string[];
    readonly history: readonly { readonly day: number; readonly event: string }[];
  }[];
  /** Mission ids already settled, so one result cannot teach a crew twice. */
  readonly settledMissions: readonly string[];
}

export interface SquadOptions {
  readonly crews?: ContentRegistry<AllyCrewDefinition>;
  readonly orders?: ContentRegistry<SquadOrderDefinition>;
}

/** One candidate for the squad, with everything the formation screen needs. */
export interface SquadCandidate {
  readonly crewId: string;
  readonly displayName: string;
  readonly callsign: string;
  readonly machineId: string | null;
  readonly machineName: string;
  /** 0 to 1 of the machine's structure. */
  readonly integrity: number;
  /** 0 to 1 of the ammunition its loadout is carrying. */
  readonly ammunition: number;
  readonly sorties: number;
  readonly confidence: number;
  /** What this crew brings, as a role name. */
  readonly role: string;
  readonly perks: readonly string[];
  /** Crews this one will not take the same target as. */
  readonly rivals: readonly string[];
  /** Null when they can be taken; otherwise why not. */
  readonly refusal: string | null;
}

/** Whether a proposed squad is allowed to go, and what it is missing. */
export interface SquadAssessment {
  readonly ok: boolean;
  readonly refusals: readonly string[];
  readonly warnings: readonly string[];
  /** Roles the squad covers, including the player's own machine. */
  readonly rolesCovered: readonly string[];
  readonly size: number;
  readonly limit: number;
}

export interface FormationInput {
  /** Crews the player wants to take. */
  readonly crewIds: readonly string[];
  /** Role of the player's own machine, so coverage counts it. */
  readonly playerRole: string;
  /** Per-crew machine state, injected so this module never reads the roster. */
  readonly machines: Readonly<
    Record<string, { readonly integrity: number; readonly ammunition: number; readonly role: string }>
  >;
  /** Ceiling this mission puts on the squad, if any. */
  readonly missionLimit?: number;
}

export class Squad {
  private readonly records = new Map<string, AllyRecord>();
  private readonly crews: ContentRegistry<AllyCrewDefinition>;
  private readonly orders: ContentRegistry<SquadOrderDefinition>;
  private readonly settled = new Set<string>();

  constructor(options: SquadOptions = {}) {
    this.crews = options.crews ?? createAllyCrewRegistry();
    this.orders = options.orders ?? createSquadOrderRegistry();
    for (const crew of this.crews.all()) {
      this.records.set(crew.id, {
        crewId: crew.id,
        machineId: null,
        sorties: 0,
        confidence: crew.baseConfidence,
        order: DEFAULT_ORDER,
        anchor: null,
        markedTargetId: null,
        learned: [],
        history: [],
      });
    }
  }

  all(): readonly AllyRecord[] {
    return [...this.records.values()];
  }

  get(crewId: string): AllyRecord | undefined {
    return this.records.get(crewId);
  }

  definition(crewId: string): AllyCrewDefinition | undefined {
    return this.crews.get(crewId);
  }

  orderRegistry(): ContentRegistry<SquadOrderDefinition> {
    return this.orders;
  }

  /**
   * What a crew is worth right now, as the numbers the behaviour reads.
   *
   * Standing lean, everything learned, and a confidence that has moved with how
   * their sorties went, multiplied into one profile. The behaviour module never
   * looks anything up: it is handed this.
   */
  profileOf(crewId: string): AllyProfile {
    const definition = this.crews.get(crewId);
    const record = this.records.get(crewId);
    if (!definition || !record) {
      return { confidence: 0.5, preferredRangeMeters: 100, aggression: 0.5, supportTendency: 0.5, bias: {} };
    }
    const bias: GoalBias = { ...definition.bias };
    for (const perk of perksAt(definition, record.sorties)) {
      for (const [goal, value] of Object.entries(perk.bias)) {
        const key = goal as keyof GoalBias;
        bias[key] = (bias[key] ?? 1) * (value ?? 1);
      }
    }
    return {
      confidence: record.confidence,
      preferredRangeMeters: definition.preferredRangeMeters,
      aggression: definition.aggression,
      supportTendency: definition.supportTendency,
      bias,
    };
  }

  /** What this crew's learned perks do to the machine they are flying. */
  machineScalesOf(crewId: string): { readonly damage: number; readonly structure: number } {
    const definition = this.crews.get(crewId);
    const record = this.records.get(crewId);
    if (!definition || !record) return { damage: 1, structure: 1 };
    let damage = 1;
    let structure = 1;
    for (const perk of perksAt(definition, record.sorties)) {
      damage *= perk.damageScale ?? 1;
      structure *= perk.structureScale ?? 1;
    }
    return { damage, structure };
  }

  /** Perks this crew has actually learned, by display name. */
  perksOf(crewId: string): readonly string[] {
    const definition = this.crews.get(crewId);
    const record = this.records.get(crewId);
    if (!definition || !record) return [];
    return perksAt(definition, record.sorties).map((perk) => perk.displayName);
  }

  /**
   * Everybody who could be taken, with the reason when they cannot.
   *
   * Refusals come from the machine rather than from the crew: a crew is always
   * willing, and it is the Jaeger that is in pieces.
   */
  candidates(input: FormationInput): readonly SquadCandidate[] {
    return this.all().map((record) => {
      const definition = this.crews.getOrThrow(record.crewId);
      const machine = record.machineId ? input.machines[record.machineId] : undefined;
      const integrity = machine?.integrity ?? 0;
      const ammunition = machine?.ammunition ?? 0;
      const refusal = !record.machineId
        ? "No machine assigned."
        : !machine
          ? "Its machine is not in the bay."
          : integrity < 0.35
            ? `Machine is at ${Math.round(integrity * 100)} percent and still in pieces.`
            : null;
      return {
        crewId: record.crewId,
        displayName: definition.displayName,
        callsign: definition.callsign,
        machineId: record.machineId,
        machineName: record.machineId ?? "unassigned",
        integrity,
        ammunition,
        sorties: record.sorties,
        confidence: record.confidence,
        role: machine?.role ?? "unknown",
        perks: this.perksOf(record.crewId),
        rivals: definition.rivals,
        refusal,
      };
    });
  }

  /**
   * Whether this squad can go out, and what it is short of.
   *
   * Refusals stop a launch. Warnings do not: taking two crews who dislike each
   * other, or a squad that is all one role, is allowed and is a bad idea, and
   * the difference between those two is the whole point of a planner.
   */
  assess(input: FormationInput): SquadAssessment {
    const limit = Math.min(MAX_SQUAD_SIZE, input.missionLimit ?? MAX_SQUAD_SIZE);
    const refusals: string[] = [];
    const warnings: string[] = [];
    const candidates = new Map(this.candidates(input).map((entry) => [entry.crewId, entry]));

    if (input.crewIds.length > limit) {
      refusals.push(`This mission will carry ${limit} ally machine${limit === 1 ? "" : "s"}.`);
    }
    if (new Set(input.crewIds).size !== input.crewIds.length) {
      refusals.push("The same crew cannot be listed twice.");
    }

    const roles: string[] = [input.playerRole];
    for (const crewId of input.crewIds) {
      const candidate = candidates.get(crewId);
      if (!candidate) {
        refusals.push(`No crew called "${crewId}".`);
        continue;
      }
      if (candidate.refusal) {
        refusals.push(`${candidate.callsign}: ${candidate.refusal}`);
        continue;
      }
      roles.push(candidate.role);
      if (candidate.ammunition < 0.3) {
        warnings.push(
          `${candidate.callsign} is down to ${Math.round(candidate.ammunition * 100)} percent ammunition.`,
        );
      }
      if (candidate.integrity < 0.7) {
        warnings.push(`${candidate.callsign} is flying at ${Math.round(candidate.integrity * 100)} percent.`);
      }
    }

    // Rivalry is a warning, never a refusal: it is a squad that will argue, not
    // a squad that cannot fly.
    for (const crewId of input.crewIds) {
      const definition = this.crews.get(crewId);
      if (!definition) continue;
      for (const rival of definition.rivals) {
        if (input.crewIds.includes(rival) && crewId < rival) {
          warnings.push(
            `${definition.callsign} and ${this.crews.get(rival)?.callsign ?? rival} will not take the same target.`,
          );
        }
      }
    }

    const covered = [...new Set(roles)];
    if (input.crewIds.length > 0 && covered.length === 1) {
      warnings.push(`Everything out there is a ${covered[0]}. Nothing covers what that is bad at.`);
    }

    return {
      ok: refusals.length === 0,
      refusals,
      warnings,
      rolesCovered: covered,
      size: input.crewIds.length,
      limit,
    };
  }

  /** Puts a crew in a machine. One machine per crew, one crew per machine. */
  assignMachine(
    crewId: string,
    machineId: string | null,
  ): { readonly ok: boolean; readonly message: string } {
    const record = this.records.get(crewId);
    if (!record) return { ok: false, message: "No crew by that name." };
    if (machineId) {
      const taken = this.all().find((entry) => entry.machineId === machineId && entry.crewId !== crewId);
      if (taken) {
        return { ok: false, message: `${this.callsignOf(taken.crewId)} is already flying that one.` };
      }
    }
    record.machineId = machineId;
    return {
      ok: true,
      message: machineId
        ? `${this.callsignOf(crewId)} takes ${machineId}.`
        : `${this.callsignOf(crewId)} stands down.`,
    };
  }

  /**
   * Gives an order.
   *
   * Returns the acknowledgement, because an order nobody answers is an order the
   * player cannot tell landed. The line is picked deterministically from the
   * crew and the order rather than at random, so the same command in the same
   * situation reads the same way.
   */
  issue(
    crewId: string,
    orderId: SquadOrderId,
    options: {
      readonly targetId?: string | null;
      readonly anchor?: { readonly east: number; readonly north: number } | null;
      readonly day?: number;
    } = {},
  ): { readonly ok: boolean; readonly acknowledgement: string; readonly refusal: string | null } {
    const record = this.records.get(crewId);
    const order = this.orders.get(orderId);
    if (!record) return { ok: false, acknowledgement: "", refusal: "No crew by that name." };
    if (!order) return { ok: false, acknowledgement: "", refusal: `No order called "${orderId}".` };
    if (order.needsTarget && !options.targetId) {
      return { ok: false, acknowledgement: "", refusal: `${order.displayName} needs something to point at.` };
    }
    if (order.needsPoint && !options.anchor) {
      return { ok: false, acknowledgement: "", refusal: `${order.displayName} needs somewhere to point at.` };
    }

    record.order = orderId;
    record.markedTargetId = options.targetId ?? null;
    record.anchor = options.anchor ?? null;

    const index = (hash(`${crewId}|${orderId}|${record.sorties}`) >>> 0) % order.acknowledgements.length;
    const acknowledgement = `${this.callsignOf(crewId)}: ${order.acknowledgements[index]}`;
    return { ok: true, acknowledgement, refusal: null };
  }

  /** Gives the same order to everybody who is out. */
  issueAll(
    orderId: SquadOrderId,
    options: {
      readonly targetId?: string | null;
      readonly anchor?: { readonly east: number; readonly north: number } | null;
      readonly crewIds?: readonly string[];
    } = {},
  ): readonly string[] {
    const ids = options.crewIds ?? this.all().map((entry) => entry.crewId);
    const lines: string[] = [];
    for (const crewId of ids) {
      const result = this.issue(crewId, orderId, options);
      lines.push(result.ok ? result.acknowledgement : `${this.callsignOf(crewId)}: ${result.refusal}`);
    }
    return lines;
  }

  /** The order a crew is currently working to. */
  orderOf(crewId: string): SquadOrderDefinition | undefined {
    const record = this.records.get(crewId);
    return record ? this.orders.get(record.order) : undefined;
  }

  /**
   * Applies one sortie to everybody who flew it.
   *
   * Guarded by mission id, the same way the crew and the roster are: the same
   * result applied twice does nothing the second time.
   */
  completeSortie(outcome: {
    readonly missionId: string;
    readonly crewIds: readonly string[];
    readonly won: boolean;
    /** 0 to 1 of the objectives met. */
    readonly score: number;
    readonly day?: number;
  }): { readonly applied: boolean; readonly messages: readonly string[] } {
    if (this.settled.has(outcome.missionId)) {
      return { applied: false, messages: ["That sortie has already been logged."] };
    }
    this.settled.add(outcome.missionId);
    if (this.settled.size > 500) {
      const oldest = this.settled.values().next().value;
      if (oldest !== undefined) this.settled.delete(oldest);
    }

    const day = outcome.day ?? 0;
    const messages: string[] = [];
    for (const crewId of outcome.crewIds) {
      const record = this.records.get(crewId);
      const definition = this.crews.get(crewId);
      if (!record || !definition) continue;
      const before = this.perksOf(crewId).length;
      record.sorties += 1;
      // Confidence moves with the result and never runs away in either
      // direction: a crew who lost once is shaken, not ruined.
      const shift = outcome.won ? 0.06 * outcome.score : -0.08 * (1 - outcome.score);
      record.confidence = Math.max(0.2, Math.min(0.95, record.confidence + shift));

      for (const perk of perksAt(definition, record.sorties)) {
        if (record.learned.includes(perk.id)) continue;
        record.learned.push(perk.id);
        const line = `${definition.callsign} learned ${perk.displayName}. ${perk.note}`;
        messages.push(line);
        this.note(crewId, day, line);
      }
      if (this.perksOf(crewId).length === before && outcome.won) {
        this.note(
          crewId,
          day,
          `Flew a clean sortie. Confidence ${Math.round(record.confidence * 100)} percent.`,
        );
      }
    }
    return { applied: true, messages };
  }

  note(crewId: string, day: number, event: string): void {
    const record = this.records.get(crewId);
    if (!record) return;
    record.history.push({ day, event });
    while (record.history.length > 40) record.history.shift();
  }

  snapshot(): SquadSnapshot {
    return {
      schemaVersion: SQUAD_SCHEMA_VERSION,
      members: this.all().map((record) => ({
        crewId: record.crewId,
        machineId: record.machineId,
        sorties: record.sorties,
        confidence: Math.round(record.confidence * 1000) / 1000,
        order: record.order,
        learned: [...record.learned],
        history: record.history.map((entry) => ({ ...entry })),
      })),
      settledMissions: [...this.settled],
    };
  }

  restore(snapshot: SquadSnapshot): void {
    this.settled.clear();
    for (const id of snapshot.settledMissions ?? []) this.settled.add(id);

    for (const entry of snapshot.members ?? []) {
      const record = this.records.get(entry.crewId);
      // A crew this build no longer ships is dropped rather than resurrected.
      if (!record) continue;
      const definition = this.crews.getOrThrow(entry.crewId);
      record.machineId = entry.machineId ?? null;
      record.sorties = Math.max(0, Math.round(entry.sorties ?? 0));
      record.confidence = clampConfidence(entry.confidence ?? definition.baseConfidence);
      record.order = this.orders.has(entry.order) ? entry.order : DEFAULT_ORDER;
      // Perks are recomputed from the sorties that earned them rather than
      // trusted from the file, the same rule levels and links follow. An id the
      // file names that the crew has not actually earned is dropped.
      const earned = perksAt(definition, record.sorties).map((perk) => perk.id);
      record.learned = (entry.learned ?? []).filter((id) => earned.includes(id));
      for (const id of earned) if (!record.learned.includes(id)) record.learned.push(id);
      record.history = (entry.history ?? []).map((line) => ({ ...line }));
      // An order pointing at something is not saved: a target and a place both
      // belong to a fight, and a fight is not saved.
      record.anchor = null;
      record.markedTargetId = null;
    }
  }

  private callsignOf(crewId: string): string {
    return this.crews.get(crewId)?.callsign ?? crewId;
  }
}

export function emptySquadSnapshot(): SquadSnapshot {
  return { schemaVersion: SQUAD_SCHEMA_VERSION, members: [], settledMissions: [] };
}

export function validateSquadSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["squad snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  if (record["schemaVersion"] !== SQUAD_SCHEMA_VERSION) {
    return [`squad snapshot version ${String(record["schemaVersion"])} is not ${SQUAD_SCHEMA_VERSION}`];
  }
  if (!Array.isArray(record["members"])) return ["squad.members must be an array"];
  if (!Array.isArray(record["settledMissions"])) return ["squad.settledMissions must be an array"];

  const errors: string[] = [];
  for (const entry of record["members"] as unknown[]) {
    const line = entry as Record<string, unknown>;
    if (typeof line["crewId"] !== "string") errors.push("every squad record needs a crewId");
    const confidence = line["confidence"];
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push(`${String(line["crewId"])} confidence must be within [0, 1]`);
    }
    const sorties = line["sorties"];
    if (typeof sorties !== "number" || !Number.isFinite(sorties) || sorties < 0) {
      errors.push(`${String(line["crewId"])} sorties must be a number that is not negative`);
    }
    if (line["learned"] !== undefined && !Array.isArray(line["learned"])) {
      errors.push(`${String(line["crewId"])} learned must be a list of perk ids`);
    }
  }
  return errors;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function hash(text: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}
