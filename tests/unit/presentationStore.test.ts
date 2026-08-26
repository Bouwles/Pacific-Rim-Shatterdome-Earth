import { describe, expect, it } from "vitest";
import {
  PRESENTATION_STORAGE_KEY,
  clearPresentation,
  loadPresentation,
  memoryStorage,
  savePresentation,
} from "../../src/ui/presentationStore";
import { MIN_HUD_OPACITY, defaultPresentation } from "../../src/ui/presentation";

/**
 * Display preferences across a reload.
 *
 * These belong to the person and the screen, not to a campaign, so they are
 * checked here rather than through a save file.
 */

describe("remembering how somebody wants to be shown things", () => {
  it("comes back with what was stored", () => {
    const storage = memoryStorage();
    const wanted = { ...defaultPresentation(), textScale: 1.35 as const, highContrast: true };
    expect(savePresentation(storage, wanted).ok).toBe(true);

    const loaded = loadPresentation(storage);
    expect(loaded.restored).toBe(true);
    expect(loaded.settings.textScale).toBe(1.35);
    expect(loaded.settings.highContrast).toBe(true);
  });

  it("uses the defaults when nothing was ever stored", () => {
    const loaded = loadPresentation(memoryStorage());
    expect(loaded.restored).toBe(false);
    expect(loaded.settings).toEqual(defaultPresentation());
    expect(loaded.note.length).toBeGreaterThan(10);
  });

  it("says so rather than throwing when there is no storage at all", () => {
    const loaded = loadPresentation(null);
    expect(loaded.restored).toBe(false);
    expect(loaded.note).toMatch(/not persist/);
    expect(savePresentation(null, defaultPresentation()).ok).toBe(false);
  });

  it("survives a storage that refuses to write", () => {
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const result = savePresentation(hostile, defaultPresentation());
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/could not be saved/);
  });

  it("survives a storage that refuses to read", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const loaded = loadPresentation(hostile);
    expect(loaded.restored).toBe(false);
    expect(loaded.settings).toEqual(defaultPresentation());
  });

  it("resets rather than failing on nonsense", () => {
    const storage = memoryStorage();
    storage.setItem(PRESENTATION_STORAGE_KEY, "not json at all");
    const loaded = loadPresentation(storage);
    expect(loaded.restored).toBe(false);
    expect(loaded.note).toMatch(/unreadable/);
  });

  it("clamps a value that drifted out of range rather than discarding everything", () => {
    const storage = memoryStorage();
    storage.setItem(
      PRESENTATION_STORAGE_KEY,
      JSON.stringify({ ...defaultPresentation(), hudOpacity: 0, subtitles: false }),
    );
    const loaded = loadPresentation(storage);
    expect(loaded.restored).toBe(true);
    expect(loaded.settings.hudOpacity).toBe(MIN_HUD_OPACITY);
    // And the rest of the preferences survived the clamping.
    expect(loaded.settings.subtitles).toBe(false);
  });

  it("forgets when asked", () => {
    const storage = memoryStorage();
    savePresentation(storage, { ...defaultPresentation(), highContrast: true });
    clearPresentation(storage);
    expect(loadPresentation(storage).restored).toBe(false);
  });

  it("never lets a stored setting hide a critical warning", () => {
    const storage = memoryStorage();
    storage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify({ hudOpacity: 0, textScale: 0.1 }));
    const loaded = loadPresentation(storage);
    expect(loaded.settings.hudOpacity).toBeGreaterThanOrEqual(MIN_HUD_OPACITY);
    expect(loaded.settings.textScale).toBeGreaterThanOrEqual(0.9);
  });
});
