/**
 * The hunt loop's screens: hangar home, hunt board, loadout, rewards, the
 * comms card and the machine picker. DOM only; the bootstrap feeds data and
 * handles every callback. Same visual system as opScreens.ts.
 */

import type { ScreenHandle } from "./opScreens";

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

function fact(key: string, value: string): HTMLElement {
  const cell = el("div");
  cell.append(el("div", "k", key), el("div", "v", value));
  return cell;
}

function screen(className: string): HTMLElement {
  const root = el("div", `op ${className}`);
  root.dataset["screen"] = className.split(" ")[0] ?? className;
  return root;
}

// -------------------------------------------------------------------- hangar

export interface HangarData {
  readonly machine: string;
  readonly mark: string;
  readonly level: number;
  readonly prestige: number;
  readonly experienceLine: string;
  readonly condition: number;
  readonly conditionLine: string;
  readonly pilots: string;
  readonly repairable: boolean;
  readonly deployable: boolean;
  readonly refusal: string | null;
  readonly rankLine: string;
}

export interface HangarCallbacks {
  onHunts: () => void;
  onJaegers: () => void;
  onLoadout: () => void;
  onUpgrades: () => void;
  onRecords: () => void;
  onTraining: () => void;
  onSettings: () => void;
  onRepair: () => void;
  onMenu: () => void;
}

export function renderHangar(
  container: HTMLElement,
  data: HangarData,
  callbacks: HangarCallbacks,
): ScreenHandle {
  const root = screen("hangar");
  const rail = el("div", "rail");
  rail.append(
    button("Hunts", "hunts", callbacks.onHunts, { primary: true }),
    button("Jaegers", "jaegers", callbacks.onJaegers),
    button("Loadout", "loadout", callbacks.onLoadout),
    button("Upgrades", "upgrades", callbacks.onUpgrades),
    button("Records", "records", callbacks.onRecords),
    button("Training", "training", callbacks.onTraining),
    el("div", "spacer"),
    button("Settings", "settings", callbacks.onSettings, { ghost: true }),
    button("Title", "exit-to-menu", callbacks.onMenu, { ghost: true, small: true }),
  );
  root.append(rail);

  const head = el("div", "head");
  head.append(el("h3", undefined, "Jaeger bay"), el("h1", undefined, data.machine));
  const facts = el("div", "facts");
  facts.append(
    fact("Mark", data.mark),
    fact("Level", String(data.level)),
    fact("Prestige", String(data.prestige)),
    fact("Pilots", data.pilots),
  );
  head.append(facts);
  head.append(el("div", "mono dim", data.experienceLine));
  root.append(head);

  const condition = el("div", "panel quiet condition");
  condition.append(el("h3", undefined, "Condition"));
  const meter = el("div", `meter ${data.condition < 0.4 ? "red" : data.condition < 0.8 ? "amber" : "green"}`);
  const fill = el("i");
  fill.style.width = `${Math.round(data.condition * 100)}%`;
  meter.appendChild(fill);
  condition.append(meter, el("div", "mono dim", data.conditionLine), el("div", "mono", data.rankLine));
  root.append(condition);

  const actions = el("div", "actions");
  actions.append(
    button("Repair", "repair", callbacks.onRepair, {
      disabled: !data.repairable,
      title: data.repairable ? undefined : "Nothing to repair",
    }),
    button("Upgrade", "upgrade", callbacks.onUpgrades),
    button("Change Jaeger", "jaegers", callbacks.onJaegers),
    button("Deploy", "deploy", callbacks.onHunts, {
      primary: true,
      disabled: !data.deployable,
      title: data.refusal ?? undefined,
    }),
  );
  root.append(actions);
  root.append(el("div", "hint", "Drag to orbit · wheel to zoom"));
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// ------------------------------------------------------------------- picker

export interface PickerOption {
  readonly id: string;
  readonly label: string;
  readonly line: string;
  readonly locked: boolean;
  readonly selected: boolean;
}

export function renderPicker(
  container: HTMLElement,
  title: string,
  options: readonly PickerOption[],
  onPick: (id: string) => void,
  onClose: () => void,
): ScreenHandle {
  const root = screen("overlay picker");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, title));
  const stack = el("div", "stack");
  for (const option of options) {
    const node = button(`${option.label}  ·  ${option.line}`, `pick-${option.id}`, () => onPick(option.id), {
      disabled: option.locked,
      ghost: !option.selected,
      title: option.locked ? "Not ready" : undefined,
    });
    node.dataset["machine"] = option.id;
    stack.append(node);
  }
  sheet.append(stack);
  const actions = el("div", "row");
  actions.style.marginTop = "12px";
  actions.append(button("Back", "close-picker", onClose, { ghost: true }));
  sheet.append(actions);
  root.append(sheet);
  container.appendChild(root);
  return { root, dispose: () => root.remove() };
}

// ------------------------------------------------------------------ upgrades

export interface UpgradeData {
  readonly machine: string;
  readonly level: number;
  readonly experienceLine: string;
  readonly choices: readonly { readonly id: string; readonly label: string; readonly note: string }[];
  readonly taken: readonly string[];
  readonly prestigeLine: string | null;
}

export function renderUpgrades(
  container: HTMLElement,
  data: UpgradeData,
  onChoose: (id: string) => void,
  onPrestige: (() => void) | null,
  onClose: () => void,
): ScreenHandle {
  const root = screen("overlay upgrades");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, "Upgrades"), el("h2", undefined, data.machine));
  sheet.append(el("div", "mono dim", `Level ${data.level} · ${data.experienceLine}`));
  sheet.append(el("div", "rule"));
  if (data.choices.length > 0) {
    sheet.append(el("h3", undefined, "Available now"));
    const stack = el("div", "stack");
    for (const choice of data.choices) {
      stack.append(
        button(`${choice.label} · ${choice.note}`, `choose-${choice.id}`, () => onChoose(choice.id), {
          primary: true,
        }),
      );
    }
    sheet.append(stack);
  } else {
    sheet.append(el("p", "dim", "Nothing to fit at this level. Hunt for the next one."));
  }
  if (data.taken.length > 0) {
    sheet.append(el("div", "rule"));
    sheet.append(el("h3", undefined, "Fitted"));
    const list = el("div", "mono dim");
    for (const item of data.taken) list.append(el("div", undefined, item));
    sheet.append(list);
  }
  if (data.prestigeLine) {
    sheet.append(el("div", "rule"));
    sheet.append(el("p", "mono amber", data.prestigeLine));
    if (onPrestige) sheet.append(button("Prestige", "prestige", onPrestige, { danger: true, small: true }));
  }
  const actions = el("div", "row");
  actions.style.marginTop = "12px";
  actions.append(button("Back", "close-upgrades", onClose, { ghost: true }));
  sheet.append(actions);
  root.append(sheet);
  container.appendChild(root);
  return { root, dispose: () => root.remove() };
}

// --------------------------------------------------------------------- hunts

export interface HuntTile {
  readonly id: string;
  readonly title: string;
  readonly location: string;
  readonly category: string;
  readonly recommendedLevel: number;
  readonly difficulty: string;
  readonly materials: readonly string[];
  readonly firstClear: string;
  readonly repeat: string;
  readonly traits: readonly string[];
  readonly weaknesses: readonly string[];
  readonly cleared: number;
  readonly bestGrade: string | null;
  readonly skyTop: string;
  readonly skyBottom: string;
  readonly locked: boolean;
}

export function renderHuntBoard(
  container: HTMLElement,
  tiles: readonly HuntTile[],
  onDeploy: (id: string) => void,
  onBack: () => void,
): ScreenHandle {
  const root = screen("hunts");
  const board = el("div", "panel board");
  const head = el("div", "row");
  head.style.justifyContent = "space-between";
  const heading = el("div");
  heading.append(el("h3", undefined, "Hunt board"), el("h2", undefined, "Choose your kaiju"));
  head.append(heading, button("Back to hangar", "back", onBack, { ghost: true, small: true }));
  board.append(head);
  const grid = el("div", "tiles");
  for (const tile of tiles) {
    const node = el("div", "tile");
    node.dataset["hunt"] = tile.id;
    const preview = el("div", "preview");
    const sky = el("div", "sky");
    sky.style.background = `linear-gradient(180deg, ${tile.skyTop}, ${tile.skyBottom})`;
    preview.append(sky, el("div", "skyline"));
    const tags = el("div", "tag-row");
    tags.append(el("span", "tag red", tile.category), el("span", "tag amber", tile.difficulty));
    if (tile.cleared > 0)
      tags.append(
        el("span", "tag cyan", `Cleared ${tile.cleared}${tile.bestGrade ? ` · best ${tile.bestGrade}` : ""}`),
      );
    preview.append(tags);
    node.append(preview);
    const body = el("div", "body");
    body.append(el("h2", undefined, tile.title), el("div", "where", tile.location));
    const facts = el("div", "facts");
    facts.append(
      fact("Level", `${tile.recommendedLevel}+`),
      fact("Difficulty", tile.difficulty),
      fact("Runs", String(tile.cleared)),
    );
    body.append(facts);
    const list = el("div", "list");
    const materials = el("div");
    materials.append(el("b", undefined, "Materials: "), document.createTextNode(tile.materials.join(", ")));
    const first = el("div");
    first.append(
      el("b", undefined, tile.cleared > 0 ? "Repeat: " : "First clear: "),
      document.createTextNode(tile.cleared > 0 ? tile.repeat : tile.firstClear),
    );
    const traits = el("div");
    traits.append(el("b", undefined, "Traits: "), document.createTextNode(tile.traits.join(" · ")));
    const weak = el("div");
    weak.append(
      el("b", undefined, "Weak to: "),
      document.createTextNode(tile.cleared > 0 ? tile.weaknesses.join(" · ") : "Unknown until fought"),
    );
    list.append(materials, first, traits, weak);
    body.append(list);
    const deploy = el("div", "deploy");
    deploy.append(
      button("Deploy", `deploy-${tile.id}`, () => onDeploy(tile.id), {
        primary: true,
        disabled: tile.locked,
        title: tile.locked ? "Bring a higher level" : undefined,
      }),
    );
    body.append(deploy);
    node.append(body);
    grid.append(node);
  }
  board.append(grid);
  root.append(board);
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// ------------------------------------------------------------------- loadout

export interface LoadoutData {
  readonly hunt: string;
  readonly location: string;
  readonly machine: string;
  readonly level: number;
  readonly pilots: string;
  readonly abilities: readonly { readonly key: string; readonly name: string; readonly note: string }[];
  readonly controls: readonly string[];
  readonly refusal: string | null;
}

export function renderLoadout(
  container: HTMLElement,
  data: LoadoutData,
  onDeploy: () => void,
  onChangeMachine: () => void,
  onBack: () => void,
): ScreenHandle {
  const root = screen("loadout");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, "Loadout"), el("h2", undefined, `${data.machine} · ${data.hunt}`));
  sheet.append(el("div", "mono cyan", `${data.location} · level ${data.level} · ${data.pilots}`));
  sheet.append(el("div", "rule"));
  const abilities = el("div", "ability-list");
  for (const ability of data.abilities) {
    const cell = el("div");
    cell.append(
      el("div", "key", ability.key),
      el("div", "name", ability.name),
      el("div", "note", ability.note),
    );
    abilities.append(cell);
  }
  sheet.append(abilities);
  sheet.append(el("div", "rule"));
  const controls = el("div", "mono dim");
  for (const line of data.controls) controls.append(el("div", undefined, line));
  sheet.append(controls);
  if (data.refusal) sheet.append(el("p", "mono red", data.refusal));
  const actions = el("div", "row");
  actions.style.justifyContent = "space-between";
  actions.style.marginTop = "14px";
  const left = el("div", "row");
  left.append(
    button("Back", "back", onBack, { ghost: true }),
    button("Change Jaeger", "jaegers", onChangeMachine, { ghost: true }),
  );
  const right = el("div", "row");
  right.append(button("Deploy", "confirm", onDeploy, { primary: true, disabled: data.refusal !== null }));
  actions.append(left, right);
  sheet.append(actions);
  root.append(sheet);
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}

// --------------------------------------------------------------------- comms

export interface CommsHandle extends ScreenHandle {
  say(who: string, initials: string, line: string): void;
  setStage(text: string): void;
}

export function renderComms(container: HTMLElement, stage: string, onSkip: () => void): CommsHandle {
  const root = screen("comms");
  root.append(el("div", "bar top"), el("div", "bar bottom"));
  const stageNode = el("div", "stage", stage);
  const card = el("div", "panel quiet card");
  const portrait = el("div", "portrait", "");
  const text = el("div");
  const who = el("div", "who", "");
  const line = el("div", "line", "");
  const wave = el("div", "wave");
  text.append(who, line, wave);
  card.append(portrait, text);
  card.dataset["field"] = "caption";
  const skip = button("Skip", "skip-cinematic", onSkip, { small: true, ghost: true });
  skip.style.position = "absolute";
  skip.style.right = "24px";
  skip.style.bottom = "3vh";
  root.append(stageNode, card, skip);
  container.appendChild(root);
  return {
    root,
    dispose: () => root.remove(),
    say(name, initials, spoken) {
      portrait.textContent = initials;
      who.textContent = name;
      line.textContent = spoken;
    },
    setStage(value) {
      stageNode.textContent = value;
    },
  };
}

// ------------------------------------------------------------------- rewards

export interface RewardsData {
  readonly grade: string;
  readonly outcome: string;
  readonly headline: string;
  readonly experienceGained: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly progress: number;
  readonly lines: readonly { readonly label: string; readonly value: string; readonly plus: boolean }[];
  readonly unlocked: readonly string[];
  readonly nextHunt: string | null;
}

export function renderRewards(
  container: HTMLElement,
  data: RewardsData,
  onReplay: () => void,
  onNext: (() => void) | null,
  onHangar: () => void,
): ScreenHandle {
  const root = screen("rewards");
  const sheet = el("div", "panel sheet");
  sheet.append(el("h3", undefined, "Hunt results"));
  const grade = el("div", "grade");
  grade.append(el("div", "letter", data.grade), el("div", "outcome", data.outcome));
  sheet.append(grade, el("p", "dim", data.headline));
  const xp = el("div", "xp");
  const lbl = el("div", "lbl");
  lbl.append(
    el(
      "span",
      undefined,
      `Level ${data.levelBefore}${data.levelAfter > data.levelBefore ? ` → ${data.levelAfter}` : ""}`,
    ),
    el("span", "green", `+${data.experienceGained} XP`),
  );
  const meter = el("div", "meter");
  const fill = el("i");
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, data.progress)) * 100)}%`;
  meter.appendChild(fill);
  xp.append(lbl, meter);
  sheet.append(xp);
  const lines = el("div", "lines");
  data.lines.forEach((entry, index) => {
    const line = el("div", "line");
    line.style.animationDelay = `${Math.min(1200, 80 * index)}ms`;
    line.dataset["field"] = "results-line";
    line.append(
      el("span", "dim", entry.label),
      el("span", `v ${entry.plus ? "plus" : ""}`.trim(), entry.value),
    );
    lines.append(line);
  });
  sheet.append(lines);
  if (data.unlocked.length > 0) {
    sheet.append(el("div", "rule"));
    sheet.append(el("h3", undefined, "Now available"));
    const list = el("div", "mono");
    for (const item of data.unlocked) list.append(el("div", undefined, item));
    sheet.append(list);
  }
  const actions = el("div", "actions");
  const left = el("div", "row");
  left.append(button("Replay", "replay", onReplay, { ghost: true }));
  if (onNext && data.nextHunt) left.append(button(`Next hunt: ${data.nextHunt}`, "next-hunt", onNext));
  const right = el("div", "row");
  right.append(button("Return to hangar", "close-results", onHangar, { primary: true }));
  actions.append(left, right);
  sheet.append(actions);
  root.append(sheet);
  sheet.addEventListener("click", () => {
    for (const line of sheet.querySelectorAll<HTMLElement>(".line")) line.style.animationDelay = "0ms";
  });
  container.appendChild(root);
  return { root, dispose: () => root.remove() };
}

export interface RecordsData {
  readonly hunts: readonly {
    readonly title: string;
    readonly location: string;
    readonly cleared: number;
    readonly best: string | null;
  }[];
  readonly machines: readonly {
    readonly name: string;
    readonly mark: string;
    readonly level: number;
    readonly prestige: number;
    readonly status: string;
  }[];
  readonly bestPrestige: number;
  readonly totalCleared: number;
}

/** The hunt log and the roster's standing: what has been cleared and by what. */
export function renderRecords(container: HTMLElement, data: RecordsData, onBack: () => void): ScreenHandle {
  const root = screen("records");
  const board = el("div", "panel board");
  const head = el("div", "row");
  head.style.justifyContent = "space-between";
  const heading = el("div");
  heading.append(el("h3", undefined, "Records"), el("h2", undefined, "Hunt log"));
  head.append(heading, button("Back to hangar", "back", onBack, { ghost: true, small: true }));
  board.append(head);
  const facts = el("div", "facts");
  facts.append(
    fact("Hunts cleared", String(data.totalCleared)),
    fact("Best prestige", String(data.bestPrestige)),
    fact("Machines", String(data.machines.length)),
  );
  board.append(facts);

  const hunts = el("div", "rows");
  hunts.append(el("h3", undefined, "Hunts"));
  const huntHead = el("div", "line head");
  huntHead.append(
    el("span", undefined, "Kaiju"),
    el("span", undefined, "Location"),
    el("span", undefined, "Cleared"),
    el("span", undefined, "Best"),
  );
  hunts.append(huntHead);
  for (const hunt of data.hunts) {
    const line = el("div", "line");
    line.dataset["record"] = hunt.title;
    line.append(
      el("span", "name", hunt.title),
      el("span", undefined, hunt.location),
      el("span", undefined, String(hunt.cleared)),
      el("span", hunt.best ? "grade" : undefined, hunt.best ?? "Not yet"),
    );
    hunts.append(line);
  }
  board.append(hunts);

  const machines = el("div", "rows");
  machines.append(el("h3", undefined, "Roster"));
  const machineHead = el("div", "line head");
  machineHead.append(
    el("span", undefined, "Jaeger"),
    el("span", undefined, "Mark"),
    el("span", undefined, "Level"),
    el("span", undefined, "Prestige"),
  );
  machines.append(machineHead);
  for (const machine of data.machines) {
    const line = el("div", "line");
    line.append(
      el("span", "name", machine.name),
      el("span", undefined, machine.mark),
      el("span", undefined, `${machine.level} · ${machine.status}`),
      el("span", undefined, String(machine.prestige)),
    );
    machines.append(line);
  }
  board.append(machines);

  root.append(board);
  container.replaceChildren(root);
  return { root, dispose: () => root.remove() };
}
