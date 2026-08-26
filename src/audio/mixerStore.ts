import { browserStorage, memoryStorage, type PresentationStorage } from "../ui/presentationStore";
import { defaultLevels, normaliseLevels, validateLevels, type MixerLevels } from "./mixer";

/**
 * Where the mixing desk lives between sessions.
 *
 * The same reasoning as the display settings, and the same storage: how loud
 * somebody wants the music is a property of the person and the room they are
 * in, not of a campaign. Loading an old save must not reset it, and starting a
 * new one must not lose it. `GAME_SPEC.md` requires *saves* to be IndexedDB;
 * ten numbers that have to be readable before the first sound plays are not a
 * save.
 *
 * Every read and write is guarded, because a browser refusing to store site
 * data must cost the player their volume settings and nothing else.
 */

export const MIXER_STORAGE_KEY = "shatterdome.mixer.v1";

export type MixerStorage = PresentationStorage;

/** The browser's own storage, or null where there is not one to use. */
export function mixerStorage(): MixerStorage | null {
  return browserStorage();
}

/** An in-memory store, for tests and for anywhere the browser will not play. */
export function memoryMixerStorage(): MixerStorage {
  return memoryStorage();
}

export interface MixerLoadResult {
  readonly levels: MixerLevels;
  readonly restored: boolean;
  readonly note: string;
}

export function loadLevels(storage: MixerStorage | null): MixerLoadResult {
  if (!storage) {
    return {
      levels: defaultLevels(),
      restored: false,
      note: "Volume settings will not persist: this browser is not storing site data.",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(MIXER_STORAGE_KEY);
  } catch {
    return { levels: defaultLevels(), restored: false, note: "Volume settings could not be read." };
  }
  if (raw === null) {
    return { levels: defaultLevels(), restored: false, note: "Using default volume settings." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      levels: defaultLevels(),
      restored: false,
      note: "Saved volume settings were unreadable and have been reset.",
    };
  }

  // Clamped rather than refused: a level that drifted out of range comes back
  // inside it instead of throwing the whole desk away.
  const levels = normaliseLevels(parsed as Partial<MixerLevels>);
  if (validateLevels(levels).length > 0) {
    return {
      levels: defaultLevels(),
      restored: false,
      note: "Saved volume settings were invalid and have been reset.",
    };
  }
  return { levels, restored: true, note: "Volume settings restored." };
}

export function saveLevels(
  storage: MixerStorage | null,
  levels: MixerLevels,
): { readonly ok: boolean; readonly note: string } {
  if (!storage) return { ok: false, note: "Not stored: this browser is not storing site data." };
  try {
    storage.setItem(MIXER_STORAGE_KEY, JSON.stringify(normaliseLevels(levels)));
    return { ok: true, note: "Volume settings saved." };
  } catch {
    return { ok: false, note: "Volume settings could not be saved." };
  }
}

export function clearLevels(storage: MixerStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(MIXER_STORAGE_KEY);
  } catch {
    // Failing to forget a volume setting is not worth reporting.
  }
}
