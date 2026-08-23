import { ON_FOOT, type OnFootInput } from "../shatterdome/onFoot";

/**
 * Keyboard and mouse for the on-foot player.
 *
 * The only file that touches an input event. It turns held keys and mouse
 * movement into a plain `OnFootInput` snapshot the controller consumes, so the
 * movement code stays testable without a browser and the input code stays free
 * of movement rules.
 *
 * Everything here can be done without a mouse. Arrow keys turn and look, Tab
 * cycles the fixtures in the room, and E uses whatever is focused: a player who
 * never enables pointer lock can still walk from command to a Conn-Pod.
 */

export interface OnFootInputCallbacks {
  readonly onInteract: () => void;
  readonly onCycleFocus: (direction: 1 | -1) => void;
  readonly onUnstuck: () => void;
  readonly onPauseToggle: () => void;
}

/** Held keys, by the `code` values a layout cannot change out from under us. */
const FORWARD_KEYS = ["KeyW"] as const;
const BACK_KEYS = ["KeyS"] as const;
const LEFT_KEYS = ["KeyA"] as const;
const RIGHT_KEYS = ["KeyD"] as const;
const TURN_LEFT_KEYS = ["ArrowLeft"] as const;
const TURN_RIGHT_KEYS = ["ArrowRight"] as const;
const LOOK_UP_KEYS = ["ArrowUp"] as const;
const LOOK_DOWN_KEYS = ["ArrowDown"] as const;

export class OnFootInputSource {
  private readonly held = new Set<string>();
  private pendingYawDeg = 0;
  private pendingPitchDeg = 0;
  private enabledValue = true;
  private disposed = false;
  private readonly listeners: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: OnFootInputCallbacks,
    /** Injected so tests can drive input without a document. */
    private readonly target: EventTarget = window,
  ) {
    this.bind("keydown", (event) => this.onKeyDown(event as KeyboardEvent));
    this.bind("keyup", (event) => this.onKeyUp(event as KeyboardEvent));
    // Focus loss must clear held keys, or alt-tabbing away leaves the player
    // walking into a wall until they come back and press the key again.
    this.bind("blur", () => this.held.clear());
    this.bindCanvas("mousemove", (event) => this.onMouseMove(event as MouseEvent));
    this.bindCanvas("click", () => this.requestPointerLock());
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  /**
   * Turns movement off while a management interface is open.
   *
   * Held keys are dropped at the same moment: a player who walks up to a
   * terminal with W held must not still be walking behind the panel.
   */
  setEnabled(enabled: boolean): void {
    this.enabledValue = enabled;
    if (!enabled) {
      this.held.clear();
      this.pendingYawDeg = 0;
      this.pendingPitchDeg = 0;
      this.exitPointerLock();
    }
  }

  get pointerLocked(): boolean {
    return typeof document !== "undefined" && document.pointerLockElement === this.canvas;
  }

  /** Consumes the frame's input. Mouse deltas are drained, held keys are not. */
  sample(deltaSeconds: number): OnFootInput {
    if (!this.enabledValue) {
      return { forward: 0, strafe: 0, run: false, crouch: false, yawDeltaDeg: 0, pitchDeltaDeg: 0 };
    }
    const keyTurn = ON_FOOT.keyboardTurnDegPerSecond * Math.max(0, deltaSeconds);
    const yawDeltaDeg =
      this.pendingYawDeg +
      (this.any(TURN_RIGHT_KEYS) ? keyTurn : 0) -
      (this.any(TURN_LEFT_KEYS) ? keyTurn : 0);
    const pitchDeltaDeg =
      this.pendingPitchDeg +
      (this.any(LOOK_UP_KEYS) ? keyTurn * 0.7 : 0) -
      (this.any(LOOK_DOWN_KEYS) ? keyTurn * 0.7 : 0);
    this.pendingYawDeg = 0;
    this.pendingPitchDeg = 0;

    return {
      forward: (this.any(FORWARD_KEYS) ? 1 : 0) - (this.any(BACK_KEYS) ? 1 : 0),
      strafe: (this.any(RIGHT_KEYS) ? 1 : 0) - (this.any(LEFT_KEYS) ? 1 : 0),
      run: this.held.has("ShiftLeft") || this.held.has("ShiftRight"),
      crouch: this.held.has("ControlLeft") || this.held.has("ControlRight"),
      yawDeltaDeg,
      pitchDeltaDeg,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    this.held.clear();
    this.exitPointerLock();
  }

  private any(keys: readonly string[]): boolean {
    return keys.some((key) => this.held.has(key));
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Escape reaches the pause menu whether or not movement is enabled, because
    // it is the way out of every state including a panel.
    if (event.code === "Escape") {
      this.callbacks.onPauseToggle();
      return;
    }
    // Use reaches the game whether or not movement is enabled, because it is
    // also how an open panel is closed: the panel's own button says "Close (E)",
    // and a key that is advertised has to work.
    if (event.code === "KeyE" && !event.repeat) {
      this.callbacks.onInteract();
      return;
    }
    if (!this.enabledValue) return;

    if (event.code === "Tab") {
      // Tab would otherwise walk the browser's own focus ring off the canvas.
      event.preventDefault();
      this.callbacks.onCycleFocus(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.repeat) return;
    if (event.code === "KeyU") {
      this.callbacks.onUnstuck();
      return;
    }
    this.held.add(event.code);
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.held.delete(event.code);
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.enabledValue || !this.pointerLocked) return;
    this.pendingYawDeg += event.movementX * ON_FOOT.lookDegreesPerPixel;
    // Screen down is a positive movement, and looking down is a negative pitch.
    this.pendingPitchDeg -= event.movementY * ON_FOOT.lookDegreesPerPixel;
  }

  private requestPointerLock(): void {
    if (!this.enabledValue || this.pointerLocked) return;
    // Pointer lock is a request, not a guarantee: a browser may refuse it and
    // the keyboard path has to keep working when it does.
    void Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => undefined);
  }

  private exitPointerLock(): void {
    if (typeof document === "undefined") return;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  private bind(type: string, handler: (event: Event) => void): void {
    this.target.addEventListener(type, handler);
    this.listeners.push(() => this.target.removeEventListener(type, handler));
  }

  private bindCanvas(type: string, handler: (event: Event) => void): void {
    this.canvas.addEventListener(type, handler);
    this.listeners.push(() => this.canvas.removeEventListener(type, handler));
  }
}
