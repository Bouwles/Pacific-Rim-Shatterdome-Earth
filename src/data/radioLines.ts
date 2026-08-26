import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * Who talks to you, and what they say.
 *
 * Every line here is written for this project. Nothing is transcribed from a
 * film, and the validator refuses a line without an author-written text body,
 * because a subtitle that only says "play file 12" is a line nobody can read
 * with the sound off.
 *
 * Lines are **text first**. Voice is an optional recording dropped into a named
 * slot later; with no recording, the line still arrives, still ducks the music,
 * still appears as a subtitle and still lands in the conversation record. That
 * is what "missing optional audio uses silence or a documented placeholder"
 * means in practice, and it is why nothing here logs a warning when a file is
 * absent.
 *
 * No WebAudio, no DOM, no Babylon.
 */

/** Who is speaking. Identity is what makes a voice recognisable without a name. */
export const SPEAKER_IDS = [
  "loccent",
  "marshal",
  "chief-engineer",
  "copilot",
  "ally-ranger",
  "science",
  "system",
] as const;
export type SpeakerId = (typeof SPEAKER_IDS)[number];

export interface SpeakerDefinition extends RegistryEntry {
  readonly id: SpeakerId;
  readonly displayName: string;
  /** Short tag shown before the subtitle, so the speaker is legible at a glance. */
  readonly callsign: string;
  /**
   * Filter band in hertz, low then high.
   *
   * A radio voice is band-limited and a voice in the room is not. This is the
   * whole of the speaker's synthesised identity: no recording needed for a
   * player to tell LOCCENT from the person standing beside them.
   */
  readonly band: readonly [number, number];
  /** Which bus the line plays on. */
  readonly bus: "radio" | "dialogue";
  /** Colour token for the subtitle, resolved by the interface layer. */
  readonly colourToken: string;
}

const SPEAKERS: readonly SpeakerDefinition[] = [
  {
    id: "loccent",
    displayName: "LOCCENT",
    callsign: "LOCCENT",
    band: [420, 3_100],
    bus: "radio",
    colourToken: "radio-loccent",
  },
  {
    id: "marshal",
    displayName: "Marshal",
    callsign: "MARSHAL",
    band: [300, 3_400],
    bus: "radio",
    colourToken: "radio-command",
  },
  {
    id: "chief-engineer",
    displayName: "Chief engineer",
    callsign: "ENG",
    band: [380, 3_000],
    bus: "radio",
    colourToken: "radio-support",
  },
  {
    id: "copilot",
    displayName: "Copilot",
    callsign: "COPILOT",
    // In the pod with you, so no radio band at all.
    band: [90, 8_000],
    bus: "dialogue",
    colourToken: "dialogue-copilot",
  },
  {
    id: "ally-ranger",
    displayName: "Allied ranger",
    callsign: "ALLY",
    band: [450, 2_900],
    bus: "radio",
    colourToken: "radio-ally",
  },
  {
    id: "science",
    displayName: "K-Science",
    callsign: "K-SCI",
    band: [400, 3_200],
    bus: "radio",
    colourToken: "radio-science",
  },
  {
    id: "system",
    displayName: "Cockpit system",
    callsign: "SYS",
    band: [600, 4_000],
    bus: "radio",
    colourToken: "radio-system",
  },
];

/**
 * How badly a line needs to be heard.
 *
 * The order is the whole point: a breach warning is not allowed to wait behind
 * somebody saying good work.
 */
export const RADIO_PRIORITIES = ["critical", "high", "normal", "low", "chatter"] as const;
export type RadioPriority = (typeof RADIO_PRIORITIES)[number];

export function priorityRank(priority: RadioPriority): number {
  return RADIO_PRIORITIES.length - RADIO_PRIORITIES.indexOf(priority);
}

export interface RadioLineDefinition extends RegistryEntry {
  readonly id: string;
  readonly speaker: SpeakerId;
  readonly priority: RadioPriority;
  /** What is said. Always present, always the subtitle. */
  readonly text: string;
  /** How long it takes to say, in milliseconds. */
  readonly durationMs: number;
  /** Seconds before this exact line may be said again. */
  readonly cooldownSeconds: number;
  /**
   * Whether something more important may cut it off mid-sentence.
   *
   * A critical line is not interruptible, which is what stops two warnings
   * cutting each other into nonsense.
   */
  readonly interruptible: boolean;
  /** What causes it, for the trigger table and for the debug readout. */
  readonly trigger: string;
  /** Optional named slot for a recording. Empty means text and silence. */
  readonly assetSlot: string;
}

const LINES: readonly RadioLineDefinition[] = [
  // ------------------------------- critical -------------------------------
  {
    id: "radio.breach.detected",
    speaker: "loccent",
    priority: "critical",
    text: "Breach event confirmed. Signature is climbing. Everybody move.",
    durationMs: 3_600,
    cooldownSeconds: 120,
    interruptible: false,
    trigger: "A breach opens.",
    assetSlot: "audio/radio/breach-detected",
  },
  {
    id: "radio.conn.pod.failing",
    speaker: "system",
    priority: "critical",
    text: "Conn-pod integrity failing. Seal the pod or disengage.",
    durationMs: 3_200,
    cooldownSeconds: 45,
    interruptible: false,
    trigger: "Cockpit integrity below the safe line.",
    assetSlot: "audio/radio/conn-pod-failing",
  },
  {
    id: "radio.reactor.critical",
    speaker: "system",
    priority: "critical",
    text: "Reactor load critical. Vent now.",
    durationMs: 2_400,
    cooldownSeconds: 30,
    interruptible: false,
    trigger: "Reactor heat at the ceiling.",
    assetSlot: "audio/radio/reactor-critical",
  },
  {
    id: "radio.civilians.in.path",
    speaker: "marshal",
    priority: "critical",
    text: "You have civilians in that block. Do not put it through them.",
    durationMs: 3_400,
    cooldownSeconds: 90,
    interruptible: false,
    trigger: "A populated district enters the fight.",
    assetSlot: "audio/radio/civilians-in-path",
  },

  // --------------------------------- high ---------------------------------
  {
    id: "radio.contact.inbound",
    speaker: "loccent",
    priority: "high",
    text: "Contact inbound, bearing on your position. Category is still resolving.",
    durationMs: 3_800,
    cooldownSeconds: 60,
    interruptible: true,
    trigger: "A creature is detected approaching.",
    assetSlot: "audio/radio/contact-inbound",
  },
  {
    id: "radio.ally.engaged",
    speaker: "ally-ranger",
    priority: "high",
    text: "We are engaged on the north side. Hold your line and we will hold ours.",
    durationMs: 3_900,
    cooldownSeconds: 90,
    interruptible: true,
    trigger: "An allied squad enters combat.",
    assetSlot: "audio/radio/ally-engaged",
  },
  {
    id: "radio.ally.down",
    speaker: "loccent",
    priority: "high",
    text: "We have lost the allied unit. You are on your own out there.",
    durationMs: 3_400,
    cooldownSeconds: 120,
    interruptible: false,
    trigger: "An allied squad is destroyed.",
    assetSlot: "audio/radio/ally-down",
  },
  {
    id: "radio.phase.shift",
    speaker: "science",
    priority: "high",
    text: "Its output just doubled. Whatever it was holding back, it is not any more.",
    durationMs: 4_200,
    cooldownSeconds: 180,
    interruptible: true,
    trigger: "A creature enters its final phase.",
    assetSlot: "audio/radio/phase-shift",
  },
  {
    id: "radio.weak.point",
    speaker: "science",
    priority: "high",
    text: "Research says the plate is thin along the flank. Put something into it.",
    durationMs: 3_900,
    cooldownSeconds: 150,
    interruptible: true,
    trigger: "A researched weak point becomes visible.",
    assetSlot: "audio/radio/weak-point",
  },

  // -------------------------------- normal --------------------------------
  {
    id: "radio.deploy.launch",
    speaker: "marshal",
    priority: "normal",
    text: "You are cleared to launch. Bring the machine back.",
    durationMs: 3_100,
    cooldownSeconds: 45,
    interruptible: true,
    trigger: "A sortie launches.",
    assetSlot: "audio/radio/deploy-launch",
  },
  {
    id: "radio.carrier.approach",
    speaker: "loccent",
    priority: "normal",
    text: "Carrier is over the drop point. Sixty seconds.",
    durationMs: 2_900,
    cooldownSeconds: 60,
    interruptible: true,
    trigger: "The carrier nears a drop.",
    assetSlot: "audio/radio/carrier-approach",
  },
  {
    id: "radio.drift.stable",
    speaker: "copilot",
    priority: "normal",
    text: "Drift is holding. I have got the right side.",
    durationMs: 2_800,
    cooldownSeconds: 120,
    interruptible: true,
    trigger: "A drift link stabilises.",
    assetSlot: "audio/radio/drift-stable",
  },
  {
    id: "radio.drift.slipping",
    speaker: "copilot",
    priority: "high",
    text: "I am slipping. Stay with me.",
    durationMs: 2_100,
    cooldownSeconds: 40,
    interruptible: false,
    trigger: "Drift stability falls below the safe band.",
    assetSlot: "audio/radio/drift-slipping",
  },
  {
    id: "radio.repair.complete",
    speaker: "chief-engineer",
    priority: "normal",
    text: "She is back together. Try not to bring her home in pieces this time.",
    durationMs: 3_600,
    cooldownSeconds: 90,
    interruptible: true,
    trigger: "A repair job finishes.",
    assetSlot: "audio/radio/repair-complete",
  },
  {
    id: "radio.funds.low",
    speaker: "chief-engineer",
    priority: "normal",
    text: "We cannot bill this to nothing. The account is nearly dry.",
    durationMs: 3_300,
    cooldownSeconds: 300,
    interruptible: true,
    trigger: "The treasury falls below the warning threshold.",
    assetSlot: "audio/radio/funds-low",
  },

  // ---------------------------------- low ---------------------------------
  {
    id: "radio.sample.recovered",
    speaker: "science",
    priority: "low",
    text: "Sample is aboard. That is worth something to us.",
    durationMs: 2_700,
    cooldownSeconds: 60,
    interruptible: true,
    trigger: "A kaiju sample is recovered.",
    assetSlot: "audio/radio/sample-recovered",
  },
  {
    id: "radio.site.discovered",
    speaker: "loccent",
    priority: "low",
    text: "New site on the board. Coordinates are with you.",
    durationMs: 2_600,
    cooldownSeconds: 45,
    interruptible: true,
    trigger: "A world site is discovered.",
    assetSlot: "audio/radio/site-discovered",
  },
  {
    id: "radio.victory",
    speaker: "marshal",
    priority: "normal",
    text: "It is down. Good work. Get back here.",
    durationMs: 2_900,
    cooldownSeconds: 30,
    interruptible: false,
    trigger: "A sortie is won.",
    assetSlot: "audio/radio/victory",
  },
  {
    id: "radio.loss",
    speaker: "marshal",
    priority: "normal",
    text: "Pull out. We will count what is left of the city in the morning.",
    durationMs: 3_800,
    cooldownSeconds: 30,
    interruptible: false,
    trigger: "A sortie is lost.",
    assetSlot: "audio/radio/loss",
  },

  // -------------------------------- chatter -------------------------------
  {
    id: "radio.chatter.dome",
    speaker: "chief-engineer",
    priority: "chatter",
    text: "Crane four is down again. Nothing you need to worry about.",
    durationMs: 3_000,
    cooldownSeconds: 240,
    interruptible: true,
    trigger: "Idle time in the complex.",
    assetSlot: "",
  },
  {
    id: "radio.chatter.weather",
    speaker: "loccent",
    priority: "chatter",
    text: "Weather is turning out there. Watch your footing.",
    durationMs: 2_800,
    cooldownSeconds: 240,
    interruptible: true,
    trigger: "Conditions worsen in the field.",
    assetSlot: "",
  },
];

export function validateSpeaker(entry: SpeakerDefinition): string[] {
  const errors: string[] = [];
  if (!SPEAKER_IDS.includes(entry.id)) errors.push(`unknown speaker "${entry.id}"`);
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (entry.callsign.trim().length === 0) errors.push("a speaker needs a callsign for the subtitle");
  const [low, high] = entry.band;
  if (low <= 0 || high <= low || high > 20_000) errors.push("band must be a sensible low to high pair");
  if (entry.colourToken.trim().length === 0) errors.push("a speaker needs a colour token");
  return errors;
}

export function validateRadioLine(entry: RadioLineDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("radio.")) errors.push('id must start with "radio."');
  if (!SPEAKER_IDS.includes(entry.speaker)) errors.push(`unknown speaker "${entry.speaker}"`);
  if (!RADIO_PRIORITIES.includes(entry.priority)) errors.push(`unknown priority "${entry.priority}"`);
  if (entry.text.trim().length < 8) {
    // A line with no written text is a line nobody can read with the sound off,
    // and there is no recording to fall back on either.
    errors.push("a line must carry its own text");
  }
  if (entry.durationMs < 400 || entry.durationMs > 20_000) errors.push("durationMs must be plausible");
  if (entry.cooldownSeconds < 0) errors.push("cooldownSeconds cannot be negative");
  if (entry.trigger.trim().length === 0) errors.push("a line must say what causes it");
  if (entry.priority === "critical" && entry.interruptible) {
    errors.push("a critical line cannot be interruptible");
  }
  return errors;
}

export function createSpeakerRegistry(): ContentRegistry<SpeakerDefinition> {
  const registry = new ContentRegistry<SpeakerDefinition>(validateSpeaker);
  for (const entry of SPEAKERS) registry.register(entry);
  return registry;
}

export function createRadioLineRegistry(): ContentRegistry<RadioLineDefinition> {
  const registry = new ContentRegistry<RadioLineDefinition>(validateRadioLine);
  for (const entry of LINES) registry.register(entry);
  return registry;
}

export const SPEAKERS_LIST = SPEAKERS;
export const RADIO_LINES = LINES;

/** Every recording slot a real voice could be dropped into. */
export function voiceSlots(): readonly string[] {
  return LINES.map((line) => line.assetSlot).filter((slot) => slot.length > 0);
}
