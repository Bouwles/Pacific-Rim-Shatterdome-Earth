import { describe, expect, it } from "vitest";
import { jaegerRegistry } from "../../src/data/jaegers";
import { ON_FOOT } from "../../src/shatterdome/onFoot";
import { InputBuffer } from "../../src/jaegers/inputBuffer";
import {
  GROUND_LOOKAHEAD_SECONDS,
  JAEGER_STATES,
  LEDGE_THRESHOLD_METERS,
  NEUTRAL_JAEGER_INPUT,
  applyReaction,
  createJaegerStateRegistry,
  signedDelta,
  spawnPose,
  stateDefinition,
  stepJaeger,
  validateJaegerState,
  type GroundQuery,
  type JaegerInput,
  type JaegerPose,
  type LocomotionContext,
} from "../../src/jaegers/locomotion";

const HEAVY = jaegerRegistry.getOrThrow("heavy-mk4");
const STANDARD = jaegerRegistry.getOrThrow("placeholder-mk0");
const AGILE = jaegerRegistry.getOrThrow("agile-mk5");

const FLAT: GroundQuery = () => 0;
const FAIR = { tractionMultiplier: 1, movementMultiplier: 1 };

function contextFor(profileOwner = STANDARD, ground: GroundQuery = FLAT, water = -1_000): LocomotionContext {
  return {
    profile: profileOwner.locomotion,
    ground,
    waterHeightMeters: water,
    effects: FAIR,
    tick: 0,
  };
}

function drive(
  pose: JaegerPose,
  input: Partial<JaegerInput>,
  seconds: number,
  context: LocomotionContext,
): JaegerPose {
  let current = pose;
  const steps = Math.round(seconds * 60);
  for (let index = 0; index < steps; index += 1) {
    current = stepJaeger(current, { ...NEUTRAL_JAEGER_INPUT, ...input }, 1 / 60, {
      ...context,
      tick: index,
    }).pose;
  }
  return current;
}

describe("the state table", () => {
  it("covers every state the milestone names, once each", () => {
    const registry = createJaegerStateRegistry();
    expect(registry.all()).toHaveLength(JAEGER_STATES.length);
    for (const id of JAEGER_STATES) expect(registry.has(id)).toBe(true);
  });

  it("refuses a state that ignores the player and still turns freely", () => {
    const errors = validateJaegerState({
      id: "knockdown",
      speedFactor: 0,
      turnFactor: 1,
      acceptsInput: false,
      minSeconds: 0,
      planted: false,
      reaction: true,
      description: "bad",
    });
    expect(errors.join(" ")).toMatch(/turn authority/);
  });

  it("gives reactions a minimum length, so a hit cannot be shrugged off in a frame", () => {
    expect(stateDefinition("knockdown").minSeconds).toBeGreaterThan(1);
    expect(stateDefinition("knockback").minSeconds).toBeGreaterThan(0);
  });
});

describe("scale", () => {
  it("moves at machine scale, an order of magnitude off a person", () => {
    for (const entry of jaegerRegistry.all()) {
      expect(entry.locomotion.runSpeedMps).toBeGreaterThan(ON_FOOT.runSpeedMps * 2);
      expect(entry.locomotion.heightMeters).toBeGreaterThan(ON_FOOT.heightMeters * 30);
      // A stride is tens of metres. A person's is under a metre.
      expect(entry.locomotion.strideMeters).toBeGreaterThan(15);
    }
  });

  it("turns slower while moving than while planted, on every frame", () => {
    for (const entry of jaegerRegistry.all()) {
      expect(entry.locomotion.turnRateDegPerSecond).toBeLessThan(
        entry.locomotion.turnInPlaceRateDegPerSecond,
      );
    }
  });
});

describe("acceleration and braking", () => {
  it("takes real time to reach walking pace rather than snapping to it", () => {
    const context = contextFor();
    const afterOneTick = drive(spawnPose(0, 0, 0), { forward: 1 }, 1 / 60, context);
    expect(afterOneTick.speedMps).toBeLessThan(STANDARD.locomotion.walkSpeedMps * 0.2);
    const afterSeconds = drive(spawnPose(0, 0, 0), { forward: 1 }, 6, context);
    expect(afterSeconds.speedMps).toBeGreaterThan(STANDARD.locomotion.walkSpeedMps * 0.9);
  });

  it("never exceeds the profile's own ceiling", () => {
    const pose = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 20, contextFor());
    expect(pose.speedMps).toBeLessThanOrEqual(STANDARD.locomotion.runSpeedMps + 0.01);
  });

  it("keeps rolling after the stick is released, because momentum is the point", () => {
    const context = contextFor();
    const moving = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 10, context);
    const coasting = drive(moving, {}, 0.5, context);
    expect(coasting.speedMps).toBeGreaterThan(1);
    expect(coasting.speedMps).toBeLessThan(moving.speedMps);
    const stopped = drive(moving, {}, 8, context);
    expect(stopped.speedMps).toBeLessThan(0.05);
  });

  it("gives the agile frame a shorter run-up than the heavy one", () => {
    const heavy = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 3, contextFor(HEAVY));
    const agile = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 3, contextFor(AGILE));
    expect(agile.speedMps / AGILE.locomotion.runSpeedMps).toBeGreaterThan(
      heavy.speedMps / HEAVY.locomotion.runSpeedMps,
    );
  });
});

describe("turn authority", () => {
  it("never snaps the body to the camera", () => {
    const context = contextFor();
    const step = stepJaeger(
      spawnPose(0, 0, 0),
      { ...NEUTRAL_JAEGER_INPUT, forward: 1, desiredHeadingDeg: 180 },
      1 / 60,
      context,
    );
    // One frame at 26 deg/s is under half a degree, whichever way round it goes:
    // 180 degrees away is an exact tie and either direction is correct.
    expect(Math.abs(signedDelta(step.pose.yawDeg, 0))).toBeLessThan(1);
    expect(Math.abs(step.headingErrorDeg)).toBeGreaterThan(170);
  });

  it("gets there eventually, at the rate the state allows", () => {
    const context = contextFor();
    const turned = drive(spawnPose(0, 0, 0), { forward: 1, desiredHeadingDeg: 90 }, 12, context);
    expect(Math.abs(signedDelta(turned.yawDeg, 90))).toBeLessThan(2);
  });

  it("turns worse at a run than standing still", () => {
    const context = contextFor();
    const planted = drive(spawnPose(0, 0, 0), { desiredHeadingDeg: 90, turnIntent: 0 }, 1, context);
    const running = drive(
      drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 8, context),
      { forward: 1, run: true, desiredHeadingDeg: 90 },
      1,
      context,
    );
    expect(planted.yawDeg).toBeGreaterThan(running.yawDeg);
  });

  it("accepts a keyboard turn with no camera intent at all", () => {
    const turned = drive(spawnPose(0, 0, 0), { turnIntent: 1 }, 1, contextFor());
    expect(turned.yawDeg).toBeGreaterThan(10);
  });
});

describe("ground handling", () => {
  it("walks over debris without stopping", () => {
    // Wrecked vehicles: under the ledge threshold, so they must not register.
    const debris: GroundQuery = (_east, north) =>
      Math.abs((north % 40) - 20) < 3 ? LEDGE_THRESHOLD_METERS - 0.3 : 0;
    const context = contextFor(STANDARD, debris);
    let pose = spawnPose(0, 0, 0);
    let blockedFrames = 0;
    for (let index = 0; index < 600; index += 1) {
      const step = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true }, 1 / 60, {
        ...context,
        tick: index,
      });
      pose = step.pose;
      if (step.blocked) blockedFrames += 1;
    }
    expect(blockedFrames).toBe(0);
    expect(pose.north).toBeGreaterThan(80);
    expect(pose.state).not.toBe("step-up");
  });

  it("steps up a ledge inside its step height", () => {
    const ledge: GroundQuery = (_east, north) => (north > 50 ? 6 : 0);
    const pose = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 12, contextFor(STANDARD, ledge));
    expect(pose.north).toBeGreaterThan(60);
    expect(pose.up).toBeGreaterThan(5);
  });

  it("refuses a cliff face rather than climbing it", () => {
    const cliff: GroundQuery = (_east, north) => (north > 40 ? 400 : 0);
    const context = contextFor(STANDARD, cliff);
    let pose = spawnPose(0, 0, 0);
    let blocked = false;
    for (let index = 0; index < 900; index += 1) {
      const step = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true }, 1 / 60, {
        ...context,
        tick: index,
      });
      pose = step.pose;
      blocked = blocked || step.blocked;
    }
    expect(blocked).toBe(true);
    expect(pose.north).toBeLessThan(45);
  });

  it("looks ahead rather than under the feet", () => {
    const drop: GroundQuery = (_east, north) => (north > 100 ? -200 : 0);
    const context = contextFor(STANDARD, drop);
    const running = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 8, context);
    // At a run the lookahead is a stride ahead: enough to have sampled the drop.
    expect(GROUND_LOOKAHEAD_SECONDS * running.speedMps).toBeGreaterThan(3);
  });

  it("falls off an edge and lands, with an impulse the camera can use", () => {
    const shelf: GroundQuery = (_east, north) => (north > 60 ? -120 : 0);
    const context = contextFor(STANDARD, shelf);
    let pose = spawnPose(0, 0, 0);
    let sawFall = false;
    let landImpulse = 0;
    for (let index = 0; index < 1_500; index += 1) {
      const step = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true }, 1 / 60, {
        ...context,
        tick: index,
      });
      pose = step.pose;
      sawFall = sawFall || pose.state === "fall";
      if (step.events.some((event) => event.kind === "land")) {
        landImpulse = Math.max(landImpulse, step.cameraImpulse);
      }
    }
    expect(sawFall).toBe(true);
    expect(landImpulse).toBeGreaterThan(0.2);
    expect(pose.up).toBeLessThan(-100);
  });
});

describe("water", () => {
  it("wades, then swims, as the bottom drops away", () => {
    const shelving: GroundQuery = (_east, north) => 20 - north * 0.6;
    const context = contextFor(STANDARD, shelving, 0);
    const states = new Set<string>();
    let pose = spawnPose(0, 0, 20);
    for (let index = 0; index < 2_400; index += 1) {
      pose = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true }, 1 / 60, {
        ...context,
        tick: index,
      }).pose;
      states.add(pose.state);
    }
    expect(states.has("wade")).toBe(true);
    expect(states.has("swim")).toBe(true);
  });

  it("reports entering the water once, not every frame", () => {
    const shelving: GroundQuery = (_east, north) => 20 - north * 0.6;
    const context = contextFor(STANDARD, shelving, 0);
    let pose = spawnPose(0, 0, 20);
    let entries = 0;
    for (let index = 0; index < 1_200; index += 1) {
      const step = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1 }, 1 / 60, {
        ...context,
        tick: index,
      });
      pose = step.pose;
      entries += step.events.filter((event) => event.kind === "water-entry").length;
    }
    expect(entries).toBe(1);
  });
});

describe("footfalls", () => {
  it("spaces footfalls by distance covered, which is what stops the feet skating", () => {
    const context = contextFor();
    let pose = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 8, context);
    const positions: Array<{ east: number; north: number }> = [];
    for (let index = 0; index < 1_200; index += 1) {
      const step = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true }, 1 / 60, {
        ...context,
        tick: index,
      });
      pose = step.pose;
      for (const event of step.events) {
        if (event.kind === "footfall") positions.push({ east: event.east, north: event.north });
      }
    }
    expect(positions.length).toBeGreaterThan(3);
    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1];
      const current = positions[index];
      if (!previous || !current) continue;
      const gap = Math.hypot(current.east - previous.east, current.north - previous.north);
      expect(gap).toBeGreaterThan(STANDARD.locomotion.strideMeters * 0.9);
      expect(gap).toBeLessThan(STANDARD.locomotion.strideMeters * 1.1);
    }
  });

  it("alternates feet", () => {
    const context = contextFor();
    let pose = spawnPose(0, 0, 0);
    const feet: Array<"L" | "R"> = [];
    for (let index = 0; index < 1_800; index += 1) {
      const step = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true }, 1 / 60, {
        ...context,
        tick: index,
      });
      pose = step.pose;
      for (const event of step.events) {
        if (event.kind === "footfall" && event.foot) feet.push(event.foot);
      }
    }
    expect(feet.length).toBeGreaterThan(4);
    for (let index = 1; index < feet.length; index += 1) expect(feet[index]).not.toBe(feet[index - 1]);
  });

  it("plants no feet while airborne", () => {
    const gap: GroundQuery = () => -400;
    const context = contextFor(STANDARD, gap);
    let pose = spawnPose(0, 0, 0);
    let footfalls = 0;
    for (let index = 0; index < 120; index += 1) {
      const step = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1 }, 1 / 60, {
        ...context,
        tick: index,
      });
      pose = step.pose;
      footfalls += step.events.filter((event) => event.kind === "footfall").length;
    }
    expect(pose.state).toBe("fall");
    expect(footfalls).toBe(0);
  });
});

describe("the environment", () => {
  it("takes grip and pace from the environment rather than inventing them", () => {
    const fair = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 4, contextFor());
    const icy = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 4, {
      ...contextFor(),
      effects: { tractionMultiplier: 0.4, movementMultiplier: 1 },
    });
    const slow = drive(spawnPose(0, 0, 0), { forward: 1, run: true }, 12, {
      ...contextFor(),
      effects: { tractionMultiplier: 1, movementMultiplier: 0.5 },
    });
    // Ice costs acceleration, not top speed; deep going costs top speed.
    expect(icy.speedMps).toBeLessThan(fair.speedMps);
    expect(slow.speedMps).toBeLessThan(STANDARD.locomotion.runSpeedMps * 0.6);
  });
});

describe("the booster", () => {
  it("fires from a buffered press and spends the charge", () => {
    const buffer = new InputBuffer();
    buffer.press("booster", 0);
    const context = { ...contextFor(), buffer, tick: 0 };
    const step = stepJaeger(spawnPose(0, 0, 0), { ...NEUTRAL_JAEGER_INPUT, forward: 1 }, 1 / 60, context);
    expect(step.pose.boosterCharge).toBe(0);
    expect(step.events.some((event) => event.kind === "booster")).toBe(true);
    expect(step.cameraImpulse).toBeGreaterThan(0.4);
  });

  it("recharges over the profile's own time and will not fire empty", () => {
    const buffer = new InputBuffer();
    buffer.press("booster", 0);
    let pose = spawnPose(0, 0, 0);
    const context = { ...contextFor(), buffer };
    pose = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT }, 1 / 60, { ...context, tick: 0 }).pose;
    buffer.press("booster", 1);
    const second = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT }, 1 / 60, { ...context, tick: 1 });
    expect(second.events.some((event) => event.kind === "booster")).toBe(false);

    let recharged = pose;
    for (let index = 0; index < 60 * 10; index += 1) {
      recharged = stepJaeger(recharged, NEUTRAL_JAEGER_INPUT, 1 / 60, { ...contextFor(), tick: index }).pose;
    }
    expect(recharged.boosterCharge).toBe(1);
  });
});

describe("reactions", () => {
  it("knocks the machine down and gets it back up on its own timing", () => {
    const context = contextFor(HEAVY);
    let pose = applyReaction(spawnPose(0, 0, 0), { kind: "knockdown", impulseMps: 20 });
    expect(pose.state).toBe("knockdown");
    const seen = new Set<string>();
    for (let index = 0; index < 60 * 12; index += 1) {
      pose = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1 }, 1 / 60, {
        ...context,
        tick: index,
      }).pose;
      seen.add(pose.state);
    }
    expect(seen.has("get-up")).toBe(true);
    // Back on its feet and taking input again by the end.
    expect(pose.state).not.toBe("knockdown");
    expect(pose.state).not.toBe("get-up");
  });

  it("ignores the player while knocked back", () => {
    const context = contextFor();
    let pose = applyReaction(spawnPose(0, 0, 0), { kind: "knockback", impulseMps: 14, directionDeg: 180 });
    const before = pose.yawDeg;
    pose = stepJaeger(
      pose,
      { ...NEUTRAL_JAEGER_INPUT, forward: 1, desiredHeadingDeg: 90 },
      1 / 60,
      context,
    ).pose;
    expect(pose.yawDeg).toBe(before);
    expect(pose.state).toBe("knockback");
  });

  it("moves on a damaged leg, slower", () => {
    const context = contextFor();
    const healthy = drive(spawnPose(0, 0, 0), { forward: 1 }, 6, context);
    const hurt = drive(
      applyReaction(spawnPose(0, 0, 0), { kind: "disable-leg" }),
      { forward: 1 },
      6,
      context,
    );
    expect(hurt.state).toBe("disabled");
    expect(hurt.speedMps).toBeLessThan(healthy.speedMps * 0.6);
  });

  it("stops responding when destroyed", () => {
    const context = contextFor();
    const dead = drive(
      applyReaction(spawnPose(0, 0, 0), { kind: "destroy" }),
      { forward: 1, run: true },
      4,
      context,
    );
    expect(dead.state).toBe("death");
    expect(dead.speedMps).toBeLessThan(0.01);
    expect(applyReaction(dead, { kind: "knockdown" }).state).toBe("death");
  });
});

describe("frame independence", () => {
  it("covers the same ground at 30 and 144 frames a second", () => {
    const context = contextFor();
    const run = (fps: number): number => {
      let pose = spawnPose(0, 0, 0);
      const steps = Math.round(6 * fps);
      for (let index = 0; index < steps; index += 1) {
        pose = stepJaeger(pose, { ...NEUTRAL_JAEGER_INPUT, forward: 1, run: true }, 1 / fps, {
          ...context,
          tick: index,
        }).pose;
      }
      return pose.north;
    };
    const slow = run(30);
    const fast = run(144);
    expect(Math.abs(slow - fast) / Math.max(slow, fast)).toBeLessThan(0.02);
  });

  it("does nothing at all on a zero or negative frame", () => {
    const pose = spawnPose(3, 4, 5, 90);
    expect(stepJaeger(pose, NEUTRAL_JAEGER_INPUT, 0, contextFor()).pose).toEqual(pose);
    expect(stepJaeger(pose, NEUTRAL_JAEGER_INPUT, -1, contextFor()).pose).toEqual(pose);
  });
});
