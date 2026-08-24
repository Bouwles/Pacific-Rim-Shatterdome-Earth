import {
  createLocomotionFamilyRegistry,
  type LocomotionFamilyDefinition,
  type Medium,
} from "../data/locomotionFamilies";
import { grantedAbilities, phaseAt, type BodyZoneId, type KaijuDefinition } from "../data/kaiju";
import type { ContentRegistry } from "../data/registry";
import type { DamageKind } from "../data/moves";
import {
  createGoalRegistry,
  decide,
  situationFrom,
  type BehaviorProfile,
  type Decision,
  type Goal,
  type GoalDefinition,
} from "./behavior";
import { bearingTo, mediumAt, nextStep, turnToward, type NavStep, type NavigationQuery } from "./navigation";
import { DEFAULT_SENSES, SenseSystem, type SenseProfile, type SenseStimulus } from "./senses";

/**
 * One living creature.
 *
 * The place the framework comes together: senses produce contacts, contacts
 * produce a situation, the situation produces a goal, the goal produces
 * somewhere to be, and navigation works out how to get there given what this
 * body can do. Body state - armour, organs, severed limbs, phase - feeds back
 * into all of it.
 *
 * Nothing here knows any creature by name. Everything that makes a serpent
 * different from a burrower arrives as data on the definition.
 */

export interface CreatureOptions {
  readonly definition: KaijuDefinition;
  readonly east: number;
  readonly north: number;
  readonly headingDeg?: number;
  readonly seed?: number;
  readonly families?: ContentRegistry<LocomotionFamilyDefinition>;
  readonly goals?: ContentRegistry<GoalDefinition>;
}

/** What the world tells a creature each tick. */
export interface CreatureInputs {
  readonly stimuli: readonly SenseStimulus[];
  readonly world: NavigationQuery;
  /** Where the thing it wants to destroy is, or null when it has no objective. */
  readonly objective: { readonly east: number; readonly north: number } | null;
  /** Where the nearest food is, or null. */
  readonly food: { readonly east: number; readonly north: number } | null;
  /** True when deep water is within reach of where it stands. */
  readonly waterNearby: boolean;
  /** True when something climbable is within reach. */
  readonly climbableNearby: boolean;
  /**
   * Somewhere it would rather lie in wait: deep water for a swimmer, cover for
   * a climber. Injected, because where a good hiding place is depends on the
   * world rather than on the creature.
   */
  readonly hideSpot?: { readonly east: number; readonly north: number } | null;
}

/** Everything a debug view needs, and the same numbers the creature acted on. */
export interface CreatureDebug {
  readonly id: string;
  readonly displayName: string;
  readonly goal: Goal;
  readonly goalReason: string;
  readonly considered: Decision["considered"];
  readonly contacts: readonly {
    readonly sourceId: string;
    readonly kind: string;
    readonly confidence: number;
    readonly distanceMeters: number;
    readonly ageSeconds: number;
  }[];
  readonly medium: Medium;
  readonly navOutcome: string;
  readonly navReason: string;
  readonly speedMps: number;
  readonly phase: string;
  readonly abilities: readonly string[];
  readonly severed: readonly BodyZoneId[];
  readonly armorLeft: readonly { readonly zoneId: BodyZoneId; readonly fraction: number }[];
  readonly organsLeft: readonly { readonly id: string; readonly fraction: number }[];
  readonly frustration: number;
}

export class Creature {
  readonly definition: KaijuDefinition;
  readonly family: LocomotionFamilyDefinition;
  private readonly senses: SenseSystem;
  private readonly goals: ContentRegistry<GoalDefinition>;
  private readonly profile: BehaviorProfile;

  east: number;
  north: number;
  headingDeg: number;
  medium: Medium = "ground";
  /** 0 to 1 of the lethal zone's health. Drives phases, retreat and enrage. */
  healthFraction = 1;
  poiseFraction = 1;
  /** 0 to 1. Rises when it cannot get where it wants, and drives flanking. */
  frustration = 0;

  private goal: Goal | null = null;
  private goalReason = "just arrived";
  private considered: Decision["considered"] = [];
  private step: NavStep | null = null;
  private readonly armorHealth = new Map<BodyZoneId, number>();
  private readonly organHealth = new Map<string, number>();
  private readonly severed = new Set<BodyZoneId>();

  constructor(options: CreatureOptions) {
    this.definition = options.definition;
    const families = options.families ?? createLocomotionFamilyRegistry();
    this.family = families.getOrThrow(options.definition.locomotion);
    this.goals = options.goals ?? createGoalRegistry();
    this.east = options.east;
    this.north = options.north;
    this.headingDeg = options.headingDeg ?? 0;

    // Definition senses override the defaults one kind at a time, so a creature
    // that only says something about vibration keeps ordinary eyes.
    const byKind = new Map<string, SenseProfile>();
    for (const profile of DEFAULT_SENSES) byKind.set(profile.kind, profile);
    for (const profile of options.definition.senses) byKind.set(profile.kind, profile);
    this.senses = new SenseSystem([...byKind.values()], options.seed ?? 0);

    this.profile = {
      weights: options.definition.behavior.weights,
      caution: options.definition.behavior.caution,
      objectiveFocus: options.definition.behavior.objectiveFocus,
      appetite: options.definition.behavior.appetite,
      enrageBelow: options.definition.behavior.enrageBelow,
      family: this.family,
    };

    for (const plate of options.definition.armor) this.armorHealth.set(plate.zoneId, plate.health);
    for (const organ of options.definition.organs) this.organHealth.set(organ.id, organ.health);
  }

  get id(): string {
    return this.definition.id;
  }

  currentGoal(): Goal | null {
    return this.goal;
  }

  /** Abilities this creature can still use, given which organs still work. */
  abilities(): readonly string[] {
    const granted = grantedAbilities(this.definition, this.organHealth);
    const lost = new Set<string>();
    for (const limb of this.definition.severable) {
      if (this.severed.has(limb.zoneId)) for (const ability of limb.disables) lost.add(ability);
    }
    return granted.filter((ability) => !lost.has(ability));
  }

  /** True when this creature can still do the named thing. */
  can(ability: string): boolean {
    return this.abilities().includes(ability);
  }

  /**
   * Puts damage on the creature's outer layers.
   *
   * Armour first, then any organ in that zone, and the remainder is what the
   * arena applies to the zone itself. Resistances scale the whole thing, so a
   * creature that shrugs off heat shrugs it off everywhere.
   */
  absorb(
    zoneId: BodyZoneId,
    amount: number,
    kind: DamageKind,
  ): { readonly toZone: number; readonly notes: readonly string[] } {
    const notes: string[] = [];
    const resistance = this.definition.resistances[kind] ?? 1;
    let left = Math.max(0, amount * resistance);

    const plate = this.definition.armor.find((entry) => entry.zoneId === zoneId);
    if (plate) {
      const plateLeft = this.armorHealth.get(zoneId) ?? 0;
      if (plateLeft > 0) {
        const absorbed = Math.min(plateLeft, left * plate.absorption);
        this.armorHealth.set(zoneId, plateLeft - absorbed);
        left -= absorbed;
        if (plateLeft - absorbed <= 0) notes.push(`armour on the ${zoneId} is off`);
      }
    }

    for (const organ of this.definition.organs) {
      if (organ.zoneId !== zoneId) continue;
      const organLeft = this.organHealth.get(organ.id) ?? 0;
      if (organLeft <= 0) continue;
      // An organ takes a share of what gets past the plate; it is a target
      // inside a zone rather than a separate body part.
      const share = Math.min(organLeft, left * 0.35);
      this.organHealth.set(organ.id, organLeft - share);
      left -= share;
      if (organLeft - share <= 0) {
        notes.push(`${organ.displayName.toLowerCase()} destroyed: ${organ.grants.join(", ")} lost`);
      }
    }

    return { toZone: Math.max(0, left), notes };
  }

  /** Takes an appendage off. What it disables comes from the definition. */
  sever(zoneId: BodyZoneId): string | null {
    const limb = this.definition.severable.find((entry) => entry.zoneId === zoneId);
    if (!limb || this.severed.has(zoneId)) return null;
    this.severed.add(zoneId);
    return `${zoneId} severed: ${limb.disables.join(", ") || "movement"} affected`;
  }

  /** Movement multiplier from everything currently missing. */
  movementScale(): number {
    let scale = 1;
    for (const limb of this.definition.severable) {
      if (this.severed.has(limb.zoneId)) scale *= limb.movementScale;
    }
    const phase = phaseAt(this.definition, this.healthFraction);
    if (phase) scale *= phase.speedScale;
    return scale;
  }

  /** Damage multiplier from the phase it is in. */
  damageScale(): number {
    return phaseAt(this.definition, this.healthFraction)?.damageScale ?? 1;
  }

  /** Records that something hurt it, which is a sense of its own. */
  remember(sourceId: string, east: number, north: number, damage: number): void {
    this.senses.remember(sourceId, east, north, damage);
  }

  /**
   * One tick of being alive.
   *
   * Senses, then a decision, then a step. The order matters: a creature acts on
   * what it believes, and what it believes is refreshed before it decides.
   */
  advance(deltaSeconds: number, inputs: CreatureInputs): CreatureDebug {
    const snapshot = this.senses.perceive(
      inputs.stimuli,
      { east: this.east, north: this.north, headingDeg: this.headingDeg },
      deltaSeconds,
    );

    this.medium = mediumAt(this.east, this.north, this.family, inputs.world);
    const objectiveDistance = inputs.objective
      ? Math.hypot(inputs.objective.east - this.east, inputs.objective.north - this.north)
      : Number.POSITIVE_INFINITY;
    const foodDistance = inputs.food
      ? Math.hypot(inputs.food.east - this.east, inputs.food.north - this.north)
      : Number.POSITIVE_INFINITY;

    const situation = situationFrom({
      snapshot,
      self: { east: this.east, north: this.north },
      healthFraction: this.healthFraction,
      poiseFraction: this.poiseFraction,
      objectiveDistanceMeters: objectiveDistance,
      feedDistanceMeters: foodDistance,
      medium: this.medium,
      waterNearby: inputs.waterNearby,
      climbableNearby: inputs.climbableNearby,
      routeBlocked: this.step?.outcome === "blocked",
      frustration: this.frustration,
      phase: this.definition.phases.findIndex(
        (phase) => phase.id === phaseAt(this.definition, this.healthFraction)?.id,
      ),
    });

    const decision = decide(this.goals, situation, this.profile, this.goal);
    this.goal = decision.goal;
    this.goalReason = decision.reason;
    this.considered = decision.considered;

    // Where the goal wants the body to be. One table, no switch on a name.
    const target = this.targetFor(decision.goal, snapshot.best, inputs);
    if (target) {
      const step = nextStep(
        { east: this.east, north: this.north, headingDeg: this.headingDeg },
        target,
        this.family,
        inputs.world,
      );
      this.step = step;

      const desired = bearingTo({ east: this.east, north: this.north }, step);
      const speed = step.speedMps * this.movementScale();
      this.headingDeg = turnToward(this.headingDeg, desired, this.family, speed, deltaSeconds);

      if (step.outcome === "blocked") {
        // It wanted to go somewhere and could not. That is what frustration is.
        this.frustration = Math.min(1, this.frustration + deltaSeconds * 0.4);
      } else {
        this.frustration = Math.max(0, this.frustration - deltaSeconds * 0.1);
        // Only travel along the heading it actually has, so a creature that
        // cannot turn fast arcs toward its target instead of sliding sideways.
        const radians = (this.headingDeg * Math.PI) / 180;
        const distance = speed * deltaSeconds;
        this.east += Math.sin(radians) * distance;
        this.north += Math.cos(radians) * distance;
        this.medium = step.medium;
      }
    }

    return this.debug(snapshot);
  }

  /**
   * Where a goal wants the body.
   *
   * A lookup rather than a switch statement on a creature: every goal resolves
   * to a point, and the differences between creatures are already in the
   * decision that picked the goal.
   */
  private targetFor(
    goal: Goal,
    best: { east: number; north: number } | null,
    inputs: CreatureInputs,
  ): { east: number; north: number } | null {
    const contact = best ?? null;
    switch (goal) {
      case "destroy-objective":
        return inputs.objective;
      case "feed":
        return inputs.food;
      case "retreat":
        // Away from what is hurting it, along the line it came from.
        return contact
          ? { east: this.east - (contact.east - this.east), north: this.north - (contact.north - this.north) }
          : null;
      case "flank": {
        if (!contact) return null;
        // Ninety degrees off the direct line, which is what going around means.
        const bearing = bearingTo({ east: this.east, north: this.north }, contact) + 70;
        const radians = (bearing * Math.PI) / 180;
        const reach = Math.max(120, Math.hypot(contact.east - this.east, contact.north - this.north) * 0.8);
        return { east: this.east + Math.sin(radians) * reach, north: this.north + Math.cos(radians) * reach };
      }
      case "ambush":
        // Move to somewhere worth waiting in, then stop. A creature that simply
        // freezes where it stands is not ambushing, it is stuck.
        return inputs.hideSpot ?? null;
      case "hunt":
        // Sweep toward the last thing it half heard, or straight on.
        return (
          contact ?? {
            east: this.east + Math.sin((this.headingDeg * Math.PI) / 180) * 400,
            north: this.north + Math.cos((this.headingDeg * Math.PI) / 180) * 400,
          }
        );
      default:
        return contact ?? inputs.objective;
    }
  }

  debug(snapshot = this.senses.snapshot()): CreatureDebug {
    return {
      id: this.definition.id,
      displayName: this.definition.name,
      goal: this.goal ?? "hunt",
      goalReason: this.goalReason,
      considered: this.considered,
      contacts: snapshot.contacts.map((contact) => ({
        sourceId: contact.sourceId,
        kind: contact.kind,
        confidence: contact.confidence,
        distanceMeters: Math.hypot(contact.east - this.east, contact.north - this.north),
        ageSeconds: contact.ageSeconds,
      })),
      medium: this.medium,
      navOutcome: this.step?.outcome ?? "none",
      navReason: this.step?.reason ?? "has not moved yet",
      speedMps: (this.step?.speedMps ?? 0) * this.movementScale(),
      phase: phaseAt(this.definition, this.healthFraction)?.displayName ?? "unhurt",
      abilities: this.abilities(),
      severed: [...this.severed],
      armorLeft: this.definition.armor.map((plate) => ({
        zoneId: plate.zoneId,
        fraction: (this.armorHealth.get(plate.zoneId) ?? 0) / plate.health,
      })),
      organsLeft: this.definition.organs.map((organ) => ({
        id: organ.id,
        fraction: (this.organHealth.get(organ.id) ?? 0) / organ.health,
      })),
      frustration: this.frustration,
    };
  }
}
