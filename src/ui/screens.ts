/**
 * DOM overlay screens for the app states that have presentation today.
 * Everything here is honest about what's implemented — no buttons that imply
 * a system exists when it doesn't (GAME_SPEC.md → Quality Contract).
 */

function clear(container: HTMLElement): void {
  container.replaceChildren();
}

export function renderMainMenu(
  container: HTMLElement,
  onNewGame: () => void,
  onOpenGallery?: () => void,
  onOpenSaves?: () => void,
  onOpenWorld?: () => void,
  onOpenSandbox?: () => void,
): void {
  clear(container);
  const panel = document.createElement("div");
  panel.className = "screen screen-menu";

  const title = document.createElement("h1");
  title.textContent = "Pacific Rim: Shatterdome Earth";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Private fan project. Original procedural placeholders. 1.0.0-rc.1.";

  const newGameButton = document.createElement("button");
  newGameButton.type = "button";
  newGameButton.textContent = "New Game";
  newGameButton.className = "primary-button";
  newGameButton.addEventListener("click", onNewGame);

  panel.append(title, subtitle, newGameButton);

  if (onOpenSandbox) {
    const sandboxButton = document.createElement("button");
    sandboxButton.type = "button";
    sandboxButton.textContent = "Simulator";
    sandboxButton.className = "secondary-button";
    sandboxButton.dataset["action"] = "open-sandbox";
    sandboxButton.addEventListener("click", onOpenSandbox);
    panel.appendChild(sandboxButton);
  }

  if (onOpenSaves) {
    const savesButton = document.createElement("button");
    savesButton.type = "button";
    savesButton.textContent = "Saves";
    savesButton.className = "secondary-button";
    savesButton.addEventListener("click", onOpenSaves);
    panel.appendChild(savesButton);
  }

  if (onOpenWorld) {
    const worldButton = document.createElement("button");
    worldButton.type = "button";
    worldButton.textContent = "World Map";
    worldButton.className = "secondary-button";
    worldButton.addEventListener("click", onOpenWorld);
    panel.appendChild(worldButton);
  }

  if (onOpenGallery) {
    const galleryButton = document.createElement("button");
    galleryButton.type = "button";
    galleryButton.textContent = "Asset Gallery";
    galleryButton.className = "secondary-button";
    galleryButton.addEventListener("click", onOpenGallery);
    panel.appendChild(galleryButton);
  }

  // The offline panel's home. Filled by renderPwaPanel once its async state
  // is known; empty is honest while nothing has been learned yet.
  const pwaHost = document.createElement("div");
  pwaHost.id = "pwaPanel";
  panel.appendChild(pwaHost);

  container.appendChild(panel);
}

/** What the offline panel shows. Built by bootstrap, drawn here. */
export interface PwaPanelState {
  /** The worker's own status, in a sentence. */
  readonly status: string;
  /** The update banner text, empty for nothing to say. */
  readonly updateMessage: string;
  /** True exactly when Apply and Later should be offered. */
  readonly showOffer: boolean;
  readonly packs: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly purpose: string;
    readonly phase: string;
    readonly filesCached: number;
    readonly filesTotal: number;
    readonly detail: string;
  }[];
}

export interface PwaPanelCallbacks {
  readonly onApplyUpdate: () => void;
  readonly onPostponeUpdate: () => void;
  readonly onDownloadPack: (id: string) => void;
  readonly onRemovePack: (id: string) => void;
}

/**
 * The offline panel on the main menu: worker status, the update offer, and
 * the optional packs with their real download state.
 *
 * Redrawn whole on every state change. It is a menu panel, not a fight, and
 * whole redraws keep it impossible to show a stale download count.
 */
export function renderPwaPanel(host: HTMLElement, state: PwaPanelState, callbacks: PwaPanelCallbacks): void {
  host.replaceChildren();
  host.dataset["section"] = "pwa";

  const status = document.createElement("p");
  status.className = "pwa-status";
  status.dataset["field"] = "pwa-status";
  status.textContent = state.status;
  host.appendChild(status);

  if (state.updateMessage) {
    const banner = document.createElement("div");
    banner.className = "pwa-update";
    banner.dataset["field"] = "pwa-update";
    const text = document.createElement("span");
    text.textContent = state.updateMessage;
    banner.appendChild(text);
    if (state.showOffer) {
      const apply = document.createElement("button");
      apply.type = "button";
      apply.dataset["action"] = "pwa-apply";
      apply.textContent = "Save and update";
      apply.addEventListener("click", callbacks.onApplyUpdate);
      const later = document.createElement("button");
      later.type = "button";
      later.dataset["action"] = "pwa-later";
      later.textContent = "Later";
      later.addEventListener("click", callbacks.onPostponeUpdate);
      banner.append(apply, later);
    }
    host.appendChild(banner);
  }

  const list = document.createElement("ul");
  list.className = "pwa-packs";
  list.dataset["field"] = "pwa-packs";
  for (const pack of state.packs) {
    const item = document.createElement("li");
    item.dataset["pack"] = pack.id;
    const label = document.createElement("span");
    label.title = pack.purpose;
    label.textContent = `${pack.displayName}: ${pack.phase} (${pack.filesCached}/${pack.filesTotal})`;
    item.appendChild(label);

    const download = document.createElement("button");
    download.type = "button";
    download.dataset["action"] = "pack-download";
    download.textContent =
      pack.phase === "partial" || pack.phase === "failed"
        ? "Resume"
        : pack.phase === "complete"
          ? "Downloaded"
          : "Download";
    download.disabled = pack.phase === "complete" || pack.phase === "downloading";
    download.addEventListener("click", () => callbacks.onDownloadPack(pack.id));
    item.appendChild(download);

    if (pack.filesCached > 0) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset["action"] = "pack-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => callbacks.onRemovePack(pack.id));
      item.appendChild(remove);
    }
    if (pack.detail) {
      const detail = document.createElement("span");
      detail.className = "pwa-detail";
      detail.textContent = pack.detail;
      item.appendChild(detail);
    }
    list.appendChild(item);
  }
  host.appendChild(list);
}

export function renderLoadingScreen(container: HTMLElement, label = "Loading…"): void {
  clear(container);
  const panel = document.createElement("div");
  panel.className = "screen screen-loading";
  panel.textContent = label;
  container.appendChild(panel);
}

export function renderErrorScreen(container: HTMLElement, message: string, onBackToMenu: () => void): void {
  clear(container);
  const panel = document.createElement("div");
  panel.className = "screen screen-error";

  const title = document.createElement("h2");
  title.textContent = "Something went wrong";
  const detail = document.createElement("p");
  detail.textContent = message;

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "Back to Menu";
  backButton.className = "secondary-button";
  backButton.addEventListener("click", onBackToMenu);

  panel.append(title, detail, backButton);
  container.appendChild(panel);
}

export function clearScreen(container: HTMLElement): void {
  clear(container);
}
