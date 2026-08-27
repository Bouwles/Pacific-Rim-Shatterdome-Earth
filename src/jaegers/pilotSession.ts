import type { JaegerDefinition, LocomotionProfile } from "../data/jaegers";
import { scaleLocomotion, type MachineGrowth } from "./progression";
import type { EnvironmentEffects } from "../world/environment";
import { InputBuffer } from "./inputBuffer";
import {
  NEUTRAL_JAEGER_INPUT,
  spawnPose,
  stepJaeger,
  applyReaction,
  type GroundQuery,
  type JaegerInput,
  type JaegerPose,
  type LocomotionEvent,
  type ReactionRequest,
} from "./locomotion";
import {
  DEFAULT_COMFORT,
  cameraPlacement,
  initialCameraState,
  nextCameraMode,
  setLockedTarget,
  stepCamera,
  switchCameraMode,
  type CameraComfort,
  type CameraInput,
  type CameraMode,
  type CameraPlacement,
  type CameraState,
} from "./camera";

/**
 * A piloted machine.
 *
 * One object holding the pose, the camera, the comfort settings and the input
 * buffer, so `bootstrap` wires four things together rather than fourteen and a
 * test can drive a full pilot session with no browser at all.
 *
 * Everything authoritative about the machine lives in the pose. Everything the
 * player set up lives in the camera state and the comfort block, which is what
 * makes a camera swap lossless: the rig changes and nothing else does.
 */

export interface PilotSessionOptions {
  readonly jaeger: JaegerDefinition;
  readonly east: number;
  readonly north: number;
  readonly up: number;
  readonly headingDeg?: number;
  readonly comfort?: CameraComfort;
  /** Injected so tests can use a shorter window than the shipped one. */
  readonly buffer?: InputBuffer;
  /**
   * What this machine's levels and rank are worth. Omitted by anything that
   * does not care, in which case the machine moves exactly as its chassis says.
   */
  readonly growth?: MachineGrowth;
}

export interface PilotUpdate {
  readonly deltaSeconds: number;
  readonly tick: number;
  readonly input: JaegerInput;
  readonly cameraInput: CameraInput;
  readonly ground: GroundQuery;
  readonly waterHeightMeters: number;
  readonly effects: Pick<EnvironmentEffects, "tractionMultiplier" | "movementMultiplier">;
  readonly obstruction?: (desiredDistanceMeters: number) => number | null;
  readonly targetPosition?: { readonly east: number; readonly north: number; readonly up: number } | null;
}

export interface PilotFrame {
  readonly pose: JaegerPose;
  readonly camera: CameraState;
  readonly placement: CameraPlacement;
  readonly events: readonly LocomotionEvent[];
  readonly groundHeightMeters: number | null;
  readonly headingErrorDeg: number;
  readonly blocked: boolean;
}

export class PilotSession {
  /**
   * The locomotion profile this machine actually moves on: its chassis numbers
   * with mobility growth applied. Computed once, because a level does not
   * change mid-fight and recomputing it per frame would be work for nothing.
   */
  private readonly profile: LocomotionProfile;

  private poseValue: JaegerPose;
  private cameraValue: CameraState;
  private comfortValue: CameraComfort;
  private readonly bufferValue: InputBuffer;
  private lastPlacement: CameraPlacement | null = null;
  private lastInput: JaegerInput = NEUTRAL_JAEGER_INPUT;
  private pendingImpulse = 0;

  constructor(private readonly options: PilotSessionOptions) {
    this.poseValue = spawnPose(options.east, options.north, options.up, options.headingDeg ?? 0);
    this.cameraValue = initialCameraState("third-person", options.headingDeg ?? 0);
    this.comfortValue = options.comfort ?? DEFAULT_COMFORT;
    this.bufferValue = options.buffer ?? new InputBuffer();
    this.profile = scaleLocomotion(options.jaeger.locomotion, options.growth?.mobility ?? 1);
  }

  get jaeger(): JaegerDefinition {
    return this.options.jaeger;
  }

  get pose(): JaegerPose {
    return this.poseValue;
  }

  get camera(): CameraState {
    return this.cameraValue;
  }

  get comfort(): CameraComfort {
    return this.comfortValue;
  }

  get buffer(): InputBuffer {
    return this.bufferValue;
  }

  get placement(): CameraPlacement | null {
    return this.lastPlacement;
  }

  /** Records a press for the controller to take when it becomes legal. */
  press(action: string, tick: number): void {
    this.bufferValue.press(action, tick);
  }

  setComfort(comfort: Partial<CameraComfort>): CameraComfort {
    this.comfortValue = { ...this.comfortValue, ...comfort };
    return this.comfortValue;
  }

  /**
   * Changes rig. Heading intent, pitch, lock, comfort and the input buffer are
   * all untouched, which is the whole contract of a camera swap.
   */
  setCameraMode(mode: CameraMode): CameraState {
    this.cameraValue = switchCameraMode(this.cameraValue, mode);
    return this.cameraValue;
  }

  cycleCamera(): CameraState {
    return this.setCameraMode(nextCameraMode(this.cameraValue.mode));
  }

  lockTarget(targetId: string | null): CameraState {
    this.cameraValue = setLockedTarget(this.cameraValue, targetId);
    return this.cameraValue;
  }

  /**
   * Moves the machine into a new local frame without disturbing anything else.
   *
   * The floating origin rebases as the player crosses the world, and the pose is
   * in local metres, so the same machine has different coordinates before and
   * after. Velocity, state, stride and camera are all frame independent and
   * survive untouched.
   */
  rebase(east: number, north: number, up: number): JaegerPose {
    this.poseValue = { ...this.poseValue, east, north, up };
    return this.poseValue;
  }

  /**
   * Adds a camera impulse from outside locomotion, 0 to 1.
   *
   * Combat impacts use this: the hit has already been counted by the arena, and
   * this only asks the camera to acknowledge it. It rides the same decay, the
   * same comfort scale and the same reduced-motion gate as a footfall, so no
   * new path can bypass the player's settings.
   */
  addImpulse(strength: number): void {
    if (!Number.isFinite(strength)) return;
    this.pendingImpulse = Math.max(this.pendingImpulse, Math.max(0, Math.min(1, strength)));
  }

  /** Applies something that happened to the machine. Combat calls this. */
  react(reaction: ReactionRequest): JaegerPose {
    this.poseValue = applyReaction(this.poseValue, reaction);
    return this.poseValue;
  }

  update(update: PilotUpdate): PilotFrame {
    this.lastInput = update.input;
    const step = stepJaeger(this.poseValue, update.input, update.deltaSeconds, {
      profile: this.profile,
      ground: update.ground,
      waterHeightMeters: update.waterHeightMeters,
      effects: update.effects,
      tick: update.tick,
      buffer: this.bufferValue,
    });
    this.poseValue = step.pose;

    const cameraContext = {
      pose: this.poseValue,
      profile: this.profile,
      comfort: this.comfortValue,
      impulse: Math.max(step.cameraImpulse, this.pendingImpulse),
      obstruction: update.obstruction,
      targetPosition: update.targetPosition ?? null,
    };
    this.cameraValue = stepCamera(this.cameraValue, update.cameraInput, update.deltaSeconds, cameraContext);
    this.pendingImpulse = 0;
    this.lastPlacement = cameraPlacement(this.cameraValue, cameraContext);

    return {
      pose: this.poseValue,
      camera: this.cameraValue,
      placement: this.lastPlacement,
      events: step.events,
      groundHeightMeters: step.groundHeightMeters,
      headingErrorDeg: step.headingErrorDeg,
      blocked: step.blocked,
    };
  }

  /** Flat numbers for a readout. Everything here is read back, never requested. */
  readout(): PilotReadout {
    const profile = this.options.jaeger.locomotion;
    return {
      jaegerName: this.options.jaeger.name,
      markDesignation: this.options.jaeger.markDesignation,
      state: this.poseValue.state,
      stateSeconds: this.poseValue.stateSeconds,
      speedMps: this.poseValue.speedMps,
      topSpeedMps: profile.runSpeedMps,
      headingDeg: this.poseValue.yawDeg,
      cameraHeadingDeg: this.cameraValue.yawDeg,
      cameraMode: this.cameraValue.mode,
      lockedTargetId: this.cameraValue.lockedTargetId,
      altitudeMeters: this.poseValue.up,
      waterState: this.poseValue.waterState,
      submergedFraction: this.poseValue.submergedFraction,
      boosterCharge: this.poseValue.boosterCharge,
      stridePhase: this.poseValue.stridePhase,
      grounded: this.poseValue.grounded,
      legDisabled: this.poseValue.legDisabled,
      destroyed: this.poseValue.destroyed,
      impulse: this.cameraValue.impulse,
      shakeScale: this.comfortValue.shakeScale,
      reducedMotion: this.comfortValue.reducedMotion,
      buffered: this.bufferValue.snapshot().pending.map((entry) => entry.action),
      droppedPresses: this.bufferValue.snapshot().dropped,
      guarding: this.lastInput.guard,
    };
  }
}

export interface PilotReadout {
  readonly jaegerName: string;
  readonly markDesignation: string;
  readonly state: string;
  readonly stateSeconds: number;
  readonly speedMps: number;
  readonly topSpeedMps: number;
  readonly headingDeg: number;
  readonly cameraHeadingDeg: number;
  readonly cameraMode: CameraMode;
  readonly lockedTargetId: string | null;
  readonly altitudeMeters: number;
  readonly waterState: string;
  readonly submergedFraction: number;
  readonly boosterCharge: number;
  readonly stridePhase: number;
  readonly grounded: boolean;
  readonly legDisabled: boolean;
  readonly destroyed: boolean;
  readonly impulse: number;
  readonly shakeScale: number;
  readonly reducedMotion: boolean;
  readonly buffered: readonly string[];
  readonly droppedPresses: number;
  readonly guarding: boolean;
}
