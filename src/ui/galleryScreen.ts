import type { GalleryMeasurements } from "../debug/gallery";

export interface GalleryScreenCallbacks {
  onSelect(index: number): void;
  onDamageChange(level: number): void;
  onSpinToggle(spinning: boolean): void;
  onOverrideChange(overrideId: string): void;
  onExit(): void;
}

export interface GalleryOverrideOption {
  readonly id: string;
  readonly label: string;
}

export interface GalleryScreenHandle {
  /** Refreshes the detail pane for the currently selected asset. */
  update(measurements: GalleryMeasurements, damageLevel: number, activeOverrideId: string): void;
  dispose(): void;
}

function row(label: string, value: string, field: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "gallery-row";
  const key = document.createElement("span");
  key.className = "gallery-key";
  key.textContent = label;
  const val = document.createElement("span");
  val.className = "gallery-value";
  val.dataset.field = field;
  val.textContent = value;
  line.append(key, val);
  return line;
}

/**
 * Asset gallery panel. Everything shown here is measured from the loaded asset,
 * so a value on screen is never a repeat of what the manifest claimed.
 */
export function renderGalleryScreen(
  container: HTMLElement,
  assets: readonly { id: string; displayName: string; assetClass: string }[],
  overrides: readonly GalleryOverrideOption[],
  totalViolations: readonly string[],
  callbacks: GalleryScreenCallbacks,
): GalleryScreenHandle {
  container.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "screen screen-gallery";
  panel.id = "assetGallery";

  const header = document.createElement("div");
  header.className = "gallery-header";
  const title = document.createElement("h2");
  title.textContent = "Asset Gallery";
  const summary = document.createElement("p");
  summary.dataset.field = "summary";
  summary.className = "gallery-summary";
  summary.textContent =
    totalViolations.length === 0
      ? `${assets.length} assets loaded, all within budget.`
      : `${assets.length} assets loaded, ${totalViolations.length} budget or validation issues.`;
  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "secondary-button";
  exit.dataset.action = "exit-gallery";
  exit.textContent = "Back to Menu";
  exit.addEventListener("click", () => callbacks.onExit());
  header.append(title, summary, exit);

  const body = document.createElement("div");
  body.className = "gallery-body";

  const list = document.createElement("ul");
  list.className = "gallery-list";
  assets.forEach((asset, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.assetId = asset.id;
    button.dataset.assetIndex = String(index);
    button.textContent = `${asset.displayName} (${asset.assetClass})`;
    button.addEventListener("click", () => callbacks.onSelect(index));
    item.appendChild(button);
    list.appendChild(item);
  });

  const detail = document.createElement("div");
  detail.className = "gallery-detail";
  detail.append(
    row("Asset", "", "detail-id"),
    row("Source", "", "detail-origin"),
    row("Height", "", "detail-height"),
    row("Width x Depth", "", "detail-extent"),
    row("Triangles", "", "detail-triangles"),
    row("Materials", "", "detail-materials"),
    row("Sockets", "", "detail-sockets"),
    row("Validation", "", "detail-diagnostics"),
  );

  const controls = document.createElement("div");
  controls.className = "gallery-controls";

  const spinLabel = document.createElement("label");
  spinLabel.textContent = "Rotate";
  const spin = document.createElement("input");
  spin.type = "checkbox";
  spin.checked = true;
  spin.name = "gallery-rotate";
  spin.dataset.action = "spin";
  spin.addEventListener("change", () => callbacks.onSpinToggle(spin.checked));
  spinLabel.prepend(spin);

  const damageLabel = document.createElement("label");
  damageLabel.textContent = "Damage preview";
  const damage = document.createElement("input");
  damage.type = "range";
  damage.min = "0";
  damage.max = "100";
  damage.value = "0";
  damage.name = "gallery-damage";
  damage.dataset.action = "damage";
  damage.addEventListener("input", () => callbacks.onDamageChange(Number(damage.value) / 100));
  damageLabel.appendChild(damage);

  const overrideLabel = document.createElement("label");
  overrideLabel.textContent = "Manifest";
  const overrideSelect = document.createElement("select");
  overrideSelect.name = "gallery-override";
  overrideSelect.dataset.action = "override";
  for (const option of overrides) {
    const opt = document.createElement("option");
    opt.value = option.id;
    opt.textContent = option.label;
    overrideSelect.appendChild(opt);
  }
  overrideSelect.addEventListener("change", () => callbacks.onOverrideChange(overrideSelect.value));
  overrideLabel.appendChild(overrideSelect);

  controls.append(spinLabel, damageLabel, overrideLabel);

  body.append(list, detail);
  panel.append(header, body, controls);
  container.appendChild(panel);

  const fields = new Map<string, HTMLElement>();
  for (const node of detail.querySelectorAll<HTMLElement>("[data-field]")) {
    fields.set(node.dataset.field as string, node);
  }

  const setField = (field: string, value: string): void => {
    const node = fields.get(field);
    if (node) node.textContent = value;
  };

  return {
    update(measurements, damageLevel, activeOverrideId) {
      setField("detail-id", `${measurements.displayName} [${measurements.id}]`);
      setField(
        "detail-origin",
        measurements.origin === "generator" ? "procedural placeholder" : "production model",
      );
      setField("detail-height", `${measurements.heightMeters.toFixed(2)} m`);
      setField(
        "detail-extent",
        `${measurements.widthMeters.toFixed(2)} m x ${measurements.depthMeters.toFixed(2)} m`,
      );
      setField(
        "detail-triangles",
        `${measurements.triangleCount.toLocaleString()} / ${measurements.triangleBudget.toLocaleString()}`,
      );
      setField("detail-materials", `${measurements.materialCount} / ${measurements.materialBudget}`);
      setField("detail-sockets", measurements.socketIds.join(", ") || "none");
      setField(
        "detail-diagnostics",
        measurements.diagnostics.length === 0
          ? "within budget, no issues"
          : measurements.diagnostics.map((d) => `${d.severity}: ${d.code}`).join("; "),
      );
      damage.value = String(Math.round(damageLevel * 100));
      overrideSelect.value = activeOverrideId;

      for (const button of list.querySelectorAll<HTMLButtonElement>("button[data-asset-id]")) {
        button.classList.toggle("selected", button.dataset.assetId === measurements.id);
      }
    },
    dispose() {
      container.replaceChildren();
    },
  };
}
