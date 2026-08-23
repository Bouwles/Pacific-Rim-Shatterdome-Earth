import { ContentRegistry } from "../data/registry";
import type { LocomotionProfile } from "../data/jaegers";
import type { EnvironmentEffects } from "../world/environment";
import { classifyWaterState, resolveFeetHeight, type WaterSituation } from "../world/ocean";
import type { InputBuffer } from "./inputBuffer";

/**
 * Jaeger locomotion.
 *
 * Heavy but responsive, as a set of numbers rather than as an adjective. Mass is
 * communicated by acceleration, braking, turn authority and stride length, all
 * of which come from the machine's own profile, so a heavy tank and an agile
 * frame run the same code and feel nothing alike.
 *
 * Three rules shape the file:
 *
 * 1. **Movement is not bound to a skeleton.** The controller produces a pose, a
 *    state, a stride phase and footfall events; an animation system reads those.
 *    Nothing here knows what a clip is called, and a machine with no model at
 *    all still walks correctly.
 * 2. **The body is never snapped to the camera.** Where the player is looking is
 *    an intent, and the body turns toward it at the rate the current state
 *    allows.
 * 3. **The ground is queried before it is stood on.** Slope, ledges and drops
 *    are sampled ahead of the feet, so the machine steps over a kerb, refuses a
 *    cliff face, and falls off an edge it actually walked over.
 *
 * Pure: no Babylon, no DOM, no wall clock, no `Math.random`. Trigonometry is
 * used, which the simulation kernel forbids and the world layer allows; this
 * module sits with the world layer for exactly that reason.
 */

export const JAEGER_STATES = [
  "idle",
  "start",
  "walk",
  "run",
  "strafe",
  "guard",
  "turn-in-place",
  "stop",
  "step-up",
  "fall",
  "land",
  "wade",
  "swim",
  "underwater",
  "booster",
  "knockback",
  "knockdown",
  "get-up",
  "disabled",
  "death",
] as const;
export type JaegerState = (typeof JAEGER_STATES)[number];

/** What a state costs and allows. A table, so behaviour is data rather than branches. */
export interface JaegerStateDefinition {
  readonly id: JaegerState;
  /** Multiplier on the profile speed this state draws from. */
  readonly speedFactor: number;
  /** Multiplier on turn rate. Zero means the body cannot turn at all. */
  readonly turnFactor: number;
  /** False when the player's stick is ignored: reactions, falls and death. */
  readonly acceptsInput: boolean;
  /** Seconds the state holds before anything else may be entered. */
  readonly minSeconds: number;
  /** True when feet are on something. Drives footfalls and dust. */
  readonly planted: boolean;
  /** True while the machine is not in control of itself. */
  readonly reaction: boolean;
  readonly description: string;
}

const STATE_DEFINITIONS: readonly JaegerStateDefinition[] = [
  {
    id: "idle",
    speedFactor: 0,
    turnFactor: 1,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Standing, feet planted, weight settled.",
  },
  {
    id: "start",
    speedFactor: 0.45,
    turnFactor: 0.5,
    acceptsInput: true,
    minSeconds: 0.35,
    planted: true,
    reaction: false,
    description: "Taking up the load before the first full stride.",
  },
  {
    id: "walk",
    speedFactor: 1,
    turnFactor: 1,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Cruising pace.",
  },
  {
    id: "run",
    speedFactor: 1,
    turnFactor: 0.55,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Committed pace; the body turns badly while it lasts.",
  },
  {
    id: "strafe",
    speedFactor: 1,
    turnFactor: 0.8,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Sidestepping while facing the target.",
  },
  {
    id: "guard",
    speedFactor: 1,
    turnFactor: 0.7,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Guarded movement: slow, square on, ready to absorb.",
  },
  {
    id: "turn-in-place",
    speedFactor: 0,
    turnFactor: 1,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Planted and rotating, which is the only way a machine this size turns quickly.",
  },
  {
    id: "stop",
    speedFactor: 0,
    turnFactor: 0.6,
    acceptsInput: true,
    minSeconds: 0.25,
    planted: true,
    reaction: false,
    description: "Braking. Momentum outlives the input.",
  },
  {
    id: "step-up",
    speedFactor: 0.6,
    turnFactor: 0.4,
    acceptsInput: true,
    minSeconds: 0.2,
    planted: true,
    reaction: false,
    description: "Clearing a ledge inside the frame's step height.",
  },
  {
    id: "fall",
    speedFactor: 0.3,
    turnFactor: 0.15,
    acceptsInput: false,
    minSeconds: 0,
    planted: false,
    reaction: false,
    description: "Airborne. Air control is almost nothing at this mass.",
  },
  {
    id: "land",
    speedFactor: 0.2,
    turnFactor: 0.3,
    acceptsInput: true,
    minSeconds: 0.35,
    planted: true,
    reaction: false,
    description: "Absorbing the landing.",
  },
  {
    id: "wade",
    speedFactor: 1,
    turnFactor: 0.75,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Walking the bottom with water against the legs.",
  },
  {
    id: "swim",
    speedFactor: 1,
    turnFactor: 0.6,
    acceptsInput: true,
    minSeconds: 0,
    planted: false,
    reaction: false,
    description: "Floating, feet off the bottom.",
  },
  {
    id: "underwater",
    speedFactor: 1,
    turnFactor: 0.5,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Walking the seabed under the surface.",
  },
  {
    id: "booster",
    speedFactor: 1.6,
    turnFactor: 0.25,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Burst thrust. Committed: the body barely turns.",
  },
  {
    id: "knockback",
    speedFactor: 0,
    turnFactor: 0,
    acceptsInput: false,
    minSeconds: 0.5,
    planted: true,
    reaction: true,
    description: "Driven backwards, feet still under the machine.",
  },
  {
    id: "knockdown",
    speedFactor: 0,
    turnFactor: 0,
    acceptsInput: false,
    minSeconds: 1.2,
    planted: false,
    reaction: true,
    description: "Down. Nothing responds.",
  },
  {
    id: "get-up",
    speedFactor: 0,
    turnFactor: 0.2,
    acceptsInput: false,
    minSeconds: 0,
    planted: true,
    reaction: true,
    description: "Standing back up, on the frame's own timing.",
  },
  {
    id: "disabled",
    speedFactor: 0.4,
    turnFactor: 0.35,
    acceptsInput: true,
    minSeconds: 0,
    planted: true,
    reaction: false,
    description: "Moving on a damaged leg: slower, and it drags.",
  },
  {
    id: "death",
    speedFactor: 0,
    turnFactor: 0,
    acceptsInput: false,
    minSeconds: 0,
    planted: false,
    reaction: true,
    description: "Out of the fight. Terminal.",
  },
];

export function validateJaegerState(entry: JaegerStateDefinition): string[] {
  const errors: string[] = [];
  if (!JAEGER_STATES.includes(entry.id)) errors.push(`unknown state id "${entry.id}"`);
  for (const key of ["speedFactor", "turnFactor", "minSeconds"] as const) {
    if (!Number.isFinite(entry[key]) || entry[key] < 0) errors.push(`${key} must be zero or more`);
  }
  if (!entry.description) errors.push("description required");
  // A state that ignores the player and still turns freely is a contradiction:
  // something has to be doing the turning.
  if (!entry.acceptsInput && entry.turnFactor > 0.5) {
    errors.push("a state that ignores input must not keep full turn authority");
  }
  return errors;
}

export function createJaegerStateRegistry(): ContentRegistry<JaegerStateDefinition> {
  const registry = new ContentRegistry<JaegerStateDefinition>(validateJaegerState);
  for (const definition of STATE_DEFINITIONS) registry.register(definition);
  return registry;
}

export const JAEGER_STATE_DEFINITIONS = STATE_DEFINITIONS;

const BY_ID: ReadonlyMap<JaegerState, JaegerStateDefinition> = new Map(
  STATE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function stateDefinition(state: JaegerState): JaegerStateDefinition {
  const definition = BY_ID.get(state);
  if (!definition) throw new Error(`Unknown Jaeger state "${state}"`);
  return definition;
}

/** Local metres: east and north from the frame origin, up above sea level. */
export interface JaegerPose {
  readonly east: number;
  readonly north: number;
  readonly up: number;
  readonly yawDeg: number;
  readonly velocityEast: number;
  readonly velocityNorth: number;
  readonly verticalMps: number;
  readonly state: JaegerState;
  readonly stateSeconds: number;
  /** 0 to 1 through the current stride. This is the animation contract. */
  readonly stridePhase: number;
  /** Which foot lands next. Alternates on every footfall. */
  readonly nextFoot: "L" | "R";
  readonly grounded: boolean;
  readonly waterState: WaterSituation["state"];
  readonly submergedFraction: number;
  /** 0 to 1. One is a full charge; a burst spends it. */
  readonly boosterCharge: number;
  readonly boosterSecondsLeft: number;
  /** True while a leg is out. Set by damage, read by the state resolver. */
  readonly legDisabled: boolean;
  readonly destroyed: boolean;
  readonly speedMps: number;
}

export interface JaegerInput {
  /** Forward is +1, back is -1. */
  readonly forward: number;
  /** Right is +1, left is -1. */
  readonly strafe: number;
  readonly run: boolean;
  readonly guard: boolean;
  /**
   * Where the player wants the machine to face, in degrees, or null when they
   * are not steering with a camera. The body turns toward this at the rate the
   * current state allows and never snaps to it.
   */
  readonly desiredHeadingDeg: number | null;
  /** Direct turn request, -1 to 1, for keyboard steering. */
  readonly turnIntent: number;
}

export const NEUTRAL_JAEGER_INPUT: JaegerInput = {
  forward: 0,
  strafe: 0,
  run: false,
  guard: false,
  desiredHeadingDeg: null,
  turnIntent: 0,
};

/** Height of the ground at a point, or null where nothing is loaded. */
export type GroundQuery = (east: number, north: number) => number | null;

export interface LocomotionContext {
  readonly profile: LocomotionProfile;
  readonly ground: GroundQuery;
  /** Sea surface height at the machine, metres. */
  readonly waterHeightMeters: number;
  /** Traction and movement from the environment. The controller never invents its own. */
  readonly effects: Pick<EnvironmentEffects, "tractionMultiplier" | "movementMultiplier">;
  /** Simulation tick, used only to age the input buffer. */
  readonly tick: number;
  readonly buffer?: InputBuffer;
}

/** Something worth hearing, seeing or feeling. Presentation reads these and owns nothing. */
export interface LocomotionEvent {
  readonly kind: "footfall" | "land" | "booster" | "water-entry" | "step-up" | "knockdown" | "get-up";
  /** Where it happened, in the same local frame as the pose. */
  readonly east: number;
  readonly north: number;
  readonly up: number;
  /** 0 to 1. Drives dust volume, decal size, camera impulse and sound level. */
  readonly intensity: number;
  readonly foot: "L" | "R" | null;
  readonly waterState: WaterSituation["state"];
}

export interface LocomotionStep {
  readonly pose: JaegerPose;
  readonly events: readonly LocomotionEvent[];
  /** Magnitude of camera impulse this step earned, 0 to 1. The camera decides what to do with it. */
  readonly cameraImpulse: number;
  /** Ground height under the feet, or null when the sector has not loaded. */
  readonly groundHeightMeters: number | null;
  /** Degrees between where the body faces and where the player asked it to. */
  readonly headingErrorDeg: number;
  /** True when a slope or a wall stopped the machine rather than the player. */
  readonly blocked: boolean;
}

export const GRAVITY_MPS2 = 9.81;
/** Seconds ahead the ground is sampled. Roughly one stride at a run. */
export const GROUND_LOOKAHEAD_SECONDS = 0.35;
/** Metres of drop below the feet before the machine is considered airborne. */
export const FALL_THRESHOLD_METERS = 1.5;
/** Fall speed at which a landing is worth a full-strength impulse. */
export const HARD_LANDING_MPS = 45;
/** Longest movement substep. A running Jaeger crosses 23 m/s, so this bounds it to half a metre. */
export const MAX_SUBSTEP_SECONDS = 0.02;
/** Rise below this is ground texture, not a ledge. Debris must not trip a 75 m machine. */
export const LEDGE_THRESHOLD_METERS = 1.2;

export function spawnPose(east: number, north: number, up: number, yawDeg = 0): JaegerPose {
  return {
    east,
    north,
    up,
    yawDeg: normalizeDegrees(yawDeg),
    velocityEast: 0,
    velocityNorth: 0,
    verticalMps: 0,
    state: "idle",
    stateSeconds: 0,
    stridePhase: 0,
    nextFoot: "L",
    grounded: true,
    waterState: "dry",
    submergedFraction: 0,
    boosterCharge: 1,
    boosterSecondsLeft: 0,
    legDisabled: false,
    destroyed: false,
    speedMps: 0,
  };
}

/**
 * Which state the machine is in, decided in priority order.
 *
 * An ordered list of predicates rather than a switch: a reaction outranks the
 * water, the water outranks the player's stick, and adding a state means adding
 * a row in the right place.
 */
interface StateRule {
  readonly id: JaegerState;
  readonly when: (context: StateContext) => boolean;
}

interface StateContext {
  readonly pose: JaegerPose;
  readonly input: JaegerInput;
  readonly profile: LocomotionProfile;
  readonly water: WaterSituation;
  readonly grounded: boolean;
  readonly moving: boolean;
  readonly speed: number;
  readonly turning: boolean;
  readonly stepping: boolean;
  readonly boosting: boolean;
  readonly locked: boolean;
}

const STATE_RULES: readonly StateRule[] = [
  { id: "death", when: (c) => c.pose.destroyed },
  // A reaction holds until its own minimum has elapsed. Nothing outranks it but death.
  { id: "knockdown", when: (c) => c.locked && c.pose.state === "knockdown" },
  { id: "get-up", when: (c) => c.pose.state === "get-up" && c.pose.stateSeconds < c.profile.getUpSeconds },
  { id: "knockback", when: (c) => c.locked && c.pose.state === "knockback" },
  { id: "get-up", when: (c) => c.pose.state === "knockdown" && !c.locked },
  { id: "fall", when: (c) => !c.grounded && c.water.state === "dry" },
  { id: "land", when: (c) => c.pose.state === "fall" && c.grounded },
  { id: "land", when: (c) => c.pose.state === "land" && c.locked },
  { id: "underwater", when: (c) => c.water.state === "underwater" },
  { id: "swim", when: (c) => c.water.state === "swimming" },
  { id: "wade", when: (c) => c.water.state === "wading" || c.water.state === "surface-combat" },
  { id: "booster", when: (c) => c.boosting },
  { id: "step-up", when: (c) => c.stepping },
  { id: "disabled", when: (c) => c.pose.legDisabled && c.moving },
  { id: "guard", when: (c) => c.input.guard },
  { id: "strafe", when: (c) => c.moving && Math.abs(c.input.strafe) > Math.abs(c.input.forward) },
  { id: "run", when: (c) => c.moving && c.input.run && c.input.forward > 0 },
  { id: "start", when: (c) => c.moving && c.speed < c.profile.walkSpeedMps * 0.35 },
  { id: "walk", when: (c) => c.moving },
  { id: "stop", when: (c) => !c.moving && c.speed > c.profile.walkSpeedMps * 0.15 },
  { id: "turn-in-place", when: (c) => !c.moving && c.turning },
  { id: "idle", when: () => true },
];

function resolveState(context: StateContext): JaegerState {
  for (const rule of STATE_RULES) {
    if (rule.when(context)) return rule.id;
  }
  return "idle";
}

/**
 * Advances the machine by one frame.
 *
 * Split into substeps so a running Jaeger cannot cross a ledge between two
 * frames without the ground under it ever being sampled.
 */
export function stepJaeger(
  pose: JaegerPose,
  input: JaegerInput,
  deltaSeconds: number,
  context: LocomotionContext,
): LocomotionStep {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return {
      pose,
      events: [],
      cameraImpulse: 0,
      groundHeightMeters: context.ground(pose.east, pose.north),
      headingErrorDeg: 0,
      blocked: false,
    };
  }

  const substeps = Math.min(8, Math.max(1, Math.ceil(deltaSeconds / MAX_SUBSTEP_SECONDS)));
  const step = deltaSeconds / substeps;

  // The buffer is aged once per frame, not once per substep: a press is a press
  // however finely the frame happens to be divided.
  const boosterPress = context.buffer
    ? context.buffer.consume(
        (action) => action === "booster" && pose.boosterCharge >= 1 && !stateDefinition(pose.state).reaction,
        context.tick,
      ) !== null
    : false;

  let current = pose;
  const events: LocomotionEvent[] = [];
  let cameraImpulse = 0;
  let blocked = false;
  let groundHeight: number | null = null;
  let headingErrorDeg = 0;

  for (let index = 0; index < substeps; index += 1) {
    const result = advance(current, input, step, context, index === 0 && boosterPress);
    current = result.pose;
    events.push(...result.events);
    cameraImpulse = Math.max(cameraImpulse, result.cameraImpulse);
    blocked = blocked || result.blocked;
    groundHeight = result.groundHeightMeters;
    headingErrorDeg = result.headingErrorDeg;
  }

  return {
    pose: current,
    events,
    cameraImpulse,
    groundHeightMeters: groundHeight,
    headingErrorDeg,
    blocked,
  };
}

function advance(
  pose: JaegerPose,
  input: JaegerInput,
  step: number,
  context: LocomotionContext,
  startBooster: boolean,
): LocomotionStep {
  const profile = context.profile;
  const events: LocomotionEvent[] = [];
  let cameraImpulse = 0;
  let blocked = false;

  const groundHere = context.ground(pose.east, pose.north);
  const groundHeight = groundHere ?? pose.up;

  // Water first: it decides whether the feet are on anything at all.
  const water = classifyWaterState({
    groundHeightMeters: groundHeight,
    waterHeightMeters: context.waterHeightMeters,
    entityHeightMeters: profile.heightMeters,
    feetHeightMeters: pose.up,
  });

  const definition = stateDefinition(pose.state);
  const locked = pose.stateSeconds < definition.minSeconds;

  // Booster: a burst that spends the charge and runs on its own clock.
  let boosterSecondsLeft = Math.max(0, pose.boosterSecondsLeft - step);
  let boosterCharge = pose.boosterCharge;
  if (startBooster && boosterCharge >= 1 && !definition.reaction) {
    boosterSecondsLeft = profile.boosterSeconds;
    boosterCharge = 0;
    cameraImpulse = Math.max(cameraImpulse, 0.55);
    events.push(makeEvent("booster", pose, 1, null, water.state));
  } else if (boosterSecondsLeft <= 0) {
    boosterCharge = Math.min(1, boosterCharge + step / profile.boosterRechargeSeconds);
  }

  const wants = Math.hypot(input.forward, input.strafe) > 0.05 && definition.acceptsInput;
  const speed = Math.hypot(pose.velocityEast, pose.velocityNorth);

  // Predictive ground query: look where the feet are going, not where they are.
  //
  // The probe reaches at least half a stride even when the machine is stopped.
  // Scaling it purely by velocity let a blocked machine creep: zero speed meant
  // zero lookahead, which read as clear ground, which let it inch forward into a
  // cliff face and then settle up the side of it.
  const facingRadians = (pose.yawDeg * Math.PI) / 180;
  const travelSpeed = Math.hypot(pose.velocityEast, pose.velocityNorth);
  const probeDistance = Math.max(profile.strideMeters * 0.5, travelSpeed * GROUND_LOOKAHEAD_SECONDS);
  const probeEast = travelSpeed > 0.1 ? pose.velocityEast / travelSpeed : Math.sin(facingRadians);
  const probeNorth = travelSpeed > 0.1 ? pose.velocityNorth / travelSpeed : Math.cos(facingRadians);
  const lookaheadEast = pose.east + probeEast * probeDistance;
  const lookaheadNorth = pose.north + probeNorth * probeDistance;
  const groundAhead = context.ground(lookaheadEast, lookaheadNorth);
  const rise = groundAhead === null ? 0 : groundAhead - groundHeight;
  const runDistance = Math.max(1, Math.hypot(lookaheadEast - pose.east, lookaheadNorth - pose.north));
  const slopeDeg = (Math.atan2(rise, runDistance) * 180) / Math.PI;

  // Anything shorter than a lamp post is ground texture. A machine that stopped
  // for every kerb and wrecked car would snag its way across a city.
  const stepping = rise > LEDGE_THRESHOLD_METERS && rise <= profile.stepUpMeters && water.state === "dry";
  const wall = slopeDeg > profile.maxSlopeDeg && rise > profile.stepUpMeters;

  const grounded = water.state !== "swimming" && pose.up <= groundHeight + FALL_THRESHOLD_METERS;

  const turning =
    definition.acceptsInput &&
    (Math.abs(input.turnIntent) > 0.05 ||
      (input.desiredHeadingDeg !== null && angleDelta(pose.yawDeg, input.desiredHeadingDeg) > 4));

  const nextState = resolveState({
    pose: { ...pose, boosterSecondsLeft },
    input,
    profile,
    water,
    grounded,
    moving: wants,
    speed,
    turning,
    stepping,
    boosting: boosterSecondsLeft > 0,
    locked,
  });

  const nextDefinition = stateDefinition(nextState);
  const stateSeconds = nextState === pose.state ? pose.stateSeconds + step : 0;

  // Turn authority. The body rotates toward intent at the rate this state allows,
  // and never further than the intent itself, so it cannot snap to the camera.
  const baseTurnRate =
    speed > profile.walkSpeedMps * 0.2 ? profile.turnRateDegPerSecond : profile.turnInPlaceRateDegPerSecond;
  const turnRate = baseTurnRate * nextDefinition.turnFactor;
  let yawDeg = pose.yawDeg;
  let headingErrorDeg = 0;
  if (input.desiredHeadingDeg !== null && nextDefinition.acceptsInput) {
    const wanted = signedDelta(pose.yawDeg, input.desiredHeadingDeg);
    const allowed = turnRate * step;
    yawDeg = normalizeDegrees(pose.yawDeg + clamp(wanted, -allowed, allowed));
    headingErrorDeg = signedDelta(yawDeg, input.desiredHeadingDeg);
  } else if (nextDefinition.acceptsInput) {
    yawDeg = normalizeDegrees(pose.yawDeg + clamp(input.turnIntent, -1, 1) * turnRate * step);
  }

  // Target speed for the state, before the environment has its say.
  const traction = clamp(context.effects.tractionMultiplier, 0.2, 1.2);
  const environment = clamp(context.effects.movementMultiplier, 0.1, 1.5);
  const base = baseSpeedFor(nextState, input, profile);
  const maxSpeed =
    base * nextDefinition.speedFactor * environment +
    (boosterSecondsLeft > 0 ? profile.boosterImpulseMps : 0);

  const yawRadians = (yawDeg * Math.PI) / 180;
  const forwardEast = Math.sin(yawRadians);
  const forwardNorth = Math.cos(yawRadians);
  const magnitude = Math.hypot(input.forward, input.strafe);
  const wish =
    magnitude > 1e-6 && nextDefinition.acceptsInput && !wall
      ? {
          east: (forwardEast * input.forward + forwardNorth * input.strafe) / Math.max(1, magnitude),
          north: (forwardNorth * input.forward - forwardEast * input.strafe) / Math.max(1, magnitude),
        }
      : { east: 0, north: 0 };
  if (wall && magnitude > 1e-6) blocked = true;

  let velocityEast = pose.velocityEast;
  let velocityNorth = pose.velocityNorth;
  if (magnitude > 1e-6 && !wall && nextDefinition.acceptsInput) {
    const rate = profile.accelerationMps2 * traction * step;
    velocityEast = approach(velocityEast, wish.east * maxSpeed, rate);
    velocityNorth = approach(velocityNorth, wish.north * maxSpeed, rate);
  } else {
    // Braking is its own number, and momentum outlives the stick either way.
    const rate = profile.brakingMps2 * traction * step;
    velocityEast = approach(velocityEast, 0, rate);
    velocityNorth = approach(velocityNorth, 0, rate);
  }

  let east = pose.east + velocityEast * step;
  let north = pose.north + velocityNorth * step;

  // Vertical: gravity while airborne, the ground or the water surface otherwise.
  let up = pose.up;
  let verticalMps = pose.verticalMps;
  const feetTarget = resolveFeetHeight({
    groundHeightMeters: groundHeight,
    waterHeightMeters: context.waterHeightMeters,
    entityHeightMeters: profile.heightMeters,
    diving: water.state === "underwater",
  });

  if (!grounded && water.state === "dry") {
    verticalMps -= GRAVITY_MPS2 * step;
    up += verticalMps * step;
    if (up <= feetTarget) {
      up = feetTarget;
      verticalMps = 0;
    }
  } else {
    // Touching down. The event fires on the transition out of the air rather
    // than on reaching the exact ground height: the machine is considered
    // grounded a metre and a half above it, so waiting for the exact height
    // meant a fall that never reported a landing at all.
    if (pose.state === "fall") {
      const impact = Math.abs(pose.verticalMps);
      cameraImpulse = Math.max(cameraImpulse, clamp(impact * profile.landingImpulseScale, 0.2, 1));
      events.push(
        makeEvent(
          "land",
          { ...pose, east, north, up },
          clamp(impact / HARD_LANDING_MPS, 0.15, 1),
          null,
          water.state,
        ),
      );
    }
    // Settle onto whatever the feet are standing on, quickly but not instantly:
    // a machine that teleports to ground height looks weightless on a slope.
    const settleRate = Math.max(4, profile.walkSpeedMps) * 2 * step;
    up = approach(up, feetTarget, settleRate);
    verticalMps = 0;
    if (stepping && nextState === "step-up") {
      events.push(
        makeEvent(
          "step-up",
          { ...pose, east, north, up },
          clamp(rise / profile.stepUpMeters, 0.2, 1),
          null,
          water.state,
        ),
      );
    }
  }

  // Footfalls are spaced by distance, never by time. This is what stops the feet
  // skating: the animation follows the ground the machine actually covered.
  const travelled = Math.hypot(east - pose.east, north - pose.north);
  let stridePhase = pose.stridePhase;
  let nextFoot = pose.nextFoot;
  if (nextDefinition.planted && travelled > 0) {
    stridePhase += travelled / profile.strideMeters;
    while (stridePhase >= 1) {
      stridePhase -= 1;
      const strength = clamp(Math.hypot(velocityEast, velocityNorth) / profile.runSpeedMps, 0.25, 1);
      events.push(makeEvent("footfall", { ...pose, east, north, up }, strength, nextFoot, water.state));
      cameraImpulse = Math.max(cameraImpulse, strength * 0.28);
      nextFoot = nextFoot === "L" ? "R" : "L";
    }
  }

  if (water.state !== pose.waterState && water.state !== "dry" && pose.waterState === "dry") {
    events.push(
      makeEvent(
        "water-entry",
        { ...pose, east, north, up },
        clamp(speed / profile.runSpeedMps, 0.3, 1),
        null,
        water.state,
      ),
    );
  }

  if (nextState === "knockdown" && pose.state !== "knockdown") {
    events.push(makeEvent("knockdown", { ...pose, east, north, up }, 1, null, water.state));
    cameraImpulse = Math.max(cameraImpulse, 0.9);
  }
  if (nextState === "get-up" && pose.state !== "get-up") {
    events.push(makeEvent("get-up", { ...pose, east, north, up }, 0.5, null, water.state));
  }

  if (wall) {
    east = pose.east;
    north = pose.north;
    velocityEast = 0;
    velocityNorth = 0;
  }

  return {
    pose: {
      east,
      north,
      up,
      yawDeg,
      velocityEast,
      velocityNorth,
      verticalMps,
      state: nextState,
      stateSeconds,
      stridePhase,
      nextFoot,
      grounded,
      waterState: water.state,
      submergedFraction: water.submergedFraction,
      boosterCharge,
      boosterSecondsLeft,
      legDisabled: pose.legDisabled,
      destroyed: pose.destroyed,
      speedMps: Math.hypot(velocityEast, velocityNorth),
    },
    events,
    cameraImpulse,
    groundHeightMeters: groundHere,
    headingErrorDeg,
    blocked,
  };
}

/** Which of the profile's speeds a state draws from. A table, not a branch chain. */
const SPEED_SOURCE: Readonly<
  Record<JaegerState, (profile: LocomotionProfile, input: JaegerInput) => number>
> = {
  idle: (p) => p.walkSpeedMps,
  start: (p) => p.walkSpeedMps,
  walk: (p) => p.walkSpeedMps,
  run: (p) => p.runSpeedMps,
  strafe: (p) => p.strafeSpeedMps,
  guard: (p) => p.guardSpeedMps,
  "turn-in-place": (p) => p.walkSpeedMps,
  stop: (p) => p.walkSpeedMps,
  "step-up": (p) => p.walkSpeedMps,
  fall: (p) => p.walkSpeedMps,
  land: (p) => p.walkSpeedMps,
  wade: (p) => p.walkSpeedMps,
  swim: (p) => p.walkSpeedMps,
  underwater: (p) => p.walkSpeedMps,
  booster: (p, i) => (i.run ? p.runSpeedMps : p.walkSpeedMps),
  knockback: (p) => p.walkSpeedMps,
  knockdown: (p) => p.walkSpeedMps,
  "get-up": (p) => p.walkSpeedMps,
  disabled: (p) => p.walkSpeedMps,
  death: (p) => p.walkSpeedMps,
};

function baseSpeedFor(state: JaegerState, input: JaegerInput, profile: LocomotionProfile): number {
  return SPEED_SOURCE[state](profile, input);
}

/**
 * Applies something that happened to the machine rather than something it did.
 *
 * Combat calls this; locomotion only has to know how to be knocked over, not
 * what knocked it over.
 */
export interface ReactionRequest {
  readonly kind: "knockback" | "knockdown" | "disable-leg" | "restore-leg" | "destroy";
  /** Metres per second imparted, for knockback. */
  readonly impulseMps?: number;
  /** Direction of the push in degrees, or straight back when absent. */
  readonly directionDeg?: number;
}

export function applyReaction(pose: JaegerPose, reaction: ReactionRequest): JaegerPose {
  if (pose.destroyed) return pose;
  const direction = ((reaction.directionDeg ?? pose.yawDeg + 180) * Math.PI) / 180;
  const impulse = reaction.impulseMps ?? 0;
  const table: Readonly<Record<ReactionRequest["kind"], () => JaegerPose>> = {
    knockback: () => ({
      ...pose,
      state: "knockback",
      stateSeconds: 0,
      velocityEast: Math.sin(direction) * impulse,
      velocityNorth: Math.cos(direction) * impulse,
    }),
    knockdown: () => ({
      ...pose,
      state: "knockdown",
      stateSeconds: 0,
      velocityEast: Math.sin(direction) * impulse * 0.5,
      velocityNorth: Math.cos(direction) * impulse * 0.5,
    }),
    "disable-leg": () => ({ ...pose, legDisabled: true }),
    "restore-leg": () => ({ ...pose, legDisabled: false }),
    destroy: () => ({ ...pose, destroyed: true, state: "death", stateSeconds: 0 }),
  };
  return table[reaction.kind]();
}

function makeEvent(
  kind: LocomotionEvent["kind"],
  pose: JaegerPose,
  intensity: number,
  foot: "L" | "R" | null,
  waterState: WaterSituation["state"],
): LocomotionEvent {
  return { kind, east: pose.east, north: pose.north, up: pose.up, intensity, foot, waterState };
}

function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  if (value > target) return Math.max(target, value - rate);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Shortest signed turn from one heading to another, in degrees. */
export function signedDelta(fromDeg: number, toDeg: number): number {
  const difference = (normalizeDegrees(toDeg) - normalizeDegrees(fromDeg) + 540) % 360;
  return difference - 180;
}

export function angleDelta(fromDeg: number, toDeg: number): number {
  return Math.abs(signedDelta(fromDeg, toDeg));
}
