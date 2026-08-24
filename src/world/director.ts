import { ContentRegistry } from "../data/registry";
import {
  combineMutations,
  createMutationRegistry,
  compatible,
  type MutationDefinition,
} from "../data/mutations";
import { createKaijuRegistry, type KaijuDefinition } from "../data/kaiju";
import { createSeededRng, hashStringToSeed, type Rng } from "../simulation/rng";
import type { RegionDefinition } from "./regions";

/**
 * The attack director.
 *
 * Decides what is coming, where, when, and how bad. Everything it does is a
 * function of state the player can see and a seeded stream, so the same seed
 * and the same decisions produce the same war, and a different decision
 * produces a different one.
 *
 * Three rules shape it, and each exists to avoid a specific failure:
 *
 * 1. **It does not spam.** Cooldowns per region, a global recovery window after
 *    anything resolves, and a hard ceiling on how many incidents can be running
 *    at once. Nonstop alerts are not difficulty, they are noise.
 * 2. **It does not decide outcomes in advance.** An incident is a composition
 *    and an arrival time. What happens when it lands is resolved by the fight
 *    or by a transparent strategic model, never by a result written when the
 *    alert was created.
 * 3. **It does not repeat itself.** Recently hit regions are weighted down, and
 *    a region cannot be chosen twice in a row while anywhere else is available.
 *
 * No Babylon, no DOM, no wall clock. Time arrives as ticks.
 */

export const DIRECTOR_SCHEMA_VERSION = 1;

/** How many incidents may be running at once, before frequency is applied. */
export const MAX_ACTIVE_INCIDENTS = 3;
/** Ticks a region is off the table after being chosen. */
export const REGION_COOLDOWN_TICKS = 60_000;
/** Ticks of quiet after anything resolves, before the next roll can succeed. */
export const RECOVERY_WINDOW_TICKS = 18_000;
/** How often the director considers spawning anything at all. */
export const ROLL_INTERVAL_TICKS = 1_800;

export const INCIDENT_STATUSES = ["forecast", "inbound", "landed", "resolved", "expired"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const RESOLUTION_KINDS = ["player-defended", "ai-defended", "ignored", "abandoned"] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

export const OBJECTIVE_KINDS = [
  "defend",
  "intercept",
  "pursue",
  "rescue",
  "contain",
  "escort",
  "research",
  "salvage",
] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

/** One creature in an incident, with whatever it arrived carrying. */
export interface IncidentCombatant {
  readonly kaijuId: string;
  readonly mutationIds: readonly string[];
  /** Combined threat this one contributes, before defences. */
  readonly strength: number;
}

export interface Incident {
  readonly id: string;
  readonly regionId: string;
  /** Where it came out of the water, as a bearing and distance from the region. */
  readonly originBearingDeg: number;
  readonly originDistanceMeters: number;
  /** Waypoints from origin to the shore, as bearings. The approach path. */
  readonly approachBearings: readonly number[];
  readonly combatants: readonly IncidentCombatant[];
  readonly mutationBudget: number;
  /** 0 to 1. How much of the warning is trustworthy. */
  readonly warningConfidence: number;
  /** What it is going for, best first. */
  readonly targetPriorities: readonly string[];
  readonly objective: ObjectiveKind;
  readonly secondaryObjectives: readonly ObjectiveKind[];
  /** Tick it was created and tick it reaches the shore. */
  readonly createdTick: number;
  readonly arrivalTick: number;
  status: IncidentStatus;
  /** Total strength, for forecasting and resolution. */
  readonly strength: number;
}

/** One line of an explanation. Every number the player sees has one of these. */
export interface LedgerLine {
  readonly label: string;
  readonly value: number;
  readonly reason: string;
}

export interface Resolution {
  readonly incidentId: string;
  readonly regionId: string;
  readonly kind: ResolutionKind;
  /** True when the city held. */
  readonly held: boolean;
  /** 0 to 1 of the region's integrity lost. */
  readonly integrityLost: number;
  readonly escalationDelta: number;
  readonly reward: number;
  /** Every contribution, so nothing about the outcome is unexplained. */
  readonly ledger: readonly LedgerLine[];
  readonly summary: string;
}

export interface RegionThreatRecord {
  readonly regionId: string;
  /** 0 to 1. How much attention this region is getting. */
  threat: number;
  /** 0 to 1. What is standing between it and the sea. */
  defense: number;
  /** Tick this region was last chosen. */
  lastChosenTick: number;
  /** Ticks before it may be chosen again. */
  cooldownTicks: number;
  /** How many incidents here the player turned up for. */
  defended: number;
  /** How many they left to the defences. */
  ignored: number;
}

export interface DirectorSnapshot {
  readonly schemaVersion: number;
  readonly escalation: number;
  readonly breachPressure: number;
  readonly crisisFrequency: number;
  readonly nextRollTick: number;
  readonly quietUntilTick: number;
  readonly incidentSeq: number;
  readonly regions: readonly {
    readonly regionId: string;
    readonly threat: number;
    readonly defense: number;
    readonly lastChosenTick: number;
    readonly cooldownTicks: number;
    readonly defended: number;
    readonly ignored: number;
  }[];
  readonly incidents: readonly (Omit<Incident, "status"> & { readonly status: IncidentStatus })[];
  readonly recentRegionIds: readonly string[];
  readonly unresolved: number;
}

export interface DirectorOptions {
  readonly regions: ContentRegistry<RegionDefinition>;
  readonly kaiju?: ContentRegistry<KaijuDefinition>;
  readonly mutations?: ContentRegistry<MutationDefinition>;
  readonly seed: number;
  /** 0.25 to 2. The player's own dial on how often this happens. */
  readonly crisisFrequency?: number;
}

/** What the player is told about an incident before it lands. */
export interface IncidentForecast {
  readonly incidentId: string;
  readonly regionId: string;
  readonly regionName: string;
  /** Ticks until it reaches the shore. Negative once it has. */
  readonly ticksToArrival: number;
  /** How long it takes to get there from the Shatterdome, in ticks. */
  readonly travelTicks: number;
  /** True when the player can still reach it before it lands. */
  readonly reachable: boolean;
  readonly warningConfidence: number;
  /** What the warning can say, given how confident it is. */
  readonly composition: string;
  readonly tells: readonly string[];
  readonly objective: ObjectiveKind;
  readonly secondaryObjectives: readonly ObjectiveKind[];
  /** What the model expects if nobody goes, with the reasons. */
  readonly ignoredForecast: Resolution;
}

export class AttackDirector {
  private readonly regionRegistry: ContentRegistry<RegionDefinition>;
  private readonly kaijuRegistry: ContentRegistry<KaijuDefinition>;
  private readonly mutationRegistry: ContentRegistry<MutationDefinition>;
  private readonly seedValue: number;
  private readonly threatByRegion = new Map<string, RegionThreatRecord>();
  private readonly incidentsById = new Map<string, Incident>();
  private recentRegions: string[] = [];

  escalation = 0.1;
  breachPressure = 0.15;
  crisisFrequency: number;
  private nextRollTick = ROLL_INTERVAL_TICKS;
  private quietUntilTick = 0;
  private incidentSeq = 0;
  private unresolvedCount = 0;

  constructor(options: DirectorOptions) {
    this.regionRegistry = options.regions;
    this.kaijuRegistry = options.kaiju ?? createKaijuRegistry();
    this.mutationRegistry = options.mutations ?? createMutationRegistry();
    this.seedValue = options.seed;
    this.crisisFrequency = clamp(options.crisisFrequency ?? 1, 0.25, 2);
    for (const region of this.regionRegistry.all()) {
      this.threatByRegion.set(region.id, {
        regionId: region.id,
        // Bigger cities draw more attention. That is the whole of the base rate.
        threat: clamp(region.populationThousands / 12_000, 0.05, 0.9),
        defense: region.deploymentPoint ? 0.55 : 0.3,
        lastChosenTick: -REGION_COOLDOWN_TICKS,
        cooldownTicks: 0,
        defended: 0,
        ignored: 0,
      });
    }
  }

  regions(): readonly RegionThreatRecord[] {
    return [...this.threatByRegion.values()];
  }

  threatFor(regionId: string): RegionThreatRecord | undefined {
    return this.threatByRegion.get(regionId);
  }

  incidents(): readonly Incident[] {
    return [...this.incidentsById.values()];
  }

  active(): readonly Incident[] {
    return this.incidents().filter(
      (incident) => incident.status === "forecast" || incident.status === "inbound",
    );
  }

  incident(id: string): Incident | undefined {
    return this.incidentsById.get(id);
  }

  get unresolved(): number {
    return this.unresolvedCount;
  }

  /** The player's dial. Lower means fewer crises, never zero difficulty. */
  setCrisisFrequency(value: number): number {
    this.crisisFrequency = clamp(value, 0.25, 2);
    return this.crisisFrequency;
  }

  /**
   * Moves the war forward.
   *
   * Rolls on a fixed cadence rather than every tick, so the same elapsed time
   * always contains the same number of chances however the frame rate varies.
   */
  advance(tick: number, deltaTicks: number): readonly Incident[] {
    if (deltaTicks <= 0) return [];
    const created: Incident[] = [];

    // Pressure builds on its own and is relieved by resolving things.
    this.breachPressure = clamp(this.breachPressure + deltaTicks * 0.0000012 * this.crisisFrequency, 0, 1);
    // Escalation climbs on its own, faster the more pressure there is behind
    // it, and is pushed back down by every attack that is stopped.
    this.escalation = clamp(this.escalation + deltaTicks * 0.0000015 * (0.25 + this.breachPressure), 0, 1);

    for (const record of this.threatByRegion.values()) {
      record.cooldownTicks = Math.max(0, record.cooldownTicks - deltaTicks);
      // Threat drifts back toward the region's own baseline rather than staying
      // wherever the last attack left it.
      const base = clamp(
        (this.regionRegistry.get(record.regionId)?.populationThousands ?? 0) / 12_000,
        0.05,
        0.9,
      );
      record.threat += (base - record.threat) * Math.min(1, deltaTicks / 200_000);
    }

    for (const incident of this.incidentsById.values()) {
      if (incident.status === "forecast" && tick >= incident.createdTick + 600) {
        incident.status = "inbound";
      }
      if (incident.status === "inbound" && tick >= incident.arrivalTick) {
        incident.status = "landed";
      }
    }

    while (tick >= this.nextRollTick) {
      const rollTick = this.nextRollTick;
      this.nextRollTick += ROLL_INTERVAL_TICKS;
      const incident = this.roll(rollTick);
      if (incident) created.push(incident);
    }

    return created;
  }

  /**
   * One chance at an attack.
   *
   * Refuses, silently and often, which is the point: a director that always
   * produces something is a director that punishes the player for existing.
   */
  private roll(tick: number): Incident | null {
    if (tick < this.quietUntilTick) return null;
    if (this.active().length >= Math.max(1, Math.round(MAX_ACTIVE_INCIDENTS * this.crisisFrequency))) {
      return null;
    }

    const rng = this.stream("roll", tick);
    // Chance rises with pressure and the player's own dial, and is deliberately
    // well under one even at full pressure.
    const chance = clamp(0.12 + this.breachPressure * 0.35, 0, 0.55) * this.crisisFrequency;
    if (rng() > chance) return null;

    const region = this.chooseRegion(rng, tick);
    if (!region) return null;

    return this.createIncident(region, tick, rng);
  }

  /**
   * Picks where.
   *
   * Weighted by threat, population and how poorly defended somewhere is, and
   * pushed away from anywhere recently hit. A region on cooldown is not
   * considered at all.
   */
  private chooseRegion(rng: Rng, tick: number): RegionDefinition | null {
    const candidates: { region: RegionDefinition; weight: number }[] = [];
    for (const region of this.regionRegistry.all()) {
      const record = this.threatByRegion.get(region.id);
      if (!record || record.cooldownTicks > 0) continue;
      let weight = record.threat * (1.4 - record.defense);
      // Anti-repetition: the more recently it was hit, the less likely again.
      const recentIndex = this.recentRegions.indexOf(region.id);
      if (recentIndex >= 0) weight *= 0.2 + recentIndex * 0.25;
      // A region the player never defends starts getting attention, which is a
      // consequence of their habits rather than a punishment for them.
      if (record.ignored > record.defended) weight *= 1.25;
      if (weight > 0) candidates.push({ region, weight });
    }
    if (candidates.length === 0) return null;

    const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * total;
    for (const entry of candidates) {
      roll -= entry.weight;
      if (roll <= 0) {
        void tick;
        return entry.region;
      }
    }
    return candidates[candidates.length - 1]?.region ?? null;
  }

  /** Builds the attack itself: what is coming, from where, and when. */
  private createIncident(region: RegionDefinition, tick: number, rng: Rng): Incident {
    const record = this.threatByRegion.get(region.id);
    this.incidentSeq += 1;
    const id = `incident.${this.incidentSeq}`;

    // Mutation budget is the difficulty curve, and it is visible: a harder
    // attack is a creature carrying more, not a creature with hidden numbers.
    const budget = Math.max(0, Math.round(this.escalation * 8 + this.breachPressure * 4));
    const count = this.escalation > 0.6 && rng() < 0.3 ? 2 : 1;
    const combatants: IncidentCombatant[] = [];
    let spent = 0;
    for (let index = 0; index < count; index += 1) {
      const pool = this.kaijuRegistry.all().filter((entry) => entry.id !== "kaiju.test-dummy");
      const definition = pool[Math.floor(rng() * pool.length)] ?? pool[0];
      if (!definition) continue;
      const mutations = this.chooseMutations(rng, Math.max(0, budget - spent));
      spent += combineMutations(mutations).totalCost;
      const effect = combineMutations(mutations);
      combatants.push({
        kaijuId: definition.id,
        mutationIds: mutations.map((mutation) => mutation.id),
        // Mass in hundreds of tons, so a category four is a real problem for a
        // coastline and a genuine one for a single machine.
        strength:
          (definition.massTons / 100) * effect.damageScale * effect.armourScale * (1 + this.escalation),
      });
    }

    const strength = combatants.reduce((total, entry) => total + entry.strength, 0);
    // Warning quality falls as pressure rises: more happening at once means
    // less certainty about any of it.
    const confidence = clamp(0.9 - this.breachPressure * 0.45 - (count - 1) * 0.15, 0.2, 0.95);
    const travel = 3_600 + Math.round(rng() * 5_400);
    const bearing = region.seawardBearingDeg + (rng() - 0.5) * 60;

    const objectives = OBJECTIVE_KINDS.filter((kind) => kind !== "escort" || region.deploymentPoint);
    const objective = objectives[Math.floor(rng() * objectives.length)] ?? "defend";
    const secondary =
      rng() < 0.4
        ? [objectives[Math.floor(rng() * objectives.length)] ?? "rescue"].filter((kind) => kind !== objective)
        : [];

    const incident: Incident = {
      id,
      regionId: region.id,
      originBearingDeg: normalize360(bearing),
      originDistanceMeters: 40_000 + Math.round(rng() * 90_000),
      approachBearings: [normalize360(bearing), normalize360(bearing + (rng() - 0.5) * 30)],
      combatants,
      mutationBudget: budget,
      warningConfidence: confidence,
      targetPriorities: this.targetsFor(region),
      objective,
      secondaryObjectives: secondary,
      createdTick: tick,
      arrivalTick: tick + travel,
      status: "forecast",
      strength,
    };

    this.incidentsById.set(id, incident);
    if (record) {
      record.lastChosenTick = tick;
      record.cooldownTicks = REGION_COOLDOWN_TICKS;
      record.threat = clamp(record.threat + 0.1, 0, 1);
    }
    this.recentRegions = [region.id, ...this.recentRegions.filter((entry) => entry !== region.id)].slice(
      0,
      4,
    );
    return incident;
  }

  private chooseMutations(rng: Rng, budget: number): MutationDefinition[] {
    const chosen: MutationDefinition[] = [];
    let left = budget;
    const pool = this.mutationRegistry
      .all()
      .filter((mutation) => mutation.minimumEscalation <= this.escalation);
    let guard = 0;
    while (left > 0 && guard < 12) {
      guard += 1;
      const affordable = pool.filter(
        (mutation) =>
          mutation.cost <= left &&
          !chosen.includes(mutation) &&
          chosen.every((existing) => compatible(existing, mutation)),
      );
      if (affordable.length === 0) break;
      const pick = affordable[Math.floor(rng() * affordable.length)];
      if (!pick) break;
      chosen.push(pick);
      left -= pick.cost;
    }
    return chosen;
  }

  private targetsFor(region: RegionDefinition): readonly string[] {
    // What a creature goes for, in order. Data about the region rather than a
    // switch on its name.
    const targets = ["population centre"];
    if (region.deploymentPoint) targets.unshift("Shatterdome");
    if (region.cityPlanId !== null) targets.push("harbour");
    return targets;
  }

  /**
   * What the player is told, and what the model expects if they do nothing.
   *
   * The forecast is honest about its own uncertainty: low confidence hides the
   * detail rather than inventing it.
   */
  forecast(incident: Incident, tick: number, travelTicks: number): IncidentForecast {
    const region = this.regionRegistry.get(incident.regionId);
    const confident = incident.warningConfidence;
    const named = incident.combatants.map((entry) => {
      const definition = this.kaijuRegistry.get(entry.kaijuId);
      return definition?.name ?? entry.kaijuId;
    });
    const tells: string[] = [];
    for (const combatant of incident.combatants) {
      for (const mutationId of combatant.mutationIds) {
        const mutation = this.mutationRegistry.get(mutationId);
        // A weak signal reports fewer of the tells, rather than making them up.
        if (mutation && confident > 0.45) tells.push(mutation.tell);
      }
    }

    const ticksToArrival = incident.arrivalTick - tick;
    return {
      incidentId: incident.id,
      regionId: incident.regionId,
      regionName: region?.displayName ?? incident.regionId,
      ticksToArrival,
      travelTicks,
      reachable: ticksToArrival > travelTicks,
      warningConfidence: confident,
      composition:
        confident > 0.7
          ? `${named.length} confirmed: ${named.join(", ")}`
          : confident > 0.4
            ? `${named.length} contact${named.length === 1 ? "" : "s"}, category uncertain`
            : "signal too weak to say what it is",
      tells,
      objective: incident.objective,
      secondaryObjectives: incident.secondaryObjectives,
      ignoredForecast: this.resolve(incident, "ignored", { apply: false }),
    };
  }

  /**
   * Works out what happens to an incident nobody flies to.
   *
   * A transparent model, not a die roll: every contribution is a ledger line
   * with a reason, and the same inputs always produce the same outcome. The
   * seeded stream only decides the margin, so a close-run thing can go either
   * way without the whole result being luck.
   */
  resolve(
    incident: Incident,
    kind: ResolutionKind,
    options: { readonly apply?: boolean; readonly playerStrength?: number } = {},
  ): Resolution {
    const apply = options.apply ?? true;
    const record = this.threatByRegion.get(incident.regionId);
    const region = this.regionRegistry.get(incident.regionId);
    const ledger: LedgerLine[] = [];

    const attack = incident.strength;
    ledger.push({ label: "Kaiju strength", value: -attack, reason: describeComposition(incident) });

    let defence = (record?.defense ?? 0.3) * 40;
    ledger.push({
      label: "Regional defences",
      value: defence,
      reason: `${Math.round((record?.defense ?? 0) * 100)} percent of the coastline is covered`,
    });

    if (kind === "player-defended" && options.playerStrength) {
      defence += options.playerStrength;
      ledger.push({
        label: "Jaeger on station",
        value: options.playerStrength,
        reason: "a machine was there",
      });
    }

    const populationPenalty = ((region?.populationThousands ?? 0) / 20_000) * 8;
    defence -= populationPenalty;
    ledger.push({
      label: "Civilian density",
      value: -populationPenalty,
      reason: "more people to move means less room to fight",
    });

    // The margin, and the one place chance enters. It cannot flip a rout.
    const rng = this.stream("resolve", hashStringToSeed(incident.id));
    const swing = (rng() - 0.5) * attack * 0.25;
    ledger.push({ label: "How it went on the day", value: swing, reason: "the margin, not the result" });

    const net = defence + swing - attack;
    const held = net >= 0;
    const severity = clamp(-net / Math.max(1, attack), 0, 1);
    const integrityLost = held ? severity * 0.05 : 0.08 + severity * 0.35;
    const escalationDelta = held ? -0.03 : 0.05 + severity * 0.08;
    const reward = held ? Math.round(attack * 120 + (kind === "player-defended" ? attack * 80 : 0)) : 0;

    ledger.push({
      label: "City integrity",
      value: -integrityLost,
      reason: held ? "held, with damage where it came ashore" : "the line did not hold",
    });
    ledger.push({
      label: "Escalation",
      value: escalationDelta,
      reason: held ? "a loss for them slows the next one" : "an unanswered attack invites the next one",
    });
    if (reward > 0) {
      ledger.push({
        label: "Funding",
        value: reward,
        reason: kind === "player-defended" ? "paid for the sortie and the result" : "paid for the result",
      });
    }

    const resolution: Resolution = {
      incidentId: incident.id,
      regionId: incident.regionId,
      kind,
      held,
      integrityLost,
      escalationDelta,
      reward,
      ledger,
      summary: held
        ? `${region?.displayName ?? incident.regionId} held. ${describeComposition(incident)}`
        : `${region?.displayName ?? incident.regionId} was overrun. ${describeComposition(incident)}`,
    };

    if (apply) this.applyResolution(incident, resolution);
    return resolution;
  }

  private applyResolution(incident: Incident, resolution: Resolution): void {
    incident.status = "resolved";
    const record = this.threatByRegion.get(incident.regionId);
    if (record) {
      if (resolution.kind === "player-defended") record.defended += 1;
      else record.ignored += 1;
      record.threat = clamp(record.threat + (resolution.held ? -0.08 : 0.12), 0, 1);
      record.defense = clamp(record.defense - resolution.integrityLost * 0.5, 0.05, 1);
    }
    this.escalation = clamp(this.escalation + resolution.escalationDelta, 0, 1);
    this.breachPressure = clamp(this.breachPressure - (resolution.held ? 0.06 : 0.01), 0, 1);
    // A recovery window after anything resolves, so the player gets to breathe.
    this.quietUntilTick = Math.max(
      this.quietUntilTick,
      incident.arrivalTick + Math.round(RECOVERY_WINDOW_TICKS / this.crisisFrequency),
    );
  }

  /** Marks an incident nobody answered and nobody defended. */
  expire(incidentId: string): Resolution | null {
    const incident = this.incidentsById.get(incidentId);
    if (!incident || incident.status === "resolved" || incident.status === "expired") return null;
    this.unresolvedCount += 1;
    const resolution = this.resolve(incident, "abandoned");
    incident.status = "expired";
    return resolution;
  }

  /** Forgets resolved incidents older than this many ticks, to bound the list. */
  prune(tick: number, keepTicks = 120_000): number {
    let removed = 0;
    for (const [id, incident] of [...this.incidentsById.entries()]) {
      const done = incident.status === "resolved" || incident.status === "expired";
      if (done && tick - incident.arrivalTick > keepTicks) {
        this.incidentsById.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  private stream(name: string, salt: number): Rng {
    return createSeededRng((hashStringToSeed(`director|${name}`) ^ this.seedValue ^ (salt | 0)) >>> 0);
  }

  snapshot(): DirectorSnapshot {
    return {
      schemaVersion: DIRECTOR_SCHEMA_VERSION,
      escalation: round(this.escalation),
      breachPressure: round(this.breachPressure),
      crisisFrequency: this.crisisFrequency,
      nextRollTick: this.nextRollTick,
      quietUntilTick: this.quietUntilTick,
      incidentSeq: this.incidentSeq,
      regions: this.regions().map((record) => ({
        regionId: record.regionId,
        threat: round(record.threat),
        defense: round(record.defense),
        lastChosenTick: record.lastChosenTick,
        cooldownTicks: Math.round(record.cooldownTicks),
        defended: record.defended,
        ignored: record.ignored,
      })),
      incidents: this.incidents().map((incident) => ({ ...incident })),
      recentRegionIds: [...this.recentRegions],
      unresolved: this.unresolvedCount,
    };
  }

  restore(snapshot: DirectorSnapshot): void {
    this.escalation = clamp(snapshot.escalation, 0, 1);
    this.breachPressure = clamp(snapshot.breachPressure, 0, 1);
    this.crisisFrequency = clamp(snapshot.crisisFrequency, 0.25, 2);
    this.nextRollTick = Math.max(0, snapshot.nextRollTick);
    this.quietUntilTick = Math.max(0, snapshot.quietUntilTick);
    this.incidentSeq = Math.max(0, snapshot.incidentSeq);
    this.unresolvedCount = Math.max(0, snapshot.unresolved);
    this.recentRegions = snapshot.recentRegionIds.filter((id) => this.threatByRegion.has(id)).slice(0, 4);

    for (const record of snapshot.regions) {
      const existing = this.threatByRegion.get(record.regionId);
      // A region this build no longer has is dropped rather than resurrected.
      if (!existing) continue;
      existing.threat = clamp(record.threat, 0, 1);
      existing.defense = clamp(record.defense, 0, 1);
      existing.lastChosenTick = record.lastChosenTick;
      existing.cooldownTicks = Math.max(0, record.cooldownTicks);
      existing.defended = Math.max(0, Math.round(record.defended));
      existing.ignored = Math.max(0, Math.round(record.ignored));
    }

    this.incidentsById.clear();
    for (const incident of snapshot.incidents) {
      if (!this.threatByRegion.has(incident.regionId)) continue;
      this.incidentsById.set(incident.id, { ...incident });
    }
  }
}

function describeComposition(incident: Incident): string {
  const parts = incident.combatants.map((combatant) => {
    const mutations = combatant.mutationIds.length;
    return `${combatant.kaijuId.replace("kaiju.", "")}${mutations > 0 ? ` with ${mutations} mutation${mutations === 1 ? "" : "s"}` : ""}`;
  });
  return parts.join(" and ");
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalize360(degrees: number): number {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

export function emptyDirectorSnapshot(): DirectorSnapshot {
  return {
    schemaVersion: DIRECTOR_SCHEMA_VERSION,
    escalation: 0.1,
    breachPressure: 0.15,
    crisisFrequency: 1,
    nextRollTick: ROLL_INTERVAL_TICKS,
    quietUntilTick: 0,
    incidentSeq: 0,
    regions: [],
    incidents: [],
    recentRegionIds: [],
    unresolved: 0,
  };
}

export function validateDirectorSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null) return ["director snapshot must be an object"];
  const record = snapshot as Record<string, unknown>;
  const errors: string[] = [];
  if (record["schemaVersion"] !== DIRECTOR_SCHEMA_VERSION) {
    errors.push(`director.schemaVersion must be ${DIRECTOR_SCHEMA_VERSION}`);
  }
  for (const key of ["escalation", "breachPressure", "crisisFrequency"] as const) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(`director.${key} must be a number at or above zero`);
    }
  }
  for (const key of ["regions", "incidents", "recentRegionIds"] as const) {
    if (!Array.isArray(record[key])) errors.push(`director.${key} must be an array`);
  }
  if (Array.isArray(record["incidents"])) {
    for (const entry of record["incidents"] as unknown[]) {
      const incident = entry as Record<string, unknown>;
      if (typeof incident["id"] !== "string") errors.push("every incident needs an id");
      if (!INCIDENT_STATUSES.includes(incident["status"] as IncidentStatus)) {
        errors.push(`unknown incident status "${String(incident["status"])}"`);
      }
    }
  }
  return errors;
}
