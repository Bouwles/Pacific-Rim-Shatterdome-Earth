import { jaegerRegistry, type JaegerDefinition } from "../data/jaegers";
import { createSeededRng, hashStringToSeed } from "../simulation/rng";
import { InputBuffer } from "../jaegers/inputBuffer";
import { PilotSession } from "../jaegers/pilotSession";
import type { GroundQuery, JaegerInput, LocomotionEvent } from "../jaegers/locomotion";

/**
 * Deterministic locomotion courses.
 *
 * Three synthetic grounds, driven headlessly at a fixed step, so "crosses the
 * city without skating or snagging" is a number a test can assert rather than a
 * thing somebody watched once. The grounds are generated here rather than
 * streamed, because a course that depends on which sectors happened to load is
 * not a course.
 *
 * Nothing in this file touches Babylon, the DOM or a wall clock, and no course
 * uses `Math.random`: the same course driven twice produces the same digest.
 */

export const COURSE_IDS = ["city", "coast", "ocean"] as const;
export type CourseId = (typeof COURSE_IDS)[number];

export interface CourseDefinition {
  readonly id: CourseId;
  readonly displayName: string;
  /** Ground height in metres for a point in the course frame. */
  readonly ground: GroundQuery;
  readonly waterHeightMeters: number;
  readonly startEast: number;
  readonly startNorth: number;
  readonly startUp: number;
  readonly seconds: number;
  readonly description: string;
}

/** Fixed step, so two runs of a course line up tick for tick. */
export const COURSE_STEP_SECONDS = 1 / 60;

/**
 * A city block plain: flat, littered with debris a machine this size should walk
 * straight over, one loading ramp it should step onto, and one tower it must not.
 */
function cityGround(seed: number): GroundQuery {
  const rng = createSeededRng(hashStringToSeed(`course.city.${seed}`));
  // Debris is generated once, up front: a ground query that draws from an RNG
  // per call would return a different height every time it was asked.
  const debris = Array.from({ length: 40 }, () => ({
    east: (rng() - 0.5) * 1_600,
    north: rng() * 2_400,
    // Wrecked vehicles and rubble: waist high on a person, nothing to a Jaeger.
    height: 0.3 + rng() * 0.7,
    radius: 6 + rng() * 14,
  }));
  return (east, north) => {
    let height = 8;
    // The ramp: a real ledge inside the step height of every shipped frame.
    if (north > 900 && north < 1_050) height = 14;
    if (north >= 1_050) height = 14;
    // The tower: too steep and too tall to climb, so it must stop the machine.
    const towerEast = 30;
    const towerNorth = 1_700;
    if (Math.abs(east - towerEast) < 45 && Math.abs(north - towerNorth) < 45) height = 120;
    for (const piece of debris) {
      if (Math.hypot(east - piece.east, north - piece.north) < piece.radius) {
        height = Math.max(height, height + piece.height);
      }
    }
    return height;
  };
}

/** A beach: dry land, a shelf, then open water deep enough to swim in. */
function coastGround(): GroundQuery {
  return (_east, north) => {
    // 40 m above sea level at the start, dropping to -140 m over two kilometres.
    // The shelf has to end deeper than a machine is tall or the course never
    // reaches water it can actually swim in: at 60 m a 75 m Jaeger is still
    // standing on the bottom, which is wading, not swimming.
    const t = clamp01(north / 2_000);
    return 40 - t * 180;
  };
}

/** Open sea: a flat seabed far below a machine's head. */
function oceanGround(): GroundQuery {
  return () => -180;
}

export function createCourses(seed: number): readonly CourseDefinition[] {
  return [
    {
      id: "city",
      displayName: "City block run",
      ground: cityGround(seed),
      waterHeightMeters: -1_000,
      startEast: 0,
      startNorth: 0,
      startUp: 8,
      seconds: 90,
      description:
        "Two kilometres of city plain with debris, a loading ramp and a tower. Debris must not stop the machine; the tower must.",
    },
    {
      id: "coast",
      displayName: "Coast wade",
      ground: coastGround(),
      waterHeightMeters: 0,
      startEast: 0,
      startNorth: 0,
      startUp: 40,
      seconds: 90,
      description: "Down a beach into the shelf and off it: dry, wading, then swimming.",
    },
    {
      id: "ocean",
      displayName: "Open water",
      ground: oceanGround(),
      waterHeightMeters: 0,
      startEast: 0,
      startNorth: 0,
      startUp: 0,
      seconds: 45,
      description: "Deep water from the first tick. Nothing under the feet at all.",
    },
  ];
}

export interface CourseResult {
  readonly courseId: CourseId;
  readonly jaegerId: string;
  readonly seconds: number;
  readonly distanceMeters: number;
  readonly averageSpeedMps: number;
  readonly peakSpeedMps: number;
  /** Highest speed the profile itself allows, including a booster burst. */
  readonly speedCeilingMps: number;
  readonly footfalls: number;
  /** Metres between footfalls, measured. Skating shows up here as a wrong number. */
  readonly measuredStrideMeters: number;
  readonly declaredStrideMeters: number;
  readonly blockedFrames: number;
  readonly statesVisited: readonly string[];
  readonly eventCounts: Readonly<Record<string, number>>;
  readonly finalWaterState: string;
  readonly digest: number;
}

export interface CourseRunOptions {
  readonly courseId: CourseId;
  readonly jaegerId?: string;
  readonly seed?: number;
  /** Overrides the course length, for a test that only needs a few seconds. */
  readonly seconds?: number;
  /** Held input for the whole run. Defaults to running straight ahead. */
  readonly input?: Partial<JaegerInput>;
  /** Booster presses, as seconds from the start of the run. */
  readonly boosterAtSeconds?: readonly number[];
}

const HELD_RUN: JaegerInput = {
  forward: 1,
  strafe: 0,
  run: true,
  guard: false,
  desiredHeadingDeg: 0,
  turnIntent: 0,
};

/**
 * Drives one machine across one course and reports what happened.
 *
 * The metrics are the acceptance criteria: measured stride against declared
 * stride catches skating, blocked frames catch snagging, and the digest catches
 * a loss of determinism.
 */
export function runCourse(options: CourseRunOptions): CourseResult {
  const seed = options.seed ?? 20260824;
  const course = createCourses(seed).find((entry) => entry.id === options.courseId);
  if (!course) {
    throw new Error(`Unknown course "${options.courseId}". Known courses: ${COURSE_IDS.join(", ")}`);
  }
  const jaeger: JaegerDefinition = jaegerRegistry.getOrThrow(options.jaegerId ?? "placeholder-mk0");

  const session = new PilotSession({
    jaeger,
    east: course.startEast,
    north: course.startNorth,
    up: course.startUp,
    headingDeg: 0,
    buffer: new InputBuffer(),
  });

  const input: JaegerInput = { ...HELD_RUN, ...options.input };
  const seconds = options.seconds ?? course.seconds;
  const steps = Math.round(seconds / COURSE_STEP_SECONDS);
  const boosterTicks = new Set(
    (options.boosterAtSeconds ?? []).map((at) => Math.round(at / COURSE_STEP_SECONDS)),
  );

  let distance = 0;
  let peakSpeed = 0;
  let blockedFrames = 0;
  let footfalls = 0;
  let lastFootfall: { east: number; north: number } | null = null;
  let strideTotal = 0;
  let strideSamples = 0;
  const states = new Set<string>();
  const eventCounts: Record<string, number> = {};
  let digest = 0x811c9dc5;

  for (let index = 0; index < steps; index += 1) {
    if (boosterTicks.has(index)) session.press("booster", index);
    const before = session.pose;
    const frame = session.update({
      deltaSeconds: COURSE_STEP_SECONDS,
      tick: index,
      input,
      cameraInput: { yawDeltaDeg: 0, pitchDeltaDeg: 0 },
      ground: course.ground,
      waterHeightMeters: course.waterHeightMeters,
      // Fair weather: the courses measure the controller, not the storm. The
      // environment path is exercised by its own test.
      effects: { tractionMultiplier: 1, movementMultiplier: 1 },
    });

    distance += Math.hypot(frame.pose.east - before.east, frame.pose.north - before.north);
    peakSpeed = Math.max(peakSpeed, frame.pose.speedMps);
    if (frame.blocked) blockedFrames += 1;
    states.add(frame.pose.state);

    for (const event of frame.events) {
      eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;
      if (event.kind === "footfall") {
        footfalls += 1;
        if (lastFootfall) {
          strideTotal += Math.hypot(event.east - lastFootfall.east, event.north - lastFootfall.north);
          strideSamples += 1;
        }
        lastFootfall = { east: event.east, north: event.north };
      }
    }

    digest = fold(digest, Math.round(frame.pose.east * 100));
    digest = fold(digest, Math.round(frame.pose.north * 100));
    digest = fold(digest, Math.round(frame.pose.up * 100));
    digest = fold(digest, Math.round(frame.pose.yawDeg * 10));
  }

  const profile = jaeger.locomotion;
  return {
    courseId: course.id,
    jaegerId: jaeger.id,
    seconds,
    distanceMeters: distance,
    averageSpeedMps: distance / seconds,
    peakSpeedMps: peakSpeed,
    speedCeilingMps: profile.runSpeedMps + profile.boosterImpulseMps,
    footfalls,
    measuredStrideMeters: strideSamples > 0 ? strideTotal / strideSamples : 0,
    declaredStrideMeters: profile.strideMeters,
    blockedFrames,
    statesVisited: [...states].sort(),
    eventCounts,
    finalWaterState: session.pose.waterState,
    digest: digest >>> 0,
  };
}

/** Runs every course for one machine. Used by the debug panel and by the tests. */
export function runAllCourses(jaegerId = "placeholder-mk0", seed = 20260824): readonly CourseResult[] {
  return COURSE_IDS.map((courseId) => runCourse({ courseId, jaegerId, seed }));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fold(hash: number, value: number): number {
  const next = Math.imul(hash ^ (value | 0), 0x01000193);
  return next >>> 0;
}

/** Events collapsed to counts, for a readout that has no room for a list. */
export function summariseEvents(events: readonly LocomotionEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
}
