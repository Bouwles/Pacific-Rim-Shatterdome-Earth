/**
 * The Shatterdome interface.
 *
 * A heads-up layer that is always on, plus the panels that open when the player
 * uses something in the world. Nothing here can be reached from a menu: a
 * facility is ordered at a terminal, a machine is inspected at its berth, and
 * the instruments are read in the Conn-Pod. That is the difference between an
 * explorable headquarters and a row of flat menus.
 *
 * Every figure on every panel is passed in from live state. There are no buttons
 * that do nothing: an order that cannot be placed is disabled and says which
 * number refused it.
 */

export interface RadioEntry {
  readonly id: string;
  readonly speaker: string;
  readonly role: string;
  readonly text: string;
}

export interface FacilityRow {
  readonly id: string;
  readonly displayName: string;
  readonly deck: number;
  readonly statusLabel: string;
  readonly tier: number;
  readonly maxTier: number;
  readonly powerDrawMw: number;
  readonly staffOnShift: number;
  readonly here: boolean;
  /** Present when there is a tier above this one. */
  readonly nextTierName: string | null;
  readonly nextTierBenefit: string | null;
  readonly nextTierCrews: number;
  readonly nextTierMinutes: number;
  /** 0 to 1 while an order is running. */
  readonly progress: number;
  readonly working: boolean;
  /** Null when the order can be placed; otherwise why it cannot. */
  readonly refusal: string | null;
}

export interface FacilityPanelState {
  readonly kind: "facility";
  readonly title: string;
  readonly powerDrawMw: number;
  readonly powerOutputMw: number;
  readonly crewsFree: number;
  readonly crewCapacity: number;
  readonly rows: readonly FacilityRow[];
}

export interface BerthPanelState {
  readonly kind: "berth";
  readonly title: string;
  readonly jaegerName: string | null;
  readonly manufacturer: string;
  readonly markDesignation: string;
  readonly massTons: number;
  readonly powerOutputMw: number;
  readonly coolingCapacity: number;
  readonly assetId: string;
  readonly assetOrigin: string;
  readonly heightMeters: number;
  readonly selected: boolean;
  readonly notes: string;
}

export interface ConnPodPanelState {
  readonly kind: "conn-pod";
  readonly title: string;
  readonly jaegerName: string | null;
  readonly massTons: number;
  readonly powerOutputMw: number;
  readonly coolingCapacity: number;
  readonly outsideWeather: string;
  readonly outsideTime: string;
  readonly windMps: number;
  readonly visibilityMeters: number;
  readonly regionLabel: string;
  readonly alertLabel: string;
  readonly readiness: string;
}

export type ShatterdomePanelState = FacilityPanelState | BerthPanelState | ConnPodPanelState;

export interface ShatterdomeScreenState {
  readonly roomName: string;
  readonly roomStatus: string;
  readonly deck: number;
  readonly staffOnShift: number;
  readonly staffSlots: number;
  readonly shiftLabel: string;
  readonly timeLabel: string;
  readonly powerText: string;
  readonly crewText: string;
  /** Where the player is standing in the room, metres from its centre. */
  readonly positionText: string;
  /**
   * What is actually on screen: staff drawn against the budget, and mesh count.
   * Null before the view reports, so the panel says nothing rather than zero.
   */
  readonly drawnText: string | null;
  readonly prompt: string | null;
  readonly announcement: string | null;
  readonly transitionLabel: string | null;
  readonly fade: number;
  readonly radio: readonly RadioEntry[];
  readonly panel: ShatterdomePanelState | null;
  readonly paused: boolean;
}

export interface ShatterdomeScreenCallbacks {
  readonly onOrder: (facilityId: string) => void;
  readonly onClosePanel: () => void;
  readonly onResume: () => void;
  readonly onOpenSaves: () => void;
  readonly onExitToMenu: () => void;
}

export interface ShatterdomeScreenHandle {
  update(state: ShatterdomeScreenState): void;
  dispose(): void;
}

/** Keyboard help, listed once here and in docs/CONTROLS.md. */
const CONTROL_HINTS = [
  "WASD walk",
  "Shift run",
  "Ctrl crouch",
  "Mouse or arrows look",
  "E use",
  "Tab cycle",
  "U unstuck",
  "Esc pause",
];

export function renderShatterdomeScreen(
  container: HTMLElement,
  callbacks: ShatterdomeScreenCallbacks,
): ShatterdomeScreenHandle {
  container.replaceChildren();

  const root = document.createElement("div");
  root.className = "screen screen-shatterdome-interior";
  root.id = "shatterdomeScreen";

  const fade = document.createElement("div");
  fade.className = "sd-fade";
  fade.setAttribute("aria-hidden", "true");

  const hud = document.createElement("div");
  hud.className = "sd-hud";

  const header = document.createElement("div");
  header.className = "sd-room";
  const roomName = field("room-name", "h2");
  const roomStatus = field("room-status", "p");
  header.append(roomName, roomStatus);

  const readout = document.createElement("div");
  readout.className = "sd-readout";
  const staffLine = field("staff", "span");
  const powerLine = field("power", "span");
  const crewLine = field("crews", "span");
  const timeLine = field("time", "span");
  const positionLine = field("position", "span");
  const drawnLine = field("drawn", "span");
  readout.append(timeLine, staffLine, powerLine, crewLine, positionLine, drawnLine);

  const prompt = field("prompt", "p");
  prompt.className = "sd-prompt";
  const announcement = document.createElement("p");
  announcement.className = "sd-announcement";
  announcement.setAttribute("aria-live", "polite");
  announcement.dataset["field"] = "announcement";

  const radio = document.createElement("ul");
  radio.className = "sd-radio";
  radio.dataset["field"] = "radio";
  radio.setAttribute("aria-live", "polite");

  const hints = document.createElement("p");
  hints.className = "sd-hints";
  hints.textContent = CONTROL_HINTS.join("  ·  ");

  hud.append(header, readout, prompt, announcement, radio, hints);

  const panelHost = document.createElement("div");
  panelHost.className = "sd-panel-host";
  panelHost.hidden = true;

  const pauseMenu = document.createElement("div");
  pauseMenu.className = "sd-pause";
  pauseMenu.hidden = true;
  pauseMenu.setAttribute("role", "dialog");
  pauseMenu.setAttribute("aria-label", "Paused");
  const pauseTitle = document.createElement("h2");
  pauseTitle.textContent = "Paused";
  const resumeButton = button("Resume", "primary-button", callbacks.onResume);
  resumeButton.dataset["action"] = "resume";
  const savesButton = button("Saves", "secondary-button", callbacks.onOpenSaves);
  savesButton.dataset["action"] = "open-saves";
  const exitButton = button("Back to Menu", "secondary-button", callbacks.onExitToMenu);
  exitButton.dataset["action"] = "exit-to-menu";
  const pauseHints = document.createElement("p");
  pauseHints.className = "sd-hints";
  pauseHints.textContent = CONTROL_HINTS.join("  ·  ");
  pauseMenu.append(pauseTitle, resumeButton, savesButton, exitButton, pauseHints);

  root.append(fade, hud, panelHost, pauseMenu);
  container.appendChild(root);

  let lastPanelKey = "";
  let lastAnnouncement = "";

  const handle: ShatterdomeScreenHandle = {
    update(state) {
      roomName.textContent = state.roomName;
      roomStatus.textContent = `Deck ${state.deck} · ${state.roomStatus}`;
      timeLine.textContent = `${state.timeLabel} · ${state.shiftLabel} shift`;
      staffLine.textContent = `${state.staffOnShift}/${state.staffSlots} on shift`;
      powerLine.textContent = state.powerText;
      crewLine.textContent = state.crewText;
      positionLine.textContent = state.positionText;
      drawnLine.textContent = state.drawnText ?? "";
      drawnLine.hidden = state.drawnText === null;

      prompt.textContent = state.transitionLabel ?? state.prompt ?? "";
      prompt.hidden = prompt.textContent === "";

      // Only write the live region when the sentence actually changes: a screen
      // reader re-reading the same prompt sixty times a second is unusable.
      const nextAnnouncement = state.announcement ?? "";
      if (nextAnnouncement !== lastAnnouncement) {
        lastAnnouncement = nextAnnouncement;
        announcement.textContent = nextAnnouncement;
      }

      renderRadio(radio, state.radio);

      fade.style.opacity = String(Math.min(1, Math.max(0, state.fade)));

      const panelKey = panelIdentity(state.panel);
      if (panelKey !== lastPanelKey) {
        lastPanelKey = panelKey;
        panelHost.replaceChildren();
        if (state.panel) {
          panelHost.appendChild(buildPanel(state.panel, callbacks));
          panelHost.hidden = false;
        } else {
          panelHost.hidden = true;
        }
      } else if (state.panel) {
        // Same panel, live numbers: refresh in place rather than rebuilding, or
        // a button would be torn out from under the pointer every frame.
        refreshPanel(panelHost, state.panel);
      }

      pauseMenu.hidden = !state.paused;
    },
    dispose() {
      root.remove();
    },
  };

  return handle;
}

function panelIdentity(panel: ShatterdomePanelState | null): string {
  if (!panel) return "";
  return `${panel.kind}|${panel.title}`;
}

function buildPanel(panel: ShatterdomePanelState, callbacks: ShatterdomeScreenCallbacks): HTMLElement {
  const element = document.createElement("div");
  element.className = "sd-panel";
  element.dataset["panel"] = panel.kind;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", panel.title);

  const header = document.createElement("div");
  header.className = "sd-panel-header";
  const title = document.createElement("h3");
  title.textContent = panel.title;
  const close = button("Close (E)", "secondary-button", callbacks.onClosePanel);
  close.dataset["action"] = "close-panel";
  header.append(title, close);
  element.appendChild(header);

  if (panel.kind === "facility") {
    const summary = document.createElement("p");
    summary.className = "sd-panel-summary";
    summary.dataset["field"] = "panel-summary";
    element.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "sd-facility-list";
    for (const row of panel.rows) {
      list.appendChild(buildFacilityRow(row, callbacks));
    }
    element.appendChild(list);
  } else if (panel.kind === "berth") {
    element.appendChild(definitionList(berthFields(panel)));
    const notes = document.createElement("p");
    notes.className = "sd-panel-notes";
    notes.dataset["field"] = "berth-notes";
    notes.textContent = panel.notes;
    element.appendChild(notes);
  } else {
    element.appendChild(definitionList(connPodFields(panel)));
    const notes = document.createElement("p");
    notes.className = "sd-panel-notes";
    notes.dataset["field"] = "conn-pod-notes";
    notes.textContent = panel.readiness;
    element.appendChild(notes);
  }

  refreshPanelElement(element, panel);
  return element;
}

function buildFacilityRow(row: FacilityRow, callbacks: ShatterdomeScreenCallbacks): HTMLElement {
  const item = document.createElement("li");
  item.className = "sd-facility-row";
  item.dataset["facility"] = row.id;

  const info = document.createElement("div");
  info.className = "sd-facility-info";
  const name = document.createElement("span");
  name.className = "sd-facility-name";
  name.dataset["field"] = "facility-name";
  const detail = document.createElement("span");
  detail.className = "sd-facility-detail";
  detail.dataset["field"] = "facility-detail";
  const benefit = document.createElement("span");
  benefit.className = "sd-facility-benefit";
  benefit.dataset["field"] = "facility-benefit";
  info.append(name, detail, benefit);

  const action = button("Order", "secondary-button", () => callbacks.onOrder(row.id));
  action.dataset["action"] = "order";

  item.append(info, action);
  return item;
}

function refreshPanel(host: HTMLElement, panel: ShatterdomePanelState): void {
  const element = host.querySelector<HTMLElement>(".sd-panel");
  if (element) refreshPanelElement(element, panel);
}

function refreshPanelElement(element: HTMLElement, panel: ShatterdomePanelState): void {
  if (panel.kind === "facility") {
    const summary = element.querySelector<HTMLElement>('[data-field="panel-summary"]');
    if (summary) {
      summary.textContent =
        `Power ${panel.powerDrawMw} of ${panel.powerOutputMw} MW · ` +
        `crews ${panel.crewsFree} of ${panel.crewCapacity} free`;
    }
    for (const row of panel.rows) {
      const item = element.querySelector<HTMLElement>(`[data-facility="${row.id}"]`);
      if (!item) continue;
      item.dataset["here"] = String(row.here);
      item.dataset["working"] = String(row.working);
      setField(item, "facility-name", `${row.displayName}${row.here ? " (here)" : ""}`);
      setField(
        item,
        "facility-detail",
        row.working
          ? `Deck ${row.deck} · ${row.statusLabel} · ${Math.round(row.progress * 100)}% complete`
          : `Deck ${row.deck} · ${row.statusLabel} · tier ${row.tier}/${row.maxTier} · ` +
              `${row.powerDrawMw} MW · ${row.staffOnShift} on shift`,
      );
      setField(
        item,
        "facility-benefit",
        row.nextTierName === null
          ? "At its highest tier."
          : `Next: ${row.nextTierName}. ${row.nextTierBenefit ?? ""} ` +
              `(${row.nextTierCrews} crew, ${row.nextTierMinutes} min)`,
      );
      const action = item.querySelector<HTMLButtonElement>('[data-action="order"]');
      if (action) {
        action.textContent = row.nextTierName === null ? "Complete" : row.working ? "Building" : "Order";
        action.disabled = row.refusal !== null;
        // The reason travels with the button rather than appearing only on a
        // failed click, so a greyed control always explains itself.
        action.title = row.refusal ?? `Order ${row.nextTierName ?? ""}`.trim();
        action.dataset["refusal"] = row.refusal ?? "";
      }
    }
    return;
  }

  const fields = panel.kind === "berth" ? berthFields(panel) : connPodFields(panel);
  for (const [key, value] of fields) setField(element, key, value);
  if (panel.kind === "berth") setField(element, "berth-notes", panel.notes);
  else setField(element, "conn-pod-notes", panel.readiness);
}

function berthFields(panel: BerthPanelState): Array<[string, string]> {
  return [
    ["berth-jaeger", panel.jaegerName ?? "Berth empty"],
    ["berth-mark", `${panel.markDesignation} · ${panel.manufacturer}`],
    ["berth-mass", `${panel.massTons.toLocaleString()} t`],
    ["berth-power", `${panel.powerOutputMw} MW · cooling ${Math.round(panel.coolingCapacity * 100)}%`],
    ["berth-height", `${panel.heightMeters.toFixed(1)} m`],
    ["berth-asset", `${panel.assetId} (${panel.assetOrigin})`],
    ["berth-selected", panel.selected ? "Selected for deployment" : "Not selected"],
  ];
}

function connPodFields(panel: ConnPodPanelState): Array<[string, string]> {
  return [
    ["pod-jaeger", panel.jaegerName ?? "No machine selected"],
    ["pod-mass", `${panel.massTons.toLocaleString()} t`],
    ["pod-power", `${panel.powerOutputMw} MW · cooling ${Math.round(panel.coolingCapacity * 100)}%`],
    ["pod-time", panel.outsideTime],
    ["pod-weather", panel.outsideWeather],
    ["pod-wind", `${panel.windMps.toFixed(1)} m/s`],
    ["pod-visibility", `${Math.round(panel.visibilityMeters).toLocaleString()} m`],
    ["pod-region", `${panel.regionLabel} · ${panel.alertLabel}`],
  ];
}

function definitionList(fields: Array<[string, string]>): HTMLElement {
  const list = document.createElement("dl");
  list.className = "sd-panel-fields";
  for (const [key, value] of fields) {
    const term = document.createElement("dt");
    term.textContent = LABELS[key] ?? key;
    const definition = document.createElement("dd");
    definition.dataset["field"] = key;
    definition.textContent = value;
    list.append(term, definition);
  }
  return list;
}

const LABELS: Readonly<Record<string, string>> = {
  "berth-jaeger": "Machine",
  "berth-mark": "Mark",
  "berth-mass": "Mass",
  "berth-power": "Reactor",
  "berth-height": "Height",
  "berth-asset": "Asset",
  "berth-selected": "Status",
  "pod-jaeger": "Machine",
  "pod-mass": "Mass",
  "pod-power": "Reactor",
  "pod-time": "Local time",
  "pod-weather": "Conditions",
  "pod-wind": "Wind",
  "pod-visibility": "Visibility",
  "pod-region": "Region",
};

function renderRadio(list: HTMLElement, entries: readonly RadioEntry[]): void {
  const shown = entries.slice(-4);
  const signature = shown.map((entry) => entry.id).join("|");
  if (list.dataset["signature"] === signature) return;
  list.dataset["signature"] = signature;
  list.replaceChildren();
  for (const entry of shown) {
    const item = document.createElement("li");
    const speaker = document.createElement("span");
    speaker.className = "sd-radio-speaker";
    speaker.textContent = `${entry.speaker}:`;
    const text = document.createElement("span");
    text.textContent = ` ${entry.text}`;
    item.append(speaker, text);
    list.appendChild(item);
  }
}

function setField(scope: HTMLElement, name: string, value: string): void {
  const element = scope.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (element && element.textContent !== value) element.textContent = value;
}

function field(name: string, tag: keyof HTMLElementTagNameMap): HTMLElement {
  const element = document.createElement(tag);
  element.dataset["field"] = name;
  return element;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = className;
  element.addEventListener("click", onClick);
  return element;
}
