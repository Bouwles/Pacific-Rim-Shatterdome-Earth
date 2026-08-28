/**
 * The encounter director.
 *
 * A fight is not a health bar going down. It is an opening, a spacing
 * phase, the creature's signature, something in the city giving way, a
 * rage, a break, a finish and an aftermath. This reads the arena each tick
 * and decides which of those the fight is in, and what that phase owes the
 * player: an objective line, a warning, a radio call, a music cue, an
 * environmental event.
 *
 * Deterministic and pure: the same inputs in the same order produce the
 * same phases, so it can be tested without a browser and replayed from a
 * save. It never changes the fight; it only names what the fight is doing
 * and asks other systems to react.
 */

export type EncounterPhase =
  | "approach"
  | "opening"
  | "spacing"
  | "signature"
  | "disruption"
  | "enrage"
  | "break"
  | "finisher"
  | "aftermath"
  | "lost";

export interface EncounterInput {
  readonly elapsedSeconds: number;
  readonly distanceMeters: number;
  /** 0 to 1 of the creature's structure left. */
  readonly creatureHealth: number;
  /** 0 to 1 of the creature's poise left; 0 is a break. */
  readonly creaturePoise: number;
  readonly creatureDefeated: boolean;
  readonly creatureAbilityUsed: boolean;
  readonly machineHealth: number;
  readonly machineDefeated: boolean;
  readonly finisherActive: boolean;
  readonly openingWindow: boolean;
}

export interface EncounterCue {
  readonly phase: EncounterPhase;
  readonly objective: string;
  readonly warning: string | null;
  readonly radioLineId: string | null;
  readonly bossPhase: boolean;
  /** Something in the district gives way: lightning, power, a collapse. */
  readonly disruption: boolean;
  readonly prompt: string | null;
}

const CUES: Readonly<Record<EncounterPhase, Omit<EncounterCue, "phase">>> = {
  approach: {
    objective: "Advance to contact. The creature is inland of the shoreline.",
    warning: null,
    radioLineId: "radio.contact.inbound",
    bossPhase: false,
    disruption: false,
    prompt: "[W] drive forward. [Shift] run. Mouse to look.",
  },
  opening: {
    objective: "Engage. Read its first move before you commit.",
    warning: "Contact",
    radioLineId: null,
    bossPhase: false,
    disruption: false,
    prompt: "[1] jab, [2] cross, [3] heavy. [F] guard.",
  },
  spacing: {
    objective: "Hold your spacing. Guard the lunge, punish the recovery.",
    warning: null,
    radioLineId: null,
    bossPhase: false,
    disruption: false,
    prompt: "[Space] booster evade.",
  },
  signature: {
    objective: "It is showing its signature. Get out of the line.",
    warning: "Signature ability",
    radioLineId: "radio.phase.shift",
    bossPhase: false,
    disruption: false,
    prompt: null,
  },
  disruption: {
    objective: "Power is failing across the district. Fight by the fires.",
    warning: "District power failing",
    radioLineId: "radio.civilians.in.path",
    bossPhase: false,
    disruption: true,
    prompt: null,
  },
  enrage: {
    objective: "It is hurt and it is angry. Do not trade; break its posture.",
    warning: "Enraged",
    radioLineId: "radio.phase.shift",
    bossPhase: true,
    disruption: false,
    prompt: "[4] launcher, [5] shoulder to build posture damage.",
  },
  break: {
    objective: "Posture broken. Finish it.",
    warning: "Opening",
    radioLineId: "radio.weak.point",
    bossPhase: true,
    disruption: false,
    prompt: "[6] finisher while the opening holds.",
  },
  finisher: {
    objective: "Finish it.",
    warning: null,
    radioLineId: null,
    bossPhase: true,
    disruption: false,
    prompt: null,
  },
  aftermath: {
    objective: "Creature down. Hold position; recovery is inbound.",
    warning: null,
    radioLineId: "radio.victory",
    bossPhase: false,
    disruption: false,
    prompt: null,
  },
  lost: {
    objective: "Machine down. LOCCENT is pulling you out.",
    warning: "Machine down",
    radioLineId: "radio.loss",
    bossPhase: false,
    disruption: false,
    prompt: null,
  },
};

const CONTACT_METERS = 220;
const OPENING_SECONDS = 14;
const SIGNATURE_HEALTH = 0.82;
const SIGNATURE_LATEST_SECONDS = 40;
const DISRUPTION_HEALTH = 0.62;
const ENRAGE_HEALTH = 0.42;

export class EncounterDirector {
  private phase: EncounterPhase = "approach";
  private contactAt: number | null = null;
  private signatureAt: number | null = null;
  private disruptionAt: number | null = null;
  private readonly visited = new Set<EncounterPhase>(["approach"]);

  get current(): EncounterPhase {
    return this.phase;
  }

  /** Phases entered so far, in order of first entry. */
  get history(): readonly EncounterPhase[] {
    return [...this.visited];
  }

  /** Advances the director. Returns the cue when the phase changed, otherwise null. */
  advance(input: EncounterInput): EncounterCue | null {
    const next = this.decide(input);
    if (next === this.phase) return null;
    this.phase = next;
    this.visited.add(next);
    if (next === "signature") this.signatureAt = input.elapsedSeconds;
    if (next === "disruption") this.disruptionAt = input.elapsedSeconds;
    return { phase: next, ...CUES[next] };
  }

  /** The cue for the current phase, for a HUD drawing it fresh. */
  cue(): EncounterCue {
    return { phase: this.phase, ...CUES[this.phase] };
  }

  private decide(input: EncounterInput): EncounterPhase {
    if (input.machineDefeated) return "lost";
    if (input.creatureDefeated) return "aftermath";
    if (input.finisherActive) return "finisher";
    if (this.contactAt === null && input.distanceMeters <= CONTACT_METERS)
      this.contactAt = input.elapsedSeconds;
    if (this.contactAt === null) return "approach";
    const sinceContact = input.elapsedSeconds - this.contactAt;

    // The break is an interruption of whatever phase is running, and ends when the window closes.
    if (input.openingWindow || (input.creaturePoise <= 0.05 && input.creatureHealth < SIGNATURE_HEALTH))
      return "break";
    if (this.phase === "break") {
      return input.creatureHealth < ENRAGE_HEALTH
        ? "enrage"
        : input.creatureHealth < DISRUPTION_HEALTH
          ? "disruption"
          : "spacing";
    }

    if (input.creatureHealth < ENRAGE_HEALTH) return "enrage";
    if (input.creatureHealth < DISRUPTION_HEALTH || this.disruptionAt !== null) {
      // The disruption is a moment, not a state: eight seconds, then back to the fight.
      if (this.disruptionAt === null) return "disruption";
      return input.elapsedSeconds - this.disruptionAt < 8 ? "disruption" : "spacing";
    }
    const signatureDue =
      input.creatureAbilityUsed ||
      input.creatureHealth < SIGNATURE_HEALTH ||
      sinceContact > SIGNATURE_LATEST_SECONDS;
    if (signatureDue || this.signatureAt !== null) {
      if (this.signatureAt === null) return "signature";
      return input.elapsedSeconds - this.signatureAt < 10 ? "signature" : "spacing";
    }
    return sinceContact < OPENING_SECONDS ? "opening" : "spacing";
  }
}

/** Letter grade from the things a sortie is judged on. Pure, for the results screen and tests. */
export function gradeSortie(input: {
  readonly outcome: "success" | "partial" | "failure" | "aborted" | "lost-contact";
  readonly objectiveScore: number;
  readonly cityImpact: number;
  readonly machineDamage: number;
  readonly optionalDone: boolean;
  readonly seconds: number;
}): { readonly letter: string; readonly points: number } {
  if (input.outcome === "failure" || input.outcome === "lost-contact") return { letter: "F", points: 0 };
  if (input.outcome === "aborted") return { letter: "D", points: 20 };
  let points = 40 + input.objectiveScore * 30;
  points += (1 - Math.min(1, input.cityImpact)) * 15;
  points += (1 - Math.min(1, input.machineDamage)) * 10;
  if (input.optionalDone) points += 10;
  if (input.seconds < 240) points += 5;
  points = Math.round(Math.max(0, Math.min(100, points)));
  const letter = points >= 92 ? "S" : points >= 80 ? "A" : points >= 65 ? "B" : points >= 50 ? "C" : "D";
  return { letter, points };
}
