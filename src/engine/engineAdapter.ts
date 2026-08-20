import { AbstractEngine, Engine, WebGPUEngine } from "@babylonjs/core";

export type RenderBackend = "WebGPU" | "WebGL";

export interface EngineAdapter {
  readonly engine: AbstractEngine;
  readonly backend: RenderBackend;
  readonly version: string;
  /** Fires when the GPU context/device is lost; the caller should show recovery messaging. */
  onContextLost(handler: () => void): void;
  /** Fires when Babylon has recovered the context/device after a loss. */
  onContextRestored(handler: () => void): void;
  /** Stops the render loop and releases every listener/observer/GPU resource this adapter created. */
  dispose(): void;
}

/**
 * Selects a render backend: WebGPU when the browser supports it, WebGL otherwise.
 * Gameplay code must never branch on which backend is active — only this module
 * and the diagnostics label are allowed to know.
 */
export async function createEngineAdapter(canvas: HTMLCanvasElement): Promise<EngineAdapter> {
  let engine: AbstractEngine;
  let backend: RenderBackend;

  const webGpuSupported = await WebGPUEngine.IsSupportedAsync.catch(() => false);
  if (webGpuSupported) {
    const webGpuEngine = new WebGPUEngine(canvas, { antialias: true });
    await webGpuEngine.initAsync();
    engine = webGpuEngine;
    backend = "WebGPU";
  } else {
    engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, antialias: true });
    backend = "WebGL";
  }

  const resizeHandler = (): void => engine.resize();
  window.addEventListener("resize", resizeHandler);

  const lostHandlers = new Set<() => void>();
  const restoredHandlers = new Set<() => void>();
  const contextLostObserver = engine.onContextLostObservable.add(() => lostHandlers.forEach((h) => h()));
  const contextRestoredObserver = engine.onContextRestoredObservable.add(() =>
    restoredHandlers.forEach((h) => h()),
  );

  let disposed = false;

  return {
    engine,
    backend,
    version: AbstractEngine.Version,
    onContextLost(handler: () => void): void {
      lostHandlers.add(handler);
    },
    onContextRestored(handler: () => void): void {
      restoredHandlers.add(handler);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", resizeHandler);
      engine.onContextLostObservable.remove(contextLostObserver);
      engine.onContextRestoredObservable.remove(contextRestoredObserver);
      lostHandlers.clear();
      restoredHandlers.clear();
      engine.stopRenderLoop();
      engine.dispose();
    },
  };
}
