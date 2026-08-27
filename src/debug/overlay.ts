import { Scene, SceneInstrumentation } from "@babylonjs/core";
import type { SimulationKernel } from "../simulation/kernel";
import { TIME_SCALE_PRESETS, type SimulationLoop } from "../simulation/loop";

/** How often the readout text refreshes. Per-frame DOM writes are wasteful and unreadable. */
const REFRESH_INTERVAL_MS = 250;
export const TOGGLE_KEY = "F3";

export interface DebugOverlaySources {
  readonly backend: string;
  readonly babylonVersion: string;
  readonly scene: Scene;
  readonly kernel: SimulationKernel;
  readonly loop: SimulationLoop;
  /**
   * Live rigid body count, or null when no physics backend is wired. Returning
   * null makes the overlay say so instead of printing a fake zero.
   */
  activePhysicsBodies(): number | null;
  /** One line of profiler truth: p95, worst, long-frame count. */
  perfLine(): string;
  /** One line of adaptive-quality truth: level, on or off, pressure. */
  adaptiveLine(): string;
}

interface Row {
  readonly label: string;
  readonly field: string;
  read(): string;
}

/**
 * Developer overlay: renderer identity, frame cost, simulation state, and the
 * transport controls (pause / single step / slow motion) used to inspect a tick.
 * Presentation only — the simulation never reads from here.
 */
export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly instrumentation: SceneInstrumentation;
  private readonly valueNodes = new Map<string, HTMLElement>();
  private readonly rows: Row[];
  private readonly renderObserver;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private readonly pauseButton: HTMLButtonElement;
  private lastRefreshMs = 0;

  constructor(
    container: HTMLElement,
    private readonly sources: DebugOverlaySources,
  ) {
    const { scene, kernel, loop } = sources;

    this.instrumentation = new SceneInstrumentation(scene);
    this.instrumentation.captureFrameTime = true;

    this.rows = [
      { label: "renderer", field: "renderer", read: () => sources.backend },
      { label: "babylon", field: "babylon", read: () => sources.babylonVersion },
      { label: "fps", field: "fps", read: () => scene.getEngine().getFps().toFixed(0) },
      {
        label: "frame",
        field: "frameTime",
        read: () => `${this.instrumentation.frameTimeCounter.current.toFixed(1)} ms`,
      },
      {
        label: "draws",
        field: "drawCalls",
        read: () => String(this.instrumentation.drawCallsCounter.current),
      },
      { label: "sim tick", field: "tick", read: () => String(kernel.tick) },
      { label: "entities", field: "entities", read: () => String(kernel.entityCount) },
      {
        label: "physics",
        field: "physicsBodies",
        read: () => {
          const bodies = sources.activePhysicsBodies();
          return bodies === null ? "n/a (no backend)" : String(bodies);
        },
      },
      { label: "seed", field: "seed", read: () => String(kernel.seed) },
      {
        label: "state",
        field: "runState",
        read: () => (loop.isPaused ? "paused" : `running ${loop.timeScale}x`),
      },
      { label: "perf", field: "perf", read: () => sources.perfLine() },
      { label: "quality", field: "adaptive", read: () => sources.adaptiveLine() },
    ];

    this.root = document.createElement("div");
    this.root.id = "diagnosticsPanel";

    const readout = document.createElement("div");
    readout.className = "diag-readout";
    for (const row of this.rows) {
      const cell = document.createElement("span");
      cell.className = "diag-cell";
      const label = document.createElement("span");
      label.className = "diag-label";
      label.textContent = `${row.label}:`;
      const value = document.createElement("span");
      value.className = "diag-value";
      value.dataset.field = row.field;
      cell.append(label, value);
      readout.appendChild(cell);
      this.valueNodes.set(row.field, value);
    }

    const controls = document.createElement("div");
    controls.className = "diag-controls";

    this.pauseButton = document.createElement("button");
    this.pauseButton.type = "button";
    this.pauseButton.dataset.action = "pause";
    this.pauseButton.textContent = loop.isPaused ? "Resume" : "Pause";
    this.pauseButton.addEventListener("click", () => {
      loop.togglePause();
      this.refresh(true);
    });

    const stepButton = document.createElement("button");
    stepButton.type = "button";
    stepButton.dataset.action = "step";
    stepButton.textContent = "Step";
    stepButton.title = "Advance exactly one simulation tick";
    stepButton.addEventListener("click", () => {
      loop.requestSingleStep();
    });

    const scaleSelect = document.createElement("select");
    scaleSelect.dataset.action = "timescale";
    scaleSelect.name = "sim-time-scale";
    scaleSelect.title = "Simulation time scale";
    scaleSelect.setAttribute("aria-label", "Simulation time scale");
    for (const preset of TIME_SCALE_PRESETS) {
      const option = document.createElement("option");
      option.value = String(preset);
      option.textContent = `${preset}x`;
      if (preset === loop.timeScale) option.selected = true;
      scaleSelect.appendChild(option);
    }
    scaleSelect.addEventListener("change", () => {
      loop.timeScale = Number(scaleSelect.value);
      this.refresh(true);
    });

    controls.append(this.pauseButton, stepButton, scaleSelect);
    this.root.append(readout, controls);
    container.appendChild(this.root);

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === TOGGLE_KEY) {
        event.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    this.renderObserver = scene.onAfterRenderObservable.add(() => this.refresh(false));
    this.refresh(true);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  private refresh(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastRefreshMs < REFRESH_INTERVAL_MS) return;
    this.lastRefreshMs = now;

    for (const row of this.rows) {
      const node = this.valueNodes.get(row.field);
      if (node) node.textContent = row.read();
    }
    this.pauseButton.textContent = this.sources.loop.isPaused ? "Resume" : "Pause";
  }

  dispose(): void {
    window.removeEventListener("keydown", this.keyHandler);
    this.renderObserver?.remove();
    this.instrumentation.dispose();
    this.valueNodes.clear();
    this.root.remove();
  }
}
