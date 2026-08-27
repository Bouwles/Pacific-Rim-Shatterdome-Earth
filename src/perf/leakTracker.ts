/**
 * What a scene transition leaves behind, counted.
 *
 * The claim disposal code makes everywhere in this project is "everything I
 * made, I released". This is where the claim is audited: a snapshot of every
 * countable resource before a transition, another after, and a diff whose
 * non-zero rows are named. Repeated combat entry and exit must diff to zero,
 * and the browser test holds exactly that.
 *
 * The inventory is a plain record of numbers, and the taking of it is
 * injected: the bootstrap counts Babylon meshes, materials, textures and
 * observers, the audio layer counts its nodes, the worker registry counts
 * workers, and a test counts whatever it likes. The tracker itself never
 * touches a scene, which is what keeps the diff logic testable headless.
 */

export type ResourceInventory = Readonly<Record<string, number>>;

export interface InventoryDiff {
  /** Resource name to growth. Only non-zero rows are listed. */
  readonly grown: Readonly<Record<string, number>>;
  /** True when nothing grew. Shrinking is allowed: caches may empty. */
  readonly clean: boolean;
  /** In words, for the panel and the test failure message. */
  readonly summary: string;
}

/** Compares two inventories. Growth is a leak candidate; shrinkage is not. */
export function diffInventories(before: ResourceInventory, after: ResourceInventory): InventoryDiff {
  const grown: Record<string, number> = {};
  for (const [name, count] of Object.entries(after)) {
    const was = before[name] ?? 0;
    if (count > was) grown[name] = count - was;
  }
  const names = Object.keys(grown);
  return {
    grown,
    clean: names.length === 0,
    summary:
      names.length === 0
        ? "Clean: nothing grew."
        : `Grew: ${names.map((name) => `${name} +${grown[name]}`).join(", ")}.`,
  };
}

/**
 * Tracks a baseline and audits against it.
 *
 * The baseline is taken at a known-quiet moment, and `audit()` is called at
 * the next quiet moment of the same kind: menu to menu, world to world. An
 * audit taken mid-fight would count the fight itself and mean nothing, so the
 * caller chooses the moments and this only does the arithmetic.
 */
export class LeakTracker {
  private readonly takeInventory: () => ResourceInventory;
  private baseline: ResourceInventory | null = null;
  private lastDiff: InventoryDiff | null = null;
  private cycles = 0;

  constructor(takeInventory: () => ResourceInventory) {
    this.takeInventory = takeInventory;
  }

  /** Records the quiet state everything after is measured against. */
  setBaseline(): ResourceInventory {
    this.baseline = this.takeInventory();
    this.cycles = 0;
    this.lastDiff = null;
    return this.baseline;
  }

  /** Compares now against the baseline. One transition cycle audited. */
  audit(): InventoryDiff {
    const current = this.takeInventory();
    const diff = this.baseline ? diffInventories(this.baseline, current) : diffInventories(current, current);
    this.cycles += 1;
    this.lastDiff = diff;
    return diff;
  }

  view(): {
    readonly hasBaseline: boolean;
    readonly cycles: number;
    readonly last: InventoryDiff | null;
  } {
    return { hasBaseline: this.baseline !== null, cycles: this.cycles, last: this.lastDiff };
  }
}
