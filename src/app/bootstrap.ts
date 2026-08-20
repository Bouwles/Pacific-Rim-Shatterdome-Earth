import { createEngineAdapter } from "../engine/engineAdapter";
import { buildBootScene } from "../engine/scene";
import { DebugOverlay } from "../debug/overlay";
import { SimulationKernel } from "../simulation/kernel";
import { SimulationLoop } from "../simulation/loop";
import { resolveSeed } from "./config";
import { AppState, AppStateMachine } from "./appState";
import {
  renderErrorScreen,
  renderLoadingScreen,
  renderMainMenu,
  renderShatterdomePlaceholder,
  clearScreen,
} from "../ui/screens";

export interface AppHandle {
  dispose(): void;
}

/**
 * Wires engine, scene, diagnostics, state machine, and DOM screens together.
 * This is the only place allowed to know how those modules connect.
 */
export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const canvas = root.querySelector<HTMLCanvasElement>("#renderCanvas");
  const uiRoot = root.querySelector<HTMLElement>("#uiRoot");
  const contextBanner = root.querySelector<HTMLElement>("#contextBanner");
  if (!canvas || !uiRoot || !contextBanner) {
    throw new Error("bootstrap: expected #renderCanvas, #uiRoot, #contextBanner in the root element");
  }

  const stateMachine = new AppStateMachine();
  const unsubscribers: Array<() => void> = [];

  let overlay: DebugOverlay | undefined;
  let kernel: SimulationKernel | undefined;
  let adapterDispose: (() => void) | undefined;

  try {
    const adapter = await createEngineAdapter(canvas);
    adapterDispose = adapter.dispose;

    const { scene } = buildBootScene(adapter.engine, canvas);

    kernel = new SimulationKernel({ seed: resolveSeed(window.location.search) });
    const loop = new SimulationLoop(kernel);

    overlay = new DebugOverlay(root, {
      backend: adapter.backend,
      babylonVersion: adapter.version,
      scene,
      kernel,
      loop,
      // No physics backend is wired yet; null makes the overlay say so.
      activePhysicsBodies: () => null,
    });

    const simKernel = kernel;
    adapter.engine.runRenderLoop(() => {
      loop.advance(adapter.engine.getDeltaTime());
      // Drain outside the tick so subscribers never mutate state mid-step.
      simKernel.events.drain();
      scene.render();
    });

    adapter.onContextLost(() => {
      contextBanner.textContent = "Rendering context lost — attempting recovery…";
      contextBanner.hidden = false;
    });
    adapter.onContextRestored(() => {
      contextBanner.hidden = true;
    });

    stateMachine.transition(AppState.MainMenu);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Boot itself failed (no engine/scene exists) — go straight to Error without a MainMenu hop.
    stateMachine.transition(AppState.Error);
    // No working engine to recover into from here; a reload is the only honest recovery path.
    renderErrorScreen(uiRoot, `Boot failed: ${message}`, () => window.location.reload());
    return { dispose: () => unsubscribers.forEach((u) => u()) };
  }

  const goToMainMenu = (): void => {
    stateMachine.transition(AppState.MainMenu);
  };

  const renderForState = (state: AppState): void => {
    switch (state) {
      case AppState.MainMenu:
        renderMainMenu(uiRoot, () => stateMachine.transition(AppState.Loading));
        break;
      case AppState.Loading:
        renderLoadingScreen(uiRoot);
        // Nothing to actually load yet — Shatterdome is a stub. Advance next frame
        // rather than instantly, so the state is honestly visible for at least one paint.
        requestAnimationFrame(() => stateMachine.transition(AppState.Shatterdome));
        break;
      case AppState.Shatterdome:
        renderShatterdomePlaceholder(uiRoot, goToMainMenu);
        break;
      case AppState.Error:
        // handled at boot-failure site above for the fatal case; runtime errors reuse this.
        break;
      default:
        clearScreen(uiRoot);
    }
  };

  unsubscribers.push(stateMachine.onChange((to) => renderForState(to)));
  renderForState(stateMachine.state);

  return {
    dispose(): void {
      unsubscribers.forEach((u) => u());
      overlay?.dispose();
      kernel?.dispose();
      adapterDispose?.();
    },
  };
}
