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

/**
 * Live environment instrumentation. Every field is measured from the same
 * `EnvironmentSample` gameplay reads, so the panel cannot show a sky the
 * simulation does not agree with.
 */
export interface EnvironmentReadout {
  readonly dayNumber: number;
  readonly timeOfDay: string;
  readonly sunElevationDeg: number;
  readonly moonElevationDeg: number;
  readonly moonIllumination: number;
  readonly lightLevel: number;
  readonly weatherKind: string;
  readonly nextWeatherKind: string;
  readonly transition: number;
  readonly intensity: number;
  readonly cloudCover: number;
  readonly precipitation: number;
  readonly frozen: boolean;
  readonly fogDensity: number;
  readonly windSpeedMps: number;
  readonly windDirectionDeg: number;
  readonly temperatureC: number;
  readonly wetness: number;
  readonly lightningFlash: number;
  readonly visibilityMeters: number;
  readonly tractionMultiplier: number;
  readonly movementMultiplier: number;
  readonly rangedAccuracyPenalty: number;
  readonly hazardous: boolean;
  readonly waterState: string;
  readonly depthZone: string;
  readonly depthMeters: number;
  readonly submergedFraction: number;
  readonly waveHeightMeters: number;
  readonly waveAmplitudeMeters: number;
  readonly audioState: string;
  readonly audioStatus: string;
  readonly diving: boolean;
  readonly qualityId: string;
  readonly particleCapacity: number;
  readonly activeParticles: number;
  readonly shadowMapSize: number;
  readonly reflections: string;
  readonly telegraphs: number;
}

/**
 * Live city instrumentation. Null outside a region with a layout, because there
 * genuinely is no city there and zeroes would imply one that has not been built.
 */
export interface CityReadout {
  readonly regionId: string;
  readonly districtCount: number;
  readonly blockCount: number;
  readonly towerCount: number;
  readonly landmarkCount: number;
  readonly roadCount: number;
  readonly harborLaneCount: number;
  readonly defenseCount: number;
  readonly destructionGroupCount: number;
  readonly evacuationCapacityThousands: number;
  readonly routeCount: number;
  readonly alertLevel: string;
  readonly evacuationProgress: number;
  readonly civilianDensity: number;
  readonly vehicleDensity: number;
  readonly shippingDensity: number;
  readonly militaryDensity: number;
  readonly evacuationFlow: number;
  readonly sirens: boolean;
  readonly drawnBlocks: number;
  readonly residentGroups: number;
  readonly totalGroups: number;
  readonly agents: number;
  readonly agentCapacity: number;
  readonly agentsByKind: Readonly<Record<string, number>>;
  readonly cityMeshes: number;
  readonly cityGpuBytes: number;
  /**
   * True when a city view exists to report on. The layout and the alert are real
   * wherever the player is, but "drawn" and "agents" describe rendering, and
   * reporting zeroes for them on the globe would imply a city that is not there.
   */
  readonly rendered: boolean;
}

export interface WorldReadout {
  readonly viewMode: WorldViewMode;
  readonly environment: EnvironmentReadout;
  readonly city: CityReadout | null;
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
  /** Advances the world clock to the next occurrence of a fraction of the day. */
  onSkipToDayFraction(fraction: number): void;
  /** Advances the world clock by whole in-game hours. */
  onAdvanceHours(hours: number): void;
  onDiveToggle(): void;
  onQualityChange(level: string): void;
  /** Raises or lowers the alert in the region the player is standing in. */
  onAlertChange(level: string): void;
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

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
  qualityLevels: readonly { readonly id: string; readonly label: string }[],
  alertLevels: readonly { readonly id: string; readonly label: string }[],
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

  // Time and quality controls. Both are debug controls and are labelled as such
  // in CONTROLS.md; neither implies a settings menu that does not exist.
  const timeRow = document.createElement("div");
  timeRow.className = "world-walk";
  const timeLabel = document.createElement("span");
  timeLabel.className = "world-walk-label";
  timeLabel.textContent = "Time";
  timeRow.appendChild(timeLabel);

  // Labelled by the clock time they set, not by "dawn" or "dusk". Sunrise moves
  // with latitude and season, so a button called Dawn would be lying at three
  // quarters of the places you can stand.
  const timeButtons: readonly (readonly [string, string, () => void])[] = [
    ["time-hour", "+1h", () => callbacks.onAdvanceHours(1)],
    ["time-six-hours", "+6h", () => callbacks.onAdvanceHours(6)],
    ["time-morning", "06:00", () => callbacks.onSkipToDayFraction(0.25)],
    ["time-noon", "12:00", () => callbacks.onSkipToDayFraction(0.5)],
    ["time-evening", "18:00", () => callbacks.onSkipToDayFraction(0.75)],
    ["time-midnight", "00:00", () => callbacks.onSkipToDayFraction(0.0)],
  ];
  for (const [action, label, handler] of timeButtons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.action = action;
    button.textContent = label;
    button.addEventListener("click", handler);
    timeRow.appendChild(button);
  }

  const waterRow = document.createElement("div");
  waterRow.className = "world-walk";
  waterRow.dataset.section = "water";
  waterRow.hidden = true;
  const waterLabel = document.createElement("span");
  waterLabel.className = "world-walk-label";
  waterLabel.textContent = "Water";
  const diveButton = document.createElement("button");
  diveButton.type = "button";
  diveButton.className = "secondary-button";
  diveButton.dataset.action = "dive-toggle";
  diveButton.textContent = "Dive";
  diveButton.addEventListener("click", () => callbacks.onDiveToggle());
  waterRow.append(waterLabel, diveButton);

  const qualityRow = document.createElement("div");
  qualityRow.className = "world-teleport";
  const qualityLabel = document.createElement("label");
  qualityLabel.textContent = "Quality";
  const qualitySelect = document.createElement("select");
  qualitySelect.name = "world-quality";
  qualitySelect.dataset.action = "quality-select";
  qualitySelect.setAttribute("aria-label", "Rendering quality");
  for (const level of qualityLevels) {
    const option = document.createElement("option");
    option.value = level.id;
    option.textContent = level.label;
    qualitySelect.appendChild(option);
  }
  qualitySelect.addEventListener("change", () => callbacks.onQualityChange(qualitySelect.value));
  qualityLabel.appendChild(qualitySelect);
  qualityRow.appendChild(qualityLabel);

  // Alert controls sit with the other controls, above the readouts, and are
  // hidden outside a region with a city because there would be nothing to alert.
  const alertRow = document.createElement("div");
  alertRow.className = "world-walk";
  alertRow.dataset.section = "alert";
  alertRow.hidden = true;
  const alertLabel = document.createElement("span");
  alertLabel.className = "world-walk-label";
  alertLabel.textContent = "Alert";
  alertRow.appendChild(alertLabel);

  const alertButtons = new Map<string, HTMLButtonElement>();
  for (const level of alertLevels) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.action = `alert-${level.id}`;
    button.textContent = level.label;
    button.addEventListener("click", () => callbacks.onAlertChange(level.id));
    alertRow.appendChild(button);
    alertButtons.set(level.id, button);
  }

  const city = document.createElement("div");
  city.className = "world-readout world-city";
  city.dataset.section = "city";
  city.hidden = true;
  city.append(
    row("City", "city-region"),
    row("Alert", "city-alert"),
    row("Evacuation", "city-evacuation"),
    row("Streets", "city-streets"),
    row("Harbour / military", "city-harbour"),
    row("Layout", "city-layout"),
    row("Defence / routes", "city-defence"),
    row("Drawn", "city-drawn"),
    row("Agents", "city-agents"),
  );

  const environment = document.createElement("div");
  environment.className = "world-readout world-environment";
  environment.dataset.section = "environment";
  environment.append(
    row("Day / time", "env-time"),
    row("Sun / moon", "env-celestial"),
    row("Light", "env-light"),
    row("Weather", "env-weather"),
    row("Cloud / rain", "env-precipitation"),
    row("Wind", "env-wind"),
    row("Temperature", "env-temperature"),
    row("Wetness", "env-wetness"),
    row("Visibility", "env-visibility"),
    row("Traction / speed", "env-traction"),
    row("Ranged penalty", "env-accuracy"),
    row("Water", "env-water"),
    row("Waves", "env-waves"),
    row("Audio", "env-audio"),
    row("Quality budgets", "env-quality"),
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
  walkLabel.textContent = "Walk";
  walkRow.appendChild(walkLabel);

  // A fixed one kilometre stride steps straight over a coastline: the shelf
  // between wading depth and open water is a few hundred metres wide, so at one
  // kilometre it is invisible. The step is selectable for that reason.
  const stepSelect = document.createElement("select");
  stepSelect.name = "world-walk-step";
  stepSelect.dataset.action = "walk-step";
  stepSelect.setAttribute("aria-label", "Walk distance");
  for (const [value, label] of [
    ["100", "100 m"],
    ["1000", "1 km"],
    ["10000", "10 km"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === "1000") option.selected = true;
    stepSelect.appendChild(option);
  }
  walkRow.appendChild(stepSelect);

  const directions: readonly (readonly [string, string, number, number])[] = [
    ["walk-north", "N", 0, 1],
    ["walk-south", "S", 0, -1],
    ["walk-east", "E", 1, 0],
    ["walk-west", "W", -1, 0],
  ];
  for (const [action, label, east, north] of directions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.action = action;
    button.textContent = label;
    button.addEventListener("click", () => {
      const distance = Number(stepSelect.value) || 1000;
      callbacks.onWalk(east * distance, north * distance);
    });
    walkRow.appendChild(button);
  }

  // Controls first, readouts last. The readouts grow without bound as more of the
  // world reports itself; the buttons must stay reachable regardless, so it is the
  // numbers that scroll away, never the things you click.
  panel.append(
    header,
    viewRow,
    teleportRow,
    walkRow,
    timeRow,
    waterRow,
    routeRow,
    alertRow,
    qualityRow,
    readout,
    city,
    environment,
    streaming,
  );
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

      const env = state.environment;
      set("env-time", `day ${env.dayNumber}, ${env.timeOfDay}`);
      set(
        "env-celestial",
        `sun ${env.sunElevationDeg.toFixed(1)}°, moon ${env.moonElevationDeg.toFixed(1)}° ` +
          `(${percent(env.moonIllumination)} lit)`,
      );
      set("env-light", percent(env.lightLevel) + (env.lightningFlash > 0 ? " (flash)" : ""));
      set(
        "env-weather",
        env.transition > 0.001
          ? `${env.weatherKind} to ${env.nextWeatherKind} ${percent(env.transition)}`
          : `${env.weatherKind} at ${percent(env.intensity)}`,
      );
      set(
        "env-precipitation",
        `${percent(env.cloudCover)} cloud, ${percent(env.precipitation)} ` +
          `${env.frozen ? "snow" : "rain"}, ${percent(env.fogDensity)} fog`,
      );
      set("env-wind", `${env.windSpeedMps.toFixed(1)} m/s from ${env.windDirectionDeg.toFixed(0)}°`);
      set("env-temperature", `${env.temperatureC.toFixed(1)} °C`);
      set("env-wetness", percent(env.wetness));
      set(
        "env-visibility",
        `${Math.round(env.visibilityMeters).toLocaleString()} m${env.hazardous ? " (hazardous)" : ""}`,
      );
      set(
        "env-traction",
        `${env.tractionMultiplier.toFixed(2)}x grip, ${env.movementMultiplier.toFixed(2)}x speed`,
      );
      set("env-accuracy", percent(env.rangedAccuracyPenalty));
      set(
        "env-water",
        `${env.waterState}, ${env.depthZone} ${env.depthMeters.toFixed(1)} m deep, ` +
          `${percent(env.submergedFraction)} submerged`,
      );
      set(
        "env-waves",
        `${env.waveHeightMeters.toFixed(2)} m here, ${env.waveAmplitudeMeters.toFixed(2)} m amplitude`,
      );
      set("env-audio", `${env.audioState} (${env.audioStatus})`);
      set(
        "env-quality",
        `${env.qualityId}: ${env.activeParticles}/${env.particleCapacity} particles, ` +
          `shadow ${env.shadowMapSize || "off"}, ${env.reflections} reflections, ` +
          `${env.telegraphs} telegraphs`,
      );
      diveButton.textContent = env.diving ? "Surface" : "Dive";
      diveButton.classList.toggle("is-active", env.diving);
      if (qualitySelect.value !== env.qualityId) qualitySelect.value = env.qualityId;

      const town = state.city;
      city.hidden = town === null;
      alertRow.hidden = town === null;
      if (town) {
        set("city-region", `${town.regionId}, ${town.districtCount} districts`);
        set("city-alert", `${town.alertLevel}${town.sirens ? ", sirens" : ""}`);
        set(
          "city-evacuation",
          `${percent(town.evacuationProgress)} clear, ${percent(town.evacuationFlow)} moving, ` +
            `${town.evacuationCapacityThousands.toLocaleString()}k capacity`,
        );
        set(
          "city-streets",
          `${percent(town.civilianDensity)} civilians, ${percent(town.vehicleDensity)} traffic`,
        );
        set(
          "city-harbour",
          `${percent(town.shippingDensity)} shipping, ${percent(town.militaryDensity)} military`,
        );
        set(
          "city-layout",
          `${town.blockCount.toLocaleString()} blocks, ${town.towerCount.toLocaleString()} towers, ` +
            `${town.landmarkCount} landmarks`,
        );
        set(
          "city-defence",
          `${town.defenseCount} positions, ${town.roadCount} roads, ` +
            `${town.harborLaneCount} lanes, ${town.routeCount} routes`,
        );
        const drawnRow = city.querySelector<HTMLElement>('[data-field="city-drawn"]')?.parentElement;
        const agentRow = city.querySelector<HTMLElement>('[data-field="city-agents"]')?.parentElement;
        if (drawnRow) drawnRow.hidden = !town.rendered;
        if (agentRow) agentRow.hidden = !town.rendered;
        set(
          "city-drawn",
          `${town.drawnBlocks.toLocaleString()} towers in ${town.residentGroups}/${town.totalGroups} groups, ` +
            `${town.cityMeshes} meshes, ${megabytes(town.cityGpuBytes)}`,
        );
        const kinds = Object.entries(town.agentsByKind)
          .map(([kind, count]) => `${count} ${kind}`)
          .join(", ");
        set("city-agents", `${town.agents}/${town.agentCapacity} pooled${kinds ? ` (${kinds})` : ""}`);

        for (const [level, button] of alertButtons) {
          button.classList.toggle("is-active", level === town.alertLevel);
          button.setAttribute("aria-pressed", String(level === town.alertLevel));
        }
      }

      const stream = state.streaming;
      streaming.hidden = stream === null;
      routeRow.hidden = stream === null;
      // Diving only means anything where there is streamed water to dive into.
      waterRow.hidden = stream === null;
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
