import type { LayerCue, LayerRole, SoundLayer, SoundProfileDefinition } from "../data/soundProfiles";

/**
 * Which layers of a profile actually sound right now.
 *
 * This is the module that stops one impact sound being played for everything. A
 * profile lists thirteen layers; a machine walking slowly at full health sounds
 * three of them, the same machine sprinting with a torn shoulder sounds nine,
 * and the difference is audible without anybody reading a health bar.
 *
 * Pure. State in, cues out. No WebAudio, no clock, no RNG.
 */

/** Everything the layer picker needs to know about a machine. */
export interface MachineAudioState {
  /** Metres per second, over the ground. */
  readonly speedMps: number;
  /** 0 to 1. How much armour is gone. */
  readonly damage: number;
  /** 0 to 1 of the reactor's output currently being drawn. */
  readonly reactorLoad: number;
  /** 0 to 1 of heat against the ceiling. */
  readonly heat: number;
  /** True while a weapon is charging or firing. */
  readonly weaponActive: boolean;
  /** What the feet are currently in contact with. */
  readonly footing: "ground" | "rubble" | "water" | "airborne";
  /** True while something in the cockpit is faulted. */
  readonly cockpitAlarm: boolean;
}

/** Everything the layer picker needs to know about a creature. */
export interface CreatureAudioState {
  readonly speedMps: number;
  readonly damage: number;
  /** True on the frames it is calling. */
  readonly calling: boolean;
  /** True while an ability is winding up. */
  readonly abilityCharging: boolean;
  /** 0 to 1 of how hard it is breathing. Exertion, not health. */
  readonly exertion: number;
  /** True when it is submerged, which mutes plate and lifts the organ layers. */
  readonly submerged: boolean;
}

/** Above this the machine reads as running rather than walking. */
export const RUNNING_SPEED_MPS = 9;
/** Damage past this makes the strain and tear layers routine rather than rare. */
export const HEAVY_DAMAGE = 0.55;
/** Nothing quieter than this is worth an audio node. */
export const AUDIBLE_FLOOR = 0.02;

/**
 * Machine layers, as an ordered list of conditions.
 *
 * Each row says which layer, and how loud, given the state. A gain of zero
 * means the layer is not sounding at all and no node is created for it, which
 * is what keeps a calm machine cheap.
 */
const MACHINE_RULES: readonly {
  readonly role: LayerRole;
  readonly idMatch: (id: string) => boolean;
  readonly gain: (state: MachineAudioState) => number;
}[] = [
  {
    role: "reactor",
    idMatch: (id) => id.endsWith("reactor.idle"),
    // Always on. It is the sound of the machine being switched on at all.
    gain: () => 1,
  },
  {
    role: "reactor",
    idMatch: (id) => id.endsWith("reactor.strain"),
    gain: (s) => curve(Math.max(s.reactorLoad, s.heat), 0.4),
  },
  {
    role: "servo",
    idMatch: (id) => id.includes("servo.hip"),
    gain: (s) => curve(s.speedMps / RUNNING_SPEED_MPS, 0.08),
  },
  {
    role: "servo",
    idMatch: (id) => id.includes("servo.shoulder"),
    // Arms only really speak once the machine is moving properly.
    gain: (s) => curve(s.speedMps / RUNNING_SPEED_MPS - 0.3, 0),
  },
  {
    role: "footfall",
    idMatch: (id) => id.includes("footfall.mass"),
    gain: (s) => (s.footing === "airborne" ? 0 : 0.55 + 0.45 * curve(s.speedMps / RUNNING_SPEED_MPS, 0)),
  },
  {
    role: "footfall",
    idMatch: (id) => id.includes("footfall.plate"),
    // A healthy frame does not rattle. A damaged one does, every step.
    gain: (s) => (s.footing === "airborne" ? 0 : curve(s.damage * 1.6, 0.1)),
  },
  {
    role: "armour-strain",
    idMatch: (id) => id.endsWith("armour.strain"),
    gain: (s) => curve(s.damage * 1.2, 0.05),
  },
  {
    role: "armour-strain",
    idMatch: (id) => id.endsWith("armour.tear"),
    // Only past the point where plate is actually failing.
    gain: (s) => (s.damage >= HEAVY_DAMAGE ? curve((s.damage - HEAVY_DAMAGE) * 2.2, 0.2) : 0),
  },
  {
    role: "weapon",
    idMatch: (id) => id.includes("weapon.charge"),
    gain: (s) => (s.weaponActive ? 1 : 0),
  },
  { role: "cockpit", idMatch: (id) => id.endsWith("cockpit.hum"), gain: () => 0.8 },
  {
    role: "cockpit",
    idMatch: (id) => id.endsWith("cockpit.alarm"),
    gain: (s) => (s.cockpitAlarm ? 1 : 0),
  },
  {
    role: "environment-contact",
    idMatch: (id) => id.endsWith("contact.water"),
    gain: (s) => (s.footing === "water" ? 0.6 + 0.4 * curve(s.speedMps / RUNNING_SPEED_MPS, 0) : 0),
  },
  {
    role: "environment-contact",
    idMatch: (id) => id.endsWith("contact.rubble"),
    gain: (s) => (s.footing === "rubble" ? 0.5 + 0.5 * curve(s.speedMps / RUNNING_SPEED_MPS, 0) : 0),
  },
];

const CREATURE_RULES: readonly {
  readonly idMatch: (id: string) => boolean;
  readonly gain: (state: CreatureAudioState) => number;
}[] = [
  { idMatch: (id) => id.includes("call"), gain: (s) => (s.calling ? 1 : 0) },
  { idMatch: (id) => id.includes("breath"), gain: (s) => 0.3 + 0.7 * curve(s.exertion, 0) },
  {
    idMatch: (id) => id.includes("step") || id.includes("movement"),
    gain: (s) => curve(s.speedMps / RUNNING_SPEED_MPS, 0.05),
  },
  {
    idMatch: (id) => id.includes("plate"),
    // Underwater the plate stops speaking and the body takes over.
    gain: (s) => (s.submerged ? 0.15 : 0.35 + 0.65 * curve(s.damage, 0)),
  },
  { idMatch: (id) => id.includes("organ"), gain: (s) => (s.submerged ? 0.9 : 0.45 + 0.4 * s.damage) },
  { idMatch: (id) => id.includes("ability"), gain: (s) => (s.abilityCharging ? 1 : 0) },
];

/** Which of a machine profile's layers sound, and how loud. */
export function machineCues(profile: SoundProfileDefinition, state: MachineAudioState): readonly LayerCue[] {
  return cuesFrom(profile.layers, (item) => {
    const rule = MACHINE_RULES.find((row) => row.role === item.role && row.idMatch(item.id));
    return rule ? rule.gain(state) : 0;
  });
}

/** Which of a creature profile's layers sound, and how loud. */
export function creatureCues(
  profile: SoundProfileDefinition,
  state: CreatureAudioState,
): readonly LayerCue[] {
  return cuesFrom(profile.layers, (item) => {
    const rule = CREATURE_RULES.find((row) => row.idMatch(item.id));
    return rule ? rule.gain(state) : 0;
  });
}

/**
 * How different two states sound, 0 to 1.
 *
 * Used by the test that proves a damaged machine is not the same sound with a
 * different number attached. A screenshot cannot assert that; this can.
 */
export function cueDistance(a: readonly LayerCue[], b: readonly LayerCue[]): number {
  const ids = new Set([...a.map((cue) => cue.layerId), ...b.map((cue) => cue.layerId)]);
  if (ids.size === 0) return 0;
  let total = 0;
  for (const id of ids) {
    const left = a.find((cue) => cue.layerId === id)?.gain ?? 0;
    const right = b.find((cue) => cue.layerId === id)?.gain ?? 0;
    total += Math.abs(left - right);
  }
  return Math.min(1, total / ids.size);
}

/** How many nodes a state would need, for the performance budget. */
export function voiceCount(cues: readonly LayerCue[]): number {
  return cues.length;
}

function cuesFrom(layers: readonly SoundLayer[], gainOf: (layer: SoundLayer) => number): readonly LayerCue[] {
  const cues: LayerCue[] = [];
  for (const item of layers) {
    const gain = clamp01(gainOf(item));
    if (gain <= AUDIBLE_FLOOR) continue;
    cues.push({ layerId: item.id, gain: Math.round(gain * 1000) / 1000 });
  }
  return cues;
}

/** Eases a 0-to-1 input, with a floor below which it is simply silent. */
function curve(value: number, floor: number): number {
  const clamped = clamp01(value);
  if (clamped <= floor) return 0;
  const scaled = (clamped - floor) / (1 - floor);
  return clamp01(scaled * scaled * (3 - 2 * scaled));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
