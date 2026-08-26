import { ContentRegistry, type RegistryEntry } from "./registry";
import type { AudioBusId } from "./audioBuses";

/**
 * What everything sounds like, described rather than recorded.
 *
 * Every entry here is a **synthesis recipe**: an oscillator shape, a band, a
 * length and an envelope, plus a clearly named slot a real recording can be
 * dropped into later. Nothing in this project bundles film audio or a
 * commercial soundtrack, and the validator refuses an entry whose only
 * definition is a file path, so a placeholder can never quietly become an
 * excuse to ship somebody else's work.
 *
 * The rule that shapes the layers: **one impact sound for everything is the
 * failure**. A footfall is a mass thump, a plate rattle and a servo settle, and
 * which of those three is audible depends on how fast the machine is moving and
 * how badly it is damaged. That is what makes a limping machine sound like a
 * limping machine rather than like a healthy one with a red bar.
 *
 * No WebAudio, no Babylon, no DOM. Recipes only.
 */

/** How a layer is generated when there is no recording for it. */
export const SYNTH_SHAPES = ["noise", "sine", "triangle", "square", "sawtooth"] as const;
export type SynthShape = (typeof SYNTH_SHAPES)[number];

/** What a layer is for. Used to decide which layers a situation calls for. */
export const LAYER_ROLES = [
  "servo",
  "footfall",
  "reactor",
  "weapon",
  "armour-strain",
  "cockpit",
  "environment-contact",
  "call",
  "breath",
  "movement",
  "plate",
  "organ",
  "ability",
] as const;
export type LayerRole = (typeof LAYER_ROLES)[number];

export interface SoundLayer {
  readonly id: string;
  readonly role: LayerRole;
  readonly bus: AudioBusId;
  readonly shape: SynthShape;
  /** Centre frequency in hertz. Where the layer sits in the mix. */
  readonly centreHz: number;
  /** Bandwidth in hertz. Wide is a rumble, narrow is a tone. */
  readonly bandwidthHz: number;
  readonly attackMs: number;
  readonly releaseMs: number;
  /** Base level, 0 to 1, before any situation scaling. */
  readonly level: number;
  /**
   * Named slot for a real recording.
   *
   * Empty means the placeholder is the intended sound for now. A name here is a
   * promise that a file with that name will be looked for and, when it is not
   * there, the synthesised version is used without a word of complaint.
   */
  readonly assetSlot: string;
  /** How it is meant to read, in words. */
  readonly character: string;
}

/** Which layers a situation calls for, and how loud. */
export interface LayerCue {
  readonly layerId: string;
  /** Multiplier on the layer's own level. */
  readonly gain: number;
}

export interface SoundProfileDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** What this profile belongs to: a machine class or a creature category. */
  readonly subject: "jaeger" | "kaiju";
  readonly layers: readonly SoundLayer[];
  /** What makes this one recognisable, in words. */
  readonly identity: string;
}

/** Shorthand so a layer reads as a description rather than a wall of fields. */
function layer(
  id: string,
  role: LayerRole,
  bus: AudioBusId,
  shape: SynthShape,
  centreHz: number,
  bandwidthHz: number,
  attackMs: number,
  releaseMs: number,
  level: number,
  character: string,
  assetSlot = "",
): SoundLayer {
  return { id, role, bus, shape, centreHz, bandwidthHz, attackMs, releaseMs, level, assetSlot, character };
}

const PROFILES: readonly SoundProfileDefinition[] = [
  // ============================== jaegers =================================
  {
    id: "sound.jaeger.standard",
    displayName: "Standard frame",
    subject: "jaeger",
    identity: "Heavy hydraulics over a steady reactor hum. Sounds engineered rather than alive.",
    layers: [
      layer(
        "jaeger.servo.hip",
        "servo",
        "jaeger",
        "sawtooth",
        220,
        90,
        12,
        180,
        0.4,
        "A hip actuator taking load.",
        "audio/jaeger/servo-hip",
      ),
      layer(
        "jaeger.servo.shoulder",
        "servo",
        "jaeger",
        "sawtooth",
        310,
        120,
        10,
        140,
        0.3,
        "A shoulder swinging through.",
        "audio/jaeger/servo-shoulder",
      ),
      layer(
        "jaeger.footfall.mass",
        "footfall",
        "jaeger",
        "noise",
        42,
        30,
        4,
        900,
        0.95,
        "The mass arriving. Felt more than heard.",
        "audio/jaeger/footfall-mass",
      ),
      layer(
        "jaeger.footfall.plate",
        "footfall",
        "jaeger",
        "noise",
        900,
        700,
        2,
        260,
        0.35,
        "Plate rattling on the frame after the foot lands.",
        "audio/jaeger/footfall-plate",
      ),
      layer(
        "jaeger.reactor.idle",
        "reactor",
        "jaeger",
        "sine",
        58,
        12,
        900,
        1_400,
        0.5,
        "The reactor at rest. Always there.",
        "audio/jaeger/reactor-idle",
      ),
      layer(
        "jaeger.reactor.strain",
        "reactor",
        "jaeger",
        "triangle",
        96,
        40,
        300,
        800,
        0.45,
        "The reactor working, and audibly so.",
        "audio/jaeger/reactor-strain",
      ),
      layer(
        "jaeger.weapon.charge",
        "weapon",
        "jaeger",
        "square",
        640,
        300,
        240,
        400,
        0.5,
        "Something building a charge.",
        "audio/jaeger/weapon-charge",
      ),
      layer(
        "jaeger.armour.strain",
        "armour-strain",
        "jaeger",
        "triangle",
        170,
        80,
        90,
        700,
        0.4,
        "Metal complaining under load.",
        "audio/jaeger/armour-strain",
      ),
      layer(
        "jaeger.armour.tear",
        "armour-strain",
        "jaeger",
        "noise",
        1_600,
        1_200,
        3,
        340,
        0.6,
        "Plate failing rather than flexing.",
        "audio/jaeger/armour-tear",
      ),
      layer(
        "jaeger.cockpit.hum",
        "cockpit",
        "jaeger",
        "sine",
        120,
        20,
        600,
        1_200,
        0.3,
        "The pod you are standing in.",
        "audio/jaeger/cockpit-hum",
      ),
      layer(
        "jaeger.cockpit.alarm",
        "cockpit",
        "jaeger",
        "square",
        880,
        60,
        8,
        120,
        0.55,
        "A fault, from inside.",
        "audio/jaeger/cockpit-alarm",
      ),
      layer(
        "jaeger.contact.water",
        "environment-contact",
        "jaeger",
        "noise",
        420,
        380,
        6,
        700,
        0.5,
        "A leg entering water.",
        "audio/jaeger/contact-water",
      ),
      layer(
        "jaeger.contact.rubble",
        "environment-contact",
        "jaeger",
        "noise",
        260,
        220,
        4,
        500,
        0.45,
        "Standing on something that used to be a building.",
        "audio/jaeger/contact-rubble",
      ),
    ],
  },

  // =============================== kaiju ==================================
  {
    id: "sound.kaiju.coastal",
    displayName: "Coastal category",
    subject: "kaiju",
    identity: "Low, wet and organic. Everything about it is breath and mass rather than machinery.",
    layers: [
      layer(
        "kaiju.call.low",
        "call",
        "kaiju",
        "sawtooth",
        68,
        44,
        180,
        2_200,
        0.9,
        "The call. Carries further than it should.",
        "audio/kaiju/call-low",
      ),
      layer(
        "kaiju.call.upper",
        "call",
        "kaiju",
        "triangle",
        420,
        260,
        120,
        1_100,
        0.45,
        "The upper harmonic that makes it read as alive.",
        "audio/kaiju/call-upper",
      ),
      layer(
        "kaiju.breath.in",
        "breath",
        "kaiju",
        "noise",
        300,
        260,
        340,
        900,
        0.4,
        "Drawing air through something very large.",
        "audio/kaiju/breath-in",
      ),
      layer(
        "kaiju.breath.out",
        "breath",
        "kaiju",
        "noise",
        190,
        170,
        120,
        1_300,
        0.45,
        "Letting it out again.",
        "audio/kaiju/breath-out",
      ),
      layer(
        "kaiju.step.mass",
        "movement",
        "kaiju",
        "noise",
        34,
        26,
        6,
        1_100,
        1,
        "A footstep with no metal in it at all.",
        "audio/kaiju/step-mass",
      ),
      layer(
        "kaiju.movement.drag",
        "movement",
        "kaiju",
        "noise",
        520,
        430,
        200,
        800,
        0.35,
        "A limb or a tail dragging.",
        "audio/kaiju/movement-drag",
      ),
      layer(
        "kaiju.plate.grind",
        "plate",
        "kaiju",
        "noise",
        1_100,
        800,
        40,
        420,
        0.4,
        "Armour plate moving over itself.",
        "audio/kaiju/plate-grind",
      ),
      layer(
        "kaiju.organ.pulse",
        "organ",
        "kaiju",
        "sine",
        46,
        16,
        260,
        900,
        0.5,
        "Something inside it working.",
        "audio/kaiju/organ-pulse",
      ),
      layer(
        "kaiju.ability.charge",
        "ability",
        "kaiju",
        "square",
        240,
        180,
        420,
        600,
        0.6,
        "It is about to do the thing.",
        "audio/kaiju/ability-charge",
      ),
    ],
  },
  {
    id: "sound.kaiju.deep",
    displayName: "Deep category",
    subject: "kaiju",
    identity: "Pressure and infrasound. Quieter than the coastal profile and much lower.",
    layers: [
      layer(
        "kaiju.deep.call",
        "call",
        "kaiju",
        "sine",
        38,
        22,
        420,
        3_400,
        0.95,
        "Barely a sound. More of a pressure change.",
        "audio/kaiju/deep-call",
      ),
      layer(
        "kaiju.deep.breath",
        "breath",
        "kaiju",
        "noise",
        140,
        120,
        500,
        1_600,
        0.35,
        "Slow, and enormous.",
        "audio/kaiju/deep-breath",
      ),
      layer(
        "kaiju.deep.step",
        "movement",
        "kaiju",
        "noise",
        28,
        20,
        10,
        1_500,
        0.9,
        "Something very heavy on a seabed.",
        "audio/kaiju/deep-step",
      ),
      layer(
        "kaiju.deep.plate",
        "plate",
        "kaiju",
        "noise",
        700,
        520,
        60,
        520,
        0.35,
        "Shell rather than plate.",
        "audio/kaiju/deep-plate",
      ),
      layer(
        "kaiju.deep.organ",
        "organ",
        "kaiju",
        "sine",
        31,
        10,
        400,
        1_400,
        0.55,
        "A very slow rhythm.",
        "audio/kaiju/deep-organ",
      ),
      layer(
        "kaiju.deep.ability",
        "ability",
        "kaiju",
        "triangle",
        160,
        120,
        600,
        900,
        0.6,
        "A charge you feel before you hear.",
        "audio/kaiju/deep-ability",
      ),
    ],
  },
];

export function validateSoundLayer(entry: SoundLayer): string[] {
  const errors: string[] = [];
  if (!entry.id.trim()) errors.push("layer id is required");
  if (!LAYER_ROLES.includes(entry.role)) errors.push(`unknown role "${entry.role}"`);
  if (!SYNTH_SHAPES.includes(entry.shape)) {
    // The rule against shipping somebody else's audio: a layer must be
    // synthesisable, so a missing file is a placeholder rather than silence or
    // an excuse to bundle a recording.
    errors.push(`layer must name a synthesis shape it can fall back to`);
  }
  if (entry.centreHz <= 0 || entry.centreHz > 20_000) errors.push("centreHz must be audible");
  if (entry.bandwidthHz < 0) errors.push("bandwidthHz cannot be negative");
  if (entry.attackMs < 0 || entry.releaseMs < 0) errors.push("envelope times cannot be negative");
  if (entry.level < 0 || entry.level > 1) errors.push("level must be between 0 and 1");
  if (entry.character.trim().length === 0) errors.push("a layer must say how it is meant to read");
  return errors;
}

export function validateSoundProfile(entry: SoundProfileDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("sound.")) errors.push('id must start with "sound."');
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (entry.identity.trim().length === 0) errors.push("a profile must say what makes it recognisable");
  if (entry.layers.length < 4) {
    // The explicit failure mode: one giant impact sound for everything. A
    // profile with three layers cannot have a movement identity.
    errors.push("a profile with fewer than four layers is one sound wearing a name");
  }

  const ids = new Set<string>();
  const roles = new Set<LayerRole>();
  for (const item of entry.layers) {
    if (ids.has(item.id)) errors.push(`duplicate layer "${item.id}"`);
    ids.add(item.id);
    roles.add(item.role);
    errors.push(...validateSoundLayer(item).map((error) => `${item.id}: ${error}`));
    if (entry.subject === "jaeger" && item.bus !== "jaeger") {
      errors.push(`${item.id} belongs on the jaeger bus`);
    }
    if (entry.subject === "kaiju" && item.bus !== "kaiju") {
      errors.push(`${item.id} belongs on the kaiju bus`);
    }
  }
  if (roles.size < 3) errors.push("a profile needs at least three different kinds of layer");
  return errors;
}

export function createSoundProfileRegistry(): ContentRegistry<SoundProfileDefinition> {
  const registry = new ContentRegistry<SoundProfileDefinition>(validateSoundProfile);
  for (const entry of PROFILES) registry.register(entry);
  return registry;
}

export const SOUND_PROFILES = PROFILES;

/** Every asset slot a real recording could be dropped into. */
export function assetSlots(): readonly string[] {
  return PROFILES.flatMap((profile) => profile.layers.map((item) => item.assetSlot)).filter(
    (slot) => slot.length > 0,
  );
}
