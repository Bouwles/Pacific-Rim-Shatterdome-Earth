import { ContentRegistry, type RegistryEntry } from "../data/registry";
import type { QualityLevel } from "../data/quality";

/**
 * The effects catalogue and the pool accounting behind it.
 *
 * Every visual effect in a fight is one of these kinds, and every kind has a
 * budget per quality level: how many can be alive at once and how many
 * particles each is worth. The budgets are the contract the stress test holds
 * the renderer to, and they are here rather than in the renderer so a test can
 * exercise the accounting without a GPU.
 *
 * The pool never grows. An effect that cannot fit is refused and counted, which
 * costs one spark burst nobody misses in a fight already full of them, instead
 * of a frame everybody feels. Releasing returns capacity exactly once however
 * many times release is called, which is what "returns to baseline after
 * repeated finishers" means in code.
 *
 * Pure. No Babylon, no clock, no RNG.
 */

export const EFFECT_KINDS = [
  "sparks",
  "plasma",
  "steam",
  "coolant",
  "kaiju-blue",
  "rain-hit",
  "water-displacement",
  "dust",
  "debris-burst",
  "lightning",
  "muzzle-flash",
  "finisher",
  "speed-lines",
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface EffectDefinition extends RegistryEntry {
  readonly id: EffectKind;
  readonly displayName: string;
  /** Palette token the effect is built from. Nothing picks a colour freehand. */
  readonly paletteId: string;
  /** Seconds a burst lives. Sustained effects loop and are released by name. */
  readonly lifeSeconds: number;
  /** True for effects that loop until released rather than burning out. */
  readonly sustained: boolean;
  /** True for effects that read as a flash and obey the flash toggle. */
  readonly flash: boolean;
  /** Simultaneous instances per quality level. */
  readonly maxAlive: Readonly<Record<QualityLevel, number>>;
  /** Particles one instance is worth, per quality level. */
  readonly particlesEach: Readonly<Record<QualityLevel, number>>;
  /** What it is for, so the catalogue is legible. */
  readonly notes: string;
}

function budgets(low: number, medium: number, high: number, cinematic: number) {
  return { low, medium, high, cinematic } as const;
}

const EFFECTS: readonly EffectDefinition[] = [
  {
    id: "sparks",
    displayName: "Sparks",
    paletteId: "style.fire",
    lifeSeconds: 0.7,
    sustained: false,
    flash: false,
    maxAlive: budgets(4, 6, 10, 14),
    particlesEach: budgets(12, 20, 36, 56),
    notes: "Metal on metal. The most common effect in any fight.",
  },
  {
    id: "plasma",
    displayName: "Plasma discharge",
    paletteId: "style.plasma",
    lifeSeconds: 0.5,
    sustained: false,
    flash: true,
    maxAlive: budgets(2, 3, 5, 7),
    particlesEach: budgets(16, 28, 48, 72),
    notes: "Energy weapons landing. Bright core, fast falloff.",
  },
  {
    id: "steam",
    displayName: "Steam",
    paletteId: "style.steel",
    lifeSeconds: 2.4,
    sustained: true,
    flash: false,
    maxAlive: budgets(2, 3, 5, 6),
    particlesEach: budgets(14, 22, 36, 50),
    notes: "Vents and breached cooling. Slow, soft, rises.",
  },
  {
    id: "coolant",
    displayName: "Coolant spray",
    paletteId: "style.sky-cool",
    lifeSeconds: 1.4,
    sustained: false,
    flash: false,
    maxAlive: budgets(1, 2, 3, 4),
    particlesEach: budgets(10, 18, 28, 40),
    notes: "A cut line under pressure. Reads as machine injury.",
  },
  {
    id: "kaiju-blue",
    displayName: "Kaiju blue",
    paletteId: "style.kaiju-blue",
    lifeSeconds: 1.8,
    sustained: false,
    flash: false,
    maxAlive: budgets(2, 3, 5, 7),
    particlesEach: budgets(14, 24, 40, 60),
    notes: "Creature blood. Luminous and toxic, and the one splash that lingers.",
  },
  {
    id: "rain-hit",
    displayName: "Rain interaction",
    paletteId: "style.sky-cool",
    lifeSeconds: 0.4,
    sustained: true,
    flash: false,
    maxAlive: budgets(1, 2, 3, 4),
    particlesEach: budgets(20, 34, 60, 90),
    notes: "Rain breaking on plate and shoulders. Only exists while it rains.",
  },
  {
    id: "water-displacement",
    displayName: "Water displacement",
    paletteId: "style.night-sea",
    lifeSeconds: 1.6,
    sustained: false,
    flash: false,
    maxAlive: budgets(2, 3, 4, 6),
    particlesEach: budgets(18, 30, 52, 80),
    notes: "A leg entering the sea. Mass made visible.",
  },
  {
    id: "dust",
    displayName: "Dust",
    paletteId: "style.steel-warm",
    lifeSeconds: 2.2,
    sustained: false,
    flash: false,
    maxAlive: budgets(3, 5, 8, 10),
    particlesEach: budgets(16, 26, 44, 64),
    notes: "Footfalls and near misses on dry ground.",
  },
  {
    id: "debris-burst",
    displayName: "Debris burst",
    paletteId: "style.steel-warm",
    lifeSeconds: 1.2,
    sustained: false,
    flash: false,
    maxAlive: budgets(2, 3, 5, 6),
    particlesEach: budgets(14, 24, 40, 56),
    notes: "Masonry leaving a building. The rigid bodies are elsewhere; this is the cloud.",
  },
  {
    id: "lightning",
    displayName: "Lightning",
    paletteId: "style.sky-cool",
    lifeSeconds: 0.3,
    sustained: false,
    flash: true,
    maxAlive: budgets(1, 1, 2, 2),
    particlesEach: budgets(6, 10, 16, 22),
    notes: "Storm strikes. A flash by definition, so the flash toggle owns it.",
  },
  {
    id: "muzzle-flash",
    displayName: "Muzzle flash",
    paletteId: "style.fire",
    lifeSeconds: 0.15,
    sustained: false,
    flash: true,
    maxAlive: budgets(2, 3, 4, 6),
    particlesEach: budgets(8, 12, 20, 28),
    notes: "Ballistic weapons firing. Short by design.",
  },
  {
    id: "finisher",
    displayName: "Finisher accents",
    paletteId: "style.warning-red",
    lifeSeconds: 2.6,
    sustained: false,
    flash: true,
    maxAlive: budgets(1, 1, 2, 2),
    particlesEach: budgets(24, 40, 70, 100),
    notes: "The one effect allowed to be theatrical, and only during a sequence.",
  },
  {
    id: "speed-lines",
    displayName: "Speed lines",
    paletteId: "style.ink",
    lifeSeconds: 0.35,
    sustained: false,
    flash: false,
    maxAlive: budgets(0, 1, 2, 2),
    particlesEach: budgets(0, 8, 14, 20),
    notes: "Dashes and heavy swings. Zero on Low, by the style guide.",
  },
];

export function validateEffect(entry: EffectDefinition): string[] {
  const errors: string[] = [];
  if (!EFFECT_KINDS.includes(entry.id)) errors.push(`unknown effect kind "${entry.id}"`);
  if (!entry.paletteId.startsWith("style.")) errors.push(`${entry.id}: colour must come from the palette`);
  if (entry.lifeSeconds <= 0 || entry.lifeSeconds > 6) errors.push(`${entry.id}: life must be plausible`);
  for (const level of ["low", "medium", "high", "cinematic"] as const) {
    if (entry.maxAlive[level] < 0) errors.push(`${entry.id}: maxAlive cannot be negative`);
    if (entry.particlesEach[level] < 0) errors.push(`${entry.id}: particles cannot be negative`);
    // Low is allowed to zero an effect out, but never to exceed a higher tier:
    // lowering quality removes detail, never adds it.
    if (level !== "cinematic" && entry.maxAlive[level] > entry.maxAlive.cinematic) {
      errors.push(`${entry.id}: ${level} allows more instances than cinematic`);
    }
  }
  if (entry.notes.trim().length < 8) errors.push(`${entry.id}: an effect must say what it is for`);
  return errors;
}

export function createEffectRegistry(): ContentRegistry<EffectDefinition> {
  const registry = new ContentRegistry<EffectDefinition>(validateEffect);
  for (const effect of EFFECTS) registry.register(effect);
  return registry;
}

export const EFFECT_DEFINITIONS = EFFECTS;

/** Total particle budget the catalogue can demand at once, per level. */
export function worstCaseParticles(level: QualityLevel): number {
  return EFFECTS.reduce((sum, effect) => sum + effect.maxAlive[level] * effect.particlesEach[level], 0);
}

/** One live effect, as the pool tracks it. */
export interface LiveEffect {
  readonly id: number;
  readonly kind: EffectKind;
  /** Seconds of life left. Sustained effects hold at their life until released. */
  secondsLeft: number;
}

export interface PoolCounters {
  readonly alive: number;
  readonly particlesInUse: number;
  readonly spawned: number;
  /** Requests refused because the kind was at its ceiling. Visible, not silent. */
  readonly refusedAtCeiling: number;
  /** Requests refused because effects are switched off entirely. */
  readonly refusedBySettings: number;
}

/**
 * The pool ledger.
 *
 * Deliberately just accounting: the renderer asks it whether an effect may
 * exist and tells it when one ends, and the ledger enforces the ceilings. Ids
 * are monotonic and never reused, so releasing twice is detectably a no-op
 * rather than quietly freeing somebody else's slot.
 */
export class EffectPoolLedger {
  private readonly registry: ContentRegistry<EffectDefinition>;
  private readonly level: QualityLevel;
  private readonly live = new Map<number, LiveEffect>();
  private readonly aliveByKind = new Map<EffectKind, number>();
  private nextId = 1;
  private spawned = 0;
  private refusedCeiling = 0;
  private refusedSettings = 0;
  /** Multiplier on every ceiling, from the particle accessibility setting. */
  private densityScale = 1;

  constructor(level: QualityLevel, registry: ContentRegistry<EffectDefinition> = createEffectRegistry()) {
    this.level = level;
    this.registry = registry;
  }

  /** The particle density setting, 0 to 1. Zero refuses everything. */
  setDensity(scale: number): void {
    this.densityScale = Math.max(0, Math.min(1, scale));
  }

  /**
   * Asks for an effect. Returns its id, or null with the refusal counted.
   *
   * A ceiling of zero at this quality level is an ordinary refusal too: Low has
   * no speed lines, and asking for one costs nothing and does nothing.
   */
  request(kind: EffectKind): number | null {
    const definition = this.registry.get(kind);
    if (!definition) return null;
    if (this.densityScale <= 0) {
      this.refusedSettings += 1;
      return null;
    }
    const ceiling = Math.floor(definition.maxAlive[this.level] * this.densityScale);
    const alive = this.aliveByKind.get(kind) ?? 0;
    if (alive >= ceiling) {
      this.refusedCeiling += 1;
      return null;
    }
    const id = this.nextId;
    this.nextId += 1;
    this.live.set(id, { id, kind, secondsLeft: definition.lifeSeconds });
    this.aliveByKind.set(kind, alive + 1);
    this.spawned += 1;
    return id;
  }

  /** Returns one effect's capacity. Exactly once, however often it is called. */
  release(id: number): boolean {
    const effect = this.live.get(id);
    if (!effect) return false;
    this.live.delete(id);
    this.aliveByKind.set(effect.kind, Math.max(0, (this.aliveByKind.get(effect.kind) ?? 1) - 1));
    return true;
  }

  /**
   * Ages every burst and releases the ones whose life ran out.
   *
   * Sustained effects do not age: they end when whatever they were attached to
   * ends, which is a release by name rather than by clock.
   */
  advance(deltaSeconds: number): readonly number[] {
    const ended: number[] = [];
    for (const effect of this.live.values()) {
      const definition = this.registry.get(effect.kind);
      if (definition?.sustained) continue;
      effect.secondsLeft -= deltaSeconds;
      if (effect.secondsLeft <= 0) ended.push(effect.id);
    }
    for (const id of ended) this.release(id);
    return ended;
  }

  aliveOf(kind: EffectKind): number {
    return this.aliveByKind.get(kind) ?? 0;
  }

  counters(): PoolCounters {
    let particles = 0;
    for (const effect of this.live.values()) {
      particles += this.registry.get(effect.kind)?.particlesEach[this.level] ?? 0;
    }
    return {
      alive: this.live.size,
      particlesInUse: particles,
      spawned: this.spawned,
      refusedAtCeiling: this.refusedCeiling,
      refusedBySettings: this.refusedSettings,
    };
  }

  /** True when nothing is alive and no capacity is missing. The baseline. */
  atBaseline(): boolean {
    if (this.live.size !== 0) return false;
    for (const count of this.aliveByKind.values()) {
      if (count !== 0) return false;
    }
    return true;
  }
}
