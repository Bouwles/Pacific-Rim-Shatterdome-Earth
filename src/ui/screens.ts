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
): void {
  clear(container);
  const panel = document.createElement("div");
  panel.className = "screen screen-menu";

  const title = document.createElement("h1");
  title.textContent = "Pacific Rim: Shatterdome Earth";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Private fan project — procedural placeholders, Milestone 07.";

  const newGameButton = document.createElement("button");
  newGameButton.type = "button";
  newGameButton.textContent = "New Game";
  newGameButton.className = "primary-button";
  newGameButton.addEventListener("click", onNewGame);

  panel.append(title, subtitle, newGameButton);

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

  container.appendChild(panel);
}

export function renderLoadingScreen(container: HTMLElement, label = "Loading…"): void {
  clear(container);
  const panel = document.createElement("div");
  panel.className = "screen screen-loading";
  panel.textContent = label;
  container.appendChild(panel);
}

export function renderShatterdomePlaceholder(container: HTMLElement, onBackToMenu: () => void): void {
  clear(container);
  const panel = document.createElement("div");
  panel.className = "screen screen-shatterdome";

  const title = document.createElement("h2");
  title.textContent = "Shatterdome";
  const notice = document.createElement("p");
  notice.textContent = "Not yet implemented — this milestone only proves the state transition into it.";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "Back to Menu";
  backButton.className = "secondary-button";
  backButton.addEventListener("click", onBackToMenu);

  panel.append(title, notice, backButton);
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
