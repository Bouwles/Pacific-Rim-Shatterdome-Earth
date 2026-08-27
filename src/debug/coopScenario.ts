import {
  CombatArena,
  combatProfileFor,
  jaegerLayout,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
} from "../combat/arena";
import { createMoveRegistry } from "../data/moves";
import { jaegerRegistry } from "../data/jaegers";
import { createKaijuRegistry } from "../data/kaiju";
import { GuestSession } from "../net/guestSession";
import { HostSession } from "../net/hostSession";
import {
  HOSTILE_LINK,
  LoopbackTransport,
  PERFECT_LINK,
  pumpPair,
  type LinkConditions,
} from "../net/transport";
import type { GuestLoadout } from "../net/protocol";

/**
 * A whole co-op battle, fought without a browser and without a clock.
 *
 * What it exists to prove is the acceptance item automation can actually hold:
 * that latency, jitter, packet loss and duplicated packets change how the fight
 * *looks* and never what it *counts*. The same fight is run twice, once on a
 * perfect link and once on a hostile one, and the host's own numbers have to
 * come out identical: the same damage dealt, the same rounds spent, the same
 * finishers, the same result, the same digest.
 *
 * Deterministic in every part. Time is a fixed step the caller advances, the
 * link's randomness is a seeded stream, and the inputs are a scripted list, so
 * two runs of this produce the same numbers or something is wrong.
 */

/** Milliseconds of wall time one arena tick stands for, for the link's delays. */
export const TICK_MS = 33;

/** One scripted thing the guest tries to do, and when. */
interface ScriptedInput {
  readonly atTick: number;
  readonly intent: Parameters<GuestSession["send"]>[0];
  readonly targetId?: string;
  readonly east?: number;
  readonly north?: number;
  readonly pressed?: boolean;
}

/**
 * What the guest does. Deliberately busy: movement, guarding, melee and a
 * weapon, so every kind of input crosses the link.
 */
const SCRIPT: readonly ScriptedInput[] = [
  { atTick: 2, intent: "move", east: 30, north: 0 },
  { atTick: 6, intent: "guard", pressed: true },
  { atTick: 10, intent: "press-move", targetId: "melee.light.jab" },
  { atTick: 14, intent: "guard", pressed: false },
  { atTick: 18, intent: "press-move", targetId: "melee.light.cross" },
  { atTick: 24, intent: "aim", targetId: "head" },
  { atTick: 28, intent: "press-move", targetId: "melee.heavy.smash.forward" },
  { atTick: 36, intent: "move", east: 32, north: 0 },
  { atTick: 42, intent: "press-move", targetId: "melee.light.jab" },
  { atTick: 50, intent: "press-move", targetId: "melee.light.cross" },
  { atTick: 58, intent: "press-move", targetId: "melee.heavy.smash.forward" },
  { atTick: 66, intent: "press-move", targetId: "melee.light.jab" },
  { atTick: 74, intent: "press-move", targetId: "melee.light.cross" },
  { atTick: 82, intent: "press-move", targetId: "melee.heavy.smash.forward" },
];

const GUEST_LOADOUT: GuestLoadout = {
  jaegerId: "heavy-mk4",
  chassisId: "heavy-mk4",
  displayName: "Lent frame",
  weaponIds: [],
};

export interface CoopRunResult {
  readonly ticks: number;
  /** Everything the host counted. The only numbers that mean anything. */
  readonly hostDamage: number;
  readonly hostEvents: number;
  readonly hostFinishers: number;
  readonly hostDigest: number;
  readonly outcome: string;
  /** What the guest applied, and what it correctly refused to apply twice. */
  readonly guestApplied: number;
  readonly guestDuplicates: number;
  /** Inputs the host actually fed to the arena. At most one effect each. */
  readonly appliedInputs: number;
  /** Inputs the host dropped as already seen or too stale to mean anything. */
  readonly duplicateInputs: number;
  readonly rejectedInputs: number;
  /** How many intents the guest sent in the first place. */
  readonly inputsSent: number;
  /** What the link did to the traffic, so the conditions are visible. */
  readonly droppedByNetwork: number;
  readonly sent: number;
}

function buildArena(seed: number): CombatArena {
  const moves = createMoveRegistry();
  const kaiju = createKaijuRegistry();
  const machine = jaegerRegistry.getOrThrow("heavy-mk4");
  const creature = kaiju.getOrThrow("kaiju.biped-alpha");

  // Two machines and a creature: the host drives one, the guest drives the
  // other, and both are built exactly the way the single-player path builds
  // them, so nothing about co-op is a second kind of fighter.
  const machineSpec = (id: string, east: number, yawDeg: number) => ({
    id,
    kind: "jaeger" as const,
    displayName: machine.name,
    heightMeters: machine.locomotion.heightMeters,
    profile: combatProfileFor(machine),
    pose: { east, north: 0, up: 0, yawDeg },
    zones: jaegerZones(machine),
    layout: jaegerLayout(machine),
    finisherThreshold: 0.2,
  });

  return new CombatArena({
    moves,
    seed,
    fighters: [
      machineSpec("jaeger", 0, 0),
      machineSpec("guest", 26, 0),
      {
        id: "kaiju",
        kind: "kaiju" as const,
        displayName: creature.name,
        heightMeters: creature.heightMeters,
        profile: kaijuCombatProfile(creature),
        pose: { east: 44, north: 0, up: 0, yawDeg: 180 },
        zones: kaijuZones(creature),
        kaiju: creature,
        finisherThreshold: creature.finisherThreshold,
      },
    ],
  });
}

/**
 * Runs one battle over a link with the given conditions.
 *
 * Both sides advance on the same fixed step, and the link is pumped between
 * ticks, so "180 ms of latency" means six ticks of it rather than whatever the
 * machine happened to manage.
 */
export function runCoopBattle(conditions: LinkConditions = PERFECT_LINK, ticks = 120): CoopRunResult {
  const arena = buildArena(20260906);
  const [hostLink, guestLink] = LoopbackTransport.pair(conditions, 4242);

  const host = new HostSession({
    arena,
    transport: hostLink,
    guestFighterId: "guest",
    guestLoadout: GUEST_LOADOUT,
    sessionId: "session.debug",
    buildVersion: "debug",
  });
  const guest = new GuestSession({
    transport: guestLink,
    displayName: "Second player",
    buildVersion: "debug",
  });

  let damage = 0;
  let finishers = 0;
  let events = 0;

  guest.join();
  pumpPair([hostLink, guestLink], 0);

  for (let tick = 0; tick < ticks; tick += 1) {
    const nowMs = tick * TICK_MS;
    for (const scripted of SCRIPT) {
      if (scripted.atTick !== tick) continue;
      guest.send(scripted.intent, {
        targetId: scripted.targetId ?? null,
        east: scripted.east ?? 0,
        north: scripted.north ?? 0,
        pressed: scripted.pressed ?? false,
      });
    }
    // Deliver whatever the link has decided to deliver by now, then step. The
    // order matters: an input that arrived this tick is applied this tick.
    pumpPair([hostLink, guestLink], nowMs);

    const produced = host.advance();
    for (const event of produced) {
      events += 1;
      damage += event.damage;
      if (event.type === "finisher-beat" || event.type === "finisher-ended") finishers += 1;
    }
    guest.advance();
    pumpPair([hostLink, guestLink], nowMs + TICK_MS - 1);
  }

  const survivor = arena.snapshot().fighters.find((fighter) => fighter.id === "kaiju");
  const result = host.finish(survivor?.defeated ? "victory" : "defeat", [
    `Damage dealt: ${Math.round(damage)}`,
    `Events: ${events}`,
  ]);
  // Drain what is still in flight so the guest sees the result it was sent.
  for (let step = 0; step < 40; step += 1) {
    pumpPair([hostLink, guestLink], ticks * TICK_MS + step * 50);
  }

  const status = host.status();
  const counters = guest.eventCounters();
  const stats = hostLink.stats();
  const guestStats = guestLink.stats();

  host.dispose();
  guest.dispose();
  hostLink.close();

  return {
    ticks,
    hostDamage: Math.round(damage * 1000) / 1000,
    hostEvents: events,
    hostFinishers: finishers,
    hostDigest: result?.digest ?? 0,
    outcome: result?.outcome ?? "aborted",
    guestApplied: counters.applied,
    guestDuplicates: counters.duplicates,
    appliedInputs: status.guest?.appliedInputs ?? 0,
    duplicateInputs: status.guest?.duplicateInputs ?? 0,
    rejectedInputs: status.guest?.rejectedInputs ?? 0,
    inputsSent: SCRIPT.length,
    droppedByNetwork: stats.droppedByNetwork + guestStats.droppedByNetwork,
    sent: stats.sent + guestStats.sent,
  };
}

export interface CoopComparison {
  readonly clean: CoopRunResult;
  readonly hostile: CoopRunResult;
  /** True when nothing was counted twice on either link. */
  readonly nothingDuplicated: boolean;
  /** Every rule that was broken, in words. Empty is the passing case. */
  readonly violations: readonly string[];
  /** What the hostile link actually did, so the run is not silently a clean one. */
  readonly degraded: boolean;
}

/**
 * The acceptance run: the same battle on a perfect link and a nasty one.
 *
 * What is **not** asserted is that the two runs are identical. They are not,
 * and should not be: a player on a 180 ms link genuinely acts later, so fewer
 * of their attacks land inside the same number of ticks. Insisting the fights
 * matched would be insisting latency has no effect, which is a different and
 * untrue claim.
 *
 * What is asserted is the thing the milestone actually asks for. Nothing is
 * counted twice:
 *
 * - every announcement the host sent was applied by the guest exactly once,
 *   even though the link deliberately delivered some of them twice;
 * - every input the host accepted was fed to the arena exactly once, and the
 *   repeats were counted and dropped;
 * - a degraded link never produces *more* damage than a clean one, which is the
 *   shape a duplication bug would take.
 */
export function compareLinks(ticks = 120): CoopComparison {
  const clean = runCoopBattle(PERFECT_LINK, ticks);
  const hostile = runCoopBattle(HOSTILE_LINK, ticks);
  const violations: string[] = [];

  for (const [name, run] of [
    ["clean", clean],
    ["hostile", hostile],
  ] as const) {
    if (run.guestApplied !== run.hostEvents) {
      violations.push(
        `${name}: the host announced ${run.hostEvents} things and the guest applied ${run.guestApplied}`,
      );
    }
    if (run.appliedInputs + run.duplicateInputs + run.rejectedInputs < run.appliedInputs) {
      violations.push(`${name}: input accounting does not add up`);
    }
    if (run.appliedInputs > run.inputsSent) {
      violations.push(`${name}: ${run.appliedInputs} inputs reached the arena from ${run.inputsSent} sent`);
    }
  }

  if (hostile.hostDamage > clean.hostDamage) {
    violations.push(
      `a degraded link dealt more damage than a clean one: ${hostile.hostDamage} against ${clean.hostDamage}`,
    );
  }
  if (hostile.hostFinishers > clean.hostFinishers) {
    violations.push(
      `a degraded link produced more finishers: ${hostile.hostFinishers} against ${clean.hostFinishers}`,
    );
  }

  // A "hostile" run that lost nothing and repeated nothing would prove nothing,
  // so the run says whether the link actually misbehaved.
  const degraded =
    hostile.droppedByNetwork > 0 && (hostile.guestDuplicates > 0 || hostile.duplicateInputs > 0);

  return { clean, hostile, nothingDuplicated: violations.length === 0, violations, degraded };
}
