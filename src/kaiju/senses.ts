import { createSeededRng, hashStringToSeed } from "../simulation/rng";

/**
 * What a creature knows, and how it came to know it.
 *
 * Seven channels, each with its own reach, its own decay and its own idea of
 * what blocks it. A creature does not have a list of enemies: it has contacts,
 * each of which is a guess about where something was, how confident it is, and
 * which sense produced it. That is the difference between a thing that hunts
 * and a thing that homes.
 *
 * All of it is plain data on a fixed tick. No Babylon, no DOM, no wall clock,
 * and no randomness that is not drawn from a named seeded stream.
 */

export const SENSE_KINDS = [
  "sight",
  "sound",
  "vibration",
  "scent",
  "threat",
  "objective",
  "damage-memory",
] as const;
export type SenseKind = (typeof SENSE_KINDS)[number];

/** Something in the world a sense can pick up. */
export interface SenseStimulus {
  /** Stable id of whatever produced it: a machine, a building, a defence line. */
  readonly sourceId: string;
  readonly east: number;
  readonly north: number;
  /** How loud, bright, heavy or interesting it is. Unitless, above zero. */
  readonly strength: number;
  readonly kind: SenseKind;
  /** True when line of sight is broken. Only sight and threat care. */
  readonly occluded?: boolean;
  /** True when the source is in water, which carries sound and hides scent. */
  readonly inWater?: boolean;
}

export interface SenseProfile {
  readonly kind: SenseKind;
  /** Metres at which a stimulus of strength one is still detectable. */
  readonly rangeMeters: number;
  /** How fast confidence falls per second once nothing is refreshing it. */
  readonly decayPerSecond: number;
  /**
   * Cone in degrees either side of facing. 180 means the sense works all the
   * way round, which is what makes vibration different from sight.
   */
  readonly arcDeg: number;
  /** Multiplier when the source is behind cover. Sight is near blind; sound is not. */
  readonly occlusionScale: number;
  /** Multiplier when the source is in water. */
  readonly waterScale: number;
}

/** One thing a creature currently believes is out there. */
export interface SenseContact {
  readonly sourceId: string;
  /** Where it was last sensed, not where it is. */
  east: number;
  north: number;
  /** 0 to 1. How sure the creature is. Decays without refreshment. */
  confidence: number;
  /** Which sense last refreshed it. */
  kind: SenseKind;
  /** Seconds since it was last refreshed. */
  ageSeconds: number;
  /** Total damage this source has done. Feeds threat and damage memory. */
  damageDealt: number;
}

export interface SensorySnapshot {
  readonly contacts: readonly SenseContact[];
  /** The strongest contact, or null when the creature has lost everything. */
  readonly best: SenseContact | null;
  /** True when anything at all is being sensed right now. */
  readonly aware: boolean;
}

/** How long a contact survives with no refreshment at all, seconds. */
export const CONTACT_MEMORY_SECONDS = 45;
/** Below this, a contact is forgotten. */
const FORGET_BELOW = 0.02;

/**
 * A creature's senses.
 *
 * Owns its contacts and nothing else. Every profile is injected from the
 * creature's own definition, so a blind burrower and a sharp-eyed flier run the
 * same code with different numbers.
 */
export class SenseSystem {
  private readonly profiles = new Map<SenseKind, SenseProfile>();
  private readonly contactsById = new Map<string, SenseContact>();
  private readonly jitter: () => number;

  constructor(profiles: readonly SenseProfile[], seed = 0) {
    for (const profile of profiles) this.profiles.set(profile.kind, profile);
    // Seeded, so two identical creatures on the same seed guess identically.
    this.jitter = createSeededRng(hashStringToSeed("senses") ^ (seed | 0));
  }

  profileFor(kind: SenseKind): SenseProfile | undefined {
    return this.profiles.get(kind);
  }

  contacts(): readonly SenseContact[] {
    return [...this.contactsById.values()];
  }

  contact(sourceId: string): SenseContact | undefined {
    return this.contactsById.get(sourceId);
  }

  /**
   * Takes in what is happening and updates what the creature believes.
   *
   * A stimulus only lands if the sense that would pick it up exists, is pointed
   * the right way, and is not defeated by cover or water. The resulting
   * confidence is what everything downstream reads: a creature acts on its
   * contacts, never on the truth.
   */
  perceive(
    stimuli: readonly SenseStimulus[],
    self: { readonly east: number; readonly north: number; readonly headingDeg: number },
    deltaSeconds: number,
  ): SensorySnapshot {
    for (const stimulus of stimuli) {
      const profile = this.profiles.get(stimulus.kind);
      if (!profile) continue;

      const distance = Math.hypot(stimulus.east - self.east, stimulus.north - self.north);
      const reach = profile.rangeMeters * Math.max(0.1, stimulus.strength);
      if (distance > reach) continue;

      if (profile.arcDeg < 180) {
        const bearing = (Math.atan2(stimulus.east - self.east, stimulus.north - self.north) * 180) / Math.PI;
        const offset = Math.abs(normalize180(bearing - self.headingDeg));
        if (offset > profile.arcDeg) continue;
      }

      let strength = 1 - distance / Math.max(1, reach);
      if (stimulus.occluded === true) strength *= profile.occlusionScale;
      if (stimulus.inWater === true) strength *= profile.waterScale;
      if (strength <= 0) continue;

      const existing = this.contactsById.get(stimulus.sourceId);
      // A guess, not a fix: a sound tells you roughly where, and the error is
      // seeded so the same creature always guesses the same way.
      const error = (1 - strength) * (profile.kind === "sight" ? 4 : 60);
      const east = stimulus.east + (this.jitter() - 0.5) * error;
      const north = stimulus.north + (this.jitter() - 0.5) * error;

      if (existing) {
        // The sharper sense wins the position, and confidence takes the best.
        if (strength >= existing.confidence) {
          existing.east = east;
          existing.north = north;
          existing.kind = stimulus.kind;
        }
        existing.confidence = Math.min(1, Math.max(existing.confidence, strength));
        existing.ageSeconds = 0;
      } else {
        this.contactsById.set(stimulus.sourceId, {
          sourceId: stimulus.sourceId,
          east,
          north,
          confidence: Math.min(1, strength),
          kind: stimulus.kind,
          ageSeconds: 0,
          damageDealt: 0,
        });
      }
    }

    // Everything fades. A creature that was hit and lost the thing that hit it
    // keeps looking where it last was, and eventually stops.
    for (const [id, contact] of [...this.contactsById.entries()]) {
      if (contact.ageSeconds > 0 || deltaSeconds > 0) {
        const profile = this.profiles.get(contact.kind);
        const decay = profile?.decayPerSecond ?? 0.2;
        if (contact.ageSeconds > 0) contact.confidence -= decay * deltaSeconds;
      }
      contact.ageSeconds += deltaSeconds;
      if (contact.ageSeconds > CONTACT_MEMORY_SECONDS || contact.confidence <= FORGET_BELOW) {
        this.contactsById.delete(id);
      }
    }

    return this.snapshot();
  }

  /**
   * Records that something hurt this creature.
   *
   * Damage memory is its own sense: a creature that has been hit knows roughly
   * where the blow came from even if it never saw it, and holds a grudge that
   * outlasts the contact that caused it.
   */
  remember(sourceId: string, east: number, north: number, damage: number): void {
    const existing = this.contactsById.get(sourceId);
    if (existing) {
      existing.damageDealt += damage;
      existing.confidence = Math.min(1, existing.confidence + 0.35);
      existing.ageSeconds = 0;
      existing.east = east;
      existing.north = north;
      return;
    }
    this.contactsById.set(sourceId, {
      sourceId,
      east,
      north,
      confidence: 0.8,
      kind: "damage-memory",
      ageSeconds: 0,
      damageDealt: damage,
    });
  }

  /** Forgets one source outright. Used when it is destroyed or leaves. */
  forget(sourceId: string): void {
    this.contactsById.delete(sourceId);
  }

  clear(): void {
    this.contactsById.clear();
  }

  snapshot(): SensorySnapshot {
    const contacts = this.contacts();
    let best: SenseContact | null = null;
    for (const contact of contacts) {
      if (!best || contact.confidence > best.confidence) best = contact;
    }
    return { contacts, best, aware: contacts.some((contact) => contact.confidence > 0.15) };
  }
}

function normalize180(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

/**
 * A sensible default set of senses.
 *
 * Every creature definition may override any of them; this is what a creature
 * that says nothing gets, and it is deliberately not equally good at
 * everything.
 */
export const DEFAULT_SENSES: readonly SenseProfile[] = [
  {
    kind: "sight",
    rangeMeters: 900,
    decayPerSecond: 0.35,
    arcDeg: 70,
    occlusionScale: 0.05,
    waterScale: 0.4,
  },
  {
    kind: "sound",
    rangeMeters: 1_400,
    decayPerSecond: 0.2,
    arcDeg: 180,
    occlusionScale: 0.6,
    waterScale: 1.3,
  },
  {
    kind: "vibration",
    rangeMeters: 700,
    decayPerSecond: 0.25,
    arcDeg: 180,
    occlusionScale: 0.9,
    waterScale: 0.5,
  },
  {
    kind: "scent",
    rangeMeters: 1_100,
    decayPerSecond: 0.08,
    arcDeg: 180,
    occlusionScale: 0.8,
    waterScale: 0.2,
  },
  {
    kind: "threat",
    rangeMeters: 1_000,
    decayPerSecond: 0.15,
    arcDeg: 180,
    occlusionScale: 0.5,
    waterScale: 1,
  },
  {
    kind: "objective",
    rangeMeters: 6_000,
    decayPerSecond: 0.01,
    arcDeg: 180,
    occlusionScale: 1,
    waterScale: 1,
  },
  {
    kind: "damage-memory",
    rangeMeters: 4_000,
    decayPerSecond: 0.05,
    arcDeg: 180,
    occlusionScale: 1,
    waterScale: 1,
  },
];

export function validateSenseProfile(profile: SenseProfile): string[] {
  const errors: string[] = [];
  if (!SENSE_KINDS.includes(profile.kind)) errors.push(`unknown sense "${String(profile.kind)}"`);
  if (!Number.isFinite(profile.rangeMeters) || profile.rangeMeters <= 0) {
    errors.push(`${profile.kind}.rangeMeters must be above zero`);
  }
  if (!Number.isFinite(profile.decayPerSecond) || profile.decayPerSecond < 0) {
    errors.push(`${profile.kind}.decayPerSecond must be zero or more`);
  }
  if (profile.arcDeg <= 0 || profile.arcDeg > 180) {
    errors.push(`${profile.kind}.arcDeg must be within (0, 180]`);
  }
  for (const key of ["occlusionScale", "waterScale"] as const) {
    if (!Number.isFinite(profile[key]) || profile[key] < 0) {
      errors.push(`${profile.kind}.${key} must be zero or more`);
    }
  }
  return errors;
}
