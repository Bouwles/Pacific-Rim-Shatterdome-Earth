import type { SaveSlotSummary } from "../saves/schema";
import type { StorageHealth } from "../saves/storageHealth";

export interface SaveScreenCallbacks {
  onSaveNew(name: string): void;
  onOverwrite(slotId: string): void;
  onLoad(slotId: string): void;
  onRename(slotId: string, name: string): void;
  onDelete(slotId: string): void;
  onExport(slotId: string): void;
  onImport(file: File): void;
  onExit(): void;
}

export interface SaveScreenHandle {
  update(slots: readonly SaveSlotSummary[], health: StorageHealth): void;
  /** Shows an outcome to the player. `kind` drives styling only. */
  notify(message: string, kind: "info" | "error"): void;
  dispose(): void;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(ms / 1000)}s`;
}

function formatWhen(epochMs: number): string {
  if (!epochMs) return "unknown";
  return new Date(epochMs).toLocaleString();
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Save and load panel. Every control here operates on real storage; nothing is
 * shown that the save service cannot actually do.
 */
export function renderSaveScreen(
  container: HTMLElement,
  callbacks: SaveScreenCallbacks,
  /** Where leaving this panel goes back to. It is not always the menu now. */
  exitLabel = "Back to Menu",
): SaveScreenHandle {
  container.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "screen screen-saves";
  panel.id = "saveScreen";

  const header = document.createElement("div");
  header.className = "save-header";
  const title = document.createElement("h2");
  title.textContent = "Saves";
  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "secondary-button";
  exit.dataset.action = "exit-saves";
  exit.textContent = exitLabel;
  exit.addEventListener("click", () => callbacks.onExit());
  header.append(title, exit);

  const storage = document.createElement("p");
  storage.className = "save-storage";
  storage.dataset.field = "storage";

  const warning = document.createElement("p");
  warning.className = "save-warning";
  warning.dataset.field = "storage-warning";
  warning.hidden = true;

  const notice = document.createElement("p");
  notice.className = "save-notice";
  notice.dataset.field = "notice";
  notice.hidden = true;

  const newRow = document.createElement("div");
  newRow.className = "save-new";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.name = "new-save-name";
  nameInput.placeholder = "New save name";
  nameInput.setAttribute("aria-label", "New save name");
  nameInput.dataset.field = "new-name";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary-button";
  saveButton.dataset.action = "save-new";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => {
    callbacks.onSaveNew(nameInput.value);
    nameInput.value = "";
  });

  const importLabel = document.createElement("label");
  importLabel.className = "save-import";
  importLabel.textContent = "Import";
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json,.json";
  importInput.name = "import-save";
  importInput.dataset.action = "import";
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (file) callbacks.onImport(file);
    // Reset so re-picking the same file fires change again.
    importInput.value = "";
  });
  importLabel.appendChild(importInput);

  newRow.append(nameInput, saveButton, importLabel);

  const list = document.createElement("ul");
  list.className = "save-list";
  list.dataset.field = "slot-list";

  const empty = document.createElement("p");
  empty.className = "save-empty";
  empty.dataset.field = "empty";
  empty.textContent = "No saves yet.";

  panel.append(header, storage, warning, notice, newRow, empty, list);
  container.appendChild(panel);

  const buildRow = (slot: SaveSlotSummary): HTMLLIElement => {
    const item = document.createElement("li");
    item.className = "save-row";
    item.dataset.slotId = slot.slotId;

    const info = document.createElement("div");
    info.className = "save-info";
    const name = document.createElement("span");
    name.className = "save-name";
    name.dataset.field = "slot-name";
    name.textContent = slot.metadata.name;
    const detail = document.createElement("span");
    detail.className = "save-detail";
    detail.dataset.field = "slot-detail";
    detail.textContent =
      `seed ${slot.metadata.worldSeed} · tick ${slot.metadata.simTick} · ` +
      `${formatDuration(slot.metadata.playTimeMs)} played · ${formatWhen(slot.metadata.lastPlayedAt)}`;
    info.append(name, detail);

    if (slot.damaged) {
      item.dataset.damaged = "true";
      const damaged = document.createElement("span");
      damaged.className = "save-damaged";
      damaged.dataset.field = "slot-damaged";
      damaged.textContent = "Damaged. Loading will recover the last good backup shown here.";
      info.appendChild(damaged);
    }

    if (slot.metadata.thumbnail) {
      const thumb = document.createElement("img");
      thumb.className = "save-thumb";
      thumb.src = slot.metadata.thumbnail;
      thumb.alt = `Thumbnail for ${slot.metadata.name}`;
      item.appendChild(thumb);
    }

    const actions = document.createElement("div");
    actions.className = "save-actions";
    const add = (action: string, label: string, handler: () => void): void => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button";
      button.dataset.action = action;
      button.textContent = label;
      button.addEventListener("click", handler);
      actions.appendChild(button);
    };

    add("load", "Load", () => callbacks.onLoad(slot.slotId));
    add("overwrite", "Overwrite", () => callbacks.onOverwrite(slot.slotId));
    add("rename", "Rename", () => {
      const next = window.prompt("Rename save", slot.metadata.name);
      if (next !== null) callbacks.onRename(slot.slotId, next);
    });
    add("export", "Export", () => callbacks.onExport(slot.slotId));
    add("delete", "Delete", () => callbacks.onDelete(slot.slotId));

    item.append(info, actions);
    return item;
  };

  return {
    update(slots, health) {
      storage.textContent =
        `Storage: ${health.backend} · ${health.slotCount} stored records · ` +
        `${formatBytes(health.usageBytes)} of ${formatBytes(health.quotaBytes)}` +
        (health.persisted === true ? " · persistent" : "");
      warning.textContent = health.warning ?? "";
      warning.hidden = health.warning === null;

      list.replaceChildren(...slots.map(buildRow));
      empty.hidden = slots.length > 0;
    },
    notify(message, kind) {
      notice.textContent = message;
      notice.dataset.kind = kind;
      notice.hidden = false;
    },
    dispose() {
      container.replaceChildren();
    },
  };
}
