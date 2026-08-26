import { ContentRegistry } from "../data/registry";
import { PART_SLOTS, createPartRegistry, type PartDefinition, type PartSlot } from "../data/parts";
import { BLUEPRINT_SCHEMA_VERSION, assemble, emptyBlueprint, type Blueprint } from "./blueprint";

/**
 * Saved blueprints, and the rule that there is only ever one custom machine.
 *
 * Blueprints are free: keep as many as you like, rename them, export one and
 * import somebody else's. **Building** is not free. A campaign carries one
 * active custom serial, and the only way to get another is to break the one you
 * have, which is a decision with a cost rather than a menu with a list.
 *
 * The sandbox is the exception, and it is an explicit one rather than a leak: a
 * sandbox library has no build limit at all, because nothing there is a
 * campaign. The limit is a property of the library, so no caller can forget it.
 *
 * Authoritative, serialisable, and free of Babylon, the DOM and the clock.
 */

export const LIBRARY_SCHEMA_VERSION = 1;

/** How many custom machines may exist at once in a campaign. */
export const CAMPAIGN_BUILD_LIMIT = 1;

export interface BuiltRecord {
  /** Blueprint that was built. */
  readonly blueprintId: string;
  /** The serial on the hull. Stable, and never reused. */
  readonly serial: string;
  /** Day it was assembled. */
  readonly day: number;
  /** Name at the time it was built, which renaming the blueprint cannot change. */
  readonly name: string;
}

export interface LibrarySnapshot {
  readonly schemaVersion: number;
  readonly blueprints: readonly Blueprint[];
  readonly built: readonly BuiltRecord[];
  /** Serials already handed out, so a rebuild never reuses one. */
  readonly serialCounter: number;
  readonly sandbox: boolean;
}

export function emptyLibrarySnapshot(): LibrarySnapshot {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    blueprints: [],
    built: [],
    serialCounter: 0,
    sandbox: false,
  };
}

export function validateLibrarySnapshot(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["library snapshot must be an object"];
  const snapshot = value as Record<string, unknown>;
  if (snapshot["schemaVersion"] !== LIBRARY_SCHEMA_VERSION) {
    return [`library schemaVersion must be ${LIBRARY_SCHEMA_VERSION}`];
  }
  const errors: string[] = [];
  if (!Array.isArray(snapshot["blueprints"])) errors.push("library.blueprints must be an array");
  if (!Array.isArray(snapshot["built"])) errors.push("library.built must be an array");
  if (typeof snapshot["serialCounter"] !== "number") errors.push("library.serialCounter must be a number");
  if (typeof snapshot["sandbox"] !== "boolean") errors.push("library.sandbox must be a boolean");
  return errors;
}

export interface LibraryResult {
  readonly ok: boolean;
  readonly message: string;
}

/** What one blueprint looks like next to a machine already owned. */
export interface Comparison {
  readonly label: string;
  /** The custom build's figure. */
  readonly build: number;
  /** The owned machine's figure. */
  readonly owned: number;
  /** True when higher is better, so a panel can colour it without knowing. */
  readonly higherIsBetter: boolean;
}

export class BlueprintLibrary {
  private readonly parts: ContentRegistry<PartDefinition>;
  private readonly blueprintList: Blueprint[] = [];
  private readonly builtList: BuiltRecord[] = [];
  private serialCounter = 0;
  private sandboxValue: boolean;

  constructor(
    options: { readonly parts?: ContentRegistry<PartDefinition>; readonly sandbox?: boolean } = {},
  ) {
    this.parts = options.parts ?? createPartRegistry();
    this.sandboxValue = options.sandbox ?? false;
  }

  get sandbox(): boolean {
    return this.sandboxValue;
  }

  /** How many custom machines this library will allow. Unlimited in sandbox. */
  get buildLimit(): number {
    return this.sandboxValue ? Number.POSITIVE_INFINITY : CAMPAIGN_BUILD_LIMIT;
  }

  blueprints(): readonly Blueprint[] {
    return [...this.blueprintList];
  }

  built(): readonly BuiltRecord[] {
    return [...this.builtList];
  }

  get(id: string): Blueprint | undefined {
    return this.blueprintList.find((entry) => entry.id === id);
  }

  /** Files a blueprint, replacing one with the same id rather than duplicating. */
  save(blueprint: Blueprint): LibraryResult {
    const name = blueprint.name.trim();
    if (name.length === 0) return { ok: false, message: "A blueprint needs a name." };
    if (name.length > 40) return { ok: false, message: "That name is too long for a hull." };

    const clean: Blueprint = { ...blueprint, name };
    const index = this.blueprintList.findIndex((entry) => entry.id === blueprint.id);
    if (index >= 0) {
      this.blueprintList[index] = clean;
      return { ok: true, message: `${name} updated.` };
    }
    this.blueprintList.push(clean);
    return { ok: true, message: `${name} filed.` };
  }

  /**
   * Renames a blueprint.
   *
   * Deliberately does not touch a machine already built from it: the serial on
   * the hull was stamped when it was assembled, and renaming a drawing does not
   * repaint a machine that is already standing in the bay.
   */
  rename(id: string, name: string): LibraryResult {
    const blueprint = this.get(id);
    if (!blueprint) return { ok: false, message: "No such blueprint." };
    return this.save({ ...blueprint, name });
  }

  /** Changes paint, markings or emblem without touching anything structural. */
  recolour(
    id: string,
    cosmetics: {
      readonly paint?: string;
      readonly markings?: string;
      readonly emblem?: string;
      readonly emblemText?: string;
    },
  ): LibraryResult {
    const blueprint = this.get(id);
    if (!blueprint) return { ok: false, message: "No such blueprint." };
    const next: Record<PartSlot, readonly string[]> = { ...blueprint.parts };
    for (const [slot, chosen] of [
      ["paint", cosmetics.paint],
      ["markings", cosmetics.markings],
      ["emblem", cosmetics.emblem],
    ] as const) {
      if (chosen === undefined) continue;
      const part = this.parts.get(chosen);
      if (!part || part.slot !== slot) return { ok: false, message: `${chosen} is not a ${slot}.` };
      next[slot] = [chosen];
    }
    return this.save({
      ...blueprint,
      parts: next,
      emblemText: cosmetics.emblemText ?? blueprint.emblemText,
    });
  }

  remove(id: string): LibraryResult {
    const index = this.blueprintList.findIndex((entry) => entry.id === id);
    if (index < 0) return { ok: false, message: "No such blueprint." };
    if (this.builtList.some((record) => record.blueprintId === id)) {
      return { ok: false, message: "Something was built from that. Scrap the machine first." };
    }
    this.blueprintList.splice(index, 1);
    return { ok: true, message: "Blueprint discarded." };
  }

  /**
   * Whether a blueprint can be built, and if not, why.
   *
   * Two separate refusals on purpose: an illegal build is a design problem, and
   * a limit reached is a fleet problem. Collapsing them would tell a player to
   * fix a build that is already fine.
   */
  buildRefusal(id: string): string | null {
    const blueprint = this.get(id);
    if (!blueprint) return "No such blueprint.";
    const result = assemble(blueprint, this.parts);
    if (!result.legal) {
      const count = result.issues.filter((issue) => issue.severity === "violation").length;
      return `${count} constraint${count === 1 ? "" : "s"} not met. Fix the build first.`;
    }
    if (this.builtList.length >= this.buildLimit) {
      return "A custom machine already exists. Scrap it before building another.";
    }
    return null;
  }

  /**
   * Builds one.
   *
   * The serial counter only ever goes up, so scrapping and rebuilding produces
   * a different machine rather than the same one back.
   */
  build(id: string, day: number): { readonly result: LibraryResult; readonly record: BuiltRecord | null } {
    const refusal = this.buildRefusal(id);
    if (refusal) return { result: { ok: false, message: refusal }, record: null };
    const blueprint = this.get(id)!;

    this.serialCounter += 1;
    const record: BuiltRecord = {
      blueprintId: id,
      serial: `CUSTOM-${String(this.serialCounter).padStart(3, "0")}`,
      day,
      name: blueprint.name,
    };
    this.builtList.push(record);
    return { result: { ok: true, message: `${record.name} assembled as ${record.serial}.` }, record };
  }

  /** Scraps a built machine, freeing the campaign's one slot. */
  scrap(serial: string): LibraryResult {
    const index = this.builtList.findIndex((record) => record.serial === serial);
    if (index < 0) return { ok: false, message: "No such machine." };
    const [record] = this.builtList.splice(index, 1);
    return { ok: true, message: `${record!.name} broken up. The serial is not reused.` };
  }

  /**
   * Exports one blueprint as text.
   *
   * Deliberately just the design: no serial, no build record, no campaign. An
   * imported blueprint is a drawing somebody sent you, and importing it can
   * never hand you a machine.
   */
  export(id: string): string | null {
    const blueprint = this.get(id);
    if (!blueprint) return null;
    return JSON.stringify({ schemaVersion: BLUEPRINT_SCHEMA_VERSION, blueprint }, null, 2);
  }

  /**
   * Imports a blueprint from text.
   *
   * Given a fresh id, so importing the same drawing twice gives two drawings
   * rather than overwriting one, and never a machine.
   */
  import(text: string, id: string): LibraryResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: "That is not a blueprint file." };
    }
    if (typeof parsed !== "object" || parsed === null)
      return { ok: false, message: "That is not a blueprint file." };
    const wrapper = parsed as Record<string, unknown>;
    if (wrapper["schemaVersion"] !== BLUEPRINT_SCHEMA_VERSION) {
      return { ok: false, message: "That blueprint was written by a different version." };
    }
    const incoming = wrapper["blueprint"];
    const cleaned = sanitiseBlueprint(incoming, id, this.parts);
    if (!cleaned) return { ok: false, message: "That blueprint is missing parts this build does not have." };
    return this.save(cleaned);
  }

  snapshot(): LibrarySnapshot {
    return {
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      blueprints: this.blueprintList.map((entry) => ({ ...entry, parts: { ...entry.parts } })),
      built: this.builtList.map((entry) => ({ ...entry })),
      serialCounter: this.serialCounter,
      sandbox: this.sandboxValue,
    };
  }

  /**
   * Puts a saved library back.
   *
   * A blueprint naming a part this build no longer has is kept rather than
   * dropped, with the missing part removed: the design is the player's work and
   * losing all of it because one part was retired would be worse than showing
   * them a build that now needs a new arm. It will simply fail validation and
   * say so.
   */
  restore(snapshot: LibrarySnapshot): void {
    this.blueprintList.length = 0;
    this.builtList.length = 0;
    this.serialCounter = Math.max(0, Math.round(snapshot.serialCounter));
    this.sandboxValue = snapshot.sandbox === true;

    for (const entry of snapshot.blueprints) {
      const cleaned = sanitiseBlueprint(entry, entry?.id ?? "blueprint.recovered", this.parts);
      if (cleaned) this.blueprintList.push(cleaned);
    }
    for (const record of snapshot.built) {
      if (!record || typeof record.serial !== "string") continue;
      if (!this.blueprintList.some((entry) => entry.id === record.blueprintId)) continue;
      this.builtList.push({ ...record });
    }
    // A save that somehow carries more machines than the rules allow keeps the
    // oldest, rather than being refused outright.
    if (this.builtList.length > this.buildLimit) this.builtList.length = this.buildLimit;
  }
}

/** Strips anything a blueprint should not contain, or returns null if it cannot. */
function sanitiseBlueprint(
  value: unknown,
  id: string,
  parts: ContentRegistry<PartDefinition>,
): Blueprint | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const incoming = record["parts"];
  if (typeof incoming !== "object" || incoming === null) return null;

  const base = emptyBlueprint(id);
  const chosen: Record<PartSlot, readonly string[]> = { ...base.parts };
  for (const slot of PART_SLOTS) {
    const ids = (incoming as Record<string, unknown>)[slot];
    if (!Array.isArray(ids)) continue;
    chosen[slot] = ids.filter(
      (entry): entry is string => typeof entry === "string" && parts.get(entry)?.slot === slot,
    );
  }

  const name = typeof record["name"] === "string" ? record["name"].trim().slice(0, 40) : "";
  const emblemText = typeof record["emblemText"] === "string" ? record["emblemText"].slice(0, 24) : "";
  return { id, name: name.length > 0 ? name : "Imported", parts: chosen, emblemText };
}

/**
 * Puts a build next to a machine already owned.
 *
 * Deliberately several axes rather than one score. A custom build that is worse
 * on every line is a bad build, and a player has to be able to see which line
 * they traded away rather than a single number going down.
 */
export function compareToOwned(
  stats: {
    readonly massTons: number;
    readonly armorRating: number;
    readonly mobilityScale: number;
    readonly structure: number;
    readonly balance: number;
  },
  owned: {
    readonly massTons: number;
    readonly armour: number;
    readonly mobility: number;
    readonly structure: number;
  },
): readonly Comparison[] {
  return [
    { label: "Mass", build: stats.massTons, owned: owned.massTons, higherIsBetter: false },
    { label: "Armour", build: stats.armorRating, owned: owned.armour, higherIsBetter: true },
    { label: "Structure", build: stats.structure, owned: owned.structure, higherIsBetter: true },
    { label: "Mobility", build: stats.mobilityScale, owned: owned.mobility, higherIsBetter: true },
    // Nothing already owned has a balance figure, because nothing else was
    // assembled. Shown against the neutral one so the axis is not hidden.
    { label: "Balance", build: stats.balance, owned: 1, higherIsBetter: true },
  ];
}
