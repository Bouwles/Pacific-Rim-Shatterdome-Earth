import {
  defaultPresentation,
  normalisePresentation,
  validatePresentation,
  type PresentationSettings,
} from "./presentation";

/**
 * Where display preferences live between sessions.
 *
 * Deliberately not the save file. How large somebody needs their text and
 * whether they can separate red from amber is a property of the person and the
 * screen in front of them, not of a campaign: loading an old save must not
 * reset the text size, and starting a new one must not lose it.
 *
 * Deliberately not IndexedDB either. `GAME_SPEC.md` requires saves to live in
 * IndexedDB rather than only in localStorage, and that rule is about saves:
 * they are large, versioned, migrated and recoverable. This is seven small
 * values that must be readable synchronously before the first frame is drawn,
 * which is exactly what localStorage is for.
 *
 * Every read and write is guarded. A browser in private mode, a full quota or a
 * user who has blocked site data all mean the settings do not persist, and none
 * of them may stop the game running.
 */

export const PRESENTATION_STORAGE_KEY = "shatterdome.presentation.v1";

/** The slice of storage this needs, so a test can hand it anything. */
export interface PresentationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's own storage, or null where there is not one to use. */
export function browserStorage(): PresentationStorage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // Prove it actually works rather than trusting that it exists: private mode
    // provides the object and throws on write.
    const probe = `${PRESENTATION_STORAGE_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export interface LoadResult {
  readonly settings: PresentationSettings;
  /** True when something was actually read back rather than defaulted. */
  readonly restored: boolean;
  /** What happened, for the storage panel. Never an exception. */
  readonly note: string;
}

/**
 * Reads the settings back.
 *
 * Anything unreadable, unparseable or out of range produces the defaults with a
 * note rather than an error. A display preference is never worth refusing to
 * start over.
 */
export function loadPresentation(storage: PresentationStorage | null): LoadResult {
  if (!storage) {
    return {
      settings: defaultPresentation(),
      restored: false,
      note: "Display settings will not persist: this browser is not storing site data.",
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(PRESENTATION_STORAGE_KEY);
  } catch {
    return {
      settings: defaultPresentation(),
      restored: false,
      note: "Display settings could not be read.",
    };
  }
  if (raw === null) {
    return { settings: defaultPresentation(), restored: false, note: "Using default display settings." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      settings: defaultPresentation(),
      restored: false,
      note: "Saved display settings were unreadable and have been reset.",
    };
  }

  // Clamped rather than refused, so a value that drifted out of range comes
  // back inside it instead of throwing the whole lot away.
  const settings = normalisePresentation(parsed as Partial<PresentationSettings>);
  const errors = validatePresentation(settings);
  if (errors.length > 0) {
    return {
      settings: defaultPresentation(),
      restored: false,
      note: "Saved display settings were invalid and have been reset.",
    };
  }
  return { settings, restored: true, note: "Display settings restored." };
}

/**
 * Writes the settings.
 *
 * Returns whether it stuck, so the interface can say "these will not be
 * remembered" rather than quietly failing and surprising somebody later.
 */
export function savePresentation(
  storage: PresentationStorage | null,
  settings: PresentationSettings,
): { readonly ok: boolean; readonly note: string } {
  if (!storage) return { ok: false, note: "Not stored: this browser is not storing site data." };
  try {
    storage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(normalisePresentation(settings)));
    return { ok: true, note: "Display settings saved." };
  } catch {
    return { ok: false, note: "Display settings could not be saved." };
  }
}

/** Forgets them, for a player who wants to start from the defaults. */
export function clearPresentation(storage: PresentationStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(PRESENTATION_STORAGE_KEY);
  } catch {
    // Nothing to do. Failing to forget a preference is not worth reporting.
  }
}

/** An in-memory store, for tests and for anywhere the browser will not play. */
export function memoryStorage(): PresentationStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
