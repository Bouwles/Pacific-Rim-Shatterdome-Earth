import { createPartRegistry, partsForSlot, STRUCTURAL_SLOTS, type PartSlot } from "../data/parts";
import { assemble, emptyBlueprint, starterBlueprint, type Blueprint } from "../custom/blueprint";
import { createSeededRng, hashStringToSeed } from "../simulation/rng";

/**
 * The builder, exercised headlessly.
 *
 * What this proves: that the part catalogue can actually produce legal machines,
 * that it can also produce illegal ones for real reasons rather than arbitrary
 * ones, and that builds made of different parts come out genuinely different
 * rather than converging on one shape.
 *
 * Deterministic from a seed. No world, no renderer, no clock.
 */

export const BUILDER_SCENARIO_SEED = 20260831;

/** Three builds somebody would actually make, plus the noise of random ones. */
export const BUILD_ARCHETYPES = ["brawler", "sprinter", "gunline"] as const;
export type BuildArchetype = (typeof BUILD_ARCHETYPES)[number];

/** A named build, so the balance tests read as builds rather than as ids. */
export function archetypeBlueprint(archetype: BuildArchetype): Blueprint {
  const base = emptyBlueprint(`blueprint.${archetype}`);
  const rows: Readonly<Record<BuildArchetype, Partial<Record<PartSlot, readonly string[]>>>> = {
    // Heavy, planted, and slow enough that anything can leave whenever it likes.
    brawler: {
      head: ["part.head.armoured"],
      torso: ["part.torso.balanced"],
      arms: ["part.arms.heavy"],
      legs: ["part.legs.heavy"],
      reactor: ["part.reactor.standard"],
      armor: ["part.armor.ablative"],
      movement: ["part.movement.stabiliser"],
      weapon: ["part.weapon.chainsword"],
    },
    // Everything light. Cannot take a hit and does not intend to be there.
    sprinter: {
      head: ["part.head.standard"],
      torso: ["part.torso.compact"],
      arms: ["part.arms.light"],
      legs: ["part.legs.sprint"],
      reactor: ["part.reactor.standard"],
      armor: ["part.armor.radiator"],
      movement: ["part.movement.booster"],
      weapon: ["part.weapon.chainsword"],
    },
    // Built around its magazines and the heat of what empties them.
    gunline: {
      head: ["part.head.sensor"],
      torso: ["part.torso.magazine"],
      arms: ["part.arms.heavy"],
      legs: ["part.legs.heavy"],
      reactor: ["part.reactor.output"],
      armor: ["part.armor.radiator"],
      movement: ["part.movement.stabiliser"],
      weapon: ["part.weapon.cannon", "part.weapon.plasma"],
      ability: ["part.ability.vent"],
    },
  };
  return { ...base, name: archetype, parts: { ...base.parts, ...rows[archetype] } };
}

export interface BuilderScenarioResult {
  readonly archetype: BuildArchetype;
  readonly legal: boolean;
  readonly violations: readonly string[];
  readonly warnings: readonly string[];
  readonly massTons: number;
  readonly balance: number;
  readonly mobilityScale: number;
  readonly armorRating: number;
  readonly powerSpareMw: number;
  readonly heatSpare: number;
  readonly ammunitionVolume: number;
  readonly cost: number;
  readonly digest: number;
}

export function runBuilderScenario(archetype: BuildArchetype): BuilderScenarioResult {
  const registry = createPartRegistry();
  const blueprint = archetypeBlueprint(archetype);
  const result = assemble(blueprint, registry);
  const { stats } = result;
  return {
    archetype,
    legal: result.legal,
    violations: result.issues.filter((i) => i.severity === "violation").map((i) => i.message),
    warnings: result.issues.filter((i) => i.severity === "warning").map((i) => i.message),
    massTons: stats.massTons,
    balance: stats.balance,
    mobilityScale: stats.mobilityScale,
    armorRating: stats.armorRating,
    powerSpareMw: stats.powerOutputMw - stats.powerDrawMw,
    heatSpare: stats.heatDissipation - stats.heatOutput,
    ammunitionVolume: stats.ammunitionVolume,
    cost: stats.cost,
    digest:
      (stats.massTons * 31 +
        Math.round(stats.balance * 1000) * 7 +
        Math.round(stats.mobilityScale * 1000)) >>>
      0,
  };
}

export function compareArchetypes(): readonly BuilderScenarioResult[] {
  return BUILD_ARCHETYPES.map(runBuilderScenario);
}

export interface RandomSweepResult {
  readonly tried: number;
  readonly legal: number;
  /** Distinct violation messages seen, so nothing refuses for a mystery reason. */
  readonly refusalKinds: readonly string[];
  /** Distinct digests among the legal builds. Builds must not converge. */
  readonly distinctLegalShapes: number;
}

/**
 * Random builds, to see what the catalogue actually allows.
 *
 * The point is not that random builds are good. It is that a meaningful share of
 * them are legal, that the illegal ones are refused for stated reasons, and that
 * the legal ones are not all the same machine.
 */
export function sweepRandomBuilds(count = 240, seed = BUILDER_SCENARIO_SEED): RandomSweepResult {
  const registry = createPartRegistry();
  const rng = createSeededRng((hashStringToSeed("builder|sweep") ^ seed) >>> 0);
  const refusals = new Set<string>();
  const shapes = new Set<number>();
  let legal = 0;

  for (let attempt = 0; attempt < count; attempt += 1) {
    const base = emptyBlueprint(`blueprint.sweep.${attempt}`);
    const parts: Record<PartSlot, readonly string[]> = { ...base.parts };
    for (const slot of STRUCTURAL_SLOTS) {
      const options = partsForSlot(slot);
      const pick = options[Math.floor(rng() * options.length)];
      if (pick) parts[slot] = [pick.id];
    }
    // Nought to two weapons, so hardpoints and ammunition both get exercised.
    const weapons = partsForSlot("weapon");
    const weaponCount = Math.floor(rng() * 3);
    const chosenWeapons: string[] = [];
    for (let index = 0; index < weaponCount; index += 1) {
      const pick = weapons[Math.floor(rng() * weapons.length)];
      if (pick) chosenWeapons.push(pick.id);
    }
    parts.weapon = chosenWeapons;

    const result = assemble({ ...base, name: `sweep-${attempt}`, parts }, registry);
    if (result.legal) {
      legal += 1;
      shapes.add(
        (result.stats.massTons * 31 +
          Math.round(result.stats.balance * 1000) * 7 +
          Math.round(result.stats.mobilityScale * 1000)) >>>
          0,
      );
    }
    for (const issue of result.issues) {
      if (issue.severity !== "violation") continue;
      // Keep the shape of the reason rather than its numbers, so the set stays
      // a list of kinds rather than a list of every arithmetic result.
      refusals.add(issue.message.replace(/\d+/g, "N"));
    }
  }

  return {
    tried: count,
    legal,
    refusalKinds: [...refusals].sort(),
    distinctLegalShapes: shapes.size,
  };
}

/** The starter build, which must always be legal or a new campaign is stuck. */
export function starterIsLegal(): boolean {
  return assemble(starterBlueprint(), createPartRegistry()).legal;
}
