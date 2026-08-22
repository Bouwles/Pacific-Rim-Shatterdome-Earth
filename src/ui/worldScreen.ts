import type { GeoPosition } from "../world/coordinates";
import type { RegionDefinition } from "../world/regions";

export type WorldViewMode = "globe" | "ground";

/** Live streaming instrumentation. Every field is measured, none is estimated by the panel. */
export interface StreamingReadout {
  readonly serviceKind: string;
  readonly stateSummary: string;
  readonly resident: number;
  readonly peakResident: number;
  readonly generated: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cancelled: number;
  readonly evicted: number;
  readonly rescued: number;
  readonly failed: number;
  readonly lastGenerationMs: number;
  readonly averageGenerationMs: number;
  readonly lastUploadMs: number;
  readonly averageUploadMs: number;
  readonly residentBytes: number;
  readonly peakResidentBytes: number;
  readonly cachedBytes: number;
  readonly cachedEntries: number;
  readonly meshes: number;
  readonly pooledMeshes: number;
  readonly thinInstances: number;
  readonly gpuBytes: number;
  /** Sampled from the streamed collision field, or null where nothing is loaded. */
  readonly groundHeightMeters: number | null;
  readonly routeRunning: boolean;
  readonly routeProgress: string;
}

export interface WorldReadout {
  readonly viewMode: WorldViewMode;
  readonly streaming: StreamingReadout | null;
  readonly position: GeoPosition;
  readonly localEast: number;
  readonly localNorth: number;
  readonly sectorId: string;
  readonly neighborIds: readonly string[];
  readonly activeRegionId: string | null;
  readonly activeClimate: string | null;
  readonly activeRegions: number;
  readonly strategicRegions: number;
  readonly rebases: number;
  readonly anchor: GeoPosition;
}

export interface WorldScreenCallbacks {
  onTeleport(regionId: string): void;
  onWalk(eastMeters: number, northMeters: number): void;
  onViewMode(mode: WorldViewMode): void;
  onRouteToggle(): void;
  onExit(): void;
}

export interface WorldScreenHandle {
  update(readout: WorldReadout): void;
  dispose(): void;
}

function formatDegrees(value: number, positive: string, negative: string): string {
  const hemisphere = value >= 0 ? positive : negative;
  return `${Math.abs(value).toFixed(4)}° ${hemisphere}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function row(label: string, field: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "world-row";
  const key = document.createElement("span");
  key.className = "world-key";
  key.textContent = label;
  const value = document.createElement("span");
  value.className = "world-value";
  value.dataset.field = field;
  line.append(key, value);
  return line;
}

/**
 * World map panel: coordinate readouts and the controls that move the player
 * around the globe. Every number shown is read back from world state, not from
 * whatever was requested.
 */
export function renderWorldScreen(
  container: HTMLElement,
  regions: readonly RegionDefinition[],
  callbacks: WorldScreenCallbacks,
): WorldScreenHandle {
  container.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "screen screen-world";
  panel.id = "worldScreen";

  const header = document.createElement("div");
  header.className = "world-header";
  const title = document.createElement("h2");
  title.textContent = "World Map";
  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "secondary-button";
  exit.dataset.action = "exit-world";
  exit.textContent = "Back to Menu";
  exit.addEventListener("click", () => callbacks.onExit());
  header.append(title, exit);

  const readout = document.createElement("div");
  readout.className = "world-readout";
  readout.append(
    row("Latitude", "latitude"),
    row("Longitude", "longitude"),
    row("Altitude", "altitude"),
    row("Local E/N", "local"),
    row("Sector", "sector"),
    row("Neighbours", "neighbors"),
    row("Region", "region"),
    row("Climate", "climate"),
    row("Simulation", "tiers"),
    row("Origin anchor", "anchor"),
    row("Rebases", "rebases"),
  );

  const viewRow = document.createElement("div");
  viewRow.className = "world-view";
  const viewLabel = document.createElement("span");
  viewLabel.className = "world-walk-label";
  viewLabel.textContent = "View";
  viewRow.appendChild(viewLabel);

  const viewButtons = new Map<WorldViewMode, HTMLButtonElement>();
  for (const [mode, label] of [
    ["globe", "Globe"],
    ["ground", "Ground"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.action = `view-${mode}`;
    button.textContent = label;
    button.addEventListener("click", () => callbacks.onViewMode(mode));
    viewRow.appendChild(button);
    viewButtons.set(mode, button);
  }

  // Streaming instrumentation only exists in the ground view, because that is
  // the only place sectors are streamed. Showing zeroes on the globe would imply
  // a system is running when it is not.
  const streaming = document.createElement("div");
  streaming.className = "world-readout world-streaming";
  streaming.dataset.section = "streaming";
  streaming.hidden = true;
  streaming.append(
    row("Generator", "stream-service"),
    row("Sector states", "stream-states"),
    row("Resident", "stream-resident"),
    row("Generated", "stream-generated"),
    row("Cache", "stream-cache"),
    row("Cancelled / evicted", "stream-churn"),
    row("Generation", "stream-generation"),
    row("Upload", "stream-upload"),
    row("Sector memory", "stream-memory"),
    row("Scene", "stream-scene"),
    row("Ground height", "stream-ground"),
    row("Stress route", "stream-route"),
  );

  const routeRow = document.createElement("div");
  routeRow.className = "world-walk";
  routeRow.dataset.section = "route";
  routeRow.hidden = true;
  const routeLabel = document.createElement("span");
  routeLabel.className = "world-walk-label";
  routeLabel.textContent = "Stress route";
  const routeButton = document.createElement("button");
  routeButton.type = "button";
  routeButton.className = "secondary-button";
  routeButton.dataset.action = "route-toggle";
  routeButton.textContent = "Fly route";
  routeButton.addEventListener("click", () => callbacks.onRouteToggle());
  routeRow.append(routeLabel, routeButton);

  const teleportRow = document.createElement("div");
  teleportRow.className = "world-teleport";
  const teleportLabel = document.createElement("label");
  teleportLabel.textContent = "Deploy to";
  const select = document.createElement("select");
  select.name = "world-teleport";
  select.dataset.action = "teleport-select";
  select.setAttribute("aria-label", "Deployment destination");
  for (const region of regions) {
    const option = document.createElement("option");
    option.value = region.id;
    option.textContent = region.deploymentPoint ? region.displayName : `${region.displayName} (no pad)`;
    select.appendChild(option);
  }
  teleportLabel.appendChild(select);

  const teleport = document.createElement("button");
  teleport.type = "button";
  teleport.className = "primary-button";
  teleport.dataset.action = "teleport";
  teleport.textContent = "Teleport";
  teleport.addEventListener("click", () => callbacks.onTeleport(select.value));
  teleportRow.append(teleportLabel, teleport);

  const walkRow = document.createElement("div");
  walkRow.className = "world-walk";
  const walkLabel = document.createElement("span");
  walkLabel.className = "world-walk-label";
  walkLabel.textContent = "Walk 1 km";
  walkRow.appendChild(walkLabel);

  const directions: readonly (readonly [string, string, number, number])[] = [
    ["walk-north", "N", 0, 1000],
    ["walk-south", "S", 0, -1000],
    ["walk-east", "E", 1000, 0],
    ["walk-west", "W", -1000, 0],
  ];
  for (const [action, label, east, north] of directions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.action = action;
    button.textContent = label;
    button.addEventListener("click", () => callbacks.onWalk(east, north));
    walkRow.appendChild(button);
  }

  // Controls first, readouts last. The readouts grow without bound as more of the
  // world reports itself; the buttons must stay reachable regardless, so it is the
  // numbers that scroll away, never the things you click.
  panel.append(header, viewRow, teleportRow, walkRow, routeRow, readout, streaming);
  container.appendChild(panel);

  const fields = new Map<string, HTMLElement>();
  for (const node of panel.querySelectorAll<HTMLElement>("[data-field]")) {
    fields.set(node.dataset.field as string, node);
  }
  // The ground view refreshes four times a second. Writing the select on every
  // refresh snapped the user's choice back to wherever they already were, so
  // picking a destination and then pressing Teleport went nowhere. Follow the
  // world only when the world itself moves.
  let lastActiveRegionId: string | null = null;

  const set = (field: string, value: string): void => {
    const node = fields.get(field);
    if (node) node.textContent = value;
  };

  return {
    update(state) {
      set("latitude", formatDegrees(state.position.latitudeDeg, "N", "S"));
      set("longitude", formatDegrees(state.position.longitudeDeg, "E", "W"));
      set("altitude", `${state.position.altitudeMeters.toFixed(1)} m`);
      set("local", `${state.localEast.toFixed(1)} m / ${state.localNorth.toFixed(1)} m`);
      set("sector", state.sectorId);
      set("neighbors", state.neighborIds.join("  "));
      set("region", state.activeRegionId ?? "open water");
      set("climate", state.activeClimate ?? "n/a");
      set("tiers", `${state.activeRegions} active, ${state.strategicRegions} strategic`);
      set(
        "anchor",
        `${formatDegrees(state.anchor.latitudeDeg, "N", "S")}, ${formatDegrees(state.anchor.longitudeDeg, "E", "W")}`,
      );
      set("rebases", String(state.rebases));
      if (state.activeRegionId !== null && state.activeRegionId !== lastActiveRegionId) {
        select.value = state.activeRegionId;
      }
      lastActiveRegionId = state.activeRegionId;

      for (const [mode, button] of viewButtons) {
        button.classList.toggle("is-active", mode === state.viewMode);
        button.setAttribute("aria-pressed", String(mode === state.viewMode));
      }

      const stream = state.streaming;
      streaming.hidden = stream === null;
      routeRow.hidden = stream === null;
      if (!stream) return;

      routeButton.textContent = stream.routeRunning ? "Stop route" : "Fly route";
      set("stream-service", stream.serviceKind);
      set("stream-states", stream.stateSummary);
      set("stream-resident", `${stream.resident} sectors, peak ${stream.peakResident}`);
      set("stream-generated", `${stream.generated}${stream.failed > 0 ? `, ${stream.failed} failed` : ""}`);
      set("stream-cache", `${stream.cacheHits} hit / ${stream.cacheMisses} miss`);
      set("stream-churn", `${stream.cancelled} / ${stream.evicted}, ${stream.rescued} rescued`);
      set(
        "stream-generation",
        `${stream.lastGenerationMs.toFixed(1)} ms last, ${stream.averageGenerationMs.toFixed(1)} ms avg`,
      );
      set(
        "stream-upload",
        `${stream.lastUploadMs.toFixed(1)} ms last, ${stream.averageUploadMs.toFixed(1)} ms avg`,
      );
      set(
        "stream-memory",
        `${megabytes(stream.residentBytes)} resident (peak ${megabytes(stream.peakResidentBytes)}), ` +
          `${megabytes(stream.cachedBytes)} cached in ${stream.cachedEntries}`,
      );
      set(
        "stream-scene",
        `${stream.meshes} meshes, ${stream.pooledMeshes} pooled, ${stream.thinInstances} instances, ` +
          `${megabytes(stream.gpuBytes)} gpu`,
      );
      set(
        "stream-ground",
        stream.groundHeightMeters === null ? "not loaded" : `${stream.groundHeightMeters.toFixed(1)} m`,
      );
      set("stream-route", stream.routeProgress);
    },
    dispose() {
      container.replaceChildren();
    },
  };
}
