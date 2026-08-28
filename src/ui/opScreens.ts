/**
 * The production path screens.
 *
 * Title, command, briefing, bay, deployment cinematic, results, pause,
 * settings, credits and the alert band: one DOM module, one visual system
 * (theme.css), no game state of its own. Every screen takes plain data and
 * callbacks, renders into the interface root, and returns a handle the
 * bootstrap can update or dispose. Nothing here reads the simulation.
 *
 * Every control has hover, focus, press and disabled behaviour from the
 * stylesheet; every screen has a clear way back; every screen fits 1366x768.
 */

export interface ScreenHandle {
  readonly root: HTMLElement;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  label: string,
  action: string,
  onClick: () => void,
  options: {
    primary?: boolean;
    danger?: boolean;
    small?: boolean;
    ghost?: boolean;
    disabled?: boolean;
    title?: string;
  } = {},
): HTMLButtonElement {
  const node = el("button");
  node.type = "button";
  node.textContent = label;
  node.dataset["action"] = action;
  if (options.primary) node.classList.add("primary");
  if (options.danger) node.classList.add("danger");
  if (options.small) node.classList.add("small");
  if (options.ghost) node.classList.add("ghost");
  if (options.disabled) node.disabled = true;
  if (options.title) node.title = options.title;
  node.addEventListener("click", onClick);
  return node;
}

function kv(pairs: readonly (readonly [string, string])[]): HTMLElement {
  const grid = el("div", "kv");
  for (const [key, value] of pairs) {
    grid.append(el("span", "k", key), el("span", "v", value));
  }
  return grid;
}

function meter(fraction: number, tone: "" | "amber" | "red" | "green" = ""): HTMLElement {
  const track = el("div", `meter ${tone}`.trim());
  const fill = el("i");
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  track.appendChild(fill);
  return track;
}

function screen(className: string): HTMLElement {
  const root = el("div", `op ${className}`);
  root.dataset["screen"] = className.split(" ")[0] ?? className;
  return root;
}

// --------------------------------------------------------------------- title

export interface TitleData {
  readonly version: string;
  /** The latest save, if any: shown under Continue. */
  readonly continueSummary: string | null;
  readonly offlineNote: string | null;
  readonly updateMessage: string | null;
  readonly showUpdateOffer: boolean;
  /** Debug builds show the developer entries. */
  readonly debug: boolean;
}

export interface TitleCallbacks {
  onContinue: () => void;
  onNewOperation: () => void;
  onSettings: () => void;
  onCredits: () => void;
  onSaves: () => void;
  onApplyUpdate: () => void;
  onPostponeUpdate: () => void;
  onDeveloper: (which: "world" | "gallery" | "sandbox") => void;
}

export function renderTitle(
  container: HTMLElement,
  data: TitleData,
  callbacks: TitleCallbacks,
): ScreenHandle {
  const root = screen("title-screen");
  const menu = el("div", "menu");
  const title = el("h1");
  title.append("Pacific Rim:", el("br"), "Shatterdome Earth");
  menu.append(title);
  menu.append(el("div", "strap", "Pan Pacific Defense Corps // Private fan project"));
  const stack = el("div", "stack");
  if (data.continueSummary) {
    stack.append(button("Continue", "continue", callbacks.onContinue, { primary: true }));
    stack.append(el("div", "save-summary", data.continueSummary));
    stack.append(button("New Game", "new-game", callbacks.onNewOperation));
  } else {
    stack.append(button("New Game", "new-game", callbacks.onNewOperation, { primary: true }));
  }
  stack.append(button("Saves", "open-saves", callbacks.onSaves, { ghost: true }));
  stack.append(button("Settings", "settings", callbacks.onSettings, { ghost: true }));
  stack.append(button("Credits", "credits", callbacks.onCredits, { ghost: true }));
  if (data.debug) {
    stack.append(
      button("World map (dev)", "open-world", () => callbacks.onDeveloper("world"), {
        ghost: true,
        small: true,
      }),
    );
    stack.append(
      button("Simulator (dev)", "open-sandbox", () => callbacks.onDeveloper("sandbox"), {
        ghost: true,
        small: true,
      }),
    );
    stack.append(
      button("Asset gallery (dev)", "open-gallery", () => callbacks.onDeveloper("gallery"), {
        ghost: true,
        small: true,
      }),
    );
  }
  menu.append(stack);
  if (data.offlineNote) menu.append(el("div", "notice", data.offlineNote));
  root.append(menu);
  root.append(el("div", "version", data.version));
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// ------------------------------------------------------------------- command

export interface CommandMission {
  readonly id: string;
  readonly title: string;
  readonly where: string;
  readonly creature: string;
  readonly category: string;
  readonly timeLeft: string;
  readonly weather: string;
  readonly damageRisk: string;
  readonly reward: string;
  readonly summary: string;
  readonly deployable: boolean;
  readonly refusal: string | null;
}

export interface CommandData {
  readonly dateLine: string;
  readonly mission: CommandMission | null;
  readonly quietLines: readonly string[];
  readonly machineLine: string;
  readonly fundsLine: string;
}

export interface CommandCallbacks {
  onBrief: (missionId: string) => void;
  onBack: () => void;
  onSettings: () => void;
}

export function renderCommand(
  container: HTMLElement,
  data: CommandData,
  callbacks: CommandCallbacks,
): ScreenHandle {
  const root = screen("command");
  const sidebar = el("div", "sidebar");
  const head = el("div", "panel quiet");
  head.append(el("h3", undefined, "LOCCENT // Strategic picture"));
  head.append(el("div", "mono dim", data.dateLine));
  sidebar.append(head);

  const card = el("div", "panel mission-card");
  card.dataset["field"] = "mission-card";
  if (data.mission) {
    const mission = data.mission;
    const tags = el("div");
    tags.append(el("span", "tag red", "Breach event"), el("span", "tag amber", mission.category));
    card.append(tags);
    card.append(el("h2", undefined, mission.title));
    card.append(el("div", "where", mission.where));
    const threat = el("div", "threat");
    for (const [key, value] of [
      ["Time left", mission.timeLeft],
      ["Weather", mission.weather],
      ["Damage risk", mission.damageRisk],
    ] as const) {
      const cell = el("div");
      cell.append(el("div", "k", key), el("div", "v", value));
      threat.append(cell);
    }
    card.append(threat);
    card.append(
      kv([
        ["Creature", mission.creature],
        ["Reward", mission.reward],
      ]),
    );
    card.append(el("div", "rule"));
    card.append(el("p", "dim", mission.summary));
    const actions = el("div", "row");
    actions.style.marginTop = "12px";
    actions.append(
      button("Review briefing", "brief", () => callbacks.onBrief(mission.id), {
        primary: true,
        disabled: !mission.deployable,
        title: mission.refusal ?? undefined,
      }),
    );
    card.append(actions);
    if (mission.refusal) card.append(el("p", "mono red", mission.refusal));
  } else {
    card.append(el("h2", undefined, "No contact"));
    card.append(el("p", "dim", "The board is quiet. Time moves; the next breach will not wait."));
  }
  sidebar.append(card);
  root.append(sidebar);

  const top = el("div", "topbar");
  top.append(
    button("Settings", "settings", callbacks.onSettings, { ghost: true, small: true }),
    button("Back to the dome", "back", callbacks.onBack, { small: true }),
  );
  root.append(top);

  const status = el("div", "panel quiet status");
  status.append(el("h3", undefined, "Readiness"));
  status.append(el("div", "mono", data.machineLine));
  status.append(el("div", "mono dim", data.fundsLine));
  if (data.quietLines.length > 0) {
    status.append(el("div", "rule"));
    const list = el("div", "quiet-list");
    for (const line of data.quietLines) list.append(el("div", undefined, line));
    status.append(list);
  }
  root.append(status);
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// ------------------------------------------------------------------ briefing

export interface BriefingData {
  readonly title: string;
  readonly where: string;
  readonly creature: string;
  readonly category: string;
  readonly creatureNote: string;
  readonly weather: string;
  readonly water: string;
  readonly risk: string;
  readonly primaryObjective: string;
  readonly optionalObjective: string;
  readonly machine: string;
  readonly machineLine: string;
  readonly pilots: readonly [string, string];
  readonly driftLine: string;
  readonly benefit: string;
  readonly drawback: string;
  readonly rewards: readonly string[];
  readonly radio: readonly { readonly who: string; readonly line: string }[];
  readonly refusal: string | null;
}

export interface BriefingCallbacks {
  onBay: () => void;
  onDeploy: () => void;
  onBack: () => void;
}

export function renderBriefing(
  container: HTMLElement,
  data: BriefingData,
  callbacks: BriefingCallbacks,
): ScreenHandle {
  const root = screen("briefing");
  const sheet = el("div", "sheet");
  const head = el("div", "panel head");
  const heading = el("div");
  heading.append(el("h3", undefined, "Mission briefing"), el("h2", undefined, data.title));
  heading.append(el("div", "mono cyan", data.where));
  const tags = el("div");
  tags.append(el("span", "tag red", "Breach"), el("span", "tag amber", data.category));
  head.append(heading, tags);
  sheet.append(head);

  const situation = el("div", "panel");
  situation.append(el("h3", undefined, "Situation"));
  situation.append(
    kv([
      ["Creature", `${data.creature} (${data.category})`],
      ["Weather", data.weather],
      ["Water", data.water],
      ["Risk", data.risk],
    ]),
  );
  situation.append(el("div", "rule"));
  situation.append(el("p", "dim", data.creatureNote));
  situation.append(el("div", "rule"));
  const primary = el("p", "objective");
  primary.append(el("strong", undefined, "Primary. "), document.createTextNode(data.primaryObjective));
  const optional = el("p", "objective");
  optional.append(el("strong", undefined, "Optional. "), document.createTextNode(data.optionalObjective));
  situation.append(primary, optional);
  sheet.append(situation);

  const machine = el("div", "panel");
  machine.append(el("h3", undefined, "Assigned machine"));
  machine.append(el("h2", undefined, data.machine));
  machine.append(el("div", "mono dim", data.machineLine));
  machine.append(el("div", "rule"));
  machine.append(
    kv([
      ["Pilots", `${data.pilots[0]} and ${data.pilots[1]}`],
      ["Drift", data.driftLine],
      ["Benefit", data.benefit],
      ["Drawback", data.drawback],
    ]),
  );
  machine.append(el("div", "rule"));
  machine.append(el("h3", undefined, "Expected rewards"));
  const rewards = el("div", "mono");
  for (const reward of data.rewards) rewards.append(el("div", undefined, reward));
  machine.append(rewards);
  sheet.append(machine);

  const radio = el("div", "panel quiet");
  radio.style.gridColumn = "1 / -1";
  radio.append(el("h3", undefined, "Radio"));
  const lines = el("div", "radio");
  for (const entry of data.radio) {
    const line = el("div");
    line.append(el("b", undefined, `${entry.who}: `), document.createTextNode(entry.line));
    lines.append(line);
  }
  radio.append(lines);
  sheet.append(radio);

  const actions = el("div", "actions");
  const left = el("div", "row");
  left.append(button("Back", "back", callbacks.onBack, { ghost: true }));
  const right = el("div", "row");
  right.append(
    button("Inspect in the bay", "bay", callbacks.onBay),
    button("Deploy", "deploy", callbacks.onDeploy, {
      primary: true,
      disabled: data.refusal !== null,
      title: data.refusal ?? undefined,
    }),
  );
  actions.append(left, right);
  sheet.append(actions);
  if (data.refusal) {
    const note = el("p", "mono red");
    note.style.gridColumn = "1 / -1";
    note.textContent = data.refusal;
    sheet.append(note);
  }
  root.append(sheet);
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// ----------------------------------------------------------------------- bay

export interface BayLimb {
  readonly label: string;
  readonly fraction: number;
}

export interface BayData {
  readonly machine: string;
  readonly designation: string;
  readonly readinessLine: string;
  readonly readiness: number;
  readonly limbs: readonly BayLimb[];
  readonly pilots: readonly { readonly name: string; readonly role: string; readonly note: string }[];
  readonly weapons: readonly { readonly name: string; readonly state: string }[];
  readonly stats: readonly (readonly [string, string])[];
  readonly repairLine: string | null;
  readonly refusal: string | null;
  readonly options: readonly { readonly id: string; readonly label: string; readonly locked: boolean }[];
  readonly selectedId: string;
}

export interface BayCallbacks {
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function renderBay(container: HTMLElement, data: BayData, callbacks: BayCallbacks): ScreenHandle {
  const root = screen("bay");
  const left = el("div", "left");
  const name = el("div", "panel name");
  name.append(el("h3", undefined, "Jaeger bay"), el("h1", undefined, data.machine));
  name.append(el("div", "mono dim", data.designation));
  name.append(el("div", "rule"));
  name.append(el("div", "mono", data.readinessLine));
  const readiness = meter(
    data.readiness,
    data.readiness < 0.5 ? "red" : data.readiness < 0.8 ? "amber" : "green",
  );
  readiness.style.marginTop = "6px";
  name.append(readiness);
  if (data.repairLine) name.append(el("p", "mono amber", data.repairLine));
  left.append(name);

  const limbs = el("div", "panel quiet");
  limbs.append(el("h3", undefined, "Structure"));
  const grid = el("div", "limbs");
  for (const limb of data.limbs) {
    grid.append(
      el("span", "dim", limb.label),
      meter(limb.fraction, limb.fraction < 0.4 ? "red" : limb.fraction < 0.75 ? "amber" : ""),
      el("span", undefined, `${Math.round(limb.fraction * 100)}%`),
    );
  }
  limbs.append(grid);
  left.append(limbs);
  root.append(left);

  const right = el("div", "right");
  const pilots = el("div", "panel pilots");
  pilots.append(el("h3", undefined, "Pilots"));
  const pair = el("div", "pair");
  for (const pilot of data.pilots) {
    const cell = el("div");
    cell.append(
      el("div", "name", pilot.name),
      el("div", "mono dim", pilot.role),
      el("div", "mono", pilot.note),
    );
    pair.append(cell);
  }
  pilots.append(pair);
  right.append(pilots);

  const weapons = el("div", "panel quiet weapons");
  weapons.append(el("h3", undefined, "Weapons"));
  const list = el("ul");
  for (const weapon of data.weapons) {
    const item = el("li");
    item.append(el("span", undefined, weapon.name), el("span", "dim", weapon.state));
    list.append(item);
  }
  weapons.append(list);
  right.append(weapons);

  const stats = el("div", "panel quiet");
  stats.append(el("h3", undefined, "Core"));
  stats.append(kv(data.stats));
  right.append(stats);
  root.append(right);

  const bottom = el("div", "bottom");
  const options = el("div", "row");
  for (const option of data.options) {
    const node = button(option.label, `select-${option.id}`, () => callbacks.onSelect(option.id), {
      small: true,
      ghost: option.id !== data.selectedId,
      disabled: option.locked,
      title: option.locked ? "Not ready" : undefined,
    });
    node.dataset["machine"] = option.id;
    if (option.id === data.selectedId) node.setAttribute("aria-pressed", "true");
    options.append(node);
  }
  const actions = el("div", "row");
  actions.append(
    button("Back", "back", callbacks.onBack, { ghost: true }),
    button("Confirm and deploy", "confirm", callbacks.onConfirm, {
      primary: true,
      disabled: data.refusal !== null,
      title: data.refusal ?? undefined,
    }),
  );
  bottom.append(options, actions);
  root.append(bottom);
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// ----------------------------------------------------------------- cinematic

export interface CinematicHandle extends ScreenHandle {
  setCaption(who: string | null, line: string): void;
  setStage(text: string): void;
}

export function renderCinematic(container: HTMLElement, stage: string, onSkip: () => void): CinematicHandle {
  const root = screen("cinematic");
  root.append(el("div", "bar top"), el("div", "bar bottom"));
  const stageNode = el("div", "stage", stage);
  const caption = el("div", "caption");
  caption.dataset["field"] = "caption";
  root.append(stageNode, caption);
  root.append(button("Skip", "skip-cinematic", onSkip, { small: true, ghost: true }));
  root.classList.add("skip-host");
  root.querySelector("button")?.classList.add("skip");
  container.appendChild(root);
  return {
    root,
    dispose: () => root.remove(),
    setCaption(who, line) {
      caption.replaceChildren();
      if (who) caption.append(el("b", undefined, `${who}: `));
      caption.append(document.createTextNode(line));
    },
    setStage(text) {
      stageNode.textContent = text;
    },
  };
}

// ------------------------------------------------------------------- results

export interface ResultsLine {
  readonly label: string;
  readonly value: string;
  readonly tone: "plus" | "minus" | "";
}

export interface ResultsData {
  readonly grade: string;
  readonly outcome: string;
  readonly headline: string;
  readonly lines: readonly ResultsLine[];
  readonly consequences: readonly string[];
  readonly canReplay: boolean;
}

export interface ResultsCallbacks {
  onReturn: () => void;
  onReplay: () => void;
}

export function renderResults(
  container: HTMLElement,
  data: ResultsData,
  callbacks: ResultsCallbacks,
): ScreenHandle {
  const root = screen("results");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, "Sortie results"));
  const grade = el("div", "grade");
  grade.append(el("div", "letter", data.grade), el("div", "outcome", data.outcome));
  sheet.append(grade);
  sheet.append(el("p", "dim", data.headline));
  const lines = el("div", "lines");
  data.lines.forEach((entry, index) => {
    const line = el("div", "line");
    line.style.animationDelay = `${Math.min(1400, 90 * index)}ms`;
    line.dataset["field"] = "results-line";
    line.append(el("span", "dim", entry.label), el("span", `v ${entry.tone}`.trim(), entry.value));
    lines.append(line);
  });
  sheet.append(lines);
  if (data.consequences.length > 0) {
    sheet.append(el("div", "rule"));
    sheet.append(el("h3", undefined, "Back at the dome"));
    const list = el("div", "mono dim");
    for (const line of data.consequences) list.append(el("div", undefined, line));
    sheet.append(list);
  }
  const actions = el("div", "actions");
  const left = el("div", "row");
  if (data.canReplay) left.append(button("Replay the sortie", "replay", callbacks.onReplay, { ghost: true }));
  const right = el("div", "row");
  right.append(button("Return to the Shatterdome", "close-results", callbacks.onReturn, { primary: true }));
  actions.append(left, right);
  sheet.append(actions);
  root.append(sheet);
  // A click anywhere on the sheet finishes the reveal early.
  sheet.addEventListener("click", () => {
    for (const line of sheet.querySelectorAll<HTMLElement>(".line")) line.style.animationDelay = "0ms";
  });
  container.appendChild(root);
  return { root, dispose: () => root.remove() };
}

// -------------------------------------------------------------- pause/settings

export interface PauseCallbacks {
  onResume: () => void;
  onSettings: () => void;
  onSaves: () => void;
  onAbort: (() => void) | null;
  onMenu: () => void;
}

export function renderPause(container: HTMLElement, title: string, callbacks: PauseCallbacks): ScreenHandle {
  const root = screen("overlay pause");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, "Paused"), el("h2", undefined, title));
  const stack = el("div", "stack");
  stack.append(button("Resume", "resume", callbacks.onResume, { primary: true }));
  stack.append(button("Saves", "open-saves", callbacks.onSaves));
  stack.append(button("Settings", "settings", callbacks.onSettings));
  if (callbacks.onAbort)
    stack.append(button("Abort the sortie", "abort-mission", callbacks.onAbort, { danger: true }));
  stack.append(button("Back to menu", "exit-to-menu", callbacks.onMenu, { ghost: true }));
  sheet.append(stack);
  root.append(sheet);
  container.appendChild(root);
  return { root, dispose: () => root.remove() };
}

export interface SettingsSlider {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export interface SettingsData {
  readonly quality: { readonly value: string; readonly options: readonly (readonly [string, string])[] };
  readonly adaptive: boolean;
  readonly sliders: readonly SettingsSlider[];
  readonly toggles: readonly { readonly id: string; readonly label: string; readonly on: boolean }[];
}

export interface SettingsCallbacks {
  onQuality: (value: string) => void;
  onAdaptive: (on: boolean) => void;
  onSlider: (id: string, value: number) => void;
  onToggle: (id: string, on: boolean) => void;
  onClose: () => void;
}

export function renderSettings(
  container: HTMLElement,
  data: SettingsData,
  callbacks: SettingsCallbacks,
): ScreenHandle {
  const root = screen("overlay settings");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, "Settings"));
  const grid = el("div", "settings-grid");

  const qualityLabel = el("label", undefined, "Quality");
  const quality = el("select");
  quality.dataset["action"] = "quality";
  for (const [value, label] of data.quality.options) {
    const option = el("option", undefined, label);
    option.value = value;
    if (value === data.quality.value) option.selected = true;
    quality.append(option);
  }
  quality.addEventListener("change", () => callbacks.onQuality(quality.value));
  grid.append(qualityLabel, quality, el("span", "val", ""));

  const adaptiveLabel = el("label", undefined, "Adaptive quality");
  const adaptive = el("input");
  adaptive.type = "checkbox";
  adaptive.checked = data.adaptive;
  adaptive.dataset["action"] = "adaptive";
  adaptive.addEventListener("change", () => callbacks.onAdaptive(adaptive.checked));
  grid.append(adaptiveLabel, adaptive, el("span", "val", ""));

  for (const slider of data.sliders) {
    const label = el("label", undefined, slider.label);
    const input = el("input");
    input.type = "range";
    input.min = String(slider.min);
    input.max = String(slider.max);
    input.value = String(slider.value);
    input.dataset["field"] = slider.id;
    const value = el("span", "val", String(slider.value));
    input.addEventListener("input", () => {
      value.textContent = input.value;
      callbacks.onSlider(slider.id, Number(input.value));
    });
    grid.append(label, input, value);
  }
  for (const toggle of data.toggles) {
    const label = el("label", undefined, toggle.label);
    const input = el("input");
    input.type = "checkbox";
    input.checked = toggle.on;
    input.dataset["field"] = toggle.id;
    input.addEventListener("change", () => callbacks.onToggle(toggle.id, input.checked));
    grid.append(label, input, el("span", "val", ""));
  }
  sheet.append(grid);
  const actions = el("div", "row");
  actions.style.marginTop = "14px";
  actions.append(button("Done", "close-settings", callbacks.onClose, { primary: true }));
  sheet.append(actions);
  root.append(sheet);
  container.appendChild(root);
  return { root, dispose: () => root.remove() };
}

// ------------------------------------------------------------------- credits

export function renderCredits(
  container: HTMLElement,
  entries: readonly string[],
  onClose: () => void,
): ScreenHandle {
  const root = screen("credits");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, "Credits"));
  sheet.append(el("h2", undefined, "Pacific Rim: Shatterdome Earth"));
  sheet.append(
    el(
      "p",
      "dim",
      "A private fan project. No affiliation with anybody who owns Pacific Rim. Everything in it is original, procedurally generated, or listed below under a licence that allows it.",
    ),
  );
  const list = el("ul");
  for (const entry of entries) list.append(el("li", undefined, entry));
  sheet.append(list);
  const actions = el("div", "row");
  actions.style.marginTop = "14px";
  actions.append(button("Back", "close-credits", onClose, { primary: true }));
  sheet.append(actions);
  root.append(sheet);
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// ---------------------------------------------------------------- alert band

export function renderAlertBand(container: HTMLElement, text: string, onRespond: () => void): ScreenHandle {
  const root = screen("alert");
  const band = el("div", "alert-band");
  band.dataset["field"] = "alert-band";
  band.append(el("span", undefined, text));
  band.append(button("Respond", "alert-respond", onRespond, { small: true, primary: true }));
  root.append(band);
  container.appendChild(root);
  return { root, dispose: () => root.remove() };
}
