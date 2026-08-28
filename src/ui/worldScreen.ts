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
  /** True while the frame-time controller holds the quality dial. */
  readonly qualityAuto: boolean;
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
  /** What has been knocked down here, and what is being done about it. */
  readonly damageSummary: string;
  readonly safetyRating: number;
  readonly blocksDamaged: number;
  readonly blocksRuined: number;
  readonly firesBurning: number;
  readonly contaminatedBlocks: number;
  readonly routesBlockedFraction: number;
  readonly trappedThousands: number;
  readonly rescuePressure: number;
  /** Live rubble against the ceiling the preset allows. */
  readonly debrisLive: number;
  readonly debrisCapacity: number;
  readonly debrisFrozen: number;
  /** Blocks being cleared or rebuilt right now, in words. */
  readonly rebuildSummary: string;
  /** The worst damaged block, or null when the city is whole. */
  readonly worstBlockId: string | null;
  readonly worstBlockLabel: string | null;
  /** What starting work on it would cost, or null when there is nothing to do. */
  readonly rebuildQuote: string | null;
  /**
   * True when a city view exists to report on. The layout and the alert are real
   * wherever the player is, but "drawn" and "agents" describe rendering, and
   * reporting zeroes for them on the globe would imply a city that is not there.
   */
  readonly rendered: boolean;
}

/** One incident on the alert board, already turned into words. */
export interface AlertReadout {
  readonly incidentId: string;
  readonly regionName: string;
  readonly status: string;
  /** In-game hours until it reaches the shore. Negative once it has. */
  readonly hoursToArrival: number;
  readonly travelHours: number;
  readonly reachable: boolean;
  readonly confidencePercent: number;
  readonly composition: string;
  readonly tells: readonly string[];
  readonly objective: string;
  readonly secondaryObjectives: readonly string[];
  /** What the model expects if nobody goes, and why, line by line. */
  readonly ifIgnored: string;
  readonly ifIgnoredLedger: readonly string[];
  /** What the planner says about going, or null when nothing can go. */
  readonly readiness: {
    readonly percent: number;
    readonly driftPercent: number;
    readonly machinePercent: number;
    readonly travelHours: number;
    readonly loadPercent: number;
    readonly weather: string;
    readonly predictedThreat: string;
    readonly refusals: readonly string[];
    readonly warnings: readonly string[];
    /** Who is flying, so a pair can be told apart before they go. */
    readonly crew: readonly string[];
    /**
     * Every drawback either pilot carries, whether or not it is biting today.
     *
     * Shown before deployment rather than discovered afterwards: a drawback the
     * player only learns about from the result is a trap, not a decision.
     */
    readonly drawbacks: readonly { readonly text: string; readonly firing: boolean }[];
  } | null;
}

/** What the war looks like from the map. */
export interface WarReadout {
  readonly escalationPercent: number;
  readonly breachPressurePercent: number;
  readonly crisisFrequency: number;
  readonly alerts: readonly AlertReadout[];
  /** The last few resolutions, each already explained. */
  readonly resolutions: readonly { readonly summary: string; readonly ledger: readonly string[] }[];
  readonly notice: string | null;
  /** The sortie in progress, or null when nobody is out. */
  readonly sortie: {
    readonly phase: string;
    readonly regionName: string;
    readonly carrierPercent: number;
    readonly objectives: readonly {
      readonly name: string;
      readonly state: string;
      readonly detail: string;
    }[];
  } | null;
  /** Results waiting to be read, or null. */
  readonly results: {
    readonly outcome: string;
    readonly summary: string;
    readonly ledger: readonly string[];
  } | null;
}

/**
 * What the map knows about somewhere worth going.
 *
 * Everything here is read off the exploration state rather than kept by the
 * screen, so the map and the world it describes cannot drift apart.
 */
export interface MapSiteRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly regionId: string;
  readonly description: string;
  readonly dangerText: string;
  /** Kilometres from where the machine is standing. */
  readonly distanceKm: number;
  /** Minutes a carrier takes to get there. */
  readonly travelMinutes: number;
  readonly claimed: boolean;
  /** True once reaching it has opened it as somewhere to deploy to. */
  readonly deployPoint: boolean;
  /** Null when it can be worked; otherwise exactly why not. */
  readonly refusal: string | null;
}

/** One leg of a planned journey. */
export interface RouteLegRow {
  readonly toName: string;
  readonly distanceKm: number;
  readonly travelMinutes: number;
}

/**
 * What makes the region the player is in that region.
 *
 * Read off the profile rather than kept here, so what the panel says about a
 * place is what the fight there will actually do.
 */
export interface RegionIdentityReadout {
  readonly regionId: string;
  /** The skyline in words: what it looks like from the water. */
  readonly skyline: string;
  /** The shore and the ground behind it. */
  readonly shoreline: string;
  /** What the place makes, and what that is worth. */
  readonly industry: string;
  /** What the local guns manage on their own. */
  readonly defence: string;
  /** Movements per hour through the region. */
  readonly traffic: string;
  /** The conditions, named. */
  readonly modifiers: readonly string[];
  /** What the conditions mean, in the order they matter. */
  readonly briefings: readonly string[];
  /** How deep the water is, and whether anything can hide in it. */
  readonly water: string;
  /** How many directions a creature can arrive from. */
  readonly approaches: string;
  /** How fast the place puts itself back together. */
  readonly rebuild: string;
}

export interface MapReadout {
  /** Found sites, nearest first. */
  readonly sites: readonly MapSiteRow[];
  /** How many exist in total, so the map can say what is still unknown. */
  readonly totalPlaced: number;
  /** Places the carrier can put a machine down, beyond the regions themselves. */
  readonly deployPoints: readonly { readonly id: string; readonly name: string }[];
  /** Straight there, and by way of what is known. Null with nowhere selected. */
  readonly route: {
    readonly directMinutes: number;
    readonly assistedMinutes: number;
    readonly legs: readonly RouteLegRow[];
    readonly summary: string;
  } | null;
  /** What the squad can actually do right now. */
  readonly readiness: string;
  /** Thruster heat, 0 to 100, and why a burst was refused. */
  readonly boosterPercent: number;
  readonly boosterRefusal: string | null;
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
  /** Why the selected machine cannot go out, or null when it can. */
  readonly pilotNotice: string | null;
  /** The war. Null only before the director exists. */
  readonly war: WarReadout | null;
  /** The map: what has been found, what it costs to reach, and how to get there. */
  readonly map: MapReadout | null;
  /** What makes this region itself. Null outside a region with a profile. */
  readonly identity: RegionIdentityReadout | null;
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
  /** Hands the quality dial to the frame-time controller, or takes it back. */
  onAdaptiveQuality(enabled: boolean): void;
  /** Raises or lowers the alert in the region the player is standing in. */
  onAlertChange(level: string): void;
  /** Starts clearing and then rebuilding the named block. */
  onRebuild(groupId: string): void;
  /** Leaves an incident to the regional defences, or ignores it outright. */
  onResolveIncident(incidentId: string, kind: "ai-defended" | "ignored"): void;
  /** The player's own dial on how often crises happen. */
  onCrisisFrequency(value: number): void;
  /** Sends a machine to this incident. */
  onDeploy(incidentId: string): void;
  /** Works a site the machine is standing at. */
  onWorkSite(siteId: string): void;
  /** Plans a route to a site, so the cost of stopping on the way is visible. */
  onPlanRoute(siteId: string): void;
  /** Puts the machine down at a discovered point. */
  onTravelToSite(siteId: string): void;
  /** Skips the rest of the carrier run. */
  onSkipCarrier(): void;
  /** Ends the sortie early, keeping whatever was achieved. */
  onAbortMission(): void;
  /** Closes the results and goes back to what the player was doing. */
  onCloseResults(): void;
  /** Take the machine out. Ground view only: there is nothing to stand on from orbit. */
  onPilot(jaegerId: string): void;
  onExit(): void;
}

export interface WorldScreenHandle {
  update(readout: WorldReadout): void;
  dispose(): void;
}

/** One line inside the route box. */
function routeLine(text: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "world-route-line";
  line.textContent = text;
  return line;
}

function emptySiteLine(text: string): HTMLElement {
  const line = document.createElement("li");
  line.className = "world-site-empty";
  line.textContent = text;
  return line;
}

/**
 * One place worth going to.
 *
 * Carries what it is, how far, how long, how dangerous, and the three things
 * that can be done about it. A control that cannot act says why on itself.
 */
function buildSiteRow(site: MapSiteRow, callbacks: WorldScreenCallbacks): HTMLElement {
  const item = document.createElement("li");
  item.className = "world-site";
  item.dataset.site = site.id;
  item.dataset.kind = site.kind;
  if (site.claimed) item.dataset.claimed = "yes";

  const head = document.createElement("div");
  head.className = "world-site-head";
  const name = document.createElement("span");
  name.className = "world-site-name";
  name.dataset.field = "site-name";
  name.textContent = site.deployPoint ? `${site.name} (deployment point)` : site.name;
  const cost = document.createElement("span");
  cost.className = "world-site-cost";
  cost.dataset.field = "site-cost";
  cost.textContent = `${site.distanceKm} km · ${site.travelMinutes} min · ${site.dangerText}`;
  head.append(name, cost);
  item.appendChild(head);

  const detail = document.createElement("p");
  detail.className = "world-site-detail";
  detail.dataset.field = "site-detail";
  detail.textContent = site.description;
  item.appendChild(detail);

  const work = document.createElement("button");
  work.type = "button";
  work.className = "secondary-button";
  work.dataset.action = "work-site";
  work.textContent = site.claimed ? "Worked" : "Work it";
  work.disabled = site.refusal !== null;
  work.title = site.refusal ?? `Work ${site.name}`;
  work.dataset.refusal = site.refusal ?? "";
  work.addEventListener("click", () => callbacks.onWorkSite(site.id));

  const route = document.createElement("button");
  route.type = "button";
  route.className = "secondary-button";
  route.dataset.action = "plan-route";
  route.textContent = "Route";
  route.title = `Plan a way to ${site.name}`;
  route.addEventListener("click", () => callbacks.onPlanRoute(site.id));

  const travel = document.createElement("button");
  travel.type = "button";
  travel.className = "secondary-button";
  travel.dataset.action = "travel-site";
  travel.textContent = "Deploy here";
  // Only somewhere already reached is somewhere the carrier will drop you.
  travel.disabled = !site.deployPoint;
  travel.title = site.deployPoint
    ? `Put the machine down at ${site.name}`
    : "Reach it once before the carrier will drop you here.";
  travel.dataset.refusal = site.deployPoint ? "" : "Not yet a deployment point.";
  travel.addEventListener("click", () => callbacks.onTravelToSite(site.id));

  item.append(work, route, travel);
  return item;
}

/** What separates one ledger line from the next inside a tooltip. */
const LEDGER_SEPARATOR = String.fromCharCode(10);

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

/** Instrumentation rows: present in the DOM for tests and debug builds, hidden from players. */
function dev(line: HTMLElement): HTMLElement {
  line.hidden = document.documentElement.dataset["debug"] !== "1";
  return line;
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
export interface WorldRosterEntry {
  readonly id: string;
  readonly label: string;
}

export function renderWorldScreen(
  container: HTMLElement,
  regions: readonly RegionDefinition[],
  qualityLevels: readonly { readonly id: string; readonly label: string }[],
  alertLevels: readonly { readonly id: string; readonly label: string }[],
  roster: readonly WorldRosterEntry[],
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
    dev(row("Local E/N", "local")),
    dev(row("Sector", "sector")),
    dev(row("Neighbours", "neighbors")),
    row("Region", "region"),
    row("Climate", "climate"),
    dev(row("Simulation", "tiers")),
    dev(row("Origin anchor", "anchor")),
    dev(row("Rebases", "rebases")),
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
    dev(row("Generator", "stream-service")),
    dev(row("Sector states", "stream-states")),
    dev(row("Resident", "stream-resident")),
    dev(row("Generated", "stream-generated")),
    dev(row("Cache", "stream-cache")),
    dev(row("Cancelled / evicted", "stream-churn")),
    dev(row("Generation", "stream-generation")),
    dev(row("Upload", "stream-upload")),
    dev(row("Sector memory", "stream-memory")),
    dev(row("Scene", "stream-scene")),
    dev(row("Ground height", "stream-ground")),
    dev(row("Stress route", "stream-route")),
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
    // A day at a time, because waiting out a build order or a repair should not
    // mean clicking the six hour button ninety times.
    ["time-day", "+1d", () => callbacks.onAdvanceHours(24)],
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

  // Adaptive quality. A checkbox rather than a mode, because the answer to
  // "who chooses the level" is either the machine or the player, visibly.
  const adaptiveLabel = document.createElement("label");
  const adaptiveBox = document.createElement("input");
  adaptiveBox.type = "checkbox";
  adaptiveBox.dataset.action = "quality-auto";
  adaptiveBox.setAttribute("aria-label", "Adaptive quality");
  adaptiveBox.addEventListener("change", () => callbacks.onAdaptiveQuality(adaptiveBox.checked));
  adaptiveLabel.append(adaptiveBox, document.createTextNode(" Auto"));
  qualityRow.appendChild(adaptiveLabel);

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

  // Starting work on the worst block. Disabled, visibly, when there is nothing
  // to clear or the block is still burning.
  const rebuildRow = document.createElement("div");
  rebuildRow.className = "world-teleport";
  rebuildRow.dataset.section = "rebuild";
  const rebuildLabel = document.createElement("label");
  rebuildLabel.textContent = "Worst block";
  const rebuildTarget = document.createElement("span");
  rebuildTarget.className = "world-value";
  rebuildTarget.dataset.field = "rebuild-target";
  rebuildLabel.appendChild(rebuildTarget);
  const rebuildButton = document.createElement("button");
  rebuildButton.type = "button";
  rebuildButton.className = "secondary-button";
  rebuildButton.dataset.action = "rebuild";
  rebuildButton.textContent = "Clear and rebuild";
  rebuildButton.disabled = true;
  let rebuildTargetId: string | null = null;
  rebuildButton.addEventListener("click", () => {
    if (rebuildTargetId) callbacks.onRebuild(rebuildTargetId);
  });
  rebuildRow.append(rebuildLabel, rebuildButton);

  // What makes this place this place. Built once and refilled, like the rest.
  const identitySection = document.createElement("div");
  identitySection.className = "world-readout world-identity";
  identitySection.dataset.section = "identity";
  identitySection.hidden = true;
  const identityHeader = document.createElement("div");
  identityHeader.className = "world-row";
  const identityKey = document.createElement("span");
  identityKey.className = "world-key";
  identityKey.textContent = "Region";
  const identityValue = document.createElement("span");
  identityValue.className = "world-value";
  identityValue.dataset.field = "identity-skyline";
  identityHeader.append(identityKey, identityValue);

  const identityList = document.createElement("ul");
  identityList.className = "world-identity-list";
  identityList.dataset.field = "identity-lines";

  const briefingList = document.createElement("ul");
  briefingList.className = "world-identity-list";
  briefingList.dataset.field = "identity-briefings";

  identitySection.append(identityHeader, identityList, briefingList);

  // The map. What has been found, what it costs to reach, and what the squad
  // can do about it. Built once and refilled, like every other section here.
  const mapSection = document.createElement("div");
  mapSection.className = "world-readout world-map";
  mapSection.dataset.section = "map";
  mapSection.hidden = true;

  const mapHeader = document.createElement("div");
  mapHeader.className = "world-row";
  const mapKey = document.createElement("span");
  mapKey.className = "world-key";
  mapKey.textContent = "Map";
  const mapValue = document.createElement("span");
  mapValue.className = "world-value";
  mapValue.dataset.field = "map-state";
  mapHeader.append(mapKey, mapValue);

  const readinessRow = document.createElement("div");
  readinessRow.className = "world-row";
  const readinessKey = document.createElement("span");
  readinessKey.className = "world-key";
  readinessKey.textContent = "Squad";
  const readinessValue = document.createElement("span");
  readinessValue.className = "world-value";
  readinessValue.dataset.field = "map-readiness";
  readinessRow.append(readinessKey, readinessValue);

  const boosterRow = document.createElement("div");
  boosterRow.className = "world-row";
  const boosterKey = document.createElement("span");
  boosterKey.className = "world-key";
  boosterKey.textContent = "Thrusters";
  const boosterValue = document.createElement("span");
  boosterValue.className = "world-value";
  boosterValue.dataset.field = "map-booster";
  boosterRow.append(boosterKey, boosterValue);

  const siteList = document.createElement("ul");
  siteList.className = "world-site-list";
  siteList.dataset.field = "map-sites";

  const routeBox = document.createElement("div");
  routeBox.className = "world-route";
  routeBox.dataset.field = "map-route";

  mapSection.append(mapHeader, readinessRow, boosterRow, siteList, routeBox);

  // The alert board. One entry per incident, each with what is known, what it
  // costs to ignore, and the buttons that actually do those things.
  const warSection = document.createElement("div");
  warSection.className = "world-readout world-war";
  warSection.dataset.section = "war";
  warSection.hidden = true;
  const warHeader = document.createElement("div");
  warHeader.className = "world-row";
  const warKey = document.createElement("span");
  warKey.className = "world-key";
  warKey.textContent = "War";
  const warValue = document.createElement("span");
  warValue.className = "world-value";
  warValue.dataset.field = "war-state";
  warHeader.append(warKey, warValue);

  const frequencyRow = document.createElement("div");
  frequencyRow.className = "world-teleport";
  frequencyRow.dataset.section = "crisis-frequency";
  const frequencyLabel = document.createElement("label");
  frequencyLabel.className = "world-walk-label";
  frequencyLabel.textContent = "Crisis frequency";
  const frequencySelect = document.createElement("select");
  frequencySelect.dataset.action = "crisis-frequency";
  frequencySelect.setAttribute("aria-label", "How often crises happen");
  for (const [value, label] of [
    ["0.5", "Rare"],
    ["1", "Standard"],
    ["1.5", "Frequent"],
    ["2", "Relentless"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === "1") option.selected = true;
    frequencySelect.appendChild(option);
  }
  frequencySelect.addEventListener("change", () => {
    callbacks.onCrisisFrequency(Number(frequencySelect.value) || 1);
  });
  frequencyLabel.appendChild(frequencySelect);
  frequencyRow.appendChild(frequencyLabel);

  // The sortie in progress, and the results of the last one. Both are hidden
  // rather than shown empty, because an empty results panel implies a mission
  // that did not happen.
  const sortieRow = document.createElement("div");
  sortieRow.className = "world-sortie";
  sortieRow.dataset.section = "sortie";
  sortieRow.hidden = true;
  const sortieState = document.createElement("span");
  sortieState.className = "world-value";
  sortieState.dataset.field = "sortie-state";
  const sortieObjectives = document.createElement("span");
  sortieObjectives.className = "world-value";
  sortieObjectives.dataset.field = "sortie-objectives";
  const skipCarrier = document.createElement("button");
  skipCarrier.type = "button";
  skipCarrier.className = "secondary-button";
  skipCarrier.dataset.action = "skip-carrier";
  skipCarrier.textContent = "Skip the carrier run";
  skipCarrier.addEventListener("click", () => callbacks.onSkipCarrier());
  const abortMission = document.createElement("button");
  abortMission.type = "button";
  abortMission.className = "secondary-button";
  abortMission.dataset.action = "abort-mission";
  abortMission.textContent = "Abort the sortie";
  abortMission.addEventListener("click", () => callbacks.onAbortMission());
  sortieRow.append(sortieState, sortieObjectives, skipCarrier, abortMission);

  const resultsRow = document.createElement("div");
  resultsRow.className = "world-results";
  resultsRow.dataset.section = "results";
  resultsRow.hidden = true;
  const resultsSummary = document.createElement("span");
  resultsSummary.className = "world-value";
  resultsSummary.dataset.field = "results-summary";
  const resultsLedger = document.createElement("ul");
  resultsLedger.dataset.field = "results-ledger";
  const closeResults = document.createElement("button");
  closeResults.type = "button";
  closeResults.className = "secondary-button";
  closeResults.dataset.action = "close-results";
  closeResults.textContent = "Back to the map";
  closeResults.addEventListener("click", () => callbacks.onCloseResults());
  resultsRow.append(resultsSummary, resultsLedger, closeResults);

  const alertList = document.createElement("ul");
  alertList.className = "world-alert-list";
  alertList.dataset.field = "alert-list";

  const resolutionList = document.createElement("ul");
  resolutionList.className = "world-resolution-list";
  resolutionList.dataset.field = "resolution-list";

  warSection.append(warHeader, frequencyRow, sortieRow, resultsRow, alertList, resolutionList);

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
    dev(row("Drawn", "city-drawn")),
    dev(row("Agents", "city-agents")),
    row("Damage", "city-damage"),
    row("Hazards", "city-hazards"),
    row("Rubble", "city-rubble"),
    row("Rebuilding", "city-rebuilding"),
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
    dev(row("Audio", "env-audio")),
    dev(row("Quality budgets", "env-quality")),
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

  // Deploying a machine belongs with the ground controls: piloting needs terrain
  // under the feet, so the row is hidden on the globe rather than shown and refused.
  const pilotRow = document.createElement("div");
  pilotRow.className = "world-teleport";
  pilotRow.dataset.section = "pilot";
  const pilotLabel = document.createElement("label");
  pilotLabel.textContent = "Machine";
  const pilotSelect = document.createElement("select");
  pilotSelect.dataset.field = "pilot-roster";
  for (const entry of roster) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    pilotSelect.appendChild(option);
  }
  pilotLabel.appendChild(pilotSelect);
  const pilotButton = document.createElement("button");
  pilotButton.type = "button";
  pilotButton.className = "secondary-button";
  pilotButton.dataset.action = "pilot";
  pilotButton.textContent = "Take the machine out";
  pilotButton.addEventListener("click", () => callbacks.onPilot(pilotSelect.value));
  pilotRow.append(pilotLabel, pilotButton);
  // A machine that cannot go out says so here, next to the button that would
  // have sent it.
  const pilotNotice = document.createElement("p");
  pilotNotice.className = "world-notice";
  pilotNotice.dataset.field = "pilot-notice";
  pilotNotice.hidden = true;
  pilotRow.appendChild(pilotNotice);

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
    identitySection,
    mapSection,
    warSection,
    rebuildRow,
    pilotRow,
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
  /**
   * What the site list currently shows.
   *
   * The ground view refreshes four times a second. Rebuilding the list every
   * time detached the buttons under the pointer, so a click on Work or Route
   * landed on a node that no longer existed and did nothing at all. The list is
   * rebuilt only when what it says actually changes.
   */
  let lastSiteSignature = "";

  const set = (field: string, value: string): void => {
    const node = fields.get(field);
    if (node) node.textContent = value;
  };

  return {
    update(state) {
      // What makes this region itself: the shape of it, what it makes, what it
      // can do about a creature, and what the conditions there mean.
      const identity = state.identity;
      identitySection.hidden = identity === null;
      if (identity) {
        identityValue.textContent = identity.skyline;
        identityList.replaceChildren(
          ...[
            identity.shoreline,
            identity.water,
            identity.approaches,
            identity.industry,
            identity.defence,
            identity.traffic,
            identity.rebuild,
            identity.modifiers.length > 0
              ? `Conditions: ${identity.modifiers.join(", ")}`
              : "No local conditions.",
          ].map((text) => {
            const line = document.createElement("li");
            line.textContent = text;
            return line;
          }),
        );
        briefingList.replaceChildren(
          ...(identity.briefings.length === 0
            ? ["Nothing unusual about fighting here."]
            : identity.briefings
          ).map((text) => {
            const line = document.createElement("li");
            line.className = "world-identity-briefing";
            line.textContent = text;
            return line;
          }),
        );
      }

      // The map: everywhere known, what it costs to get there, and what can be
      // done about it. Rebuilt from the readout rather than kept here, so the
      // map cannot describe a world that has moved on.
      const map = state.map;
      mapSection.hidden = map === null;
      if (map) {
        const unknown = Math.max(0, map.totalPlaced - map.sites.length);
        mapValue.textContent =
          `${map.sites.length} found` +
          (unknown > 0 ? `, ${unknown} still out there` : ", nothing left to find") +
          ` · ${map.deployPoints.length} deployment point${map.deployPoints.length === 1 ? "" : "s"}`;
        readinessValue.textContent = map.readiness;
        boosterValue.textContent =
          `${map.boosterPercent}% heat` + (map.boosterRefusal ? ` · ${map.boosterRefusal}` : "");

        const signature = map.sites
          .map((site) => `${site.id}|${site.claimed}|${site.deployPoint}|${site.refusal ?? ""}`)
          .join(";");
        if (signature !== lastSiteSignature) {
          lastSiteSignature = signature;
          siteList.replaceChildren(
            ...(map.sites.length === 0
              ? [emptySiteLine("Nothing found yet. Go and look.")]
              : map.sites.map((site) => buildSiteRow(site, callbacks))),
          );
        } else {
          // Same rows, moving numbers. Update in place so nothing under the
          // pointer is replaced while somebody is clicking it.
          for (const site of map.sites) {
            const row = siteList.querySelector<HTMLElement>(`[data-site="${site.id}"]`);
            if (!row) continue;
            const cost = row.querySelector<HTMLElement>('[data-field="site-cost"]');
            if (cost) {
              cost.textContent = `${site.distanceKm} km · ${site.travelMinutes} min · ${site.dangerText}`;
            }
          }
        }

        if (map.route) {
          routeBox.replaceChildren(
            routeLine(
              `Direct ${map.route.directMinutes} min · by way of what is known ${map.route.assistedMinutes} min`,
            ),
            routeLine(map.route.summary),
            ...map.route.legs.map((leg) =>
              routeLine(`${leg.toName}: ${leg.distanceKm} km, ${leg.travelMinutes} min`),
            ),
          );
        } else {
          routeBox.replaceChildren(routeLine("No route planned."));
        }
      }
      // The war, and the actions that answer it.
      const war = state.war;
      warSection.hidden = war === null;
      if (war) {
        warValue.textContent =
          `escalation ${war.escalationPercent}% · breach pressure ${war.breachPressurePercent}%` +
          (war.notice ? ` · ${war.notice}` : "");
        if (Number(frequencySelect.value) !== war.crisisFrequency) {
          frequencySelect.value = String(war.crisisFrequency);
        }

        // A sortie in progress, with what it is doing and how to leave it.
        const sortie = war.sortie;
        sortieRow.hidden = sortie === null;
        if (sortie) {
          sortieState.textContent =
            `Sortie over ${sortie.regionName}: ${sortie.phase}` +
            (sortie.phase === "carrier" ? ` (${sortie.carrierPercent}% of the flight)` : "");
          sortieObjectives.textContent = sortie.objectives
            .map((objective) => `${objective.name} ${objective.state}: ${objective.detail}`)
            .join(" · ");
          skipCarrier.disabled = sortie.phase !== "carrier";
        }

        const results = war.results;
        resultsRow.hidden = results === null;
        if (results) {
          resultsSummary.textContent = `${results.outcome}: ${results.summary}`;
          resultsLedger.replaceChildren();
          for (const line of results.ledger) {
            const item = document.createElement("li");
            item.dataset.field = "results-line";
            item.textContent = line;
            resultsLedger.appendChild(item);
          }
        }

        alertList.replaceChildren();
        if (war.alerts.length === 0) {
          const quiet = document.createElement("li");
          quiet.dataset.field = "alert-empty";
          quiet.textContent = "Nothing inbound.";
          alertList.appendChild(quiet);
        }
        for (const alert of war.alerts) {
          const item = document.createElement("li");
          item.className = "world-alert";
          item.dataset.incident = alert.incidentId;

          const headline = document.createElement("span");
          headline.className = "world-alert-headline";
          headline.dataset.field = "alert-headline";
          headline.textContent =
            `${alert.regionName}: ${alert.status}, ` +
            (alert.hoursToArrival >= 0 ? `${alert.hoursToArrival.toFixed(1)} h out` : "ashore now") +
            ` · ${alert.travelHours.toFixed(1)} h to get there` +
            (alert.reachable ? "" : " · too far to reach in time");

          const detail = document.createElement("span");
          detail.className = "world-alert-detail";
          detail.dataset.field = "alert-detail";
          detail.textContent =
            `${alert.composition} (${alert.confidencePercent}% confidence) · ${alert.objective}` +
            (alert.secondaryObjectives.length > 0 ? ` then ${alert.secondaryObjectives.join(", ")}` : "") +
            (alert.tells.length > 0 ? ` · ${alert.tells.join(" ")}` : "");

          const forecast = document.createElement("span");
          forecast.className = "world-alert-forecast";
          forecast.dataset.field = "alert-forecast";
          forecast.textContent = `If nobody goes: ${alert.ifIgnored}`;
          forecast.title = alert.ifIgnoredLedger.join(LEDGER_SEPARATOR);

          const defend = document.createElement("button");
          defend.type = "button";
          defend.className = "secondary-button";
          defend.dataset.action = "incident-defend";
          defend.textContent = "Let the defences handle it";
          defend.addEventListener("click", () =>
            callbacks.onResolveIncident(alert.incidentId, "ai-defended"),
          );

          // What the planner says about going, and the button that goes.
          const readiness = alert.readiness;
          const ready = document.createElement("span");
          ready.className = "world-alert-readiness";
          ready.dataset.field = "alert-readiness";
          ready.textContent =
            readiness === null
              ? "No machine can be sent."
              : `Readiness ${readiness.percent}% · drift ${readiness.driftPercent}% · machine ${readiness.machinePercent}% · ` +
                `${readiness.travelHours.toFixed(1)} h flight · carrier ${readiness.loadPercent}% loaded · ${readiness.weather}` +
                (readiness.crew.length > 0 ? ` · crew ${readiness.crew.join(" and ")}` : "") +
                (readiness.refusals.length > 0 ? ` · cannot go: ${readiness.refusals.join(" ")}` : "") +
                (readiness.warnings.length > 0 ? ` · ${readiness.warnings.join(" ")}` : "");

          const deploy = document.createElement("button");
          deploy.type = "button";
          deploy.className = "secondary-button";
          deploy.dataset.action = "incident-deploy";
          deploy.textContent = "Deploy";
          // Built here and appended with the rest of the row below: inserting it
          // next to a node that is not in the document yet does nothing at all.
          const drawbackList = document.createElement("ul");
          drawbackList.className = "world-alert-drawbacks";
          drawbackList.dataset.field = "alert-drawbacks";
          for (const entry of readiness?.drawbacks ?? []) {
            const line = document.createElement("li");
            line.dataset.firing = String(entry.firing);
            line.textContent = entry.text;
            drawbackList.appendChild(line);
          }
          drawbackList.hidden = (readiness?.drawbacks.length ?? 0) === 0;
          deploy.disabled = readiness === null || readiness.refusals.length > 0;
          deploy.title = readiness?.predictedThreat ?? "";
          deploy.addEventListener("click", () => callbacks.onDeploy(alert.incidentId));

          const ignore = document.createElement("button");
          ignore.type = "button";
          ignore.className = "secondary-button";
          ignore.dataset.action = "incident-ignore";
          ignore.textContent = "Stand down";
          ignore.addEventListener("click", () => callbacks.onResolveIncident(alert.incidentId, "ignored"));

          item.append(headline, detail, forecast, ready, drawbackList, deploy, defend, ignore);
          alertList.appendChild(item);
        }

        resolutionList.replaceChildren();
        for (const resolution of war.resolutions) {
          const item = document.createElement("li");
          item.className = "world-resolution";
          item.dataset.field = "resolution";
          item.textContent = resolution.summary;
          // Every number that moved, and why it moved, on the element itself.
          item.title = resolution.ledger.join(LEDGER_SEPARATOR);
          resolutionList.appendChild(item);
        }
      }

      pilotNotice.hidden = state.pilotNotice === null;
      pilotNotice.textContent = state.pilotNotice ?? "";
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
      // The checkbox follows the controller's real state: a manual pick turns
      // the controller off, and a box still showing on would be a lie.
      if (adaptiveBox.checked !== env.qualityAuto) adaptiveBox.checked = env.qualityAuto;

      const town = state.city;
      city.hidden = town === null;
      alertRow.hidden = town === null;
      // Piloting needs streamed ground to stand on, so the row is only offered
      // where there is any: on the globe there is nothing under the feet.
      pilotRow.hidden = state.viewMode !== "ground";
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
        set("city-damage", `${town.damageSummary} · safety ${Math.round(town.safetyRating * 100)}%`);
        set(
          "city-hazards",
          `${town.firesBurning} burning · ${town.contaminatedBlocks} contaminated · ` +
            `${Math.round(town.routesBlockedFraction * 100)}% of routes blocked · ` +
            `${town.trappedThousands.toFixed(1)}k trapped, rescue pressure ${Math.round(town.rescuePressure * 100)}%`,
        );
        set("city-rubble", `${town.debrisLive}/${town.debrisCapacity} bodies, ${town.debrisFrozen} settled`);
        set("city-rebuilding", town.rebuildSummary);
        rebuildTargetId = town.worstBlockId;
        rebuildTarget.textContent = town.worstBlockLabel ?? "nothing down";
        rebuildButton.disabled = town.worstBlockId === null;
        if (town.rebuildQuote) rebuildButton.title = town.rebuildQuote;

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
