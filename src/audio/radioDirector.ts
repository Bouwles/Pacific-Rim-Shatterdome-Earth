import { ContentRegistry } from "../data/registry";
import {
  createRadioLineRegistry,
  createSpeakerRegistry,
  priorityRank,
  validateRadioLine,
  type RadioLineDefinition,
  type RadioPriority,
  type SpeakerDefinition,
  type SpeakerId,
} from "../data/radioLines";
import type { DuckRequest } from "./mixer";

/**
 * Who gets to talk, in what order, and what happens to whoever was already
 * talking.
 *
 * The failure this exists to prevent is four voices at once during the worst
 * thirty seconds of a fight. One line speaks at a time. Anything more important
 * cuts in, anything less important waits, chatter is dropped rather than
 * queued, and the same line cannot repeat until its cooldown has run.
 *
 * Every line that is spoken, interrupted or dropped lands in a **conversation
 * record**, which is authoritative state: the player can read back what was
 * said during a sortie they were too busy to listen to, so it saves.
 *
 * Pure and clock-free. Time arrives as a number of seconds; nothing here reads
 * a clock, and nothing here touches WebAudio.
 */

/** One line at a time, so this is a queue rather than a mixer. */
export const MAX_QUEUE = 4;
/** How many records are kept. Old conversation is dropped oldest first. */
export const MAX_RECORDS = 200;

export type DeliveryOutcome = "spoken" | "interrupted" | "dropped" | "queued";

/** What happened when something asked for a line. */
export interface RadioDecision {
  readonly lineId: string;
  readonly outcome: DeliveryOutcome | "refused";
  /** Plain words, for the debug readout and for the tests. */
  readonly reason: string;
  /** The line this one cut off, if any. */
  readonly interrupted: string | null;
}

/** A line currently being spoken. */
export interface ActiveLine {
  readonly line: RadioLineDefinition;
  readonly speaker: SpeakerDefinition;
  readonly startedAtSeconds: number;
  readonly endsAtSeconds: number;
}

/** What the interface should be showing right now. */
export interface Subtitle {
  readonly callsign: string;
  readonly speakerName: string;
  readonly text: string;
  readonly priority: RadioPriority;
  readonly colourToken: string;
  /**
   * True when this line arrived over the top of another one.
   *
   * The line that was cut off is gone by the time anybody could read it, so
   * what the band can usefully show is that this one came in over something,
   * which is also the honest explanation for a subtitle vanishing mid-sentence.
   */
  readonly interrupting: boolean;
}

/** One entry in the conversation record. Authoritative, and saved. */
export interface ConversationRecord {
  readonly lineId: string;
  readonly speaker: SpeakerId;
  readonly text: string;
  readonly priority: RadioPriority;
  readonly atSeconds: number;
  readonly outcome: DeliveryOutcome;
}

/** Version of the radio section of a save. */
export const RADIO_SCHEMA_VERSION = 1;

export interface RadioSaveState {
  readonly schemaVersion: number;
  readonly records: readonly ConversationRecord[];
  /** Cooldown clocks, so reloading does not let every line fire again at once. */
  readonly lastSpoken: Readonly<Record<string, number>>;
}

export interface RadioDirectorOptions {
  readonly lines?: ContentRegistry<RadioLineDefinition>;
  readonly speakers?: ContentRegistry<SpeakerDefinition>;
  readonly maxRecords?: number;
}

export class RadioDirector {
  private readonly lines: ContentRegistry<RadioLineDefinition>;
  private readonly speakers: ContentRegistry<SpeakerDefinition>;
  private readonly maxRecords: number;

  private active: ActiveLine | null = null;
  /** Whether whatever is speaking cut something else off to get there. */
  private activeInterrupted = false;
  private queue: RadioLineDefinition[] = [];
  private readonly lastSpoken = new Map<string, number>();
  private log: ConversationRecord[] = [];

  constructor(options: RadioDirectorOptions = {}) {
    this.lines = options.lines ?? createRadioLineRegistry();
    this.speakers = options.speakers ?? createSpeakerRegistry();
    this.maxRecords = options.maxRecords ?? MAX_RECORDS;
  }

  /**
   * Adds or replaces a line at runtime.
   *
   * Used for the crew, whose words live in their own pilot definitions rather
   * than in the line catalogue. Validated exactly like an authored line, so a
   * runtime line with no text or an impossible priority is refused here rather
   * than arriving mid-fight.
   *
   * Returns the validation errors, empty when it was accepted.
   */
  define(line: RadioLineDefinition): readonly string[] {
    const errors = validateRadioLine(line);
    if (errors.length > 0) return errors;
    this.lines.replace(line);
    return [];
  }

  /** Ask for a line. Everything about whether it is heard is decided here. */
  request(lineId: string, nowSeconds: number): RadioDecision {
    const line = this.lines.get(lineId);
    if (!line) {
      return { lineId, outcome: "refused", reason: "No line by that name.", interrupted: null };
    }

    const last = this.lastSpoken.get(lineId);
    if (last !== undefined && nowSeconds - last < line.cooldownSeconds) {
      const remaining = Math.ceil(line.cooldownSeconds - (nowSeconds - last));
      return {
        lineId,
        outcome: "refused",
        reason: `Said too recently. ${remaining}s of cooldown left.`,
        interrupted: null,
      };
    }
    if (this.queue.some((queued) => queued.id === lineId) || this.active?.line.id === lineId) {
      return { lineId, outcome: "refused", reason: "Already waiting to be said.", interrupted: null };
    }

    this.retireIfFinished(nowSeconds);

    if (!this.active) {
      this.begin(line, nowSeconds);
      return { lineId, outcome: "spoken", reason: "Nothing else was speaking.", interrupted: null };
    }

    const incoming = priorityRank(line.priority);
    const current = priorityRank(this.active.line.priority);

    if (incoming > current && this.active.line.interruptible) {
      const cut = this.active.line.id;
      this.record(this.active.line, this.active.startedAtSeconds, "interrupted");
      this.begin(line, nowSeconds);
      this.activeInterrupted = true;
      return {
        lineId,
        outcome: "spoken",
        reason: "More important than what was being said.",
        interrupted: cut,
      };
    }

    // Chatter never waits. If it cannot be said now it was not worth saying.
    if (line.priority === "chatter") {
      this.record(line, nowSeconds, "dropped");
      return { lineId, outcome: "dropped", reason: "Chatter, and the channel is busy.", interrupted: null };
    }

    return this.enqueue(line, nowSeconds);
  }

  /**
   * Moves time forward.
   *
   * Finishes whatever has run its length and starts the next thing waiting, so
   * a queued warning is never left sitting behind a line that already ended.
   */
  update(nowSeconds: number): void {
    this.retireIfFinished(nowSeconds);
    if (this.active || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (next) this.begin(next, nowSeconds);
  }

  /** Stops whatever is speaking, for a scene change or a load. */
  silence(nowSeconds: number): void {
    if (this.active) this.record(this.active.line, this.active.startedAtSeconds, "interrupted");
    this.active = null;
    this.activeInterrupted = false;
    for (const waiting of this.queue) this.record(waiting, nowSeconds, "dropped");
    this.queue = [];
  }

  get speaking(): ActiveLine | null {
    return this.active;
  }

  get waiting(): readonly RadioLineDefinition[] {
    return this.queue;
  }

  /** What the subtitle band should read, or null for nothing being said. */
  subtitle(): Subtitle | null {
    if (!this.active) return null;
    const { line, speaker } = this.active;
    return {
      callsign: speaker.callsign,
      speakerName: speaker.displayName,
      text: line.text,
      priority: line.priority,
      colourToken: speaker.colourToken,
      interrupting: this.activeInterrupted,
    };
  }

  /**
   * What the mixer should be ducking, given who is speaking.
   *
   * A critical line pushes hard, ordinary traffic pushes gently, and neither
   * one can touch a bus with a duck depth of zero. That rule lives in the mixer;
   * this only says how hard the push is.
   */
  duckRequests(): readonly DuckRequest[] {
    if (!this.active) return [];
    const { line, speaker } = this.active;
    const strength = line.priority === "critical" ? 1 : line.priority === "high" ? 0.8 : 0.6;
    return [{ busId: speaker.bus, strength }];
  }

  /** Everything that has been said, newest last. */
  records(): readonly ConversationRecord[] {
    return this.log;
  }

  /** The record as somebody would read it back, newest first. */
  transcript(limit = 20): readonly ConversationRecord[] {
    return this.log.slice(-limit).reverse();
  }

  toSave(): RadioSaveState {
    return {
      schemaVersion: RADIO_SCHEMA_VERSION,
      records: this.log.map((entry) => ({ ...entry })),
      lastSpoken: Object.fromEntries(this.lastSpoken),
    };
  }

  /**
   * Puts a saved conversation back.
   *
   * Unknown line ids are skipped rather than refused: a save written before a
   * line was renamed should still open, and a record of a line that no longer
   * exists is not worth failing a load over.
   */
  restore(state: RadioSaveState | undefined): void {
    this.active = null;
    this.activeInterrupted = false;
    this.queue = [];
    this.log = [];
    this.lastSpoken.clear();
    if (!state) return;
    for (const entry of state.records) {
      if (!this.lines.get(entry.lineId)) continue;
      this.log.push({ ...entry });
    }
    this.trim();
    for (const [id, at] of Object.entries(state.lastSpoken)) {
      if (this.lines.get(id)) this.lastSpoken.set(id, at);
    }
  }

  private enqueue(line: RadioLineDefinition, nowSeconds: number): RadioDecision {
    if (this.queue.length >= MAX_QUEUE) {
      // Find the least important thing waiting and see whether this beats it.
      let weakestIndex = 0;
      for (let index = 1; index < this.queue.length; index += 1) {
        const candidate = this.queue[index];
        const weakest = this.queue[weakestIndex];
        if (candidate && weakest && priorityRank(candidate.priority) < priorityRank(weakest.priority)) {
          weakestIndex = index;
        }
      }
      const weakest = this.queue[weakestIndex];
      if (!weakest || priorityRank(line.priority) <= priorityRank(weakest.priority)) {
        this.record(line, nowSeconds, "dropped");
        return {
          lineId: line.id,
          outcome: "dropped",
          reason: "The queue is full of more important traffic.",
          interrupted: null,
        };
      }
      this.queue.splice(weakestIndex, 1);
      this.record(weakest, nowSeconds, "dropped");
    }

    // Insert by priority, keeping the order things arrived within a priority.
    const rank = priorityRank(line.priority);
    let at = this.queue.length;
    for (let index = 0; index < this.queue.length; index += 1) {
      const queued = this.queue[index];
      if (queued && priorityRank(queued.priority) < rank) {
        at = index;
        break;
      }
    }
    this.queue.splice(at, 0, line);
    return {
      lineId: line.id,
      outcome: "queued",
      reason: `Waiting behind ${this.active?.line.id ?? "the channel"}.`,
      interrupted: null,
    };
  }

  private begin(line: RadioLineDefinition, nowSeconds: number): void {
    const speaker = this.speakers.get(line.speaker);
    if (!speaker) {
      // A line whose speaker no longer exists is dropped rather than crashing a
      // sortie. The record still shows it was meant to be said.
      this.record(line, nowSeconds, "dropped");
      return;
    }
    this.active = {
      line,
      speaker,
      startedAtSeconds: nowSeconds,
      endsAtSeconds: nowSeconds + line.durationMs / 1000,
    };
    this.activeInterrupted = false;
    this.lastSpoken.set(line.id, nowSeconds);
  }

  private retireIfFinished(nowSeconds: number): void {
    if (!this.active || nowSeconds < this.active.endsAtSeconds) return;
    this.record(this.active.line, this.active.startedAtSeconds, "spoken");
    this.active = null;
    this.activeInterrupted = false;
  }

  private record(line: RadioLineDefinition, atSeconds: number, outcome: DeliveryOutcome): void {
    this.log.push({
      lineId: line.id,
      speaker: line.speaker,
      text: line.text,
      priority: line.priority,
      atSeconds: Math.round(atSeconds * 100) / 100,
      outcome,
    });
    this.trim();
  }

  private trim(): void {
    if (this.log.length > this.maxRecords) this.log = this.log.slice(-this.maxRecords);
  }
}

/** Whether a save's radio state is shaped the way this expects. */
/** A radio section for a campaign that has not heard anything yet. */
export function emptyRadioSnapshot(): RadioSaveState {
  return { schemaVersion: RADIO_SCHEMA_VERSION, records: [], lastSpoken: {} };
}

export function validateRadioSave(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["radio state must be an object"];
  const state = value as Partial<RadioSaveState>;
  const errors: string[] = [];
  if (state.schemaVersion !== RADIO_SCHEMA_VERSION) {
    errors.push(`radio.schemaVersion must be ${RADIO_SCHEMA_VERSION}, got ${String(state.schemaVersion)}`);
  }
  if (!Array.isArray(state.records)) {
    errors.push("radio records must be an array");
  } else {
    for (const entry of state.records) {
      if (typeof entry?.lineId !== "string" || entry.lineId.length === 0) {
        errors.push("a conversation record needs a line id");
        break;
      }
      if (typeof entry.text !== "string" || entry.text.length === 0) {
        errors.push("a conversation record needs its text");
        break;
      }
      if (typeof entry.atSeconds !== "number" || !Number.isFinite(entry.atSeconds)) {
        errors.push("a conversation record needs a time");
        break;
      }
    }
  }
  if (typeof state.lastSpoken !== "object" || state.lastSpoken === null) {
    errors.push("radio cooldowns must be an object");
  }
  return errors;
}
