import type { GeoPosition } from "../world/coordinates";
import type { RegionDefinition } from "../world/regions";

export interface WorldReadout {
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

  panel.append(header, readout, teleportRow, walkRow);
  container.appendChild(panel);

  const fields = new Map<string, HTMLElement>();
  for (const node of readout.querySelectorAll<HTMLElement>("[data-field]")) {
    fields.set(node.dataset.field as string, node);
  }
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
      select.value = state.activeRegionId ?? select.value;
    },
    dispose() {
      container.replaceChildren();
    },
  };
}
