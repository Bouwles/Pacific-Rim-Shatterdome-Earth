import { AI_AGGRESSION, CITY_DAMAGE_PRESETS, WATER_STATES, type SandboxScenario } from "../sandbox/scenario";
import { SANDBOX_RULE_DEFINITIONS, type SandboxRuleId, type SandboxRules } from "../sandbox/rules";

/**
 * The sandbox: a screen for building a fight rather than being given one.
 *
 * Everything on it is built from the game's own tables. The region list is the
 * region registry, the creature list is the kaiju registry, the toggles are the
 * rule definitions. Nothing here hard-codes a name, which is what makes "spawn
 * any unlocked unit" true without anybody editing a file.
 *
 * The advanced panel is closed by default and holds exactly what belongs there:
 * the debug drawing. Everything else is a normal player-facing option, so the
 * ordinary sandbox stays a game rather than a developer tool.
 *
 * Presentation only. It draws what it is handed and reports what was pressed.
 */

/** An option in one of the pickers, as the screen shows it. */
export interface SandboxOption {
  readonly id: string;
  readonly label: string;
}

export interface SandboxScreenState {
  readonly scenario: SandboxScenario;
  readonly rules: SandboxRules;
  /** Everything wrong with the scenario, in sentences. Empty means it will run. */
  readonly problems: readonly string[];
  /** Saved scenarios, newest last. */
  readonly library: readonly { readonly id: string; readonly name: string; readonly note: string }[];
  /** What the library store said. */
  readonly libraryNote: string;
  /** The scoreboard, in words. */
  readonly statsNote: string;
  /** Import and export text, shared by both directions. */
  readonly transferText: string;
  readonly transferNote: string;
  /** Whether the advanced panel is open. */
  readonly advancedOpen: boolean;
  readonly regions: readonly SandboxOption[];
  readonly weathers: readonly SandboxOption[];
  readonly objectives: readonly SandboxOption[];
  readonly difficulties: readonly SandboxOption[];
  readonly chassis: readonly SandboxOption[];
  readonly creatures: readonly SandboxOption[];
}

export interface SandboxScreenCallbacks {
  /** One path for every edit, so nothing changes a scenario without validating it. */
  readonly onChange: (change: Partial<SandboxScenario>) => void;
  readonly onRule: (id: SandboxRuleId, on: boolean) => void;
  readonly onAdvanced: (open: boolean) => void;
  readonly onSave: () => void;
  readonly onLoad: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onExport: () => void;
  readonly onImport: (text: string) => void;
  readonly onRun: () => void;
  readonly onExit: () => void;
}

export interface SandboxScreenHandle {
  update(state: SandboxScreenState): void;
  dispose(): void;
}

function clear(container: HTMLElement): void {
  while (container.firstChild) container.removeChild(container.firstChild);
}

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(document.createTextNode(`${text} `), control);
  return label;
}

function select(field: string, onChange: (value: string) => void): HTMLSelectElement {
  const element = document.createElement("select");
  element.dataset["field"] = field;
  element.addEventListener("change", () => onChange(element.value));
  return element;
}

function fill(element: HTMLSelectElement, options: readonly SandboxOption[], selected: string): void {
  const signature = options.map((option) => option.id).join("|");
  if (element.dataset["signature"] !== signature) {
    element.dataset["signature"] = signature;
    element.replaceChildren(
      ...options.map((option) => {
        const node = document.createElement("option");
        node.value = option.id;
        node.textContent = option.label;
        return node;
      }),
    );
  }
  if (element.value !== selected) element.value = selected;
}

export function renderSandboxScreen(
  container: HTMLElement,
  callbacks: SandboxScreenCallbacks,
): SandboxScreenHandle {
  clear(container);
  const panel = document.createElement("div");
  panel.className = "screen screen-sandbox";
  panel.id = "sandboxScreen";

  const heading = document.createElement("h2");
  heading.textContent = "Simulator";
  const blurb = document.createElement("p");
  blurb.className = "sandbox-blurb";
  blurb.textContent =
    "Build a fight. Nothing here costs anything, nothing here is earned, and none of it reaches a campaign.";

  // ------------------------------- the fight -------------------------------
  const place = document.createElement("div");
  place.className = "sandbox-row";
  place.dataset["section"] = "place";

  const regionSelect = select("region", (value) => callbacks.onChange({ regionId: value }));
  const weatherSelect = select("weather", (value) =>
    callbacks.onChange({ weather: value as SandboxScenario["weather"] }),
  );
  const waterSelect = select("water", (value) =>
    callbacks.onChange({ water: value as SandboxScenario["water"] }),
  );
  const timeInput = document.createElement("input");
  timeInput.type = "range";
  timeInput.min = "0";
  timeInput.max = "100";
  timeInput.dataset["field"] = "time";
  timeInput.addEventListener("input", () =>
    callbacks.onChange({ dayFraction: Number(timeInput.value) / 100 }),
  );

  place.append(
    labelled("Region", regionSelect),
    labelled("Weather", weatherSelect),
    labelled("Water", waterSelect),
    labelled("Time", timeInput),
  );

  const forces = document.createElement("div");
  forces.className = "sandbox-row";
  forces.dataset["section"] = "forces";

  const chassisSelect = select("chassis", (value) =>
    callbacks.onChange({ squad: [{ chassisId: value, pilotIds: [] }] }),
  );
  const creatureSelect = select("creature", (value) =>
    callbacks.onChange({
      waves: [{ combatants: [{ kaijuId: value, mutationIds: [] }], delaySeconds: 0 }],
    }),
  );
  const objectiveSelect = select("objective", (value) =>
    callbacks.onChange({ objective: value as SandboxScenario["objective"] }),
  );
  const difficultySelect = select("difficulty", (value) =>
    callbacks.onChange({ difficulty: value as SandboxScenario["difficulty"] }),
  );
  const damageSelect = select("city-damage", (value) =>
    callbacks.onChange({ cityDamage: value as SandboxScenario["cityDamage"] }),
  );
  const aggressionSelect = select("aggression", (value) =>
    callbacks.onChange({ aggression: value as SandboxScenario["aggression"] }),
  );

  forces.append(
    labelled("Machine", chassisSelect),
    labelled("Creature", creatureSelect),
    labelled("Objective", objectiveSelect),
    labelled("Difficulty", difficultySelect),
    labelled("City", damageSelect),
    labelled("Aggression", aggressionSelect),
  );

  // -------------------------------- the rules ------------------------------
  const rulesRow = document.createElement("div");
  rulesRow.className = "sandbox-row";
  rulesRow.dataset["section"] = "rules";

  const ruleBoxes = new Map<SandboxRuleId, HTMLInputElement>();
  for (const rule of SANDBOX_RULE_DEFINITIONS.filter((entry) => !entry.advanced)) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset["rule"] = rule.id;
    box.addEventListener("change", () => callbacks.onRule(rule.id, box.checked));
    const label = document.createElement("label");
    label.title = rule.effect;
    label.append(box, document.createTextNode(` ${rule.displayName}`));
    rulesRow.appendChild(label);
    ruleBoxes.set(rule.id, box);
  }

  // Advanced, closed by default: a tool rather than a toy, and leaving it in the
  // ordinary list would make the normal sandbox look like a developer build.
  const advanced = document.createElement("details");
  advanced.className = "sandbox-advanced";
  advanced.dataset["section"] = "advanced";
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = "Advanced";
  advanced.appendChild(advancedSummary);
  advanced.addEventListener("toggle", () => callbacks.onAdvanced(advanced.open));
  for (const rule of SANDBOX_RULE_DEFINITIONS.filter((entry) => entry.advanced)) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset["rule"] = rule.id;
    box.addEventListener("change", () => callbacks.onRule(rule.id, box.checked));
    const label = document.createElement("label");
    label.title = rule.effect;
    label.append(box, document.createTextNode(` ${rule.displayName}`));
    advanced.appendChild(label);
    ruleBoxes.set(rule.id, box);
  }

  // ------------------------------ the library ------------------------------
  const libraryRow = document.createElement("div");
  libraryRow.className = "sandbox-row";
  libraryRow.dataset["section"] = "library";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.dataset["field"] = "name";
  nameInput.addEventListener("change", () => callbacks.onChange({ name: nameInput.value }));

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.dataset["action"] = "save";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => callbacks.onSave());

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.dataset["action"] = "export";
  exportButton.textContent = "Export";
  exportButton.addEventListener("click", () => callbacks.onExport());

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.dataset["action"] = "import";
  importButton.textContent = "Import";
  importButton.addEventListener("click", () => callbacks.onImport(transferBox.value));

  const transferBox = document.createElement("textarea");
  transferBox.dataset["field"] = "transfer";
  transferBox.rows = 3;
  transferBox.placeholder = "Exported scenarios appear here. Paste one in and press Import.";

  const transferNote = document.createElement("span");
  transferNote.className = "sandbox-note";
  transferNote.dataset["field"] = "transfer-note";

  const savedList = document.createElement("ul");
  savedList.className = "sandbox-library";
  savedList.dataset["field"] = "saved";

  libraryRow.append(
    labelled("Name", nameInput),
    saveButton,
    exportButton,
    importButton,
    transferNote,
    transferBox,
    savedList,
  );

  // ------------------------------ the verdict ------------------------------
  const problems = document.createElement("ul");
  problems.className = "sandbox-problems";
  problems.dataset["field"] = "problems";

  const statsNote = document.createElement("p");
  statsNote.className = "sandbox-note";
  statsNote.dataset["field"] = "stats";

  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.className = "primary-button";
  runButton.dataset["action"] = "run";
  runButton.textContent = "Run it";
  runButton.addEventListener("click", () => callbacks.onRun());

  const exitButton = document.createElement("button");
  exitButton.type = "button";
  exitButton.dataset["action"] = "exit";
  exitButton.textContent = "Back to Menu";
  exitButton.addEventListener("click", () => callbacks.onExit());

  const footer = document.createElement("div");
  footer.className = "sandbox-row";
  footer.append(runButton, exitButton);

  panel.append(heading, blurb, place, forces, rulesRow, advanced, libraryRow, problems, statsNote, footer);
  container.appendChild(panel);

  return {
    update(state: SandboxScreenState): void {
      const scenario = state.scenario;
      fill(regionSelect, state.regions, scenario.regionId);
      fill(weatherSelect, state.weathers, scenario.weather);
      fill(
        waterSelect,
        WATER_STATES.map((id) => ({ id, label: id.replace("-", " ") })),
        scenario.water,
      );
      fill(chassisSelect, state.chassis, scenario.squad[0]?.chassisId ?? "");
      fill(creatureSelect, state.creatures, scenario.waves[0]?.combatants[0]?.kaijuId ?? "");
      fill(objectiveSelect, state.objectives, scenario.objective);
      fill(difficultySelect, state.difficulties, scenario.difficulty);
      fill(
        damageSelect,
        CITY_DAMAGE_PRESETS.map((id) => ({ id, label: id.replace("-", " ") })),
        scenario.cityDamage,
      );
      fill(
        aggressionSelect,
        AI_AGGRESSION.map((id) => ({ id, label: id })),
        scenario.aggression,
      );
      // Not while it is being dragged: writing to a control under the pointer
      // fights the person holding it.
      if (document.activeElement !== timeInput) {
        timeInput.value = String(Math.round(scenario.dayFraction * 100));
      }
      if (document.activeElement !== nameInput) nameInput.value = scenario.name;

      for (const [id, box] of ruleBoxes) box.checked = state.rules[id];
      if (advanced.open !== state.advancedOpen) advanced.open = state.advancedOpen;

      // Every reason it will not run, listed rather than summarised, because a
      // scenario usually has one fixable problem and hiding the others means
      // fixing them one reload at a time.
      problems.replaceChildren(
        ...state.problems.map((problem) => {
          const item = document.createElement("li");
          item.textContent = problem;
          return item;
        }),
      );
      problems.hidden = state.problems.length === 0;
      runButton.disabled = state.problems.length > 0;
      runButton.title = state.problems.length > 0 ? "Fix what is listed below first." : "Start this fight.";

      savedList.replaceChildren(
        ...state.library.map((saved) => {
          const item = document.createElement("li");
          const load = document.createElement("button");
          load.type = "button";
          load.dataset["action"] = "load";
          load.dataset["scenario"] = saved.id;
          load.textContent = saved.name;
          load.addEventListener("click", () => callbacks.onLoad(saved.id));
          const remove = document.createElement("button");
          remove.type = "button";
          remove.dataset["action"] = "delete";
          remove.dataset["scenario"] = saved.id;
          remove.textContent = "Delete";
          remove.addEventListener("click", () => callbacks.onDelete(saved.id));
          const note = document.createElement("span");
          note.textContent = saved.note;
          item.append(load, remove, note);
          return item;
        }),
      );

      transferNote.textContent = `${state.libraryNote} ${state.transferNote}`.trim();
      if (state.transferText && transferBox.value !== state.transferText) {
        transferBox.value = state.transferText;
      }
      statsNote.textContent = state.statsNote;
    },
    dispose(): void {
      clear(container);
    },
  };
}
