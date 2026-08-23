import type { JaegerInput } from "../jaegers/locomotion";
import type { CameraInput } from "../jaegers/camera";

/**
 * Keyboard and mouse for a piloted Jaeger.
 *
 * The only file in the pilot path that touches an input event. It turns held
 * keys and mouse movement into two plain snapshots, one for the machine and one
 * for the camera, so the controller stays testable without a browser.
 *
 * Movement is camera relative: pushing forward means "that way", where that way
 * is where the player is looking. What it never means is "face that way now" -
 * the heading is handed to the controller as an intent and the body turns toward
 * it at whatever rate its current state allows.
 *
 * Everything works without a mouse. Q and E turn, the arrow keys look, and a
 * player who never enables pointer lock can drive the whole course.
 */

export interface PilotInputCallbacks {
  readonly onCameraCycle: () => void;
  readonly onLockToggle: () => void;
  readonly onBooster: () => void;
  readonly onExit: () => void;
  readonly onReducedMotionToggle: () => void;
  /** An attack press. The slot is what the player pressed, not what will run. */
  readonly onAttack?: (slot: number) => void;
  readonly onAimModeToggle?: () => void;
}

/** Attack slots, in the order they sit on the number row. */
export const ATTACK_SLOT_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"] as const;

const FORWARD_KEYS = ["KeyW"] as const;
const BACK_KEYS = ["KeyS"] as const;
const LEFT_KEYS = ["KeyA"] as const;
const RIGHT_KEYS = ["KeyD"] as const;
const TURN_LEFT_KEYS = ["KeyQ"] as const;
const TURN_RIGHT_KEYS = ["KeyE"] as const;
const LOOK_LEFT_KEYS = ["ArrowLeft"] as const;
const LOOK_RIGHT_KEYS = ["ArrowRight"] as const;
const LOOK_UP_KEYS = ["ArrowUp"] as const;
const LOOK_DOWN_KEYS = ["ArrowDown"] as const;
const RUN_KEYS = ["ShiftLeft", "ShiftRight"] as const;
const GUARD_KEYS = ["KeyF"] as const;

/** Degrees per second when looking with the keyboard rather than the mouse. */
export const KEYBOARD_LOOK_DEG_PER_SECOND = 95;

export class PilotInputSource {
  private readonly held = new Set<string>();
  private pendingYawDeg = 0;
  private pendingPitchDeg = 0;
  private enabledValue = true;
  private disposed = false;
  private sensitivityValue = 0.11;
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: PilotInputCallbacks,
    /** Injected so a test can drive input with no document. */
    private readonly target: EventTarget = window,
  ) {
    this.bind("keydown", (event) => this.onKeyDown(event as KeyboardEvent));
    this.bind("keyup", (event) => this.onKeyUp(event as KeyboardEvent));
    // Losing focus with a key held would otherwise leave the machine walking
    // into a hillside until the player came back and pressed it again.
    this.bind("blur", () => this.held.clear());
    this.bindCanvas("mousemove", (event) => this.onMouseMove(event as MouseEvent));
    this.bindCanvas("click", () => this.requestPointerLock());
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  setEnabled(enabled: boolean): void {
    this.enabledValue = enabled;
    if (!enabled) {
      this.held.clear();
      this.pendingYawDeg = 0;
      this.pendingPitchDeg = 0;
    }
  }

  setSensitivity(sensitivity: number): void {
    if (Number.isFinite(sensitivity) && sensitivity > 0) this.sensitivityValue = sensitivity;
  }

  /**
   * What the machine should do this frame.
   *
   * `cameraYawDeg` is where the player is looking; the returned heading intent is
   * that yaw rotated by the direction they are pushing, which is what makes the
   * controls camera relative without the body ever snapping to the camera.
   */
  sample(cameraYawDeg: number, deltaSeconds: number, allowHeadingIntent = true): JaegerInput {
    if (!this.enabledValue) {
      return { forward: 0, strafe: 0, run: false, guard: false, desiredHeadingDeg: null, turnIntent: 0 };
    }
    const forward = axis(this.held, FORWARD_KEYS, BACK_KEYS);
    const strafe = axis(this.held, RIGHT_KEYS, LEFT_KEYS);
    const turnIntent = axis(this.held, TURN_RIGHT_KEYS, TURN_LEFT_KEYS);
    const moving = Math.hypot(forward, strafe) > 0.05;
    const desiredHeadingDeg =
      allowHeadingIntent && moving && Math.abs(turnIntent) < 0.05
        ? cameraYawDeg + (Math.atan2(strafe, forward) * 180) / Math.PI
        : null;
    void deltaSeconds;
    return {
      forward,
      strafe,
      run: RUN_KEYS.some((code) => this.held.has(code)),
      guard: GUARD_KEYS.some((code) => this.held.has(code)),
      desiredHeadingDeg,
      turnIntent,
    };
  }

  /** Look deltas for this frame, mouse and keyboard combined. Consumed once. */
  sampleCamera(deltaSeconds: number): CameraInput {
    if (!this.enabledValue) return { yawDeltaDeg: 0, pitchDeltaDeg: 0 };
    const keyboardYaw =
      axis(this.held, LOOK_RIGHT_KEYS, LOOK_LEFT_KEYS) * KEYBOARD_LOOK_DEG_PER_SECOND * deltaSeconds;
    const keyboardPitch =
      axis(this.held, LOOK_DOWN_KEYS, LOOK_UP_KEYS) * KEYBOARD_LOOK_DEG_PER_SECOND * deltaSeconds;
    const yawDeltaDeg = this.pendingYawDeg + keyboardYaw;
    const pitchDeltaDeg = this.pendingPitchDeg + keyboardPitch;
    this.pendingYawDeg = 0;
    this.pendingPitchDeg = 0;
    return { yawDeltaDeg, pitchDeltaDeg };
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.enabledValue) return;
    // A press is recorded once. Key repeat would otherwise queue a booster burst
    // for every frame the key was held.
    if (event.repeat) return;
    this.held.add(event.code);
    const actions: Record<string, () => void> = {
      KeyC: () => this.callbacks.onCameraCycle(),
      KeyT: () => this.callbacks.onLockToggle(),
      Space: () => this.callbacks.onBooster(),
      KeyM: () => this.callbacks.onReducedMotionToggle(),
      KeyR: () => this.callbacks.onAimModeToggle?.(),
      Escape: () => this.callbacks.onExit(),
    };
    ATTACK_SLOT_KEYS.forEach((code, index) => {
      actions[code] = () => this.callbacks.onAttack?.(index);
    });
    const action = actions[event.code];
    if (action) {
      action();
      event.preventDefault();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.held.delete(event.code);
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.enabledValue) return;
    if (document.pointerLockElement !== this.canvas) return;
    this.pendingYawDeg += event.movementX * this.sensitivityValue;
    this.pendingPitchDeg += event.movementY * this.sensitivityValue;
  }

  private requestPointerLock(): void {
    if (!this.enabledValue || this.disposed) return;
    if (document.pointerLockElement === this.canvas) return;
    void this.canvas.requestPointerLock?.();
  }

  private bind(type: string, handler: (event: Event) => void): void {
    this.target.addEventListener(type, handler);
    this.listeners.push(() => this.target.removeEventListener(type, handler));
  }

  private bindCanvas(type: string, handler: (event: Event) => void): void {
    this.canvas.addEventListener(type, handler);
    this.listeners.push(() => this.canvas.removeEventListener(type, handler));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    this.held.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }
}

function axis(held: ReadonlySet<string>, positive: readonly string[], negative: readonly string[]): number {
  const up = positive.some((code) => held.has(code)) ? 1 : 0;
  const down = negative.some((code) => held.has(code)) ? 1 : 0;
  return up - down;
}
