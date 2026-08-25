import { createPilotRegistry, type PilotDefinition } from "../data/pilots";
import {
  INJURY_SEVERITIES,
  createInjuryRegistry,
  treatedRecoveryDays,
  injuryPoolFor,
  type InjuryDefinition,
  type InjuryRestriction,
} from "../data/injuries";
import type { ContentRegistry } from "../data/registry";
import { createSeededRng, hashStringToSeed, type Rng } from "../simulation/rng";

/**
 * The people, between sorties.
 *
 * The pilot table says who somebody is. This says how they are: what they have
 * been through lately, who they have flown with and how well that link has
 * grown, what they are carrying, and whether they can go out at all.
 *
 * It is the roster's shape applied to people rather than machines, deliberately:
 * one record per person, a link track per pair, snapshot and restore over plain
 * data, and no Babylon, no DOM and no wall clock anywhere in it. Time arrives as
 * days passing and as sorties being reported.
 *
 * A link belongs to a pair, not to a person, and is written to both sides at
 * once so the two can never disagree about how well they know each other.
 */

export const CREW_SCHEMA_VERSION = 1;

export const CREW_STATUSES = ["ready", "deployed", "injured", "recovering", "training"] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];

/** Experience one link level costs. Flat, because a link is time, not a curve. */
export const LINK_EXPERIENCE_PER_LEVEL = 100;
/** The highest a link goes. Past this, flying together is its own reward. */
export const MAX_LINK_LEVEL = 8;

/**
 * Where link experience comes from.
 *
 * Four sources, all of them things the player did. Nothing accrues from waiting
 * on a menu, which is the difference between a relationship and a timer.
 */
export const LINK_SOURCES = ["deployment", "compatible-choice", "training", "conversation"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

/** What each source is worth. A sortie together is worth far more than a chat. */
export const LINK_VALUES: Readonly<Record<LinkSource, number>> = {
  deployment: 34,
  "compatible-choice": 12,
  training: 18,
  conversation: 7,
};

/** How often a given source may be banked, so nothing can be farmed. */
export const LINK_DAILY_LIMIT: Readonly<Record<LinkSource, number>> = {
  deployment: 99,
  "compatible-choice": 99,
  training: 1,
  conversation: 2,
};

export interface CrewInjury {
  readonly injuryId: string;
  /** Days of rest still owed. */
  daysRemaining: number;
  readonly treated: boolean;
  /** Day it happened, for the record. */
  readonly day: number;
}

export interface LinkTrack {
  readonly partnerId: string;
  experience: number;
  level: number;
  /** Sorties this pair have flown together. */
  sorties: number;
}

/** One line of somebody's record. Short, kept, and bounded. */
export interface CrewEntry {
  readonly day: number;
  readonly event: string;
}

export interface CrewRecord {
  readonly pilotId: string;
  status: CrewStatus;
  /** 0 to 1. Recent strain. Falls with rest and rises with hard sorties. */
  stress: number;
  injuries: CrewInjury[];
  /** Link tracks by partner id. Symmetric: both sides are written together. */
  links: Record<string, LinkTrack>;
  /** Sorties flown by this person, in any machine, with anybody. */
  sorties: number;
  /** Sources banked today, so a day's conversations cannot be repeated forever. */
  bankedToday: Record<string, number>;
  /** The day `bankedToday` refers to. */
  bankedDay: number;
  history: CrewEntry[];
}

export interface CrewSnapshot {
  readonly schemaVersion: number;
  readonly members: readonly {
    readonly pilotId: string;
    readonly status: CrewStatus;
    readonly stress: number;
    readonly sorties: number;
    readonly injuries: readonly CrewInjury[];
    readonly links: Readonly<Record<string, LinkTrack>>;
    readonly bankedToday: Readonly<Record<string, number>>;
    readonly bankedDay: number;
    readonly history: readonly CrewEntry[];
  }[];
  /** Mission ids already paid out, so one result cannot advance a link twice. */
  readonly settledMissions: readonly string[];
}

export interface CrewOptions {
  readonly pilots?: ContentRegistry<PilotDefinition>;
  readonly injuries?: ContentRegistry<InjuryDefinition>;
  /** Seed for injury draws. Deterministic, like everything else authoritative. */
  readonly seed?: number;
}

/** What a sortie did to the two people who flew it. */
export interface SortieOutcome {
  /** Stable id of the mission, so the same result cannot be banked twice. */
  readonly missionId: string;
  readonly pilotIds: readonly string[];
  /** 0 to 1 of the objectives met. */
  readonly score: number;
  /** 0 to 1 of the machine's structure lost. */
  readonly machineDamage: number;
  /** True when the sortie ended cleanly. */
  readonly won: boolean;
  readonly day: number;
}

export interface SortieEffect {
  readonly linkGained: number;
  readonly levelsGained: number;
  readonly injuries: readonly { readonly pilotId: string; readonly injuryId: string }[];
  readonly messages: readonly string[];
  /** False when this mission had already been banked and nothing was applied. */
  readonly applied: boolean;
}

export class Crew {
  private readonly records = new Map<string, CrewRecord>();
  private readonly pilots: ContentRegistry<PilotDefinition>;
  private readonly injuries: ContentRegistry<InjuryDefinition>;
  private readonly seedValue: number;
  /** Missions already paid out. The guard against a result being banked twice. */
  private readonly settled = new Set<string>();

  constructor(options: CrewOptions = {}) {
    this.pilots = options.pilots ?? createPilotRegistry();
    this.injuries = options.injuries ?? createInjuryRegistry();
    this.seedValue = options.seed ?? 0;
    for (const pilot of this.pilots.all()) {
      this.records.set(pilot.id, {
        pilotId: pilot.id,
        status: "ready",
        stress: 0,
        injuries: [],
        links: {},
        sorties: pilot.sorties,
        bankedToday: {},
        bankedDay: 0,
        history: [],
      });
    }
  }

  all(): readonly CrewRecord[] {
    return [...this.records.values()];
  }

  get(pilotId: string): CrewRecord | undefined {
    return this.records.get(pilotId);
  }

  getOrThrow(pilotId: string): CrewRecord {
    const record = this.records.get(pilotId);
    if (!record) throw new Error(`No crew record for "${pilotId}"`);
    return record;
  }

  definition(pilotId: string): PilotDefinition | undefined {
    return this.pilots.get(pilotId);
  }

  injuryRegistry(): ContentRegistry<InjuryDefinition> {
    return this.injuries;
  }

  /** The link level between two people, in either order. */
  linkLevel(first: string, second: string): number {
    return this.records.get(first)?.links[second]?.level ?? 0;
  }

  linkTrack(first: string, second: string): LinkTrack | undefined {
    return this.records.get(first)?.links[second];
  }

  /**
   * Banks link experience for a pair.
   *
   * Written to both sides in one call, so the two records cannot disagree.
   * Sources that could be repeated forever are capped per day, which is what
   * stops a conversation being a button that grinds a relationship.
   */
  addLink(
    first: string,
    second: string,
    source: LinkSource,
    day = 0,
  ): { readonly gained: number; readonly level: number; readonly refused: string | null } {
    const a = this.records.get(first);
    const b = this.records.get(second);
    if (!a || !b) return { gained: 0, level: 0, refused: "One of them is not on the roster." };
    if (first === second) return { gained: 0, level: 0, refused: "Nobody drifts with themselves." };

    this.rollDay(a, day);
    this.rollDay(b, day);
    const limit = LINK_DAILY_LIMIT[source];
    const key = `${source}:${second}`;
    const otherKey = `${source}:${first}`;
    if ((a.bankedToday[key] ?? 0) >= limit) {
      return {
        gained: 0,
        level: a.links[second]?.level ?? 0,
        refused: `They have already done that today.`,
      };
    }
    a.bankedToday[key] = (a.bankedToday[key] ?? 0) + 1;
    b.bankedToday[otherKey] = (b.bankedToday[otherKey] ?? 0) + 1;

    const gained = LINK_VALUES[source];
    const level = this.applyLink(a, second, gained);
    this.applyLink(b, first, gained);
    return { gained, level, refused: null };
  }

  /** Adds experience to one side of a pair and returns the level it reached. */
  private applyLink(record: CrewRecord, partnerId: string, gained: number): number {
    const track = record.links[partnerId] ?? { partnerId, experience: 0, level: 0, sorties: 0 };
    track.experience += gained;
    track.level = Math.min(MAX_LINK_LEVEL, Math.floor(track.experience / LINK_EXPERIENCE_PER_LEVEL));
    record.links[partnerId] = track;
    return track.level;
  }

  /** Resets the daily banking counters when the day has moved on. */
  private rollDay(record: CrewRecord, day: number): void {
    if (record.bankedDay === day) return;
    record.bankedDay = day;
    record.bankedToday = {};
  }

  /**
   * Applies one sortie to the two people who flew it.
   *
   * Guarded by mission id: the same result applied twice does nothing the second
   * time and says so. Link, stress and injuries all move here and nowhere else.
   */
  completeSortie(outcome: SortieOutcome): SortieEffect {
    if (this.settled.has(outcome.missionId)) {
      return {
        linkGained: 0,
        levelsGained: 0,
        injuries: [],
        messages: ["That sortie has already been logged."],
        applied: false,
      };
    }
    this.settled.add(outcome.missionId);
    // Bounded, so a long campaign cannot grow the save without limit. Far more
    // than any run will hold open at once.
    if (this.settled.size > 500) {
      const oldest = this.settled.values().next().value;
      if (oldest !== undefined) this.settled.delete(oldest);
    }

    const [firstId, secondId] = outcome.pilotIds;
    const messages: string[] = [];
    const injuries: { pilotId: string; injuryId: string }[] = [];
    let linkGained = 0;
    let levelsGained = 0;

    if (firstId && secondId) {
      const before = this.linkLevel(firstId, secondId);
      // A sortie flown together is worth the most, and a clean one more again.
      const result = this.addLink(firstId, secondId, "deployment", outcome.day);
      linkGained += result.gained;
      if (outcome.won) {
        const bonus = this.addLink(firstId, secondId, "compatible-choice", outcome.day);
        linkGained += bonus.gained;
      }
      const after = this.linkLevel(firstId, secondId);
      levelsGained = after - before;
      for (const [id, other] of [
        [firstId, secondId],
        [secondId, firstId],
      ] as const) {
        const track = this.records.get(id)?.links[other];
        if (track) track.sorties += 1;
      }
      if (levelsGained > 0) {
        const line = `Drift link with ${this.nameOf(secondId)} reached level ${after}.`;
        messages.push(line);
        this.note(firstId, outcome.day, line);
        this.note(secondId, outcome.day, `Drift link with ${this.nameOf(firstId)} reached level ${after}.`);
      }
    }

    // Stress and injury, per person, from how the sortie actually went.
    const severity = Math.max(0, Math.min(1, outcome.machineDamage * 0.8 + (1 - outcome.score) * 0.4));
    for (const pilotId of outcome.pilotIds) {
      const record = this.records.get(pilotId);
      const pilot = this.pilots.get(pilotId);
      if (!record || !pilot) continue;
      record.sorties += 1;
      record.stress = clamp01(record.stress + severity * 0.5 + 0.08);
      if (record.status === "deployed") record.status = "ready";

      const drawn = this.drawInjury(pilot, record, severity, outcome);
      if (drawn) {
        injuries.push({ pilotId, injuryId: drawn.id });
        const line = `${pilot.callsign} came back with ${drawn.displayName.toLowerCase()}.`;
        messages.push(line);
        this.note(pilotId, outcome.day, line);
      }
    }

    return { linkGained, levelsGained, injuries, messages, applied: true };
  }

  /**
   * Whether this sortie hurt somebody, and how.
   *
   * Seeded from the mission id and the pilot, so the same sortie always produces
   * the same outcome for the same person and a reload cannot reroll it. A tough
   * pilot is genuinely harder to hurt, and nothing here can kill anybody.
   */
  private drawInjury(
    pilot: PilotDefinition,
    record: CrewRecord,
    severity: number,
    outcome: SortieOutcome,
  ): InjuryDefinition | null {
    if (severity <= 0.15) return null;
    const rng = this.stream(`injury|${outcome.missionId}|${pilot.id}`);
    // Stress makes people careless, resistance makes them durable. Sized so a
    // genuinely bad sortie hurts somebody about one time in ten rather than
    // every other time: the first version of this grounded the whole roster
    // inside a fortnight, which is a scheduling puzzle nobody asked for.
    const chance = clamp01(severity * 0.25 + record.stress * 0.08) * (1 - pilot.injuryResistance * 0.6);
    if (rng() >= chance) return null;

    // Light injuries first, and the draw is weighted toward them, so a bad day
    // usually means a headache rather than a spine.
    const pool = injuryPoolFor(severity)
      .filter((entry) => this.injuries.has(entry.id))
      .sort((a, b) => INJURY_SEVERITIES.indexOf(a.severity) - INJURY_SEVERITIES.indexOf(b.severity));
    if (pool.length === 0) return null;
    const roll = rng();
    const chosen = pool[Math.min(pool.length - 1, Math.floor(roll * roll * pool.length))] ?? pool[0]!;
    this.applyInjury(record, chosen, outcome.day);
    return chosen;
  }

  /** Puts an injury on somebody and takes them out of the rotation if it grounds them. */
  private applyInjury(record: CrewRecord, injury: InjuryDefinition, day: number): void {
    record.injuries.push({
      injuryId: injury.id,
      daysRemaining: injury.recoveryDays,
      treated: false,
      day,
    });
    record.stress = Math.max(record.stress, injury.stressFloor);
    record.status = injury.restriction === "grounded" ? "injured" : "recovering";
  }

  /**
   * Treats an injury in the medical bay.
   *
   * Shortens the recovery and never removes it, because an injury that can be
   * cleared on the spot is not a decision about who flies tomorrow.
   */
  treat(pilotId: string, injuryId: string, day = 0): { readonly ok: boolean; readonly message: string } {
    const record = this.records.get(pilotId);
    if (!record) return { ok: false, message: "Nobody by that name." };
    const carried = record.injuries.find((entry) => entry.injuryId === injuryId && !entry.treated);
    if (!carried) return { ok: false, message: "Nothing untreated of that kind." };
    const definition = this.injuries.get(injuryId);
    if (!definition) return { ok: false, message: "The bay does not know that injury." };

    const index = record.injuries.indexOf(carried);
    record.injuries[index] = {
      injuryId: carried.injuryId,
      daysRemaining: Math.min(carried.daysRemaining, treatedRecoveryDays(definition)),
      treated: true,
      day: carried.day,
    };
    const line = `Treated for ${definition.displayName.toLowerCase()}. ${record.injuries[index]!.daysRemaining} days to go.`;
    this.note(pilotId, day, line);
    return { ok: true, message: line };
  }

  /**
   * Puts somebody on recovery duty.
   *
   * They are out of the rotation while it runs, and they come back with less
   * stress than rest alone would have cleared. It is the answer to a crew who
   * are all technically able to fly and none of them fit to.
   */
  assignRecovery(pilotId: string, days: number, day = 0): { readonly ok: boolean; readonly message: string } {
    const record = this.records.get(pilotId);
    if (!record) return { ok: false, message: "Nobody by that name." };
    if (record.status === "deployed") return { ok: false, message: "They are out on a sortie." };
    const length = Math.max(1, Math.round(days));
    record.status = "recovering";
    record.injuries.push({
      injuryId: "rest",
      daysRemaining: length,
      treated: true,
      day,
    });
    const line = `Stood down for ${length} days of recovery.`;
    this.note(pilotId, day, line);
    return { ok: true, message: line };
  }

  /**
   * Moves everybody forward by whole days.
   *
   * Injuries heal, rest clears, and stress falls on its own. Driven by a count
   * of days rather than by a clock, so every path that moves time forward
   * settles the crew exactly once.
   */
  advanceDays(days: number, day = 0): readonly string[] {
    const elapsed = Math.max(0, Math.round(days));
    if (elapsed === 0) return [];
    const messages: string[] = [];

    for (const record of this.records.values()) {
      if (record.injuries.length > 0) {
        const kept: CrewInjury[] = [];
        for (const injury of record.injuries) {
          const left = injury.daysRemaining - elapsed;
          if (left > 0) {
            kept.push({ ...injury, daysRemaining: left });
            continue;
          }
          const definition = this.injuries.get(injury.injuryId);
          const line =
            injury.injuryId === "rest"
              ? `${this.nameOf(record.pilotId)} is back in the rotation.`
              : `${this.nameOf(record.pilotId)} has recovered from ${definition?.displayName.toLowerCase() ?? injury.injuryId}.`;
          messages.push(line);
          this.note(record.pilotId, day, line);
        }
        record.injuries = kept;
      }

      // Rest is worth more than simply not flying.
      const resting = record.status === "recovering" || record.status === "injured";
      record.stress = clamp01(record.stress - elapsed * (resting ? 0.12 : 0.05));
      if (record.injuries.length === 0 && record.status !== "deployed" && record.status !== "training") {
        record.status = "ready";
      }
    }
    return messages;
  }

  /** Sends somebody to the training floor: link with a partner, and no sortie. */
  train(
    pilotId: string,
    partnerId: string,
    day = 0,
  ): { readonly ok: boolean; readonly message: string; readonly level: number } {
    const record = this.records.get(pilotId);
    const partner = this.records.get(partnerId);
    if (!record || !partner) return { ok: false, message: "Nobody by that name.", level: 0 };
    for (const [id, entry] of [
      [pilotId, record],
      [partnerId, partner],
    ] as const) {
      const blocked = this.restrictionsOf(id).includes("grounded");
      if (blocked) {
        return { ok: false, message: `${this.nameOf(id)} is not cleared for the harness.`, level: 0 };
      }
      if (entry.status === "deployed") {
        return { ok: false, message: `${this.nameOf(id)} is out on a sortie.`, level: 0 };
      }
    }
    const result = this.addLink(pilotId, partnerId, "training", day);
    if (result.refused) return { ok: false, message: result.refused, level: result.level };
    const line = `Ran drift training with ${this.nameOf(partnerId)}.`;
    this.note(pilotId, day, line);
    this.note(partnerId, day, `Ran drift training with ${this.nameOf(pilotId)}.`);
    return { ok: true, message: line, level: result.level };
  }

  /**
   * A conversation off duty.
   *
   * Worth the least of the four sources and capped hardest, because talking to
   * somebody twice a day should build a relationship slowly rather than be the
   * optimal way to build one.
   */
  converse(
    pilotId: string,
    partnerId: string,
    day = 0,
  ): { readonly ok: boolean; readonly line: string; readonly message: string } {
    const pilot = this.pilots.get(pilotId);
    if (!pilot) return { ok: false, line: "", message: "Nobody by that name." };
    const result = this.addLink(pilotId, partnerId, "conversation", day);
    // Which line they give is seeded on the day and the pair, so the same
    // conversation is the same conversation.
    const rng = this.stream(`talk|${pilotId}|${partnerId}|${day}`);
    const lines = pilot.dialogue.offDuty;
    const line = lines[Math.floor(rng() * lines.length)] ?? lines[0] ?? "";
    if (result.refused) return { ok: false, line, message: result.refused };
    this.note(pilotId, day, `Talked with ${this.nameOf(partnerId)} off duty.`);
    return { ok: true, line, message: `Link with ${this.nameOf(partnerId)} is level ${result.level}.` };
  }

  /** Everything stopping this pilot doing something, from what they are carrying. */
  restrictionsOf(pilotId: string): readonly InjuryRestriction[] {
    const record = this.records.get(pilotId);
    if (!record) return [];
    const restrictions: InjuryRestriction[] = [];
    for (const injury of record.injuries) {
      const definition = this.injuries.get(injury.injuryId);
      if (definition && !restrictions.includes(definition.restriction)) {
        restrictions.push(definition.restriction);
      }
    }
    return restrictions;
  }

  /** How much the injuries somebody is carrying drag on holding a drift. */
  injuryPenaltyOf(pilotId: string): number {
    const record = this.records.get(pilotId);
    if (!record) return 0;
    let total = 0;
    for (const injury of record.injuries) {
      total += this.injuries.get(injury.injuryId)?.stabilityPenalty ?? 0;
    }
    return Math.min(0.5, total);
  }

  /** Whether somebody can be sent out at all, and why not. */
  canDeploy(pilotId: string): { readonly ok: boolean; readonly message: string } {
    const record = this.records.get(pilotId);
    if (!record) return { ok: false, message: "Nobody by that name." };
    if (record.status === "deployed") return { ok: false, message: "Already out." };
    // A deliberate stand-down takes somebody out of the rotation as surely as a
    // concussion does. Without this the button reads as advice rather than an
    // order, and the recovery it buys can be thrown away by the next click.
    const resting = record.injuries.find((entry) => entry.injuryId === "rest");
    if (resting) {
      return {
        ok: false,
        message: `${this.nameOf(pilotId)} is standing down: ${resting.daysRemaining} days left.`,
      };
    }
    if (this.restrictionsOf(pilotId).includes("grounded")) {
      const injury = record.injuries.find(
        (entry) => this.injuries.get(entry.injuryId)?.restriction === "grounded",
      );
      const definition = injury ? this.injuries.get(injury.injuryId) : undefined;
      return {
        ok: false,
        message: `${this.nameOf(pilotId)} is grounded: ${definition?.displayName.toLowerCase() ?? "injured"}, ${injury?.daysRemaining ?? 0} days left.`,
      };
    }
    return { ok: true, message: "Cleared for the harness." };
  }

  /**
   * Who could take this seat instead.
   *
   * Ordered by how well they would drift with the partner who is staying, so a
   * substitute is a suggestion rather than a list. Anybody grounded is left out
   * entirely, because offering somebody who cannot fly is a fake choice.
   */
  substitutesFor(
    missingId: string,
    partnerId: string,
  ): readonly { readonly pilotId: string; readonly name: string; readonly linkLevel: number }[] {
    return this.all()
      .filter((record) => record.pilotId !== missingId && record.pilotId !== partnerId)
      .filter((record) => this.canDeploy(record.pilotId).ok)
      .map((record) => ({
        pilotId: record.pilotId,
        name: this.nameOf(record.pilotId),
        linkLevel: this.linkLevel(record.pilotId, partnerId),
      }))
      .sort((a, b) => b.linkLevel - a.linkLevel || a.name.localeCompare(b.name));
  }

  /** Marks a pair as out. */
  deploy(pilotIds: readonly string[]): void {
    for (const id of pilotIds) {
      const record = this.records.get(id);
      if (record) record.status = "deployed";
    }
  }

  /** Adds a line to somebody's record. Bounded, oldest trimmed first. */
  note(pilotId: string, day: number, event: string): void {
    const record = this.records.get(pilotId);
    if (!record) return;
    record.history.push({ day, event });
    while (record.history.length > 40) record.history.shift();
  }

  snapshot(): CrewSnapshot {
    return {
      schemaVersion: CREW_SCHEMA_VERSION,
      members: this.all().map((record) => ({
        pilotId: record.pilotId,
        status: record.status,
        stress: Math.round(record.stress * 1000) / 1000,
        sorties: record.sorties,
        injuries: record.injuries.map((entry) => ({ ...entry })),
        links: Object.fromEntries(Object.entries(record.links).map(([id, track]) => [id, { ...track }])),
        bankedToday: { ...record.bankedToday },
        bankedDay: record.bankedDay,
        history: record.history.map((entry) => ({ ...entry })),
      })),
      settledMissions: [...this.settled],
    };
  }

  restore(snapshot: CrewSnapshot): void {
    this.settled.clear();
    for (const id of snapshot.settledMissions ?? []) this.settled.add(id);

    for (const entry of snapshot.members ?? []) {
      const record = this.records.get(entry.pilotId);
      // A pilot this build no longer ships is dropped rather than resurrected.
      if (!record) continue;
      record.status = CREW_STATUSES.includes(entry.status) ? entry.status : "ready";
      // Nobody comes back mid-sortie: a fight is not saved.
      if (record.status === "deployed") record.status = "ready";
      record.stress = clamp01(entry.stress ?? 0);
      record.sorties = Math.max(0, Math.round(entry.sorties ?? 0));
      record.injuries = (entry.injuries ?? [])
        .filter((injury) => injury.injuryId === "rest" || this.injuries.has(injury.injuryId))
        .map((injury) => ({
          injuryId: injury.injuryId,
          daysRemaining: Math.max(0, Math.round(injury.daysRemaining)),
          treated: injury.treated === true,
          day: Math.max(0, Math.round(injury.day ?? 0)),
        }));
      record.links = {};
      for (const [partnerId, track] of Object.entries(entry.links ?? {})) {
        // A link to somebody who is not on the roster any more is meaningless.
        if (!this.records.has(partnerId) && !this.pilots.has(partnerId)) continue;
        const experience = Math.max(0, Math.round(track.experience ?? 0));
        record.links[partnerId] = {
          partnerId,
          experience,
          // Recomputed from the experience that earned it rather than trusted.
          level: Math.min(MAX_LINK_LEVEL, Math.floor(experience / LINK_EXPERIENCE_PER_LEVEL)),
          sorties: Math.max(0, Math.round(track.sorties ?? 0)),
        };
      }
      record.bankedToday = { ...(entry.bankedToday ?? {}) };
      record.bankedDay = Math.max(0, Math.round(entry.bankedDay ?? 0));
      record.history = (entry.history ?? []).map((line) => ({ ...line }));
    }
  }

  private nameOf(pilotId: string): string {
    return this.pilots.get(pilotId)?.name ?? pilotId;
  }

  private stream(name: string): Rng {
    return createSeededRng((hashStringToSeed(`crew|${name}`) ^ this.seedValue) >>> 0);
  }
}

export function emptyCrewSnapshot(): CrewSnapshot {
  return { schemaVersion: CREW_SCHEMA_VERSION, members: [], settledMissions: [] };
}

export function validateCrewSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["crew snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  if (record["schemaVersion"] !== CREW_SCHEMA_VERSION) {
    return [`crew snapshot version ${String(record["schemaVersion"])} is not ${CREW_SCHEMA_VERSION}`];
  }
  if (!Array.isArray(record["members"])) return ["crew.members must be an array"];
  if (!Array.isArray(record["settledMissions"])) return ["crew.settledMissions must be an array"];

  const errors: string[] = [];
  for (const entry of record["members"] as unknown[]) {
    const line = entry as Record<string, unknown>;
    if (typeof line["pilotId"] !== "string") errors.push("every crew record needs a pilotId");
    if (!CREW_STATUSES.includes(line["status"] as CrewStatus)) {
      errors.push(`unknown crew status "${String(line["status"])}"`);
    }
    const stress = line["stress"];
    if (typeof stress !== "number" || !Number.isFinite(stress) || stress < 0 || stress > 1) {
      errors.push(`${String(line["pilotId"])} stress must be within [0, 1]`);
    }
    if (line["injuries"] !== undefined && !Array.isArray(line["injuries"])) {
      errors.push(`${String(line["pilotId"])} injuries must be a list`);
    }
    if (line["links"] !== undefined && (typeof line["links"] !== "object" || line["links"] === null)) {
      errors.push(`${String(line["pilotId"])} links must be an object keyed by partner`);
    }
  }
  return errors;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
