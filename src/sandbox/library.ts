import { browserStorage, memoryStorage, type PresentationStorage } from "../ui/presentationStore";
import {
  SANDBOX_SCHEMA_VERSION,
  liveRegistries,
  validateScenario,
  type SandboxScenario,
  type ScenarioRegistries,
} from "./scenario";
import { normaliseRules, validateRules, type SandboxRules } from "./rules";

/**
 * Where custom scenarios live, and how they travel.
 *
 * Deliberately **not** the campaign save. That is the whole architecture of this
 * milestone in one decision: a sandbox scenario is stored in a different place
 * entirely, so "sandbox rewards never enter the main save" is not a rule
 * somebody has to remember, it is a thing there is no code path to do. There is
 * no function here that reads or writes a `RootSave`, and nothing in the save
 * pipeline knows this file exists.
 *
 * Storage is the browser's, guarded the same way the display and volume settings
 * are: a browser that refuses costs the player their library and nothing else.
 * Scenarios are small, a few hundred bytes each, and the real way to move one
 * between machines is the export file rather than the store.
 */

export const SANDBOX_STORAGE_KEY = "shatterdome.sandbox.v1";
/** How many scenarios the library holds. Past it, the oldest is refused, not dropped. */
export const MAX_SCENARIOS = 50;

export type SandboxStorage = PresentationStorage;

export function sandboxStorage(): SandboxStorage | null {
  return browserStorage();
}

export function memorySandboxStorage(): SandboxStorage {
  return memoryStorage();
}

/** One saved entry: the fight, and the rules it was built to be played under. */
export interface SandboxEntry {
  readonly scenario: SandboxScenario;
  readonly rules: SandboxRules;
  /** Epoch milliseconds. Passed in rather than read, so this stays clock-free. */
  readonly savedAt: number;
}

/** What an export file looks like. Versioned separately from the scenario. */
export const SANDBOX_FILE_KIND = "shatterdome.sandbox.scenario";

export interface SandboxFile {
  readonly kind: typeof SANDBOX_FILE_KIND;
  readonly fileVersion: number;
  readonly entry: SandboxEntry;
}

/** Why a file cannot be played as it stands. */
export type CompatibilityVerdict = "ok" | "different-version" | "unknown-content" | "malformed";

export interface CompatibilityReport {
  readonly verdict: CompatibilityVerdict;
  /** Sentences a person can act on. Empty only when the verdict is ok. */
  readonly reasons: readonly string[];
  /**
   * True when it could be opened for editing even though it will not run.
   *
   * A scenario naming one creature this build does not have is worth opening so
   * somebody can swap that creature out. A file that is not a scenario at all is
   * not.
   */
  readonly openable: boolean;
}

/**
 * Works out whether a file can be played, edited or neither.
 *
 * This is where a modded or cross-version scenario is *marked* rather than
 * silently half-loaded. The distinction between "written by another version"
 * and "names content this build has never heard of" matters: the first is
 * usually recoverable and the second usually means somebody else's content pack.
 */
export function checkCompatibility(
  entry: SandboxEntry,
  registries: ScenarioRegistries = liveRegistries(),
): CompatibilityReport {
  const reasons: string[] = [];

  if (entry.scenario.schemaVersion !== SANDBOX_SCHEMA_VERSION) {
    return {
      verdict: "different-version",
      reasons: [
        `Written for scenario format ${entry.scenario.schemaVersion}; this build reads ` +
          `${SANDBOX_SCHEMA_VERSION}. It came from a different version of the game.`,
      ],
      openable: false,
    };
  }

  const problems = validateScenario(entry.scenario, registries);
  if (problems.length === 0) return { verdict: "ok", reasons: [], openable: true };

  // A missing name is content this build does not have, which is what a modded
  // file looks like from here. Anything else is a scenario that is simply wrong.
  const unknown = problems.filter((problem) => problem.includes("in this build"));
  reasons.push(...problems);
  if (unknown.length > 0) {
    reasons.push(
      "This scenario was probably built with content this copy of the game does not have. " +
        "Swap the missing pieces out and it will run.",
    );
    return { verdict: "unknown-content", reasons, openable: true };
  }
  return { verdict: "malformed", reasons, openable: true };
}

export interface LibraryLoad {
  readonly entries: readonly SandboxEntry[];
  readonly note: string;
  /** True when something was read back rather than defaulted. */
  readonly restored: boolean;
}

/** Reads the library. Anything unreadable produces an empty one and a note. */
export function loadLibrary(storage: SandboxStorage | null): LibraryLoad {
  if (!storage) {
    return {
      entries: [],
      restored: false,
      note: "Scenarios will not be kept: this browser is not storing site data.",
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(SANDBOX_STORAGE_KEY);
  } catch {
    return { entries: [], restored: false, note: "The scenario library could not be read." };
  }
  if (raw === null) return { entries: [], restored: false, note: "No saved scenarios yet." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      entries: [],
      restored: false,
      note: "The scenario library was unreadable and has been left alone rather than overwritten.",
    };
  }
  if (!Array.isArray(parsed)) {
    return { entries: [], restored: false, note: "The scenario library was not a list of scenarios." };
  }

  // Kept even when they will not run: a scenario naming missing content is
  // still worth showing so somebody can repair it.
  const entries = parsed.filter(isEntryShaped);
  return {
    entries,
    restored: true,
    note:
      entries.length === parsed.length
        ? `${entries.length} scenario${entries.length === 1 ? "" : "s"} in the library.`
        : `${entries.length} of ${parsed.length} scenarios could be read.`,
  };
}

export interface LibrarySaveResult {
  readonly ok: boolean;
  readonly note: string;
  readonly entries: readonly SandboxEntry[];
}

/**
 * Saves one scenario, replacing any earlier one with the same id.
 *
 * Replacing rather than appending is what makes the id worth having: editing a
 * scenario and saving it again leaves one entry, not a pile of near-copies.
 */
export function saveScenario(storage: SandboxStorage | null, entry: SandboxEntry): LibrarySaveResult {
  const problems = validateScenario(entry.scenario);
  if (problems.length > 0) {
    return { ok: false, note: `This scenario will not run yet: ${problems[0]}`, entries: [] };
  }
  const existing = loadLibrary(storage).entries;
  const without = existing.filter((candidate) => candidate.scenario.id !== entry.scenario.id);
  if (without.length >= MAX_SCENARIOS) {
    return {
      ok: false,
      // Refused rather than silently dropping somebody else's work.
      note: `The library holds ${MAX_SCENARIOS} scenarios. Delete one to make room.`,
      entries: existing,
    };
  }
  const entries = [...without, { ...entry, rules: normaliseRules(entry.rules) }];
  if (!storage) return { ok: false, note: "Not stored: this browser is not storing site data.", entries };
  try {
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(entries));
    return { ok: true, note: `Saved "${entry.scenario.name}".`, entries };
  } catch {
    return { ok: false, note: "The scenario could not be saved. Storage refused it.", entries };
  }
}

export function deleteScenario(storage: SandboxStorage | null, id: string): LibrarySaveResult {
  const entries = loadLibrary(storage).entries.filter((entry) => entry.scenario.id !== id);
  if (!storage) return { ok: false, note: "Not stored: this browser is not storing site data.", entries };
  try {
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(entries));
    return { ok: true, note: "Deleted.", entries };
  } catch {
    return { ok: false, note: "The library could not be updated.", entries };
  }
}

/** The text of an export file. What a player hands to somebody else. */
export function exportScenario(entry: SandboxEntry): string {
  const file: SandboxFile = { kind: SANDBOX_FILE_KIND, fileVersion: 1, entry };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  readonly entry: SandboxEntry | null;
  readonly compatibility: CompatibilityReport;
}

/**
 * Reads an export file.
 *
 * Refuses anything that is not one of ours before looking at the contents, so a
 * pasted save file or an unrelated JSON document produces "that is not a
 * scenario" rather than a list of missing fields.
 */
export function importScenario(
  text: string,
  registries: ScenarioRegistries = liveRegistries(),
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      entry: null,
      compatibility: {
        verdict: "malformed",
        reasons: ["That is not readable as a file. Paste the whole thing, unmodified."],
        openable: false,
      },
    };
  }

  const file = parsed as Partial<SandboxFile>;
  if (file.kind !== SANDBOX_FILE_KIND) {
    return {
      entry: null,
      compatibility: {
        verdict: "malformed",
        reasons: ["That is not a scenario file from this game."],
        openable: false,
      },
    };
  }
  if (!file.entry || !isEntryShaped(file.entry)) {
    return {
      entry: null,
      compatibility: {
        verdict: "malformed",
        reasons: ["That scenario file is missing the scenario."],
        openable: false,
      },
    };
  }

  const entry: SandboxEntry = { ...file.entry, rules: normaliseRules(file.entry.rules) };
  return { entry, compatibility: checkCompatibility(entry, registries) };
}

/** A shape check, not a content check. Content is `validateScenario`'s job. */
function isEntryShaped(value: unknown): value is SandboxEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<SandboxEntry>;
  const scenario = entry.scenario as Partial<SandboxScenario> | undefined;
  if (!scenario || typeof scenario !== "object") return false;
  if (typeof scenario.id !== "string" || typeof scenario.name !== "string") return false;
  if (typeof scenario.schemaVersion !== "number") return false;
  if (!Array.isArray(scenario.squad) || !Array.isArray(scenario.waves)) return false;
  if (entry.rules !== undefined && validateRules(entry.rules).length > 0) return false;
  return true;
}
