import { browserStorage, memoryStorage, type PresentationStorage } from "../ui/presentationStore";

/**
 * The effects accessibility settings.
 *
 * Five controls, each answering one question a player might need answered for
 * comfort or safety: flashes, screen shake, motion blur, particle density and
 * intense colour. They live beside the display and volume settings, in the
 * browser rather than in a save, because how much flashing somebody can be
 * shown is a property of the person and not of a campaign.
 *
 * The rule the whole file serves: **no full-screen flash may ever ignore
 * these.** The catalogue marks which effects are flashes and the renderer asks
 * before drawing one, so the setting is in the code path rather than in a
 * checklist.
 */

export const VFX_STORAGE_KEY = "shatterdome.vfx.v1";

export interface VfxSettings {
  /** False suppresses everything the effect catalogue marks as a flash. */
  readonly flashes: boolean;
  /** 0 to 1 on camera impulse and shake. Multiplies the comfort shake scale. */
  readonly shakeScale: number;
  /** False disables motion blur entirely. Nothing depends on it being on. */
  readonly motionBlur: boolean;
  /** 0 to 1 on particle density. Scales every pool ceiling. */
  readonly particleDensity: number;
  /**
   * False mutes saturated effect colour toward the palette's steel tones.
   *
   * Warning colours are exempt: they are information, and muting them would
   * trade comfort for a reading a player needs.
   */
  readonly intenseColor: boolean;
}

export function defaultVfxSettings(): VfxSettings {
  return { flashes: true, shakeScale: 1, motionBlur: true, particleDensity: 1, intenseColor: true };
}

export function validateVfxSettings(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["vfx settings must be an object"];
  const settings = value as Partial<VfxSettings>;
  const errors: string[] = [];
  if (typeof settings.flashes !== "boolean") errors.push("flashes must be on or off");
  if (typeof settings.motionBlur !== "boolean") errors.push("motionBlur must be on or off");
  if (typeof settings.intenseColor !== "boolean") errors.push("intenseColor must be on or off");
  for (const key of ["shakeScale", "particleDensity"] as const) {
    const number = settings[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) {
      errors.push(`${key} must be between 0 and 1`);
    }
  }
  return errors;
}

/** Clamps rather than refuses, so a drifted value comes back inside its range. */
export function normaliseVfxSettings(value: Partial<VfxSettings> | undefined): VfxSettings {
  const base = defaultVfxSettings();
  if (!value) return base;
  const clamp = (n: unknown, fallback: number): number =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  return {
    flashes: value.flashes !== false,
    shakeScale: clamp(value.shakeScale, base.shakeScale),
    motionBlur: value.motionBlur !== false,
    particleDensity: clamp(value.particleDensity, base.particleDensity),
    intenseColor: value.intenseColor !== false,
  };
}

export type VfxStorage = PresentationStorage;

export function vfxStorage(): VfxStorage | null {
  return browserStorage();
}

export function memoryVfxStorage(): VfxStorage {
  return memoryStorage();
}

export interface VfxLoadResult {
  readonly settings: VfxSettings;
  readonly restored: boolean;
  readonly note: string;
}

export function loadVfxSettings(storage: VfxStorage | null): VfxLoadResult {
  if (!storage) {
    return {
      settings: defaultVfxSettings(),
      restored: false,
      note: "Effect settings will not persist: this browser is not storing site data.",
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(VFX_STORAGE_KEY);
  } catch {
    return { settings: defaultVfxSettings(), restored: false, note: "Effect settings could not be read." };
  }
  if (raw === null) {
    return { settings: defaultVfxSettings(), restored: false, note: "Using default effect settings." };
  }
  try {
    const settings = normaliseVfxSettings(JSON.parse(raw) as Partial<VfxSettings>);
    if (validateVfxSettings(settings).length > 0) {
      return {
        settings: defaultVfxSettings(),
        restored: false,
        note: "Saved effect settings were invalid and have been reset.",
      };
    }
    return { settings, restored: true, note: "Effect settings restored." };
  } catch {
    return {
      settings: defaultVfxSettings(),
      restored: false,
      note: "Saved effect settings were unreadable and have been reset.",
    };
  }
}

export function saveVfxSettings(
  storage: VfxStorage | null,
  settings: VfxSettings,
): { readonly ok: boolean; readonly note: string } {
  if (!storage) return { ok: false, note: "Not stored: this browser is not storing site data." };
  try {
    storage.setItem(VFX_STORAGE_KEY, JSON.stringify(normaliseVfxSettings(settings)));
    return { ok: true, note: "Effect settings saved." };
  } catch {
    return { ok: false, note: "Effect settings could not be saved." };
  }
}
