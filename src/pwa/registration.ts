import { SKIP_WAITING_MESSAGE } from "./swPolicy";
import { UpdateFlow } from "./updateFlow";

/**
 * The one place the real service worker API is touched.
 *
 * Everything decidable lives in `UpdateFlow` and `swPolicy`; this file only
 * binds them to the browser: register the worker, watch for a waiting one,
 * and, when the flow says the player accepted from a safe place, flush saves,
 * tell the worker to take over and reload once it has.
 *
 * Service workers need HTTPS or localhost, and a browser can refuse them
 * entirely (private windows sometimes do). Both cases are reported in the
 * status rather than thrown: the game runs identically without one, it just
 * is not installable or offline-capable, and the panel says so.
 */

export interface PwaStatus {
  /** What happened, in a sentence. */
  readonly state: "unsupported" | "insecure" | "registering" | "active" | "failed";
  readonly detail: string;
}

export interface PwaHandle {
  readonly flow: UpdateFlow;
  status(): PwaStatus;
  /** Tells the flow where the app is, so offers only appear somewhere safe. */
  placeChanged(place: string): void;
  /** The player accepted. Flushes saves via the callback, then applies. */
  accept(): Promise<boolean>;
  postpone(): void;
  dispose(): void;
}

export interface PwaOptions {
  /** Writes every dirty save to disk. Resolves only when they are genuinely down. */
  readonly flushSaves: () => Promise<void>;
  /** Reloads the page. Injected so a test can observe instead. */
  readonly reload?: () => void;
  /** Worker URL. The default is the real one. */
  readonly url?: string;
  /**
   * Called whenever the flow's state may have changed, so the interface can
   * redraw. An update can arrive while the menu is already on screen, and a
   * banner nobody redraws is a banner nobody sees.
   */
  readonly onFlowChange?: () => void;
}

/**
 * Registers the worker and wires the update flow.
 *
 * In development the worker is only registered when the page asks with
 * `?sw=1`: a dev server's module graph changes every edit, and a worker
 * caching it would serve yesterday's modules to today's code.
 */
export function initialisePwa(options: PwaOptions): PwaHandle {
  const flow = new UpdateFlow();
  let statusValue: PwaStatus = { state: "registering", detail: "Registering the offline worker." };
  let registration: ServiceWorkerRegistration | null = null;
  let disposed = false;
  const listeners: Array<() => void> = [];

  const secure =
    globalThis.isSecureContext === true ||
    globalThis.location?.hostname === "localhost" ||
    globalThis.location?.hostname === "127.0.0.1";

  if (!("serviceWorker" in navigator)) {
    statusValue = {
      state: "unsupported",
      detail: "This browser has no service workers. The game runs, but not offline.",
    };
  } else if (!secure) {
    statusValue = {
      state: "insecure",
      detail: "Offline play needs HTTPS or localhost. The game runs, but is not installable here.",
    };
  } else {
    const url = options.url ?? "/sw.js";
    navigator.serviceWorker
      .register(url)
      .then((reg) => {
        if (disposed) return;
        registration = reg;
        statusValue = { state: "active", detail: "Offline shell active. One load caches the game." };

        const changed = (): void => options.onFlowChange?.();

        // A worker already waiting means an update arrived before this page.
        if (reg.waiting && navigator.serviceWorker.controller) {
          flow.updateReady();
          changed();
        }

        const onUpdateFound = (): void => {
          const installing = reg.installing;
          if (!installing) return;
          flow.updateDownloading();
          changed();
          const onState = (): void => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              flow.updateReady();
              changed();
            }
          };
          installing.addEventListener("statechange", onState);
          listeners.push(() => installing.removeEventListener("statechange", onState));
        };
        reg.addEventListener("updatefound", onUpdateFound);
        listeners.push(() => reg.removeEventListener("updatefound", onUpdateFound));
      })
      .catch((error: unknown) => {
        statusValue = {
          state: "failed",
          detail: `The offline worker could not register: ${(error as Error).message}`,
        };
      });

    // When the new worker takes over, the page reloads onto the new version.
    // This only ever fires after accept(), because nothing else skips waiting.
    const onControllerChange = (): void => {
      (options.reload ?? (() => globalThis.location.reload()))();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    listeners.push(() => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange));
  }

  return {
    flow,
    status: () => statusValue,
    placeChanged: (place) => {
      flow.placeChanged(place);
      options.onFlowChange?.();
    },
    postpone: () => {
      flow.postpone();
      options.onFlowChange?.();
    },
    accept: async () => {
      if (!flow.accept()) return false;
      // Saves first, and genuinely finished before the worker is told anything:
      // an update that races a save is the mistake this whole flow exists for.
      await options.flushSaves();
      if (!flow.flushed()) return false;
      registration?.waiting?.postMessage(SKIP_WAITING_MESSAGE);
      return true;
    },
    dispose: () => {
      disposed = true;
      for (const remove of listeners) remove();
      listeners.length = 0;
    },
  };
}
