import { Squad } from "../allies/squad";
import { AllyController, resolveSquadIntents, type AllyInputs } from "../allies/allyController";
import { createSquadOrderRegistry, type SquadOrderId } from "../data/squadOrders";
import { createAllyCrewRegistry } from "../data/allyCrews";
import type { AllySituation } from "../allies/allyBehavior";

/**
 * A fight from the squad's side, run headlessly.
 *
 * What this proves: an ally does something useful with no orders at all, an
 * order changes what it does promptly, two allies do not pick the same body
 * zone or both burn a signature on the same swing, and none of it depends on
 * an arena, a scene or a clock.
 */

export const SQUAD_SCENARIO_SEED = 20260827;

/** A plain, middle-of-the-road fight, for varying one thing at a time. */
export function baselineSituation(overrides: Partial<AllySituation> = {}): AllySituation {
  return {
    targetDistanceMeters: 120,
    markedDistanceMeters: 120,
    onMarkedTarget: true,
    healthFraction: 1,
    playerHealthFraction: 1,
    playerDistanceMeters: 140,
    anchorDistanceMeters: Number.POSITIVE_INFINITY,
    civilianDistanceMeters: 900,
    ammunitionFraction: 1,
    friendlyInLine: false,
    nearestAllyMeters: 200,
    zoneContested: false,
    routeBlocked: false,
    frustration: 0,
    playerCommitted: false,
    ...overrides,
  };
}

function baselineInputs(overrides: Partial<AllyInputs> = {}): AllyInputs {
  return {
    situation: baselineSituation(),
    position: { east: 0, north: 0 },
    playerPosition: { east: 100, north: 0 },
    targetPosition: { east: 120, north: 40 },
    markedPosition: { east: 120, north: 40 },
    anchor: null,
    civilianPosition: { east: -500, north: 0 },
    targetZoneIds: ["head", "torso", "left-arm", "right-arm", "tail"],
    claimedZones: [],
    signatureWindow: false,
    ...overrides,
  };
}

export interface SquadScenarioResult {
  /** What each crew chose, in order. */
  readonly goals: readonly string[];
  readonly zones: readonly (string | null)[];
  readonly firing: readonly boolean[];
  readonly signatures: readonly boolean[];
  readonly acknowledgements: readonly string[];
  readonly digest: number;
}

/**
 * One tick of a whole squad, with an optional order standing.
 *
 * The order is issued through the squad rather than handed to the controller,
 * so this exercises the same path the quick command uses.
 */
export function runSquadTick(
  options: {
    readonly crewIds?: readonly string[];
    readonly order?: SquadOrderId;
    readonly situation?: Partial<AllySituation>;
    readonly inputs?: Partial<AllyInputs>;
    readonly ticks?: number;
  } = {},
): SquadScenarioResult {
  const crews = createAllyCrewRegistry();
  const orders = createSquadOrderRegistry();
  const squad = new Squad({ crews, orders });
  const crewIds = options.crewIds ?? ["ally.karsten", "ally.oduya"];

  const acknowledgements: string[] = [];
  if (options.order) {
    acknowledgements.push(
      ...squad.issueAll(options.order, {
        crewIds,
        targetId: "kaiju",
        anchor: { east: 0, north: 0 },
      }),
    );
  }

  // One controller per crew, each carrying that crew's own standing order.
  const members = crewIds.map((crewId) => ({
    controller: new AllyController({ crewId, profile: squad.profileOf(crewId) }),
    inputs: baselineInputs({
      ...options.inputs,
      situation: baselineSituation(options.situation),
    }),
    order: squad.orderOf(crewId),
  }));

  // Resolved together every tick, so zone claims are decided against what the
  // others are doing now rather than what they did last time.
  let resolved = resolveSquadIntents(members, 0.25);
  for (let tick = 1; tick < (options.ticks ?? 1); tick += 1) {
    resolved = resolveSquadIntents(members, 0.25);
  }

  const text = resolved.map((intent) => `${intent.crewId}:${intent.goal}:${intent.targetZoneId}`).join("|");
  return {
    goals: resolved.map((intent) => intent.goal),
    zones: resolved.map((intent) => intent.targetZoneId),
    firing: resolved.map((intent) => intent.fire),
    signatures: resolved.map((intent) => intent.useSignature),
    acknowledgements,
    digest: digestOf(text),
  };
}

/**
 * The same squad under every order, for comparing them side by side.
 *
 * This is the acceptance question in one function: giving an order has to change
 * what the allies do, promptly and visibly, without pausing anything.
 */
export function compareOrders(crewId = "ally.karsten"): readonly {
  readonly order: SquadOrderId | "none";
  readonly goal: string;
  readonly fire: boolean;
}[] {
  const orders = createSquadOrderRegistry();
  const squad = new Squad({ orders });
  const rows: { order: SquadOrderId | "none"; goal: string; fire: boolean }[] = [];

  const tick = (orderId: SquadOrderId | "none") => {
    const controller = new AllyController({ crewId, profile: squad.profileOf(crewId) });
    const order = orderId === "none" ? undefined : orders.get(orderId);
    // An order that names a place gives the ally somewhere to be, so the
    // comparison sees what those orders actually do rather than what they do
    // with nowhere to stand.
    const inputs = baselineInputs(
      order?.needsPoint
        ? {
            anchor: { east: 0, north: 0 },
            situation: baselineSituation({ anchorDistanceMeters: 120 }),
          }
        : {},
    );
    const intent = controller.advance(0.25, inputs, order);
    rows.push({ order: orderId, goal: intent.goal, fire: intent.fire });
  };

  tick("none");
  for (const order of orders.all()) tick(order.id);
  return rows;
}

/** What a crew learns over a campaign of flying beside the player. */
export function runSquadCampaign(sorties = 12): {
  readonly perks: readonly string[];
  readonly confidence: number;
  readonly messages: readonly string[];
} {
  const squad = new Squad();
  const messages: string[] = [];
  for (let index = 0; index < sorties; index += 1) {
    const result = squad.completeSortie({
      missionId: `squad.sortie.${index}`,
      crewIds: ["ally.karsten"],
      won: index % 3 !== 0,
      score: 0.8,
      day: index * 2,
    });
    messages.push(...result.messages);
  }
  return {
    perks: squad.perksOf("ally.karsten"),
    confidence: Math.round((squad.get("ally.karsten")?.confidence ?? 0) * 1000) / 1000,
    messages,
  };
}

function digestOf(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
