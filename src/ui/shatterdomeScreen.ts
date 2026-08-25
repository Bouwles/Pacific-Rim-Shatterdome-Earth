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
  /** Which machine stands here, for the repair action. Null for an empty berth. */
  readonly jaegerId: string | null;
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
  /** What the machine is doing: ready, under repair, being rebuilt. */
  readonly status: string;
  /** Structure left across every component, 0 to 100. */
  readonly integrityPercent: number;
  /** One line per component: what it is, what state it is in, what is left. */
  readonly components: readonly { readonly name: string; readonly state: string; readonly percent: number }[];
  /** Systems currently offline because the component carrying them is gone. */
  readonly offline: readonly string[];
  readonly scars: number;
  /** Levels, rank, passives, modules and goals. Null for an empty berth. */
  readonly progression: ProgressionPanelState | null;
  /** Who flies it, and what that is worth. Null for an empty berth. */
  readonly crew: CrewPanelState | null;
  /** The work order, or null when the machine needs nothing. */
  readonly workOrder: {
    readonly summary: string;
    readonly lines: readonly string[];
    readonly hours: number;
    readonly cost: number;
  } | null;
}

/** One long running goal, as the berth shows it. */
export interface MasteryRow {
  readonly name: string;
  readonly detail: string;
  readonly rank: number;
  readonly maxRank: number;
  /** 0 to 1 toward the next rank. */
  readonly progress: number;
}

export interface PassiveOption {
  readonly id: string;
  readonly name: string;
  readonly effect: string;
  readonly tradeoff: string;
}

export interface ModuleRow {
  readonly id: string;
  readonly name: string;
  readonly effect: string;
  readonly tradeoff: string;
  readonly fitted: boolean;
  readonly stored: boolean;
  /** Null when it can be fitted; otherwise why it cannot. */
  readonly refusal: string | null;
}

/** One person, as the Conn-Pod roster shows them. */
export interface CrewRow {
  readonly pilotId: string;
  readonly name: string;
  readonly callsign: string;
  /** Assigned to this machine right now. */
  readonly assigned: boolean;
  /** Level of the link with the other assigned pilot. */
  readonly linkLevel: number;
  /**
   * How far into the next level that link is, as "banked of needed".
   *
   * Shown because a conversation is worth a fraction of a level: without this
   * the panel reads as though talking to somebody did nothing at all.
   */
  readonly linkProgress: string;
  /** Status, stress and anything they are carrying, in one line. */
  readonly condition: string;
  /** What their perk currently does, or what it is waiting for. */
  readonly perk: string;
  /** Their drawback, and whether it applies to this machine. */
  readonly drawback: string;
  readonly drawbackFiring: boolean;
  /** Null when they can be assigned; otherwise why not. */
  readonly refusal: string | null;
  /** Ids of untreated injuries, so the bay can be offered. */
  readonly treatable: readonly string[];
}

/** Who is in the Conn-Pod, and everything about changing that. */
export interface CrewPanelState {
  /** The pair, and what they are worth together in this machine. */
  readonly summary: string;
  /** Each term that moved the drift number. */
  readonly factors: readonly string[];
  readonly rows: readonly CrewRow[];
  /** The last thing anybody said. */
  readonly note: string | null;
}

/** Everything the machine has earned, for the berth. */
export interface ProgressionPanelState {
  readonly level: number;
  readonly levelCap: number;
  readonly prestige: number;
  /** Experience into the current level and what the next one wants. */
  readonly experienceInto: number;
  readonly experienceNeeded: number;
  /** What its levels and rank are worth, one line each. */
  readonly growthLines: readonly string[];
  /** What the next level opens, or null at the cap. */
  readonly nextUnlock: string | null;
  /** Moves this machine has earned the right to throw. */
  readonly moves: readonly string[];
  readonly passives: readonly string[];
  /** A choice waiting to be made, or null. */
  readonly passiveChoice: { readonly tier: number; readonly options: readonly PassiveOption[] } | null;
  readonly canRespec: boolean;
  readonly moduleSummary: string;
  readonly modules: readonly ModuleRow[];
  readonly masteries: readonly MasteryRow[];
  /** Both sides of the prestige trade, always shown before it can be taken. */
  readonly prestigeSummary: string;
  readonly prestigeRefusal: string | null;
  /** The last thing the bay said about any of this. */
  readonly note: string | null;
  /** What levelling has said recently, newest first. */
  readonly log: readonly string[];
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

/** One performance range, drawn as a bar rather than reduced to a score. */
export interface MarketBand {
  readonly label: string;
  /** Percentages, 0 to 100, the same numbers the bar and the figures show. */
  readonly low: number;
  readonly high: number;
}

export interface MarketOfferRow {
  readonly id: string;
  readonly name: string;
  readonly maker: string;
  /** Mark, role, condition and where it is being built. */
  readonly summary: string;
  readonly priceText: string;
  /** Lead time and what it costs to keep. */
  readonly termsText: string;
  readonly bands: readonly MarketBand[];
  readonly tradeoff: string;
  /** The terms of the contract, in the words a person would read out. */
  readonly conditions: readonly string[];
  readonly equipment: string;
  readonly upgrades: string;
  /** Null when it can be signed; otherwise why it cannot. */
  readonly refusal: string | null;
}

export interface MarketPanelState {
  readonly kind: "market";
  readonly title: string;
  /** Money, salvage and where the calendar is in the rotation. */
  readonly summary: string;
  readonly rows: readonly MarketOfferRow[];
  /** What is on order, with the day it is due. */
  readonly pending: readonly string[];
  /** What is already owned, so a purchase is a decision about a fleet. */
  readonly fleet: readonly string[];
  /** The last thing the office said. Null before anything is signed. */
  readonly note: string | null;
}

export type ShatterdomePanelState =
  FacilityPanelState | BerthPanelState | ConnPodPanelState | MarketPanelState;

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
  /** Puts one shift of work into the machine in this berth. */
  readonly onRepair: (jaegerId: string) => void;
  /** Signs for one machine on the contracts board. */
  readonly onPurchase: (offerId: string) => void;
  /** Takes a passive at the tier the machine has opened. */
  readonly onChoosePassive: (jaegerId: string, passiveId: string) => void;
  /** Gives every passive back, to choose again. */
  readonly onRespec: (jaegerId: string) => void;
  readonly onFitModule: (jaegerId: string, moduleId: string) => void;
  readonly onRemoveModule: (jaegerId: string, moduleId: string) => void;
  /** Resets the machine to level one for a permanent rank. */
  readonly onPrestige: (jaegerId: string) => void;
  /** Puts this pilot in the Conn-Pod, taking whoever was there out. */
  readonly onAssignPilot: (pilotId: string) => void;
  /** A word off duty. Builds the link slowly, and is capped per day. */
  readonly onTalkToPilot: (pilotId: string) => void;
  /** Sends somebody to the medical bay for an injury they are carrying. */
  readonly onTreatPilot: (pilotId: string, injuryId: string) => void;
  /** Stands somebody down for a few days to clear the stress. */
  readonly onStandDownPilot: (pilotId: string) => void;
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
  // The board is part of the identity: signing for a machine takes a row away,
  // and a refresh in place would leave the old row on screen.
  if (panel.kind === "market") {
    return `market|${panel.title}|${panel.rows.map((row) => row.id).join(",")}`;
  }
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
    if (panel.crew) element.appendChild(buildCrew(panel.crew, callbacks));
    if (panel.progression && panel.jaegerId) {
      element.appendChild(buildProgression(panel.jaegerId, panel.progression, callbacks));
    }
    // The work order is the whole repair bay: what is broken, what it costs,
    // and a shift of work you can actually put into it.
    const work = button("Work a shift", "secondary-button", () => {
      if (panel.jaegerId) callbacks.onRepair(panel.jaegerId);
    });
    work.dataset["action"] = "repair";
    work.disabled = panel.workOrder === null || panel.jaegerId === null;
    element.appendChild(work);
  } else if (panel.kind === "market") {
    const summary = document.createElement("p");
    summary.className = "sd-panel-summary";
    summary.dataset["field"] = "market-summary";
    element.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "sd-market-list";
    for (const row of panel.rows) list.appendChild(buildOfferRow(row, callbacks));
    if (panel.rows.length === 0) {
      const empty = document.createElement("li");
      empty.className = "sd-market-empty";
      empty.textContent = "Nothing on the board this rotation.";
      list.appendChild(empty);
    }
    element.appendChild(list);

    const orders = document.createElement("ul");
    orders.className = "sd-market-orders";
    orders.dataset["field"] = "market-orders";
    element.appendChild(orders);

    const fleet = document.createElement("p");
    fleet.className = "sd-panel-notes";
    fleet.dataset["field"] = "market-fleet";
    element.appendChild(fleet);

    const note = document.createElement("p");
    note.className = "sd-panel-notes";
    note.dataset["field"] = "market-note";
    note.setAttribute("aria-live", "polite");
    element.appendChild(note);
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

function buildCrew(state: CrewPanelState, callbacks: ShatterdomeScreenCallbacks): HTMLElement {
  const section = document.createElement("div");
  section.className = "sd-progression sd-crew";
  section.dataset["field"] = "crew";

  const heading = document.createElement("h4");
  heading.textContent = "Conn-Pod crew";
  section.appendChild(heading);

  const summary = document.createElement("p");
  summary.className = "sd-facility-detail";
  summary.dataset["field"] = "crew-summary";
  section.appendChild(summary);

  const factors = document.createElement("p");
  factors.className = "sd-facility-benefit";
  factors.dataset["field"] = "crew-factors";
  section.appendChild(factors);

  const list = document.createElement("ul");
  list.className = "sd-market-list";
  for (const row of state.rows) {
    const item = document.createElement("li");
    item.className = "sd-market-row";
    item.dataset["pilot"] = row.pilotId;
    item.dataset["assigned"] = String(row.assigned);

    const head = document.createElement("div");
    head.className = "sd-market-head";
    const name = document.createElement("span");
    name.className = "sd-market-name";
    name.dataset["field"] = "crew-name";
    const link = document.createElement("span");
    link.className = "sd-market-price";
    link.dataset["field"] = "crew-link";
    head.append(name, link);

    const condition = document.createElement("span");
    condition.className = "sd-facility-detail";
    condition.dataset["field"] = "crew-condition";
    const perk = document.createElement("span");
    perk.className = "sd-facility-detail";
    perk.dataset["field"] = "crew-perk";
    const drawback = document.createElement("span");
    drawback.className = "sd-facility-benefit";
    drawback.dataset["field"] = "crew-drawback";

    const actions = document.createElement("div");
    actions.className = "sd-passive-row";
    const assign = button("Assign", "secondary-button", () => callbacks.onAssignPilot(row.pilotId));
    assign.dataset["action"] = "assign-pilot";
    const talk = button("Talk", "secondary-button", () => callbacks.onTalkToPilot(row.pilotId));
    talk.dataset["action"] = "talk-pilot";
    const rest = button("Stand down", "secondary-button", () => callbacks.onStandDownPilot(row.pilotId));
    rest.dataset["action"] = "stand-down-pilot";
    actions.append(assign, talk, rest);
    for (const injuryId of row.treatable) {
      const treat = button("Treat", "secondary-button", () => callbacks.onTreatPilot(row.pilotId, injuryId));
      treat.dataset["action"] = "treat-pilot";
      treat.dataset["injury"] = injuryId;
      actions.appendChild(treat);
    }

    item.append(head, condition, perk, drawback, actions);
    list.appendChild(item);
  }
  section.appendChild(list);

  const note = document.createElement("p");
  note.className = "sd-panel-notes";
  note.dataset["field"] = "crew-note";
  note.setAttribute("aria-live", "polite");
  section.appendChild(note);

  refreshCrew(section, state);
  return section;
}

function refreshCrew(section: HTMLElement, state: CrewPanelState): void {
  setField(section, "crew-summary", state.summary);
  setField(section, "crew-factors", state.factors.join(" · "));
  setField(section, "crew-note", state.note ?? "");
  for (const row of state.rows) {
    const item = section.querySelector<HTMLElement>(`[data-pilot="${row.pilotId}"]`);
    if (!item) continue;
    item.dataset["assigned"] = String(row.assigned);
    setField(item, "crew-name", `${row.name} "${row.callsign}"${row.assigned ? " (flying)" : ""}`);
    setField(
      item,
      "crew-link",
      row.linkLevel > 0 ? `link ${row.linkLevel} · ${row.linkProgress}` : `no link · ${row.linkProgress}`,
    );
    setField(item, "crew-condition", row.condition);
    setField(item, "crew-perk", row.perk);
    setField(item, "crew-drawback", row.drawback);
    const drawbackLine = item.querySelector<HTMLElement>('[data-field="crew-drawback"]');
    if (drawbackLine) drawbackLine.dataset["firing"] = String(row.drawbackFiring);
    const assign = item.querySelector<HTMLButtonElement>('[data-action="assign-pilot"]');
    if (assign) {
      assign.disabled = row.assigned || row.refusal !== null;
      assign.title = row.refusal ?? `Put ${row.callsign} in the Conn-Pod`;
      assign.dataset["refusal"] = row.refusal ?? "";
    }
  }
}

function buildProgression(
  jaegerId: string,
  state: ProgressionPanelState,
  callbacks: ShatterdomeScreenCallbacks,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "sd-progression";
  section.dataset["field"] = "progression";

  const heading = document.createElement("h4");
  heading.textContent = "Service and progression";
  section.appendChild(heading);

  const summary = document.createElement("p");
  summary.className = "sd-facility-detail";
  summary.dataset["field"] = "progression-summary";
  section.appendChild(summary);

  const bar = document.createElement("span");
  // Its own class rather than the band track: that one takes its width from the
  // band grid it normally sits in, and on its own it collapses to nothing.
  bar.className = "sd-experience-track";
  const fill = document.createElement("span");
  fill.className = "sd-band-fill";
  fill.dataset["field"] = "progression-bar";
  bar.appendChild(fill);
  section.appendChild(bar);

  const growth = document.createElement("p");
  growth.className = "sd-facility-benefit";
  growth.dataset["field"] = "progression-growth";
  section.appendChild(growth);

  // A choice, when one is waiting. Every option states what it costs.
  const choice = document.createElement("div");
  choice.className = "sd-passive-choice";
  choice.dataset["field"] = "passive-choice";
  section.appendChild(choice);
  if (state.passiveChoice) {
    const label = document.createElement("p");
    label.className = "sd-facility-detail";
    label.textContent = `Tier ${state.passiveChoice.tier} is open. One of these, permanently.`;
    choice.appendChild(label);
    for (const option of state.passiveChoice.options) {
      const row = document.createElement("div");
      row.className = "sd-passive-row";
      const text = document.createElement("span");
      text.className = "sd-facility-detail";
      text.textContent = `${option.name}: ${option.effect} ${option.tradeoff}`;
      const take = button("Take", "secondary-button", () => callbacks.onChoosePassive(jaegerId, option.id));
      take.dataset["action"] = "choose-passive";
      take.dataset["passive"] = option.id;
      row.append(text, take);
      choice.appendChild(row);
    }
  }

  const passives = document.createElement("p");
  passives.className = "sd-facility-detail";
  passives.dataset["field"] = "progression-passives";
  section.appendChild(passives);

  const respec = button("Strip back and re-choose", "secondary-button", () => callbacks.onRespec(jaegerId));
  respec.dataset["action"] = "respec";
  respec.disabled = !state.canRespec;
  section.appendChild(respec);

  const moduleHeading = document.createElement("p");
  moduleHeading.className = "sd-facility-detail";
  moduleHeading.dataset["field"] = "module-summary";
  section.appendChild(moduleHeading);

  const modules = document.createElement("ul");
  modules.className = "sd-market-list";
  for (const row of state.modules) {
    const item = document.createElement("li");
    item.className = "sd-market-row";
    item.dataset["module"] = row.id;
    const name = document.createElement("span");
    name.className = "sd-market-name";
    name.textContent = `${row.name}${row.fitted ? " (fitted)" : row.stored ? " (in stores)" : ""}`;
    const detail = document.createElement("span");
    detail.className = "sd-facility-detail";
    detail.textContent = `${row.effect} ${row.tradeoff}`;
    const action = row.fitted
      ? button("Remove", "secondary-button", () => callbacks.onRemoveModule(jaegerId, row.id))
      : button("Fit", "secondary-button", () => callbacks.onFitModule(jaegerId, row.id));
    action.dataset["action"] = row.fitted ? "remove-module" : "fit-module";
    action.disabled = !row.fitted && row.refusal !== null;
    action.title = row.refusal ?? "";
    item.append(name, detail, action);
    modules.appendChild(item);
  }
  section.appendChild(modules);

  const masteryList = document.createElement("ul");
  masteryList.className = "sd-market-terms";
  for (const goal of state.masteries) {
    const item = document.createElement("li");
    item.textContent = `${goal.name}: rank ${goal.rank} of ${goal.maxRank}. ${goal.detail}`;
    masteryList.appendChild(item);
  }
  section.appendChild(masteryList);

  const prestige = document.createElement("p");
  prestige.className = "sd-facility-benefit";
  prestige.dataset["field"] = "prestige-summary";
  section.appendChild(prestige);

  const prestigeButton = button("Prestige", "secondary-button", () => callbacks.onPrestige(jaegerId));
  prestigeButton.dataset["action"] = "prestige";
  prestigeButton.disabled = state.prestigeRefusal !== null;
  prestigeButton.title = state.prestigeRefusal ?? "";
  section.appendChild(prestigeButton);

  const note = document.createElement("p");
  note.className = "sd-panel-notes";
  note.dataset["field"] = "progression-note";
  note.setAttribute("aria-live", "polite");
  section.appendChild(note);

  const log = document.createElement("ul");
  log.className = "sd-market-orders";
  log.dataset["field"] = "progression-log";
  section.appendChild(log);

  refreshProgression(section, state);
  return section;
}

function refreshProgression(section: HTMLElement, state: ProgressionPanelState): void {
  setField(
    section,
    "progression-summary",
    `Level ${state.level} of ${state.levelCap}` +
      (state.prestige > 0 ? ` · prestige ${state.prestige}` : "") +
      (state.experienceNeeded > 0
        ? ` · ${Math.round(state.experienceInto)} of ${Math.round(state.experienceNeeded)} to the next`
        : " · at the cap"),
  );
  const bar = section.querySelector<HTMLElement>('[data-field="progression-bar"]');
  if (bar) {
    const fraction =
      state.experienceNeeded > 0 ? Math.min(1, state.experienceInto / state.experienceNeeded) : 1;
    bar.style.left = "0%";
    bar.style.width = `${Math.max(2, Math.round(fraction * 100))}%`;
  }
  setField(
    section,
    "progression-growth",
    `${state.growthLines.join(" · ")}${state.nextUnlock ? ` · Next: ${state.nextUnlock}` : ""}`,
  );
  setField(
    section,
    "progression-passives",
    state.passives.length === 0 ? "No passives chosen." : `Passives: ${state.passives.join(", ")}`,
  );
  setField(section, "module-summary", state.moduleSummary);
  setField(section, "prestige-summary", state.prestigeSummary);
  setField(section, "progression-note", state.note ?? "");
  const log = section.querySelector<HTMLElement>('[data-field="progression-log"]');
  if (log) {
    log.replaceChildren(
      ...state.log.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }),
    );
  }
}

function buildOfferRow(row: MarketOfferRow, callbacks: ShatterdomeScreenCallbacks): HTMLElement {
  const item = document.createElement("li");
  item.className = "sd-market-row";
  item.dataset["offer"] = row.id;

  const head = document.createElement("div");
  head.className = "sd-market-head";
  const name = document.createElement("span");
  name.className = "sd-market-name";
  name.dataset["field"] = "offer-name";
  const price = document.createElement("span");
  price.className = "sd-market-price";
  price.dataset["field"] = "offer-price";
  head.append(name, price);

  const summary = document.createElement("span");
  summary.className = "sd-facility-detail";
  summary.dataset["field"] = "offer-summary";
  const terms = document.createElement("span");
  terms.className = "sd-facility-detail";
  terms.dataset["field"] = "offer-terms";

  // Bands, not a score. Each bar shows the range the machine works in, so two
  // machines can be compared without either being reduced to one number.
  const bands = document.createElement("div");
  bands.className = "sd-band-set";
  for (const band of row.bands) {
    const line = document.createElement("div");
    line.className = "sd-band";
    const label = document.createElement("span");
    label.className = "sd-band-label";
    label.textContent = band.label;
    const track = document.createElement("span");
    track.className = "sd-band-track";
    const fill = document.createElement("span");
    fill.className = "sd-band-fill";
    fill.style.left = `${Math.max(0, Math.min(100, band.low))}%`;
    fill.style.width = `${Math.max(2, Math.min(100 - band.low, band.high - band.low))}%`;
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "sd-band-value";
    value.textContent = `${Math.round(band.low)}-${Math.round(band.high)}`;
    line.append(label, track, value);
    bands.appendChild(line);
  }

  const tradeoff = document.createElement("span");
  tradeoff.className = "sd-facility-benefit";
  tradeoff.dataset["field"] = "offer-tradeoff";

  const terms2 = document.createElement("ul");
  terms2.className = "sd-market-terms";
  terms2.dataset["field"] = "offer-conditions";

  const action = button("Sign", "secondary-button", () => callbacks.onPurchase(row.id));
  action.dataset["action"] = "purchase";

  item.append(head, summary, terms, bands, tradeoff, terms2, action);
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

  if (panel.kind === "market") {
    setField(element, "market-summary", panel.summary);
    for (const row of panel.rows) {
      const item = element.querySelector<HTMLElement>(`[data-offer="${row.id}"]`);
      if (!item) continue;
      setField(item, "offer-name", `${row.name} · ${row.maker}`);
      setField(item, "offer-price", row.priceText);
      setField(item, "offer-summary", row.summary);
      setField(item, "offer-terms", row.termsText);
      setField(item, "offer-tradeoff", row.tradeoff);
      const conditions = item.querySelector<HTMLElement>('[data-field="offer-conditions"]');
      if (conditions) {
        conditions.replaceChildren(
          ...row.conditions.map((text) => {
            const line = document.createElement("li");
            line.textContent = text;
            return line;
          }),
        );
      }
      const action = item.querySelector<HTMLButtonElement>('[data-action="purchase"]');
      if (action) {
        action.disabled = row.refusal !== null;
        // A greyed button that says nothing is a bug, so the reason rides along.
        action.title = row.refusal ?? `Sign for ${row.name}`;
        action.dataset["refusal"] = row.refusal ?? "";
      }
    }
    const orders = element.querySelector<HTMLElement>('[data-field="market-orders"]');
    if (orders) {
      orders.replaceChildren(
        ...(panel.pending.length === 0 ? ["Nothing on order."] : panel.pending).map((text) => {
          const line = document.createElement("li");
          line.textContent = text;
          return line;
        }),
      );
    }
    setField(
      element,
      "market-fleet",
      panel.fleet.length === 0 ? "No machines assigned." : `Fleet: ${panel.fleet.join(", ")}`,
    );
    setField(element, "market-note", panel.note ?? "");
    return;
  }

  const fields = panel.kind === "berth" ? berthFields(panel) : connPodFields(panel);
  for (const [key, value] of fields) setField(element, key, value);
  if (panel.kind === "berth") {
    setField(element, "berth-notes", panel.notes);
    const progression = element.querySelector<HTMLElement>('[data-field="progression"]');
    if (progression && panel.progression) refreshProgression(progression, panel.progression);
    const crewSection = element.querySelector<HTMLElement>('[data-field="crew"]');
    if (crewSection && panel.crew) refreshCrew(crewSection, panel.crew);
  } else {
    setField(element, "conn-pod-notes", panel.readiness);
  }
}

function berthFields(panel: BerthPanelState): Array<[string, string]> {
  return [
    ["berth-jaeger", panel.jaegerName ?? "Berth empty"],
    ["berth-status", `${panel.status} · ${panel.integrityPercent}% structure`],
    [
      "berth-components",
      panel.components.length === 0
        ? "no record"
        : panel.components.map((entry) => `${entry.name} ${entry.percent}% ${entry.state}`).join(" · "),
    ],
    ["berth-offline", panel.offline.length === 0 ? "all systems answering" : panel.offline.join(", ")],
    [
      "berth-scars",
      panel.scars === 0 ? "unmarked" : `${panel.scars} ${panel.scars === 1 ? "mark" : "marks"}`,
    ],
    ["berth-work", panel.workOrder?.summary ?? "Nothing on the board."],
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
