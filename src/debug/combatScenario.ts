import { createMoveRegistry } from "../data/moves";
import { createKaijuRegistry } from "../data/kaiju";
import { jaegerRegistry } from "../data/jaegers";
import {
  CombatArena,
  combatProfileFor,
  jaegerZones,
  kaijuCombatProfile,
  kaijuZones,
  type ArenaSnapshot,
  type CombatEvent,
} from "../combat/arena";

/**
 * A deterministic exchange.
 *
 * Two fighters in an arena, both running the same resolver, both throwing moves
 * out of the same table on a fixed schedule. No RNG, no wall clock, no renderer:
 * the same scenario run twice produces the same events, the same damage and the
 * same digest, which is what makes "they can exchange attacks deterministically"
 * something a test can assert rather than something to be watched.
 */

export const COMBAT_SCENARIO_TICKS = 900;

export interface CombatScenarioOptions {
  readonly jaegerId?: string;
  readonly kaijuId?: string;
  readonly ticks?: number;
  /**
   * The player's script: which move to press on which tick. Presses go through
   * the buffer, so a press made during a recovery is taken the instant it
   * becomes legal rather than being dropped.
   */
  readonly script?: readonly { readonly tick: number; readonly moveId: string }[];
  /** Ticks between the kaiju's own attacks. */
  readonly kaijuCadenceTicks?: number;
  /** Metres apart the two start. */
  readonly separationMeters?: number;
  /** Body zone the machine aims for. Null fights the silhouette rather than the creature. */
  readonly aimZoneId?: string | null;
}

export interface CombatScenarioResult {
  readonly ticks: number;
  readonly events: readonly CombatEvent[];
  readonly snapshot: ArenaSnapshot;
  readonly digest: number;
  readonly hits: number;
  readonly guarded: number;
  readonly rejected: number;
  readonly cancels: number;
  readonly whiffs: number;
  readonly reactions: readonly string[];
  readonly damageToKaiju: number;
  readonly damageToJaeger: number;
  readonly zonesDestroyed: readonly string[];
  readonly winner: string | null;
}

/**
 * The default exchange: jab into cross into a heavy, over and over.
 *
 * Generated from the run length rather than written out, so a longer scenario is
 * a longer fight rather than a fight followed by silence. The pattern is fixed,
 * so it is still exactly reproducible.
 */
function defaultScript(ticks: number): { tick: number; moveId: string }[] {
  const script: { tick: number; moveId: string }[] = [];
  // A jab into a cross inside the jab's cancel window, then a heavy once the
  // cross has landed. That is a combo rather than three separate attacks, and it
  // is what exercises the cancel rules rather than only the timing.
  const finishers = ["melee.heavy.overhead", "melee.launcher.uppercut", "melee.guard-break.shoulder"];
  let index = 0;
  for (let tick = 30; tick < ticks; tick += 120) {
    script.push({ tick, moveId: "melee.light.jab" });
    script.push({ tick: tick + 10, moveId: "melee.light.cross" });
    script.push({ tick: tick + 22, moveId: finishers[index % finishers.length] ?? "melee.heavy.overhead" });
    index += 1;
  }
  return script;
}

export function runCombatScenario(options: CombatScenarioOptions = {}): CombatScenarioResult {
  const moves = createMoveRegistry();
  const kaijuRegistry = createKaijuRegistry();
  const jaeger = jaegerRegistry.getOrThrow(options.jaegerId ?? "placeholder-mk0");
  const kaiju = kaijuRegistry.getOrThrow(options.kaijuId ?? "kaiju.test-dummy");
  // Close enough that a light attack reaches: a jab tops out at 26 m of reach
  // plus its own radius, and the creature's torso is 16 m across.
  const separation = options.separationMeters ?? 36;
  const ticks = options.ticks ?? COMBAT_SCENARIO_TICKS;
  const cadence = options.kaijuCadenceTicks ?? 210;

  const arena = new CombatArena({
    moves,
    fighters: [
      {
        id: "jaeger",
        kind: "jaeger",
        displayName: jaeger.name,
        heightMeters: jaeger.locomotion.heightMeters,
        profile: combatProfileFor(jaeger),
        pose: { east: 0, north: 0, up: 0, yawDeg: 0 },
        zones: jaegerZones(jaeger),
        finisherThreshold: 0.2,
      },
      {
        id: "kaiju",
        kind: "kaiju",
        displayName: kaiju.name,
        heightMeters: kaiju.heightMeters,
        profile: kaijuCombatProfile(kaiju),
        pose: { east: 0, north: separation, up: 0, yawDeg: 180 },
        zones: kaijuZones(kaiju),
        kaiju,
        finisherThreshold: kaiju.finisherThreshold,
      },
    ],
  });

  // A pilot going for the core rather than swinging at the biggest thing in
  // front of them. This is what aim mode is for, and it is the difference
  // between a long exchange and a finished fight.
  arena.setAim("jaeger", options.aimZoneId === undefined ? "core" : options.aimZoneId);

  const script = options.script ?? defaultScript(ticks);
  const pressesByTick = new Map<number, string[]>();
  for (const entry of script) {
    const list = pressesByTick.get(entry.tick) ?? [];
    list.push(entry.moveId);
    pressesByTick.set(entry.tick, list);
  }

  for (let tick = 0; tick < ticks; tick += 1) {
    for (const moveId of pressesByTick.get(tick) ?? []) arena.press("jaeger", moveId);
    // The kaiju attacks on its own cadence and alternates what it throws. This
    // is a schedule, not behaviour: the attack director is a later milestone and
    // pretending otherwise would be a fake system.
    if (tick > 0 && tick % cadence === 0) {
      arena.press("kaiju", tick % (cadence * 2) === 0 ? "kaiju.claw.swipe" : "kaiju.tail.sweep");
    }
    // Both keep facing each other, at the turn authority their current move allows.
    arena.faceToward("jaeger", "kaiju", 2.2);
    arena.faceToward("kaiju", "jaeger", 1.4);
    arena.step();
  }

  const events = arena.log();
  const snapshot = arena.snapshot();
  const kaijuView = snapshot.fighters.find((fighter) => fighter.id === "kaiju");
  const jaegerView = snapshot.fighters.find((fighter) => fighter.id === "jaeger");

  return {
    ticks,
    events,
    snapshot,
    digest: arena.digest(),
    hits: events.filter((event) => event.type === "hit").length,
    guarded: events.filter((event) => event.type === "guarded").length,
    rejected: events.filter((event) => event.type === "attack-rejected").length,
    cancels: events.filter((event) => event.type === "attack-cancelled").length,
    whiffs: events.filter((event) => event.type === "whiffed").length,
    reactions: events.filter((event) => event.type === "reaction").map((event) => event.reaction ?? "none"),
    damageToKaiju: events
      .filter((event) => event.targetId === "kaiju")
      .reduce((total, event) => total + event.damage, 0),
    damageToJaeger: events
      .filter((event) => event.targetId === "jaeger")
      .reduce((total, event) => total + event.damage, 0),
    zonesDestroyed: events
      .filter((event) => event.type === "zone-destroyed")
      .map((event) => `${event.actorId}.${event.zoneId ?? "?"}`),
    winner: kaijuView?.defeated === true ? "jaeger" : jaegerView?.defeated === true ? "kaiju" : null,
  };
}

/** One line per event, for a log a person can read. */
export function describeEvent(event: CombatEvent): string {
  const parts = [`t${event.tick}`, event.type, event.actorId];
  if (event.moveId) parts.push(event.moveId);
  if (event.volumeId) parts.push(`volume ${event.volumeId}`);
  if (event.targetId) parts.push(`-> ${event.targetId}`);
  if (event.zoneId) parts.push(`zone ${event.zoneId}`);
  if (event.damage > 0) parts.push(`${event.damage} damage`);
  if (event.reaction && event.reaction !== "none") parts.push(event.reaction);
  if (event.reason) parts.push(event.reason);
  return parts.join(" · ");
}
