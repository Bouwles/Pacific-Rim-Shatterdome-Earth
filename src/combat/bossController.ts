import type { TitanRegion } from "./titanBreak";

/**
 * Knifehead's brain.
 *
 * A readable state and utility controller with a memory of what it has just
 * thrown, three behaviour phases, distance and arena awareness, an eye on
 * its own broken regions, and an answer to a player who repeats themselves.
 * It never reads the player's inputs; it reads what the player has done.
 *
 * Deterministic: a seeded generator picks between weighted options, so the
 * same seed and the same fight give the same creature.
 */

export type BossPhase = "hunter" | "wounded" | "desperate";

export type BossAction =
  | "kaiju.charge.blade"
  | "kaiju.claw.left"
  | "kaiju.claw.right"
  | "kaiju.claw.swipe"
  | "kaiju.blade.sweep"
  | "kaiju.blade.down"
  | "kaiju.bite.clinch"
  | "kaiju.shove"
  | "kaiju.tail.sweep";

export type BossMovement = "approach" | "circle" | "hold" | "retreat" | "reposition" | "recover";

export interface BossSense {
  readonly tick: number;
  readonly distanceMeters: number;
  /** Bearing from the creature to the machine, and the creature's own heading. */
  readonly bearingToPlayerDeg: number;
  readonly headingDeg: number;
  /** Where the machine is relative to the creature's facing, degrees, -180 to 180. */
  readonly playerOffsetDeg: number;
  readonly playerAttacking: boolean;
  readonly playerRecovering: boolean;
  readonly playerGuarding: boolean;
  readonly playerOverheated: boolean;
  readonly playerAiming: boolean;
  /** Lateral speed of the machine around the creature, metres per second. */
  readonly playerLateralMps: number;
  /** Hits the creature has taken in the last two seconds. */
  readonly recentHitsTaken: number;
  readonly healthFraction: number;
  readonly poiseFraction: number;
  /** The creature is staggered, down or otherwise not in control. */
  readonly reeling: boolean;
  readonly busy: boolean;
  readonly regions: Readonly<Record<TitanRegion, { readonly broken: boolean; readonly severed: boolean }>>;
  readonly adaptation: "none" | "armor-through" | "evade";
  /** Nearest water deep enough to hide in: bearing and distance, or null. */
  readonly water: { readonly bearingDeg: number; readonly distanceMeters: number } | null;
  readonly inWater: boolean;
}

export interface BossDecision {
  readonly action: BossAction | null;
  readonly movement: BossMovement;
  readonly speedScale: number;
  readonly phase: BossPhase;
  /** For the presentation: a stumble after a charge on a broken leg. */
  readonly stumble: boolean;
  /** The reason, for the debug view. */
  readonly why: string;
}

interface Candidate {
  readonly action: BossAction;
  readonly weight: number;
  readonly why: string;
}

/** Signature families: the repetition rule counts these, not raw ids. */
const SIGNATURE: Readonly<Record<BossAction, string>> = {
  "kaiju.charge.blade": "charge",
  "kaiju.claw.left": "claws",
  "kaiju.claw.right": "claws",
  "kaiju.claw.swipe": "claws",
  "kaiju.blade.sweep": "sweep",
  "kaiju.blade.down": "drive",
  "kaiju.bite.clinch": "bite",
  "kaiju.shove": "shove",
  "kaiju.tail.sweep": "tail",
};

const CADENCE: Readonly<Record<BossPhase, readonly [number, number]>> = {
  hunter: [150, 220],
  wounded: [130, 190],
  desperate: [90, 130],
};

export class BossController {
  private seed: number;
  private cooldownTicks = 40;
  private readonly memory: string[] = [];
  private stringStep = 0;
  private stringLeftFirst = true;
  private stumbleTicks = 0;
  private repositionTicks = 0;
  private idleTicks = 0;
  private lastActionTick = 0;
  private hideUntilTick = 0;
  private lastShoveTick = -10_000;
  phaseValue: BossPhase = "hunter";
  actionsTaken = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0 || 1;
  }

  get phase(): BossPhase {
    return this.phaseValue;
  }

  get history(): readonly string[] {
    return this.memory;
  }

  /** The presentation asks whether a broken leg tripped it. */
  get stumbling(): boolean {
    return this.stumbleTicks > 0;
  }

  private random(): number {
    // xorshift32: small, fast, deterministic.
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4_294_967_296;
  }

  private between(low: number, high: number): number {
    return low + Math.floor(this.random() * (high - low + 1));
  }

  private phaseFor(sense: BossSense): BossPhase {
    const broken = Object.values(sense.regions).filter((region) => region.broken).length;
    if (sense.healthFraction <= 0.27) return "desperate";
    if (broken >= 1 || sense.healthFraction <= 0.62) return "wounded";
    return "hunter";
  }

  private repeats(signature: string): number {
    let count = 0;
    for (let i = this.memory.length - 1; i >= 0; i -= 1) {
      if (this.memory[i] === signature) count += 1;
      else break;
    }
    return count;
  }

  step(sense: BossSense): BossDecision {
    const phase = this.phaseFor(sense);
    const phaseChanged = phase !== this.phaseValue;
    this.phaseValue = phase;
    const legBroken = sense.regions["leg.L"].broken || sense.regions["leg.R"].broken;
    const legsBroken = sense.regions["leg.L"].broken && sense.regions["leg.R"].broken;
    const speedScale =
      (legsBroken ? 0.6 : legBroken ? 0.78 : 1) *
      (phase === "desperate" ? 1.15 : phase === "wounded" ? 1.05 : 1);

    if (this.stumbleTicks > 0) {
      this.stumbleTicks -= 1;
      return {
        action: null,
        movement: "hold",
        speedScale,
        phase,
        stumble: true,
        why: "stumbling on the broken leg",
      };
    }
    if (sense.reeling) {
      this.idleTicks = 0;
      return { action: null, movement: "hold", speedScale, phase, stumble: false, why: "reeling" };
    }
    if (sense.busy) {
      this.idleTicks = 0;
      return { action: null, movement: "hold", speedScale, phase, stumble: false, why: "committed" };
    }

    // A wounded creature near deep water goes to it when its balance is
    // gone, and comes back out with a charge.
    if (this.repositionTicks > 0) {
      this.repositionTicks -= 1;
      if (sense.tick >= this.hideUntilTick) {
        this.repositionTicks = 0;
        this.cooldownTicks = 0;
      } else {
        return {
          action: null,
          movement: "reposition",
          speedScale,
          phase,
          stumble: false,
          why: "to the water",
        };
      }
    }
    if (
      phase !== "hunter" &&
      sense.poiseFraction > 0.75 &&
      sense.water &&
      sense.water.distanceMeters < 140 &&
      !sense.inWater &&
      this.random() < 0.012
    ) {
      this.repositionTicks = 300;
      this.hideUntilTick = sense.tick + 240;
      this.remember("water");
      return {
        action: null,
        movement: "reposition",
        speedScale,
        phase,
        stumble: false,
        why: "breaking off to the water",
      };
    }

    if (this.cooldownTicks > 0) this.cooldownTicks -= 1;
    const distance = sense.distanceMeters;
    const facing = Math.abs(sense.playerOffsetDeg) < 40;
    const behind = Math.abs(sense.playerOffsetDeg) > 120;

    // Movement while waiting: close at range, circle when it has the space,
    // hold when it is on top of the machine.
    let movement: BossMovement =
      distance > 60 ? "approach" : distance > 34 ? (this.random() < 0.5 ? "circle" : "approach") : "hold";
    if (behind) movement = "approach";

    this.idleTicks += 1;
    const forced = this.idleTicks > 240 && distance < 120;
    if (this.cooldownTicks > 0 && !forced) {
      return {
        action: null,
        movement,
        speedScale,
        phase,
        stumble: false,
        why: `waiting ${this.cooldownTicks}`,
      };
    }

    // Candidates by range, weighted by phase, regions, memory and adaptation.
    const candidates: Candidate[] = [];
    const armL = sense.regions["arm.L"];
    const armR = sense.regions["arm.R"];
    const head = sense.regions.head;
    if (distance > 70 && distance < 260 && !sense.inWater) {
      candidates.push({
        action: "kaiju.charge.blade",
        weight: (head.broken ? 0.5 : 1) * (phase === "hunter" ? 1.3 : 1),
        why: "range, charge",
      });
    }
    if (distance <= 70 && distance > 24 && phase !== "hunter" && this.random() < 0.6) {
      candidates.push({
        action: "kaiju.charge.blade",
        weight: 0.45 * (head.broken ? 0.5 : 1),
        why: "short charge",
      });
    }
    if (distance <= 52) {
      if (!armL.severed)
        candidates.push({
          action: "kaiju.claw.left",
          weight: (armL.broken ? 0.45 : 1) * 1.1,
          why: "claw string",
        });
      if (!armR.severed)
        candidates.push({
          action: "kaiju.claw.right",
          weight: (armR.broken ? 0.45 : 1) * 1.1,
          why: "claw string",
        });
      if (armL.severed && armR.severed)
        candidates.push({ action: "kaiju.claw.swipe", weight: 0.6, why: "stumps" });
      candidates.push({
        action: "kaiju.blade.sweep",
        weight: (head.broken ? 0.3 : 0.6) + Math.min(1, Math.abs(sense.playerLateralMps) / 12) * 0.6,
        why: "sweep the circle",
      });
      candidates.push({
        action: "kaiju.blade.down",
        weight: (head.broken ? 0.3 : 0.7) + (sense.playerGuarding ? 0.9 : 0),
        why: "drive through the guard",
      });
      if (sense.playerRecovering && sense.poiseFraction < 0.5 && facing)
        candidates.push({ action: "kaiju.bite.clinch", weight: 1.4, why: "bite the recovery" });
      if (sense.playerOverheated || sense.playerAiming)
        candidates.push({ action: "kaiju.bite.clinch", weight: 0.9, why: "punish the reactor" });
      if (
        (sense.recentHitsTaken >= 4 || sense.adaptation === "armor-through") &&
        sense.tick - this.lastShoveTick > 720
      )
        candidates.push({ action: "kaiju.shove", weight: 1.6, why: "shove off the pressure" });
      if (behind && !sense.regions.tail.severed)
        candidates.push({ action: "kaiju.tail.sweep", weight: 1.5, why: "tail at the flank" });
    }
    if (distance <= 34 && phase === "desperate") {
      candidates.push({ action: "kaiju.claw.right", weight: 0.8, why: "frenzy" });
      candidates.push({ action: "kaiju.shove", weight: 0.5, why: "frenzy" });
    }

    // The repetition rule: never the same signature three times running, and
    // twice is already unlikely.
    const weighted = candidates
      .map((candidate) => {
        const repeats = this.repeats(SIGNATURE[candidate.action]);
        const scale = repeats >= 2 ? 0 : repeats === 1 ? 0.35 : 1;
        return { ...candidate, weight: candidate.weight * scale };
      })
      .filter((candidate) => candidate.weight > 0);

    if (weighted.length === 0) {
      if (forced) this.idleTicks = 0;
      return { action: null, movement, speedScale, phase, stumble: false, why: "nothing in range" };
    }
    const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
    let pick = this.random() * total;
    let chosen = weighted[weighted.length - 1]!;
    for (const candidate of weighted) {
      pick -= candidate.weight;
      if (pick <= 0) {
        chosen = candidate;
        break;
      }
    }

    // Claw strings come in twos or threes, alternating arms, with the second
    // arm's pace; the string is one signature in memory.
    let action = chosen.action;
    if (action === "kaiju.claw.left" || action === "kaiju.claw.right") {
      if (this.stringStep === 0) {
        this.stringLeftFirst = action === "kaiju.claw.left";
        this.stringStep = 1;
      } else {
        action =
          this.stringLeftFirst === (this.stringStep % 2 === 1) ? "kaiju.claw.right" : "kaiju.claw.left";
        if (sense.regions[action === "kaiju.claw.left" ? "arm.L" : "arm.R"].severed)
          action = "kaiju.claw.swipe";
        this.stringStep += 1;
      }
      const stringLength = phase === "hunter" ? 2 : 3;
      if (this.stringStep >= stringLength) {
        this.stringStep = 0;
        this.cooldownTicks = this.between(...CADENCE[phase]);
        this.remember("claws");
      } else {
        this.cooldownTicks = 32;
      }
    } else {
      this.stringStep = 0;
      this.cooldownTicks = this.between(...CADENCE[phase]);
      this.remember(SIGNATURE[action]);
    }
    if (action === "kaiju.charge.blade" && legBroken) this.stumbleTicks = 48;
    if (action === "kaiju.shove") this.lastShoveTick = sense.tick;
    if (phaseChanged) this.cooldownTicks = Math.min(this.cooldownTicks, 40);
    this.idleTicks = 0;
    this.lastActionTick = sense.tick;
    this.actionsTaken += 1;
    return {
      action,
      movement: action === "kaiju.charge.blade" ? "hold" : movement,
      speedScale,
      phase,
      stumble: false,
      why: chosen.why,
    };
  }

  private remember(signature: string): void {
    this.memory.push(signature);
    if (this.memory.length > 12) this.memory.shift();
  }
}
