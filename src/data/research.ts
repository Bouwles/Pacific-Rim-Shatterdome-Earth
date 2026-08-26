import { ContentRegistry, type RegistryEntry } from "./registry";

/**
 * The research tree.
 *
 * Nine branches, and a node in one of them is a programme rather than a
 * percentage: it asks for specific samples off specific fights, a facility that
 * can actually run it, people to run it and time to run it in, and it hands back
 * something that changes how a fight goes.
 *
 * The rule that shapes everything here: **a benefit is a capability, not a
 * number**. Nothing in this file makes a weapon hit five percent harder.
 * Countermeasures reveal what a creature is about to do, blunt a status it
 * inflicts, or make something trackable that was not. Chassis nodes put a
 * machine on the pad that cannot be bought. Facility and logistics nodes change
 * what the complex can do. If a node cannot be described without the word
 * "percent", it does not belong in the tree.
 *
 * The second rule: **core progression runs on common samples**. Every branch has
 * a path from nothing to its useful end using only samples any kill yields. Rare
 * and exotic samples gate the optional and the spectacular, never the road. A
 * test walks the whole graph and proves it.
 *
 * No Babylon, no DOM, no RNG. This is a table.
 */

export const RESEARCH_BRANCHES = [
  "weapons",
  "materials",
  "reactor",
  "mobility",
  "sensors",
  "biology",
  "defense",
  "logistics",
  "chassis",
] as const;
export type ResearchBranch = (typeof RESEARCH_BRANCHES)[number];

/** What finishing a node actually hands over. Capabilities, never scalars. */
export const RESEARCH_BENEFIT_KINDS = [
  /** Shows a creature's wind-up earlier, and says what is coming. */
  "telegraph",
  /** Blunts a named status effect: shorter, weaker, or refused outright. */
  "status-resist",
  /** Makes something trackable: through weather, water, or after it breaks line of sight. */
  "tracking",
  /** Marks a category's weak zones so they can be aimed at deliberately. */
  "weak-point",
  /** Opens a piece of equipment: a weapon, a module, a facility tier. */
  "equipment",
  /** Puts a chassis on the pad that cannot be bought. */
  "chassis",
  /** Changes what the complex itself can do. */
  "facility",
] as const;
export type ResearchBenefitKind = (typeof RESEARCH_BENEFIT_KINDS)[number];

/** One thing a completed node hands over. */
export interface ResearchBenefit {
  readonly kind: ResearchBenefitKind;
  /**
   * What it applies to. A status id, an ability tag, a kaiju category, an
   * equipment id, a chassis id, or a facility effect name. Never a display name.
   */
  readonly target: string;
  /**
   * How much of the thing. Seconds of warning, fraction of a status refused,
   * metres of tracking. Read only by the countermeasure resolver, which knows
   * what the number means for each kind.
   */
  readonly magnitude: number;
  /** What the player is told they got. Plain words, no numbers repeated. */
  readonly summary: string;
}

/** A sample requirement. Named, counted, and checkable. */
export interface SampleRequirement {
  readonly sampleId: string;
  readonly count: number;
}

export interface ResearchNodeDefinition extends RegistryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly branch: ResearchBranch;
  /** Nodes that must be finished first. Ids in this same registry. */
  readonly requires: readonly string[];
  /** Samples consumed when the experiment is started. */
  readonly samples: readonly SampleRequirement[];
  /** Research data spent alongside the samples. */
  readonly dataCost: number;
  /** Credits the programme costs to run. */
  readonly fundingCost: number;
  /** Facility that has to exist, and the tier it has to be at. */
  readonly requiresFacility: { readonly facilityId: string; readonly tier: number } | null;
  /** Researchers the experiment occupies while it runs. */
  readonly staffRequired: number;
  /** Ticks of work at full effectiveness. */
  readonly researchTicks: number;
  readonly benefits: readonly ResearchBenefit[];
  /**
   * The experiment itself, in words.
   *
   * Shown while it runs, so a programme underway is something happening in a lab
   * rather than a progress bar with a name on it.
   */
  readonly experiment: string;
  readonly description: string;
}

/** Shorthand for the common case: a node that needs only what any kill drops. */
function common(count: number): readonly SampleRequirement[] {
  return [
    { sampleId: "sample.hide", count },
    { sampleId: "sample.blood", count },
  ];
}

const NODES: readonly ResearchNodeDefinition[] = [
  // ========================= biology ======================================
  // The root of the tree. Everything that understands a creature starts here,
  // and it costs nothing rare, because nothing else is reachable without it.
  {
    id: "research.biology.dissection",
    displayName: "Field dissection protocol",
    branch: "biology",
    requires: [],
    samples: common(2),
    dataCost: 40,
    fundingCost: 250_000,
    requiresFacility: { facilityId: "research", tier: 1 },
    staffRequired: 2,
    researchTicks: 2_400,
    benefits: [
      {
        kind: "weak-point",
        target: "*",
        magnitude: 0.5,
        summary: "Recovery crews know what to cut and what to leave, so every kill yields more.",
      },
    ],
    experiment: "A carcass on the pad, opened along the ventral line while the blood is still hot.",
    description: "How to take one apart without ruining what is worth having.",
  },
  {
    id: "research.biology.nervous-system",
    displayName: "Nervous system map",
    branch: "biology",
    requires: ["research.biology.dissection"],
    samples: [
      { sampleId: "sample.skeletal", count: 2 },
      { sampleId: "sample.blood", count: 3 },
    ],
    dataCost: 90,
    fundingCost: 480_000,
    requiresFacility: { facilityId: "research", tier: 1 },
    staffRequired: 3,
    researchTicks: 3_600,
    benefits: [
      {
        kind: "telegraph",
        target: "*",
        magnitude: 0.35,
        summary: "The moment before it commits reads on the display, whatever it is about to do.",
      },
    ],
    experiment: "Stimulus response traced through a preserved cord, timing every twitch.",
    description: "Where the signal goes, and how long it takes to get there.",
  },
  {
    id: "research.biology.behavioural-model",
    displayName: "Behavioural model",
    branch: "biology",
    requires: ["research.biology.nervous-system"],
    samples: [
      { sampleId: "sample.cranial", count: 1 },
      { sampleId: "sample.hide", count: 4 },
    ],
    dataCost: 180,
    fundingCost: 900_000,
    requiresFacility: { facilityId: "research", tier: 2 },
    staffRequired: 4,
    researchTicks: 5_400,
    benefits: [
      {
        kind: "telegraph",
        target: "*",
        magnitude: 0.55,
        summary: "Not just that it is winding up, but which way it is going to go.",
      },
      {
        kind: "weak-point",
        target: "*",
        magnitude: 1,
        summary: "Every category's soft zones are marked before the first exchange.",
      },
    ],
    experiment: "Recorded engagements replayed against the nerve map until the tells line up.",
    description: "What it does before it does it.",
  },
  {
    id: "research.biology.live-containment",
    displayName: "Live containment study",
    branch: "biology",
    requires: ["research.biology.behavioural-model"],
    samples: [
      { sampleId: "sample.live-culture", count: 2 },
      { sampleId: "sample.regenerative", count: 1 },
    ],
    dataCost: 400,
    fundingCost: 2_400_000,
    requiresFacility: { facilityId: "kaiju-containment", tier: 1 },
    staffRequired: 6,
    researchTicks: 9_000,
    benefits: [
      {
        kind: "facility",
        target: "containmentYield",
        magnitude: 0.4,
        summary: "The tanks pay their way: a living specimen produces research every day it lives.",
      },
    ],
    experiment: "A specimen alive in the tanks, watched around the clock by people who volunteered.",
    description: "What one does when it is not dying. Optional, and the only way to see it.",
  },

  // ========================= materials ====================================
  {
    id: "research.materials.plate-analysis",
    displayName: "Plate analysis",
    branch: "materials",
    requires: ["research.biology.dissection"],
    samples: common(3),
    dataCost: 70,
    fundingCost: 400_000,
    requiresFacility: { facilityId: "research", tier: 1 },
    staffRequired: 2,
    researchTicks: 3_000,
    benefits: [
      {
        kind: "equipment",
        target: "module.composite-plating",
        magnitude: 1,
        summary: "Composite plating can be fitted in the bays.",
      },
    ],
    experiment: "Sections cut, mounted and driven into until they fail, then measured.",
    description: "Why it holds, and at what point it stops holding.",
  },
  {
    id: "research.materials.laminate",
    displayName: "Kaiju laminate",
    branch: "materials",
    requires: ["research.materials.plate-analysis"],
    samples: [
      { sampleId: "sample.plate-lamina", count: 2 },
      { sampleId: "sample.skeletal", count: 3 },
    ],
    dataCost: 220,
    fundingCost: 1_300_000,
    requiresFacility: { facilityId: "manufacture", tier: 1 },
    staffRequired: 4,
    researchTicks: 6_000,
    benefits: [
      {
        kind: "equipment",
        target: "component.laminate-hull",
        magnitude: 1,
        summary: "Laminate hull sections become buildable, and the exclusive frames need them.",
      },
    ],
    experiment: "Their plate layered into ours in the press, then shot at until one of them wins.",
    description: "Their armour, on our machines.",
  },
  {
    id: "research.materials.ablative",
    displayName: "Ablative shielding",
    branch: "materials",
    requires: ["research.materials.laminate"],
    samples: [
      { sampleId: "sample.vitrified", count: 2 },
      { sampleId: "sample.hide", count: 4 },
    ],
    dataCost: 300,
    fundingCost: 1_800_000,
    requiresFacility: { facilityId: "manufacture", tier: 1 },
    staffRequired: 4,
    researchTicks: 7_200,
    benefits: [
      {
        kind: "status-resist",
        target: "status.burning",
        magnitude: 0.7,
        summary: "Plasma stops sticking. Burning goes out almost as fast as it starts.",
      },
      {
        kind: "status-resist",
        target: "status.corroded",
        magnitude: 0.5,
        summary: "Acid takes the shielding instead of the frame under it.",
      },
    ],
    experiment: "Layers designed to be destroyed, burned off one at a time under a plasma head.",
    description: "Armour that is supposed to come off, so the machine under it does not.",
  },

  // ========================= weapons ======================================
  {
    id: "research.weapons.toxin-analysis",
    displayName: "Toxin analysis",
    branch: "weapons",
    requires: ["research.biology.dissection"],
    samples: common(2),
    dataCost: 60,
    fundingCost: 320_000,
    requiresFacility: { facilityId: "research", tier: 1 },
    staffRequired: 2,
    researchTicks: 2_700,
    benefits: [
      {
        kind: "status-resist",
        target: "status.corroded",
        magnitude: 0.35,
        summary: "Crews know how to neutralise it in the field rather than waiting it out.",
      },
    ],
    experiment: "Blue titrated against every hull coating in the stores, one drop at a time.",
    description: "What their blood does to our metal, and what stops it.",
  },
  {
    id: "research.weapons.harmonic-payload",
    displayName: "Harmonic payload",
    branch: "weapons",
    requires: ["research.weapons.toxin-analysis", "research.biology.nervous-system"],
    samples: [
      { sampleId: "sample.neural", count: 1 },
      { sampleId: "sample.blood", count: 4 },
    ],
    dataCost: 260,
    fundingCost: 1_500_000,
    requiresFacility: { facilityId: "research", tier: 2 },
    staffRequired: 4,
    researchTicks: 6_600,
    benefits: [
      {
        kind: "equipment",
        target: "weapon.harmonic-lance",
        magnitude: 1,
        summary: "The harmonic lance can be fitted. It works on the cord rather than on the plate.",
      },
    ],
    experiment: "Frequencies swept against live cord tissue until one of them stops it dead.",
    description: "A weapon aimed at how they are wired rather than at how thick they are.",
  },
  {
    id: "research.weapons.venom-adaptation",
    displayName: "Venom adaptation",
    branch: "weapons",
    requires: ["research.weapons.toxin-analysis"],
    samples: [
      { sampleId: "sample.venom-gland", count: 1 },
      { sampleId: "sample.conductive", count: 1 },
    ],
    dataCost: 240,
    fundingCost: 1_200_000,
    requiresFacility: { facilityId: "research", tier: 2 },
    staffRequired: 3,
    researchTicks: 5_400,
    benefits: [
      {
        kind: "status-resist",
        target: "status.bleeding",
        magnitude: 0.6,
        summary: "Wound sealant in the lines. A cut stops being a countdown.",
      },
    ],
    experiment: "Their coagulant reversed and reversed again until it works on hydraulic fluid.",
    description: "Optional, and worth it if anything you fight opens holes.",
  },

  // ========================= sensors ======================================
  {
    id: "research.sensors.signature-library",
    displayName: "Signature library",
    branch: "sensors",
    requires: ["research.biology.dissection"],
    samples: common(2),
    dataCost: 50,
    fundingCost: 280_000,
    requiresFacility: { facilityId: "research", tier: 1 },
    staffRequired: 2,
    researchTicks: 2_400,
    benefits: [
      {
        kind: "tracking",
        target: "*",
        magnitude: 400,
        summary: "Contacts hold on the display four hundred metres further out than they did.",
      },
    ],
    experiment: "Every recorded contact reduced to a signature and filed against what it turned out to be.",
    description: "Knowing what you are looking at from further away.",
  },
  {
    id: "research.sensors.thermal-array",
    displayName: "Thermal array",
    branch: "sensors",
    requires: ["research.sensors.signature-library"],
    samples: [
      { sampleId: "sample.skeletal", count: 3 },
      { sampleId: "sample.hide", count: 3 },
    ],
    dataCost: 160,
    fundingCost: 850_000,
    requiresFacility: { facilityId: "research", tier: 1 },
    staffRequired: 3,
    researchTicks: 4_200,
    benefits: [
      {
        kind: "tracking",
        target: "storm",
        magnitude: 900,
        summary: "Weather stops hiding them. A contact in a storm reads as well as one in clear air.",
      },
    ],
    experiment: "Array flown into the worst weather the region has, looking for something known.",
    description: "Seeing through what the sea throws at the sensors.",
  },
  {
    id: "research.sensors.sonar-adaptation",
    displayName: "Adaptive sonar",
    branch: "sensors",
    requires: ["research.sensors.thermal-array"],
    samples: [
      { sampleId: "sample.pressure-adapted", count: 1 },
      { sampleId: "sample.sensory-organ", count: 1 },
    ],
    dataCost: 300,
    fundingCost: 1_600_000,
    requiresFacility: { facilityId: "research", tier: 2 },
    staffRequired: 4,
    researchTicks: 6_600,
    benefits: [
      {
        kind: "tracking",
        target: "water",
        magnitude: 1_200,
        summary: "It cannot break contact by going under any more.",
      },
      {
        kind: "telegraph",
        target: "*",
        magnitude: 0.25,
        summary: "A surfacing attack reads before it surfaces.",
      },
    ],
    experiment: "Their own hearing organ wired to a hydrophone array and asked what it hears.",
    description: "Built out of the organ they use to find us.",
  },

  // ========================= mobility =====================================
  {
    id: "research.mobility.gait-analysis",
    displayName: "Gait analysis",
    branch: "mobility",
    requires: ["research.biology.dissection"],
    samples: common(2),
    dataCost: 60,
    fundingCost: 300_000,
    requiresFacility: { facilityId: "research", tier: 1 },
    staffRequired: 2,
    researchTicks: 2_700,
    benefits: [
      {
        kind: "equipment",
        target: "module.gyro-stabiliser",
        magnitude: 1,
        summary: "Gyroscopic stabilisers can be fitted.",
      },
    ],
    experiment: "Footage of a hundred and forty tons walking, frame by frame, against our own.",
    description: "How something that heavy stays upright, and what we were doing wrong.",
  },
  {
    id: "research.mobility.reactive-footing",
    displayName: "Reactive footing",
    branch: "mobility",
    requires: ["research.mobility.gait-analysis"],
    samples: [
      { sampleId: "sample.limb-actuator", count: 2 },
      { sampleId: "sample.skeletal", count: 2 },
    ],
    dataCost: 200,
    fundingCost: 1_100_000,
    requiresFacility: { facilityId: "manufacture", tier: 1 },
    staffRequired: 3,
    researchTicks: 5_400,
    benefits: [
      {
        kind: "status-resist",
        target: "status.shocked",
        magnitude: 0.5,
        summary: "Actuators ride out a current spike instead of locking.",
      },
    ],
    experiment: "A leg assembly on a shake table, driven until the footing algorithm gives up.",
    description: "Staying up when the ground and the machine both stop cooperating.",
  },

  // ========================= reactor ======================================
  {
    id: "research.reactor.core-containment",
    displayName: "Core containment",
    branch: "reactor",
    requires: ["research.biology.dissection"],
    samples: common(3),
    dataCost: 80,
    fundingCost: 450_000,
    requiresFacility: { facilityId: "reactor", tier: 1 },
    staffRequired: 3,
    researchTicks: 3_600,
    benefits: [
      {
        kind: "facility",
        target: "constructionRate",
        magnitude: 0.15,
        summary:
          "The reactor runs closer to its ceiling safely, so the yards can draw more and build faster.",
      },
    ],
    experiment: "Containment vessel cycled past its rating with nobody on that deck.",
    description: "Getting more out of what is already down there.",
  },
  {
    id: "research.reactor.kaiju-core-study",
    displayName: "Kaiju core study",
    branch: "reactor",
    requires: ["research.reactor.core-containment", "research.biology.behavioural-model"],
    samples: [
      { sampleId: "sample.core-fragment", count: 1 },
      { sampleId: "sample.regenerative", count: 1 },
    ],
    dataCost: 500,
    fundingCost: 3_000_000,
    requiresFacility: { facilityId: "reactor", tier: 2 },
    staffRequired: 6,
    researchTicks: 10_800,
    benefits: [
      {
        kind: "equipment",
        target: "component.resonance-core",
        magnitude: 1,
        summary: "Resonance cores become buildable. Nothing else will drive the exclusive frames.",
      },
    ],
    experiment: "A core fragment held in a field and asked, very carefully, what it is doing.",
    description: "Whatever drives them, driving us instead.",
  },

  // ========================= defense ======================================
  {
    id: "research.defense.coastal-net",
    displayName: "Coastal sensor net",
    branch: "defense",
    requires: ["research.sensors.signature-library"],
    samples: common(3),
    dataCost: 110,
    fundingCost: 600_000,
    requiresFacility: { facilityId: "defense", tier: 1 },
    staffRequired: 3,
    researchTicks: 3_600,
    benefits: [
      {
        kind: "facility",
        target: "defenceStrength",
        magnitude: 0.25,
        summary: "The coastal guns fire on something they saw coming rather than on a bearing.",
      },
    ],
    experiment: "Buoys laid across the approaches and left to listen for a season.",
    description: "Warning, before the thing is already in the harbour.",
  },
  {
    id: "research.defense.breach-shutters",
    displayName: "Breach shutters",
    branch: "defense",
    requires: ["research.defense.coastal-net", "research.materials.plate-analysis"],
    samples: [
      { sampleId: "sample.containment-log", count: 1 },
      { sampleId: "sample.hide", count: 4 },
    ],
    dataCost: 260,
    fundingCost: 1_400_000,
    requiresFacility: { facilityId: "defense", tier: 1 },
    staffRequired: 4,
    researchTicks: 6_000,
    benefits: [
      {
        kind: "facility",
        target: "defenceStrength",
        magnitude: 0.5,
        summary: "The complex can shut itself, and a fight at the doors stops reaching the decks.",
      },
    ],
    experiment: "Shutter assemblies dropped against a ram rig until the mounting fails first.",
    description: "Optional, and the only thing that helps when it comes to you.",
  },

  // ========================= logistics ====================================
  {
    id: "research.logistics.recovery-doctrine",
    displayName: "Recovery doctrine",
    branch: "logistics",
    requires: ["research.biology.dissection"],
    samples: common(2),
    dataCost: 50,
    fundingCost: 260_000,
    requiresFacility: { facilityId: "logistics", tier: 1 },
    staffRequired: 2,
    researchTicks: 2_400,
    benefits: [
      {
        kind: "facility",
        target: "deliverySpeed",
        magnitude: 0.3,
        summary:
          "Recovery crews get the thing home before the tide takes it, and everything else moves faster too.",
      },
    ],
    experiment: "Two crews sent to the same wreck with different orders, and the results compared.",
    description: "Getting the thing home before the tide takes it.",
  },
  {
    id: "research.logistics.field-fabrication",
    displayName: "Field fabrication",
    branch: "logistics",
    requires: ["research.logistics.recovery-doctrine", "research.materials.plate-analysis"],
    samples: [
      { sampleId: "sample.skeletal", count: 3 },
      { sampleId: "sample.hide", count: 3 },
    ],
    dataCost: 190,
    fundingCost: 1_000_000,
    requiresFacility: { facilityId: "logistics", tier: 1 },
    staffRequired: 3,
    researchTicks: 4_800,
    benefits: [
      {
        kind: "facility",
        target: "repairRate",
        magnitude: 0.2,
        summary: "The bays make what they need instead of waiting for it, so a shift of work goes further.",
      },
    ],
    experiment: "A press and a furnace put on the gantry deck to see what can be made in place.",
    description: "Making the part rather than waiting for it.",
  },

  // ========================= chassis ======================================
  // The end of several branches at once, deliberately. An exclusive frame is
  // what a whole programme was for, not a node with a big number on it.
  {
    id: "research.chassis.harmonic-frame",
    displayName: "Harmonic frame programme",
    branch: "chassis",
    requires: [
      "research.materials.laminate",
      "research.weapons.harmonic-payload",
      "research.sensors.thermal-array",
    ],
    samples: [
      { sampleId: "sample.neural", count: 2 },
      { sampleId: "sample.plate-lamina", count: 2 },
      { sampleId: "sample.intact-organ", count: 1 },
    ],
    dataCost: 600,
    fundingCost: 3_600_000,
    requiresFacility: { facilityId: "manufacture", tier: 1 },
    staffRequired: 6,
    researchTicks: 12_000,
    benefits: [
      {
        kind: "chassis",
        target: "harmonic-mk1",
        magnitude: 1,
        summary: "The harmonic frame can be laid down. It cannot be bought from anybody.",
      },
    ],
    experiment: "Three programmes brought into one hangar and argued into a single hull.",
    description: "Materials, weapons and sensors, in one machine nobody sells.",
  },
  {
    id: "research.chassis.leviathan-frame",
    displayName: "Leviathan frame programme",
    branch: "chassis",
    requires: [
      "research.chassis.harmonic-frame",
      "research.reactor.kaiju-core-study",
      "research.materials.ablative",
    ],
    samples: [
      { sampleId: "sample.core-fragment", count: 2 },
      { sampleId: "sample.regenerative", count: 1 },
      { sampleId: "sample.live-culture", count: 1 },
    ],
    dataCost: 1_200,
    fundingCost: 7_200_000,
    requiresFacility: { facilityId: "manufacture", tier: 2 },
    staffRequired: 8,
    researchTicks: 18_000,
    benefits: [
      {
        kind: "chassis",
        target: "leviathan-mk1",
        magnitude: 1,
        summary: "The leviathan frame can be laid down, driven by a core that was alive.",
      },
    ],
    experiment: "A hull built around something still warm, behind glass, on the deepest deck.",
    description: "The end of the tree. Optional, expensive, and unlike anything on the board.",
  },
];

export function validateResearchNode(entry: ResearchNodeDefinition): string[] {
  const errors: string[] = [];
  if (!entry.id.startsWith("research.")) errors.push('id must start with "research."');
  if (entry.displayName.trim().length === 0) errors.push("displayName is required");
  if (!RESEARCH_BRANCHES.includes(entry.branch)) errors.push(`unknown branch "${entry.branch}"`);
  if (entry.requires.includes(entry.id)) errors.push("a node cannot require itself");
  if (new Set(entry.requires).size !== entry.requires.length) errors.push("duplicate prerequisite");
  if (entry.dataCost < 0) errors.push("dataCost cannot be negative");
  if (entry.fundingCost < 0) errors.push("fundingCost cannot be negative");
  if (entry.staffRequired <= 0) errors.push("staffRequired must be positive");
  if (entry.researchTicks <= 0) errors.push("researchTicks must be positive");
  if (entry.benefits.length === 0) {
    // A node that hands nothing over is the "tiny percentage upgrade" failure in
    // its purest form: something to finish for the sake of finishing it.
    errors.push("a node must hand something over");
  }
  for (const benefit of entry.benefits) {
    if (!RESEARCH_BENEFIT_KINDS.includes(benefit.kind)) errors.push(`unknown benefit "${benefit.kind}"`);
    if (benefit.target.trim().length === 0) errors.push("a benefit needs a target");
    if (benefit.magnitude <= 0) errors.push("a benefit magnitude must be positive");
    if (benefit.summary.trim().length === 0) errors.push("a benefit needs a summary");
  }
  for (const requirement of entry.samples) {
    if (!requirement.sampleId.startsWith("sample.")) errors.push(`bad sample "${requirement.sampleId}"`);
    if (requirement.count <= 0) errors.push("a sample requirement must ask for at least one");
    if (requirement.count > 4) {
      // The anti-grind rule, enforced rather than remembered.
      errors.push(`asking for ${requirement.count} of ${requirement.sampleId} is a grind`);
    }
  }
  if (entry.requiresFacility && entry.requiresFacility.tier <= 0)
    errors.push("facility tier must be positive");
  if (entry.experiment.trim().length === 0) errors.push("experiment is required");
  if (entry.description.trim().length === 0) errors.push("description is required");
  return errors;
}

export function createResearchRegistry(): ContentRegistry<ResearchNodeDefinition> {
  const registry = new ContentRegistry<ResearchNodeDefinition>(validateResearchNode);
  for (const entry of NODES) registry.register(entry);
  // Prerequisites are checked after every node is in, because a node is allowed
  // to be authored before the one it depends on.
  for (const entry of NODES) {
    for (const required of entry.requires) {
      if (!registry.has(required)) {
        throw new Error(`Research node "${entry.id}" requires unknown node "${required}"`);
      }
    }
  }
  return registry;
}

export const RESEARCH_NODES = NODES;

/** Nodes with nothing in front of them. Where a fresh campaign can start. */
export function rootNodes(): readonly ResearchNodeDefinition[] {
  return NODES.filter((entry) => entry.requires.length === 0);
}

/** Everything in one branch, in the order it was authored. */
export function branchNodes(branch: ResearchBranch): readonly ResearchNodeDefinition[] {
  return NODES.filter((entry) => entry.branch === branch);
}
