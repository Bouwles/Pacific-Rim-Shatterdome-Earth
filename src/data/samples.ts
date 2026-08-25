import { ContentRegistry, type RegistryEntry } from "./registry";
import { BODY_ZONE_IDS, type BodyZoneId } from "./kaiju";
import type { MutationKind } from "./mutations";
import type { TissueClass } from "../world/resources";

/**
 * What comes off a kaiju, and what had to happen to get it.
 *
 * A sample is not a number. It is a specific thing recovered from a specific
 * part of a specific creature under specific conditions, and research asks for
 * it by name. That is what makes a research tree a set of decisions about how to
 * fight rather than a bar that fills up.
 *
 * Every sample declares how it is obtained, so the award rules can be derived
 * from the data rather than written twice, and so a test can prove that nothing
 * the tree calls for is impossible to get.
 *
 * The classes are the ones the economy already grades tissue by: common, rare,
 * exotic. That is deliberate. A common sample has to be gettable from almost any
 * fight, because core progression is not allowed to hang on a lucky drop.
 */

/** Where a sample can come from. Each is a real, checkable condition. */
export const SAMPLE_TRIGGERS = [
  /** Any kill, however it went. The floor that stops progression stalling. */
  "any-kill",
  /** A named body zone was destroyed or severed before the creature died. */
  "zone-destroyed",
  /** The creature carried a mutation of a given kind. */
  "mutation",
  /** It was brought down alive rather than killed. */
  "captured",
  /** The killing blow was a finisher rather than attrition. */
  "finisher",
  /** The killing damage was of a particular kind. */
  "damage-kind",
  /** The fight happened in a particular medium or weather. */
  "environment",
  /** A named mission objective was met. */
  "objective",
] as const;
export type SampleTrigger = (typeof SAMPLE_TRIGGERS)[number];

export interface SampleDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  /** Grades against the same scale the economy values tissue by. */
  readonly sampleClass: TissueClass;
  readonly trigger: SampleTrigger;
  /** Zone this comes off, for `zone-destroyed`. */
  readonly zoneId?: BodyZoneId;
  /** Mutation kind that yields it, for `mutation`. */
  readonly mutationKind?: MutationKind;
  /** Damage kind or medium or objective id, depending on the trigger. */
  readonly qualifier?: string;
  /**
   * How many come off when the condition is met, before familiarity.
   *
   * Small numbers on purpose. A research node asking for three of something is
   * asking for three fights that went a particular way, which is a goal; asking
   * for thirty would be asking for grinding, which is not.
   */
  readonly yieldCount: number;
  readonly description: string;
}

const SAMPLES: readonly SampleDefinition[] = [
  // --- The floor -----------------------------------------------------------
  // Every kill yields these, so no branch can ever be stranded behind a drop
  // that did not happen. Core progression is built on them.
  {
    id: "sample.hide",
    displayName: "Hide section",
    sampleClass: "common",
    trigger: "any-kill",
    yieldCount: 2,
    description: "Outer plating and the skin under it. Anything that dies leaves some.",
  },
  {
    id: "sample.blood",
    displayName: "Blue",
    sampleClass: "common",
    trigger: "any-kill",
    yieldCount: 2,
    description: "Kaiju blood, caustic and abundant. The cleanup crews would rather you took it away.",
  },
  {
    id: "sample.skeletal",
    displayName: "Skeletal section",
    sampleClass: "common",
    trigger: "any-kill",
    yieldCount: 1,
    description: "Bone and the cartilage around it. Says how the thing carried its own weight.",
  },

  // --- Where you hit it ----------------------------------------------------
  {
    id: "sample.cranial",
    displayName: "Cranial tissue",
    sampleClass: "rare",
    trigger: "zone-destroyed",
    zoneId: "head",
    yieldCount: 1,
    description: "Only recoverable if the head came apart. Where the senses were.",
  },
  {
    id: "sample.neural",
    displayName: "Neural cord",
    sampleClass: "rare",
    trigger: "zone-destroyed",
    zoneId: "torso",
    yieldCount: 1,
    description: "The trunk line. Taking the torso apart is the only way to reach it intact.",
  },
  {
    id: "sample.core-fragment",
    displayName: "Core fragment",
    sampleClass: "exotic",
    trigger: "zone-destroyed",
    zoneId: "core",
    yieldCount: 1,
    description: "A piece of whatever drives them. Rare, unstable, and the reason the labs exist.",
  },
  {
    id: "sample.limb-actuator",
    displayName: "Limb musculature",
    sampleClass: "common",
    trigger: "zone-destroyed",
    zoneId: "limb.left",
    yieldCount: 1,
    description: "How a thing that size moves a limb that size without tearing itself apart.",
  },
  {
    id: "sample.tail-segment",
    displayName: "Tail segment",
    sampleClass: "rare",
    trigger: "zone-destroyed",
    zoneId: "tail",
    yieldCount: 1,
    description: "Severed rather than shot off. The balance organ is in the last third.",
  },

  // --- What it was carrying ------------------------------------------------
  {
    id: "sample.plate-lamina",
    displayName: "Plate lamina",
    sampleClass: "rare",
    trigger: "mutation",
    mutationKind: "armour",
    yieldCount: 2,
    description: "Layered armour off something that had grown more of it than it should have.",
  },
  {
    id: "sample.venom-gland",
    displayName: "Venom gland",
    sampleClass: "rare",
    trigger: "mutation",
    mutationKind: "offence",
    yieldCount: 1,
    description: "Intact only if it did not burst, which mostly depends on how it died.",
  },
  {
    id: "sample.myofibre",
    displayName: "Fast myofibre",
    sampleClass: "rare",
    trigger: "mutation",
    mutationKind: "mobility",
    yieldCount: 1,
    description: "Muscle from something that moved faster than its mass says it should.",
  },
  {
    id: "sample.sensory-organ",
    displayName: "Sensory organ",
    sampleClass: "rare",
    trigger: "mutation",
    mutationKind: "sensory",
    yieldCount: 1,
    description: "What it was hunting with. Reads pressure, heat and something nobody has named.",
  },
  {
    id: "sample.regenerative",
    displayName: "Regenerative mass",
    sampleClass: "exotic",
    trigger: "mutation",
    mutationKind: "resilience",
    yieldCount: 1,
    description: "Tissue that was still closing its own wounds when it was cut out.",
  },

  // --- How you took it down ------------------------------------------------
  {
    id: "sample.live-culture",
    displayName: "Live culture",
    sampleClass: "exotic",
    trigger: "captured",
    yieldCount: 2,
    description: "Only from a creature brought down alive. Nothing dead gives this up.",
  },
  {
    id: "sample.intact-organ",
    displayName: "Intact organ",
    sampleClass: "exotic",
    trigger: "finisher",
    yieldCount: 1,
    description: "A clean finish leaves something whole. Grinding one down does not.",
  },
  {
    id: "sample.vitrified",
    displayName: "Vitrified tissue",
    sampleClass: "rare",
    trigger: "damage-kind",
    qualifier: "heat",
    yieldCount: 1,
    description: "Cooked rather than cut. Useless for biology and ideal for materials work.",
  },
  {
    id: "sample.conductive",
    displayName: "Conductive tissue",
    sampleClass: "rare",
    trigger: "damage-kind",
    qualifier: "electrical",
    yieldCount: 1,
    description: "Killed by current, which leaves the pathways it travelled visible.",
  },

  // --- Where it happened ---------------------------------------------------
  {
    id: "sample.pressure-adapted",
    displayName: "Pressure-adapted tissue",
    sampleClass: "rare",
    trigger: "environment",
    qualifier: "water",
    yieldCount: 1,
    description: "Taken in the water, where the organs are still under the pressure they grew in.",
  },
  {
    id: "sample.storm-etched",
    displayName: "Storm-etched plate",
    sampleClass: "rare",
    trigger: "environment",
    qualifier: "storm",
    yieldCount: 1,
    description: "Plate scoured by a fight in weather. Shows what the surface does under load.",
  },

  // --- What you were sent to do -------------------------------------------
  {
    id: "sample.evacuation-record",
    displayName: "Evacuation telemetry",
    sampleClass: "common",
    trigger: "objective",
    qualifier: "protect-civilians",
    yieldCount: 2,
    description: "Not off the creature at all. What it did to a city that was getting out of the way.",
  },
  {
    id: "sample.containment-log",
    displayName: "Containment log",
    sampleClass: "rare",
    trigger: "objective",
    qualifier: "contain-breach",
    yieldCount: 1,
    description: "What came through, how wide, and for how long. Only from holding a breach.",
  },
];

export function validateSample(entry: SampleDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("sample.")) errors.push('id must start with "sample."');
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (!SAMPLE_TRIGGERS.includes(entry.trigger)) errors.push(`unknown trigger "${entry.trigger}"`);
  if (entry.yieldCount <= 0) errors.push("yieldCount must be positive");
  if (entry.yieldCount > 4) {
    // The rule that keeps this from becoming a farm. If a node needs more than a
    // handful, the answer is a different sample, not a bigger pile of this one.
    errors.push("yieldCount above 4 turns a sample into a grind");
  }
  if (entry.trigger === "zone-destroyed") {
    if (!entry.zoneId) errors.push("zone-destroyed needs a zoneId");
    else if (!BODY_ZONE_IDS.includes(entry.zoneId)) errors.push(`unknown zoneId "${entry.zoneId}"`);
  }
  if (entry.trigger === "mutation" && !entry.mutationKind) errors.push("mutation needs a mutationKind");
  for (const trigger of ["damage-kind", "environment", "objective"] as const) {
    if (entry.trigger === trigger && !entry.qualifier) errors.push(`${trigger} needs a qualifier`);
  }
  if (entry.description.trim().length === 0) errors.push("description is required");
  return errors;
}

export function createSampleRegistry(): ContentRegistry<SampleDefinition> {
  const registry = new ContentRegistry<SampleDefinition>(validateSample);
  for (const entry of SAMPLES) registry.register(entry);
  return registry;
}

export const SAMPLE_DEFINITIONS = SAMPLES;

/** Every sample any fight yields, whatever else happened. */
export function guaranteedSampleIds(): readonly string[] {
  return SAMPLES.filter((entry) => entry.trigger === "any-kill").map((entry) => entry.id);
}
