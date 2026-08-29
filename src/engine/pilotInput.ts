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
  /** The melee row: grapple, dodge, parry, prop swing and pick up. */
  readonly onMelee?: (code: string) => void;
  readonly onChargeStart?: () => void;
  readonly onChargeRelease?: () => void;
  /** Whether the finisher input is being held, checked every beat that asks. */
  readonly onFinisherHold?: (holding: boolean) => void;
  /** A weapon key. The code is passed through; what it means is bootstrap's business. */
  readonly onWeapon?: (code: string) => void;
  /** Sustained weapons stop when the key comes up. */
  readonly onWeaponRelease?: (code: string) => void;
  /** Opens or closes the quick command dial. Never pauses anything. */
  readonly onOrderDial?: () => void;
  /**
   * A number-row key while piloting.
   *
   * Routed here rather than straight to the weapon row because the same digits
   * mean an order while the dial is open. The caller decides which, and forwards
   * to the weapon path when it is not an order.
   */
  readonly onNumberKey?: (code: string) => boolean;
  /** Action layout: left mouse, the basic chain. */
  readonly onPrimary?: () => void;
  /** Action layout: right mouse down and up, the heavy and its charge. */
  readonly onSecondaryDown?: () => void;
  readonly onSecondaryUp?: () => void;
  /** Action layout: Q, the booster dodge. */
  readonly onDodge?: () => void;
  /** Action layout: E, the grab. */
  readonly onGrab?: () => void;
  /** Action layout: 1 to 4, the abilities. */
  readonly onAbility?: (index: number) => void;
  /** Action layout: R, the ultimate. */
  readonly onUltimate?: () => void;
  /** Action layout: F pressed, the perfect-guard attempt (the hold is read separately). */
  readonly onGuardPress?: () => void;
}

/** Keys the ranged row answers to. */
export const WEAPON_KEY_CODES = [
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
  "KeyJ",
  "KeyK",
  "KeyO",
  "KeyL",
] as const;

/** Keys the melee row answers to. */
export const MELEE_KEY_CODES = ["KeyG", "KeyV", "KeyB", "KeyN", "KeyP"] as const;
/** The number row, which gives a squad order while the quick command is open. */
export const SQUAD_ORDER_KEY_CODES = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
] as const;

/** Opens the quick command. */
export const ORDER_DIAL_KEY_CODE = "KeyQ";

/** Held to wind up a charge, released to throw it. */
const CHARGE_KEY_CODE = "KeyH";

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
  private chargingValue = false;
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: PilotInputCallbacks,
    /** Injected so a test can drive input with no document. */
    private readonly target: EventTarget = window,
    /**
     * The action layout: mouse buttons attack, Q dodges, E grabs, 1 to 4 are
     * abilities, R is the ultimate, F on press is the perfect guard. The
     * classic layout (number-row attacks, letter-row weapons) stays for the
     * debug build and its tests.
     */
    private actionLayout = false,
  ) {
    this.bind("keydown", (event) => this.onKeyDown(event as KeyboardEvent));
    this.bind("keyup", (event) => this.onKeyUp(event as KeyboardEvent));
    // Losing focus with a key held would otherwise leave the machine walking
    // into a hillside until the player came back and pressed it again.
    this.bind("blur", () => this.held.clear());
    this.bindCanvas("mousemove", (event) => this.onMouseMove(event as MouseEvent));
    this.bindCanvas("click", () => this.requestPointerLock());
    this.bindCanvas("mousedown", (event) => this.onMouseDown(event as MouseEvent));
    this.bindCanvas("mouseup", (event) => this.onMouseUp(event as MouseEvent));
    this.bindCanvas("contextmenu", (event) => {
      if (this.actionLayout) event.preventDefault();
    });
  }

  /** Switches between the classic number-row layout and the action layout. */
  setActionLayout(on: boolean): void {
    this.actionLayout = on;
  }

  private onMouseDown(event: MouseEvent): void {
    if (!this.enabledValue || !this.actionLayout) return;
    if (event.button === 0) this.callbacks.onPrimary?.();
    else if (event.button === 2) this.callbacks.onSecondaryDown?.();
    else if (event.button === 1) {
      event.preventDefault();
      this.callbacks.onLockToggle();
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (!this.enabledValue || !this.actionLayout) return;
    if (event.button === 2) this.callbacks.onSecondaryUp?.();
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  /** True while a charge is being wound up. */
  get charging(): boolean {
    return this.chargingValue;
  }

  /**
   * Which way the stick is pushed, for directional variants.
   *
   * A move with a direction is the same button with a different answer, so the
   * direction has to be readable at the moment the button is pressed rather than
   * only inside the movement sample.
   */
  /** Whether the classic turn keys steer; under the action layout the mouse does. */
  get turnKeysActive(): boolean {
    return !this.actionLayout;
  }

  get moveDirection(): "neutral" | "forward" | "back" | "side" {
    if (LEFT_KEYS.some((code) => this.held.has(code)) || RIGHT_KEYS.some((code) => this.held.has(code))) {
      return "side";
    }
    if (FORWARD_KEYS.some((code) => this.held.has(code))) return "forward";
    if (BACK_KEYS.some((code) => this.held.has(code))) return "back";
    return "neutral";
  }

  /** True while the guard key is down, which is also the finisher hold. */
  get finisherHeld(): boolean {
    return this.held.has("KeyF");
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
    const turnIntent = this.actionLayout ? 0 : axis(this.held, TURN_RIGHT_KEYS, TURN_LEFT_KEYS);
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
    for (const code of MELEE_KEY_CODES) {
      actions[code] = () => this.callbacks.onMelee?.(code);
    }
    for (const code of WEAPON_KEY_CODES) {
      actions[code] = () => this.callbacks.onWeapon?.(code);
    }
    // The number row is offered to the quick command first and falls through to
    // whatever it already did. The digits are attack slots and weapons, and a
    // squad order must not quietly take any of them away: the caller answers
    // whether it consumed the key, and if it did not, the original action runs.
    for (const code of SQUAD_ORDER_KEY_CODES) {
      const fallback = actions[code];
      actions[code] = () => {
        if (this.callbacks.onNumberKey?.(code) === true) return;
        fallback?.();
      };
    }
    actions[ORDER_DIAL_KEY_CODE] = () => this.callbacks.onOrderDial?.();
    actions[CHARGE_KEY_CODE] = () => {
      this.chargingValue = true;
      this.callbacks.onChargeStart?.();
    };
    if (this.actionLayout) {
      // Turning is the mouse's job; Q and E are the dodge and the grab.
      delete actions["KeyQ"];
      delete actions["KeyE"];
      delete actions["KeyH"];
      actions["KeyQ"] = () => this.callbacks.onDodge?.();
      actions["KeyE"] = () => this.callbacks.onGrab?.();
      actions["KeyR"] = () => this.callbacks.onUltimate?.();
      actions["KeyF"] = () => this.callbacks.onGuardPress?.();
      (["Digit1", "Digit2", "Digit3", "Digit4"] as const).forEach((code, index) => {
        actions[code] = () => this.callbacks.onAbility?.(index);
      });
      for (const code of ["Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"]) delete actions[code];
      for (const code of MELEE_KEY_CODES) delete actions[code];
      for (const code of WEAPON_KEY_CODES) delete actions[code];
    }
    const action = actions[event.code];
    if (action) {
      action();
      event.preventDefault();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.held.delete(event.code);
    if (event.code === CHARGE_KEY_CODE && this.chargingValue) {
      this.chargingValue = false;
      this.callbacks.onChargeRelease?.();
    }
    if (event.code === "KeyF") this.callbacks.onFinisherHold?.(false);
    // The chain sword channels while its ability key is held.
    if (this.actionLayout && event.code === "Digit3") this.callbacks.onWeaponRelease?.("KeyK");
    if ((WEAPON_KEY_CODES as readonly string[]).includes(event.code)) {
      this.callbacks.onWeaponRelease?.(event.code);
    }
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
    // Automation and unfocused documents refuse the lock; that is not an error.
    void Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => undefined);
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
