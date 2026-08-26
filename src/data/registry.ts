export interface RegistryEntry {
  readonly id: string;
}

/**
 * Typed content table. This is the pattern every Jaeger/kaiju/weapon/facility/etc.
 * data set must use instead of name-keyed switch statements (GAME_SPEC.md → Architectural Modules).
 */
export class ContentRegistry<T extends RegistryEntry> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly validate: (entry: T) => string[] = () => []) {}

  register(entry: T): void {
    const errors = this.validate(entry);
    if (errors.length > 0) {
      throw new Error(`Invalid registry entry "${entry.id}": ${errors.join("; ")}`);
    }
    if (this.entries.has(entry.id)) {
      throw new Error(`Duplicate registry id "${entry.id}"`);
    }
    this.entries.set(entry.id, entry);
  }

  /**
   * Replaces an entry, or adds it if it is not there.
   *
   * For definitions authored at runtime rather than shipped: the custom Jaeger
   * is assembled from a blueprint and its definition changes whenever the
   * blueprint does. Everything shipped goes through `register`, which still
   * refuses a duplicate, so this cannot be used to quietly overwrite content.
   */
  replace(entry: T): void {
    const errors = this.validate(entry);
    if (errors.length > 0) {
      throw new Error(`Invalid registry entry "${entry.id}": ${errors.join("; ")}`);
    }
    this.entries.set(entry.id, entry);
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  getOrThrow(id: string): T {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown registry id "${id}"`);
    return entry;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  all(): readonly T[] {
    return Array.from(this.entries.values());
  }
}
