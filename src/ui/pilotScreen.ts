import type { CameraMode } from "../jaegers/camera";
import { COLOUR_VISION_PRESETS, TEXT_SCALES, SEVERITY_TOKENS, iconGlyph } from "./hudTokens";
import { type HudModel } from "./hudModel";
import { styleFor, type PresentationSettings } from "./presentation";
import type { PilotReadout } from "../jaegers/pilotSession";

/**
 * The pilot heads-up layer.
 *
 * A readout, the comfort controls and the camera selector. Every figure on it is
 * read back from the controller rather than requested, so the panel cannot claim
 * a state the machine is not in.
 *
 * The comfort controls are here rather than in a settings menu because they are
 * the ones a player reaches for while the camera is making them ill, which is
 * not the moment to go looking for a menu.
 */

export interface PilotViewStats {
  readonly decals: number;
  readonly decalCapacity: number;
  readonly scaleReferences: number;
  readonly dustParticles: number;
  readonly modelResolved: boolean;
  readonly soundDelaySeconds: number;
}

/** What the combat block shows. Null when nothing has been spawned to fight. */
export interface PilotCombatState {
  readonly targetName: string;
  readonly targetDistanceMeters: number;
  readonly lockedOn: boolean;
  readonly aimZoneId: string | null;
  readonly zones: readonly { readonly id: string; readonly health: number; readonly maxHealth: number }[];
  readonly stamina: number;
  readonly staminaMax: number;
  readonly heat: number;
  readonly overheated: boolean;
  readonly poise: number;
  readonly guarding: boolean;
  readonly activeMove: string | null;
  readonly activePhase: string | null;
  readonly buffered: readonly string[];
  readonly finisherOpen: boolean;
  readonly defeated: boolean;
  /** Newest first: tick, what connected, where, and for how much. */
  readonly hitLog: readonly string[];
  readonly debugVolumes: boolean;
  /** Combo, grapple and finisher state, in words. */
  readonly training: string;
  readonly comboHits: number;
  readonly bestCombo: number;
  readonly chargeProgress: number;
  readonly grapplePhase: string;
  readonly grappleStruggle: number;
  readonly finisherPhase: string;
  readonly holdingProp: string | null;
  readonly propSwingsLeft: number;
  /** Ranged loadout: what is carried, what is left in it, and what is ready. */
  readonly weapons: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly magazine: number;
    readonly magazineSize: number;
    /** How it is fed, so a heat weapon does not read as an empty magazine. */
    readonly feed: "rounds" | "heat" | "reactor";
    readonly reserve: number;
    readonly ready: boolean;
    readonly reloading: boolean;
    readonly channelling: boolean;
  }[];
  /** Status effects burning or shocking away on the target. */
  readonly targetStatuses: readonly string[];
  /**
   * What the creature is doing and why. Null before anything is fighting, so
   * the rows say nothing rather than implying an AI that is not running.
   */
  readonly creature: {
    readonly goal: string;
    readonly goalReason: string;
    readonly considered: readonly {
      readonly goal: string;
      readonly score: number;
      readonly reason: string;
    }[];
    readonly contacts: readonly {
      readonly sourceId: string;
      readonly kind: string;
      readonly confidence: number;
      readonly distanceMeters: number;
    }[];
    readonly medium: string;
    readonly navOutcome: string;
    readonly navReason: string;
    readonly speedMps: number;
    readonly phase: string;
    readonly abilities: readonly string[];
    readonly severed: readonly string[];
    readonly organs: readonly { readonly id: string; readonly fraction: number }[];
  } | null;
  readonly liveProjectiles: number;
  readonly projectileCapacity: number;
}

/** One row of the move list. Written from the move table, never hand-authored. */
export interface MoveListEntry {
  readonly id: string;
  readonly displayName: string;
  readonly group: string;
  /** How the player performs it, in the game's own control language. */
  readonly input: string;
  /** Plain language. No frame data, no jargon. */
  readonly coaching: string;
  /** Speed as a word rather than a tick count. */
  readonly speed: string;
}

/** What the machine is carrying from earlier fights, component by component. */
export interface PilotDamageState {
  readonly integrityPercent: number;
  readonly components: readonly { readonly name: string; readonly state: string; readonly percent: number }[];
  readonly offline: readonly string[];
  readonly scars: number;
  /** What the damage is doing to how it moves and hits, in words. */
  readonly mobility: string;
}

export interface PilotScreenState {
  readonly readout: PilotReadout;
  /** The HUD and how the player wants it drawn. Null before a machine is out. */
  readonly hud: HudLayerState | null;
  /** Null only before a machine is taken out. */
  readonly damage: PilotDamageState | null;
  readonly view: PilotViewStats | null;
  readonly groundHeightMeters: number | null;
  readonly headingErrorDeg: number;
  readonly blocked: boolean;
  readonly combat: PilotCombatState | null;
  /** The squad and the quick command, or null when nobody came with you. */
  readonly squad: SquadPanelState | null;
  /** The mixing desk, the subtitle band and the conversation record. */
  readonly audio: AudioPanelState | null;
}

/** One fader on the mixing desk. */
export interface AudioBusRow {
  readonly id: string;
  readonly label: string;
  /** 0 to 1, as the player set it. */
  readonly level: number;
  /** What lives on this bus, so nothing is a mystery slider. */
  readonly carries: string;
}

/** What is being said, if anything. */
export interface SubtitleRow {
  readonly callsign: string;
  readonly speakerName: string;
  readonly text: string;
  readonly priority: string;
  /** True when this line came in over the top of another one. */
  readonly interrupting: boolean;
}

/** Sound, as the player controls and reads it. */
export interface AudioPanelState {
  readonly buses: readonly AudioBusRow[];
  /** Whether volumes will actually be remembered, in words. */
  readonly note: string;
  /** Whether the browser let audio start at all. */
  readonly status: string;
  /** Null when nobody is speaking. */
  readonly subtitle: SubtitleRow | null;
  /** What the score is doing, for anybody who wants to know. */
  readonly music: string;
  /** What has been said, newest first. */
  readonly transcript: readonly string[];
}

/** One ally, as the squad readout shows them. */
export interface SquadMemberRow {
  readonly crewId: string;
  readonly callsign: string;
  /** What they are doing right now, in their own words. */
  readonly doing: string;
  /** The order standing over them. */
  readonly order: string;
  /** 0 to 100 of their machine's structure. */
  readonly integrityPercent: number;
  readonly down: boolean;
}

/** The squad, and the dial for telling it what to do. */
export interface SquadPanelState {
  readonly members: readonly SquadMemberRow[];
  /** Every order that can be given, with the key that gives it. */
  readonly orders: readonly { readonly id: string; readonly label: string; readonly hotkey: string }[];
  /** True while the dial is open. The fight keeps running either way. */
  readonly dialOpen: boolean;
  /** Radio traffic, newest first. */
  readonly log: readonly string[];
}

/** What the HUD layer needs, beyond what the panel already had. */
export interface HudLayerState {
  readonly model: HudModel;
  readonly settings: PresentationSettings;
  /** What the settings store said. Shown so persistence is never a mystery. */
  readonly note: string;
}

export interface PilotScreenCallbacks {
  readonly onCameraMode: (mode: CameraMode) => void;
  readonly onShakeScale: (value: number) => void;
  readonly onReducedMotion: (value: boolean) => void;
  readonly onInvertPitch: (value: boolean) => void;
  readonly onLockToggle: () => void;
  readonly onSwitchJaeger: (jaegerId: string) => void;
  /** Gives the whole squad an order. Never pauses the fight. */
  readonly onSquadOrder: (orderId: string) => void;
  /** Opens or closes the quick command dial. */
  readonly onToggleOrderDial: () => void;
  readonly onSpawnTarget: () => void;
  readonly onClearTarget: () => void;
  readonly onDebugVolumes: (enabled: boolean) => void;
  readonly onMoveList: (open: boolean) => void;
  readonly onHoldToComplete: (enabled: boolean) => void;
  readonly onSkipSequences: (enabled: boolean) => void;
  /** How far the ordinary interface fades. The critical layer ignores it. */
  readonly onHudOpacity: (value: number) => void;
  readonly onTextScale: (value: number) => void;
  readonly onHighContrast: (enabled: boolean) => void;
  readonly onColourVision: (preset: string) => void;
  readonly onSubtitles: (enabled: boolean) => void;
  /** Moves one fader. The mixer decides what that means for every other bus. */
  readonly onAudioLevel: (busId: string, level: number) => void;
  /** Opens or closes the conversation record. */
  readonly onTranscript: (open: boolean) => void;
  readonly onExit: () => void;
}

export interface PilotScreenHandle {
  update(state: PilotScreenState): void;
  dispose(): void;
}

export interface PilotRosterEntry {
  readonly id: string;
  readonly label: string;
}

const CAMERA_LABELS: Readonly<Record<CameraMode, string>> = {
  "third-person": "Chase",
  combat: "Combat",
  cockpit: "Conn-Pod",
};

/**
 * Draws the squad readout and the quick command dial.
 *
 * Rebuilt only when the squad itself changes and refreshed in place otherwise,
 * so a button is never torn out from under a pointer mid-fight. Nothing here
 * pauses anything: the dial shows keys that are live whether it is open or not.
 */
function refreshSquad(
  host: HTMLElement,
  state: SquadPanelState | null,
  callbacks: PilotScreenCallbacks,
): void {
  if (!state || state.members.length === 0) {
    host.hidden = true;
    host.replaceChildren();
    host.dataset["built"] = "";
    return;
  }
  host.hidden = false;

  const signature = `${state.members.map((member) => member.crewId).join(",")}|${state.dialOpen}`;
  if (host.dataset["built"] !== signature) {
    host.dataset["built"] = signature;
    host.replaceChildren();

    const heading = document.createElement("div");
    heading.className = "pilot-squad-head";
    const title = document.createElement("span");
    title.textContent = "Squad";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary-button";
    toggle.dataset["action"] = "toggle-orders";
    toggle.textContent = state.dialOpen ? "Close orders (Q)" : "Orders (Q)";
    toggle.addEventListener("click", () => callbacks.onToggleOrderDial());
    heading.append(title, toggle);
    host.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "pilot-squad-list";
    for (const member of state.members) {
      const item = document.createElement("li");
      item.dataset["crew"] = member.crewId;
      const name = document.createElement("span");
      name.className = "pilot-squad-name";
      name.dataset["field"] = "squad-name";
      const doing = document.createElement("span");
      doing.className = "pilot-squad-doing";
      doing.dataset["field"] = "squad-doing";
      item.append(name, doing);
      list.appendChild(item);
    }
    host.appendChild(list);

    if (state.dialOpen) {
      const dial = document.createElement("div");
      dial.className = "pilot-order-dial";
      dial.dataset["field"] = "order-dial";
      for (const order of state.orders) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.dataset["action"] = "squad-order";
        button.dataset["order"] = order.id;
        button.textContent = `${order.hotkey}  ${order.label}`;
        button.addEventListener("click", () => callbacks.onSquadOrder(order.id));
        dial.appendChild(button);
      }
      host.appendChild(dial);
    }

    const log = document.createElement("ul");
    log.className = "pilot-squad-log";
    log.dataset["field"] = "squad-log";
    log.setAttribute("aria-live", "polite");
    host.appendChild(log);
  }

  for (const member of state.members) {
    const item = host.querySelector<HTMLElement>(`[data-crew="${member.crewId}"]`);
    if (!item) continue;
    item.dataset["down"] = String(member.down);
    const name = item.querySelector<HTMLElement>('[data-field="squad-name"]');
    if (name) name.textContent = `${member.callsign} · ${member.integrityPercent}%`;
    const doing = item.querySelector<HTMLElement>('[data-field="squad-doing"]');
    if (doing) {
      doing.textContent = member.down ? "down" : `${member.doing} · order: ${member.order}`;
    }
  }

  const log = host.querySelector<HTMLElement>('[data-field="squad-log"]');
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

/** One reading on a strip: a glyph, a colour, a border, and the words. */
interface StripEntry {
  readonly key: string;
  readonly severity: keyof typeof SEVERITY_TOKENS;
  readonly text: string;
  readonly icon: string;
}

/**
 * Fills one strip of readings.
 *
 * Every entry carries the severity three ways: colour, glyph and border weight.
 * That is what makes the display work for a player who cannot separate the
 * hues, and what makes a grey screenshot still readable.
 */
function fillStrip(list: HTMLElement, entries: readonly StripEntry[], settings: PresentationSettings): void {
  list.replaceChildren(
    ...entries.map((entry) => {
      const token = SEVERITY_TOKENS[entry.severity];
      const style = styleFor(entry.severity, settings);
      const item = document.createElement("li");
      item.className = "pilot-hud-entry";
      item.dataset["severity"] = entry.severity;
      item.dataset["reading"] = entry.key;
      item.style.color = style.colour;
      item.style.borderLeftWidth = `${token.borderWidth}px`;
      item.style.opacity = String(style.opacity);
      item.style.transitionDuration = `${style.motionMs}ms`;

      const glyph = document.createElement("span");
      glyph.className = "pilot-hud-glyph";
      glyph.dataset["glyph"] = token.glyph;
      glyph.textContent = `${iconGlyph(entry.icon)}${token.glyph}`;
      const label = document.createElement("span");
      label.textContent = entry.text;
      item.append(glyph, label);
      return item;
    }),
  );
}

export function renderPilotScreen(
  container: HTMLElement,
  roster: readonly PilotRosterEntry[],
  moveList: readonly MoveListEntry[],
  callbacks: PilotScreenCallbacks,
): PilotScreenHandle {
  // Appended, never replacing: the world panel is still live behind this one and
  // clearing the container took the streaming readout down with it.
  const panel = document.createElement("div");
  panel.className = "screen screen-pilot";
  panel.id = "pilotScreen";

  // The squad readout and the quick command dial. Both live in the heads-up
  // layer and neither of them stops the fight: the dial is a list of keys that
  // are already live, shown so a player does not have to remember them.
  const squadPanel = document.createElement("div");
  squadPanel.className = "pilot-squad";
  squadPanel.dataset["field"] = "squad";
  squadPanel.hidden = true;

  const header = document.createElement("div");
  header.className = "pilot-header";
  const title = document.createElement("h2");
  title.dataset["field"] = "machine";
  title.textContent = "Jaeger";
  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "secondary-button";
  exit.dataset["action"] = "exit-pilot";
  exit.textContent = "Leave machine";
  exit.addEventListener("click", callbacks.onExit);
  header.append(title, exit);

  // Camera selector. Switching rigs must not disturb anything else, so these are
  // buttons that report the active rig rather than a control that owns state.
  const cameraRow = document.createElement("div");
  cameraRow.className = "pilot-row";
  const cameraLabel = document.createElement("span");
  cameraLabel.className = "pilot-row-label";
  cameraLabel.textContent = "Camera";
  cameraRow.appendChild(cameraLabel);
  const cameraButtons = new Map<CameraMode, HTMLButtonElement>();
  for (const mode of ["third-person", "combat", "cockpit"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset["action"] = `camera-${mode}`;
    button.textContent = CAMERA_LABELS[mode];
    button.addEventListener("click", () => callbacks.onCameraMode(mode));
    cameraButtons.set(mode, button);
    cameraRow.appendChild(button);
  }
  const lockButton = document.createElement("button");
  lockButton.type = "button";
  lockButton.className = "secondary-button";
  lockButton.dataset["action"] = "lock-toggle";
  lockButton.textContent = "Lock";
  lockButton.addEventListener("click", callbacks.onLockToggle);
  cameraRow.appendChild(lockButton);

  const rosterRow = document.createElement("div");
  rosterRow.className = "pilot-row";
  const rosterLabel = document.createElement("label");
  rosterLabel.textContent = "Machine";
  const rosterSelect = document.createElement("select");
  rosterSelect.dataset["field"] = "roster";
  for (const entry of roster) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    rosterSelect.appendChild(option);
  }
  rosterSelect.addEventListener("change", () => callbacks.onSwitchJaeger(rosterSelect.value));
  rosterLabel.appendChild(rosterSelect);
  rosterRow.appendChild(rosterLabel);

  const comfortRow = document.createElement("div");
  comfortRow.className = "pilot-row pilot-comfort";
  const shakeLabel = document.createElement("label");
  shakeLabel.textContent = "Camera motion";
  const shake = document.createElement("input");
  shake.type = "range";
  shake.min = "0";
  shake.max = "100";
  shake.value = "100";
  shake.dataset["field"] = "shake";
  shake.addEventListener("input", () => callbacks.onShakeScale(Number(shake.value) / 100));
  shakeLabel.appendChild(shake);

  const reducedLabel = document.createElement("label");
  const reduced = document.createElement("input");
  reduced.type = "checkbox";
  reduced.dataset["action"] = "reduced-motion";
  reduced.addEventListener("change", () => callbacks.onReducedMotion(reduced.checked));
  reducedLabel.append(reduced, document.createTextNode(" Reduced motion"));

  const invertLabel = document.createElement("label");
  const invert = document.createElement("input");
  invert.type = "checkbox";
  invert.dataset["action"] = "invert-pitch";
  invert.addEventListener("change", () => callbacks.onInvertPitch(invert.checked));
  invertLabel.append(invert, document.createTextNode(" Invert look"));

  // Two accessibility settings that belong next to the camera ones, because
  // they answer the same question: how much of this do you want to have to do.
  const holdLabel = document.createElement("label");
  const hold = document.createElement("input");
  hold.type = "checkbox";
  hold.checked = true;
  hold.dataset["action"] = "hold-to-complete";
  hold.addEventListener("change", () => callbacks.onHoldToComplete(hold.checked));
  holdLabel.append(hold, document.createTextNode(" Hold to complete"));

  const skipLabel = document.createElement("label");
  const skip = document.createElement("input");
  skip.type = "checkbox";
  skip.dataset["action"] = "skip-sequences";
  skip.addEventListener("change", () => callbacks.onSkipSequences(skip.checked));
  skipLabel.append(skip, document.createTextNode(" Skip finisher sequences"));

  comfortRow.append(shakeLabel, reducedLabel, invertLabel, holdLabel, skipLabel);

  const readout = document.createElement("div");
  readout.className = "world-readout pilot-readout";

  const rows = new Map<string, HTMLElement>();
  const addRow = (key: string, label: string): void => {
    const row = document.createElement("div");
    row.className = "world-row";
    const keyCell = document.createElement("span");
    keyCell.className = "world-key";
    keyCell.textContent = label;
    const valueCell = document.createElement("span");
    valueCell.className = "world-value";
    valueCell.dataset["field"] = key;
    row.append(keyCell, valueCell);
    readout.appendChild(row);
    rows.set(key, valueCell);
  };

  addRow("state", "State");
  addRow("speed", "Speed");
  addRow("heading", "Heading");
  addRow("ground", "Ground");
  addRow("water", "Water");
  addRow("booster", "Booster");
  addRow("stride", "Stride");
  addRow("camera", "Camera");
  addRow("comfort", "Comfort");
  addRow("buffer", "Buffer");
  addRow("scale", "Scale refs");
  addRow("damage", "Damage");
  addRow("systems", "Systems");

  // Combat block. Hidden until there is something to fight, because an empty
  // target readout would imply a system that is not running.
  const combatRow = document.createElement("div");
  combatRow.className = "pilot-row";
  const spawnButton = document.createElement("button");
  spawnButton.type = "button";
  spawnButton.className = "secondary-button";
  spawnButton.dataset["action"] = "spawn-target";
  spawnButton.textContent = "Spawn test kaiju";
  spawnButton.addEventListener("click", callbacks.onSpawnTarget);
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "secondary-button";
  clearButton.dataset["action"] = "clear-target";
  clearButton.textContent = "Clear";
  clearButton.addEventListener("click", callbacks.onClearTarget);
  const volumesLabel = document.createElement("label");
  const volumes = document.createElement("input");
  volumes.type = "checkbox";
  volumes.dataset["action"] = "debug-volumes";
  volumes.addEventListener("change", () => callbacks.onDebugVolumes(volumes.checked));
  volumesLabel.append(volumes, document.createTextNode(" Hit debug"));
  combatRow.append(spawnButton, clearButton, volumesLabel);

  const combat = document.createElement("div");
  combat.className = "world-readout pilot-readout";
  combat.dataset["section"] = "combat";
  combat.hidden = true;

  const combatRows = new Map<string, HTMLElement>();
  const addCombatRow = (key: string, label: string): void => {
    const row = document.createElement("div");
    row.className = "world-row";
    const keyCell = document.createElement("span");
    keyCell.className = "world-key";
    keyCell.textContent = label;
    const valueCell = document.createElement("span");
    valueCell.className = "world-value";
    valueCell.dataset["field"] = key;
    row.append(keyCell, valueCell);
    combat.appendChild(row);
    combatRows.set(key, valueCell);
  };
  addCombatRow("target", "Target");
  addCombatRow("target-zones", "Zones");
  addCombatRow("resources", "Resources");
  addCombatRow("move", "Move");
  addCombatRow("combat-buffer", "Buffer");
  addCombatRow("melee", "Melee");
  addCombatRow("ai-goal", "Kaiju goal");
  addCombatRow("ai-considered", "Considering");
  addCombatRow("ai-senses", "Senses");
  addCombatRow("ai-path", "Path");
  addCombatRow("ai-body", "Creature body");
  addCombatRow("weapons", "Weapons");
  addCombatRow("rounds", "Rounds");
  addCombatRow("training", "Coaching");

  const hitLog = document.createElement("ul");
  hitLog.className = "pilot-hitlog";
  hitLog.dataset["field"] = "hit-log";
  combat.appendChild(hitLog);

  // The move list. Built from the move table, so it can never describe a move
  // the game does not have, or miss one it does.
  const movesButton = document.createElement("button");
  movesButton.type = "button";
  movesButton.className = "secondary-button";
  movesButton.dataset["action"] = "move-list";
  movesButton.textContent = "Moves";
  combatRow.appendChild(movesButton);

  const moves = document.createElement("div");
  moves.className = "pilot-movelist";
  moves.dataset["section"] = "move-list";
  moves.hidden = true;
  let movesOpen = false;
  movesButton.addEventListener("click", () => {
    movesOpen = !movesOpen;
    moves.hidden = !movesOpen;
    movesButton.classList.toggle("is-active", movesOpen);
    callbacks.onMoveList(movesOpen);
  });

  const groups = new Map<string, MoveListEntry[]>();
  for (const entry of moveList) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry);
    groups.set(entry.group, list);
  }
  for (const [group, entries] of groups) {
    const heading = document.createElement("h3");
    heading.textContent = group;
    moves.appendChild(heading);
    const list = document.createElement("ul");
    for (const entry of entries) {
      const item = document.createElement("li");
      item.dataset["move"] = entry.id;
      const name = document.createElement("span");
      name.className = "pilot-move-name";
      name.textContent = `${entry.displayName} · ${entry.input} · ${entry.speed}`;
      const coaching = document.createElement("span");
      coaching.className = "pilot-move-coaching";
      coaching.textContent = entry.coaching;
      item.append(name, coaching);
      list.appendChild(item);
    }
    moves.appendChild(list);
  }

  const hint = document.createElement("p");
  hint.className = "pilot-hint";
  hint.textContent =
    "WASD drive · Shift run · Space booster · Q/E turn · Mouse or arrows look · C camera · T lock · M reduced motion · Esc leave. " +
    "Fight: 1 jab · 2 cross · 3 heavy · 4 launcher · 5 shoulder · 6 finisher · F guard · R aim mode. " +
    "Ranged: 7 plasma · 8 missiles · 9 mortar · 0 cannon · J whip · K sword · O booster strike · L reload";

  // The HUD. A separate layer from the panel below it, because the panel is a
  // dense readout for somebody who is looking, and this is what has to be
  // readable by somebody who is fighting.
  const hud = document.createElement("div");
  hud.className = "pilot-hud";
  hud.dataset["section"] = "hud";
  hud.hidden = true;

  // The critical band sits above everything and never fades. This is the one
  // rule the whole layer exists to keep.
  const criticalBand = document.createElement("div");
  criticalBand.className = "pilot-hud-critical";
  criticalBand.dataset["field"] = "hud-critical";

  const hudGrid = document.createElement("div");
  hudGrid.className = "pilot-hud-grid";

  const conditionStrip = document.createElement("ul");
  conditionStrip.className = "pilot-hud-strip";
  conditionStrip.dataset["field"] = "hud-condition";

  const targetStrip = document.createElement("ul");
  targetStrip.className = "pilot-hud-strip";
  targetStrip.dataset["field"] = "hud-target";

  const ammoStrip = document.createElement("ul");
  ammoStrip.className = "pilot-hud-strip";
  ammoStrip.dataset["field"] = "hud-ammo";

  const contextStrip = document.createElement("ul");
  contextStrip.className = "pilot-hud-strip";
  contextStrip.dataset["field"] = "hud-context";

  hudGrid.append(conditionStrip, targetStrip, ammoStrip, contextStrip);

  const cockpit = document.createElement("ul");
  cockpit.className = "pilot-cockpit";
  cockpit.dataset["field"] = "hud-instruments";

  // The subtitle band. Part of the HUD rather than a settings panel, because a
  // line nobody can hear is only useful where the player is already looking.
  const subtitleBand = document.createElement("div");
  subtitleBand.className = "pilot-subtitle";
  subtitleBand.dataset["field"] = "subtitle";
  subtitleBand.hidden = true;

  hud.append(criticalBand, subtitleBand, hudGrid, cockpit);

  // Display settings, next to the comfort ones because they answer the same
  // question: how do you want to be shown this.
  const displayRow = document.createElement("div");
  displayRow.className = "pilot-controls";
  displayRow.dataset["section"] = "display";

  const opacityLabel = document.createElement("label");
  opacityLabel.append(document.createTextNode("HUD "));
  const opacity = document.createElement("input");
  opacity.type = "range";
  opacity.min = "35";
  opacity.max = "100";
  opacity.value = "100";
  opacity.dataset["action"] = "hud-opacity";
  opacity.addEventListener("input", () => callbacks.onHudOpacity(Number(opacity.value) / 100));
  opacityLabel.appendChild(opacity);

  const textLabel = document.createElement("label");
  textLabel.append(document.createTextNode("Text "));
  const textSelect = document.createElement("select");
  textSelect.dataset["action"] = "text-scale";
  for (const scale of TEXT_SCALES) {
    const option = document.createElement("option");
    option.value = String(scale);
    option.textContent = `${Math.round(scale * 100)}%`;
    if (scale === 1) option.selected = true;
    textSelect.appendChild(option);
  }
  textSelect.addEventListener("change", () => callbacks.onTextScale(Number(textSelect.value)));
  textLabel.appendChild(textSelect);

  const contrastLabel = document.createElement("label");
  const contrast = document.createElement("input");
  contrast.type = "checkbox";
  contrast.dataset["action"] = "high-contrast";
  contrast.addEventListener("change", () => callbacks.onHighContrast(contrast.checked));
  contrastLabel.append(contrast, document.createTextNode(" High contrast"));

  const visionLabel = document.createElement("label");
  visionLabel.append(document.createTextNode("Colour "));
  const visionSelect = document.createElement("select");
  visionSelect.dataset["action"] = "colour-vision";
  for (const preset of COLOUR_VISION_PRESETS) {
    const option = document.createElement("option");
    option.value = preset;
    option.textContent = preset;
    visionSelect.appendChild(option);
  }
  visionSelect.addEventListener("change", () => callbacks.onColourVision(visionSelect.value));
  visionLabel.appendChild(visionSelect);

  const subtitleLabel = document.createElement("label");
  const subtitles = document.createElement("input");
  subtitles.type = "checkbox";
  subtitles.checked = true;
  subtitles.dataset["action"] = "subtitles";
  subtitles.addEventListener("change", () => callbacks.onSubtitles(subtitles.checked));
  subtitleLabel.append(subtitles, document.createTextNode(" Subtitles"));

  // Whether the preferences will actually be remembered. A browser that refuses
  // to store them says so here rather than surprising somebody after a reload.
  const displayNote = document.createElement("span");
  displayNote.className = "pilot-display-note";
  displayNote.dataset["field"] = "display-note";

  displayRow.append(opacityLabel, textLabel, contrastLabel, visionLabel, subtitleLabel, displayNote);

  // The mixing desk. One fader per bus, built from the bus list rather than
  // hand-written, so a bus added later cannot arrive without a control.
  const audioRow = document.createElement("div");
  audioRow.className = "pilot-controls";
  audioRow.dataset["section"] = "audio";

  const faders = document.createElement("div");
  faders.className = "pilot-faders";
  faders.dataset["field"] = "audio-buses";

  const audioNote = document.createElement("span");
  audioNote.className = "pilot-display-note";
  audioNote.dataset["field"] = "audio-note";

  const transcriptList = document.createElement("ol");
  transcriptList.className = "pilot-transcript";
  transcriptList.dataset["field"] = "transcript";
  transcriptList.hidden = true;

  const transcriptToggle = document.createElement("button");
  transcriptToggle.type = "button";
  transcriptToggle.dataset["action"] = "transcript";
  transcriptToggle.textContent = "Record";
  let transcriptOpen = false;
  transcriptToggle.addEventListener("click", () => {
    transcriptOpen = !transcriptOpen;
    callbacks.onTranscript(transcriptOpen);
    transcriptList.hidden = !transcriptOpen;
  });

  audioRow.append(faders, transcriptToggle, audioNote, transcriptList);

  panel.append(
    header,
    hud,
    cameraRow,
    displayRow,
    audioRow,
    rosterRow,
    comfortRow,
    combatRow,
    readout,
    combat,
    squadPanel,
    moves,
    hint,
  );
  container.appendChild(panel);

  let lastMode: CameraMode | null = null;

  return {
    update(state: PilotScreenState): void {
      // Sound first, because the subtitle band belongs to the HUD and has to be
      // drawn whether or not there is a machine out.
      const audio = state.audio;
      audioRow.hidden = audio === null;
      if (audio) {
        audioNote.textContent = `${audio.note} ${audio.status} · ${audio.music}`;
        // Rebuilt only when the set of buses changes, so a pointer is never
        // dragged out from under somebody mid-slide.
        const signature = audio.buses.map((bus) => bus.id).join("|");
        if (faders.dataset["signature"] !== signature) {
          faders.dataset["signature"] = signature;
          faders.replaceChildren(
            ...audio.buses.map((bus) => {
              const label = document.createElement("label");
              label.title = bus.carries;
              label.append(document.createTextNode(`${bus.label} `));
              const slider = document.createElement("input");
              slider.type = "range";
              slider.min = "0";
              slider.max = "100";
              slider.dataset["action"] = "audio-level";
              slider.dataset["bus"] = bus.id;
              slider.value = String(Math.round(bus.level * 100));
              slider.addEventListener("input", () =>
                callbacks.onAudioLevel(bus.id, Number(slider.value) / 100),
              );
              label.appendChild(slider);
              return label;
            }),
          );
        } else {
          for (const bus of audio.buses) {
            const slider = faders.querySelector<HTMLInputElement>(`input[data-bus="${bus.id}"]`);
            // Not while it is being dragged: writing to a slider under the
            // pointer fights the person holding it.
            if (slider && document.activeElement !== slider) {
              slider.value = String(Math.round(bus.level * 100));
            }
          }
        }

        transcriptList.replaceChildren(
          ...audio.transcript.map((line) => {
            const item = document.createElement("li");
            item.textContent = line;
            return item;
          }),
        );
      }

      // The HUD first, because it is the part that has to be right under
      // pressure. Everything below it is for somebody who has time to read.
      const layer = state.hud;
      hud.hidden = layer === null;
      if (layer) {
        const { model, settings } = layer;
        hud.style.setProperty("--hud-opacity", String(settings.hudOpacity));
        hud.style.setProperty("--hud-text-scale", String(settings.textScale));
        displayNote.textContent = layer.note;

        // The controls follow the stored settings rather than whatever the
        // markup happened to default to, so a restored preference is visible.
        opacity.value = String(Math.round(settings.hudOpacity * 100));
        textSelect.value = String(settings.textScale);
        contrast.checked = settings.highContrast;
        visionSelect.value = settings.colourVision;
        subtitles.checked = settings.subtitles;

        // The subtitle. Shown when somebody is speaking and the player has not
        // turned subtitles off, and never faded below the readable floor.
        const spoken = audio?.subtitle ?? null;
        subtitleBand.hidden = spoken === null || !settings.subtitles;
        if (spoken && settings.subtitles) {
          subtitleBand.dataset["priority"] = spoken.priority;
          subtitleBand.textContent = (spoken.interrupting ? "* " : "") + `${spoken.callsign}: ${spoken.text}`;
        } else {
          // Cleared as well as hidden. A hidden band still holding the last
          // thing anybody said is a finished line pretending it is not, and it
          // would flash back for a frame the next time the band is shown.
          subtitleBand.textContent = "";
        }

        // The critical band. Never faded, never hidden, and empty when there is
        // genuinely nothing critical rather than as a stylistic choice.
        const criticals = model.alerts.filter((alert) => alert.severity === "critical");
        criticalBand.hidden = criticals.length === 0;
        criticalBand.replaceChildren(
          ...criticals.map((alert) => {
            const style = styleFor("critical", settings);
            const item = document.createElement("div");
            item.className = "pilot-hud-alert";
            item.dataset["severity"] = "critical";
            item.dataset["alert"] = alert.id;
            item.style.color = style.colour;
            item.style.borderWidth = `${SEVERITY_TOKENS.critical.borderWidth}px`;
            item.style.opacity = String(style.opacity);
            // Glyph as well as colour, so the meaning survives without hue.
            const glyph = document.createElement("span");
            glyph.className = "pilot-hud-glyph";
            glyph.textContent = SEVERITY_TOKENS.critical.glyph;
            const label = document.createElement("span");
            label.textContent = `${alert.label} — ${alert.detail}`;
            item.append(glyph, label);
            return item;
          }),
        );

        fillStrip(
          conditionStrip,
          model.components.map((component) => ({
            key: component.id,
            severity: component.severity,
            text: `${component.name} ${component.offline ? "offline" : `${Math.round(component.fraction * 100)}%`}`,
            icon: "structure",
          })),
          settings,
        );

        fillStrip(
          targetStrip,
          model.targetZones.map((zone) => ({
            key: zone.id,
            severity: zone.severity,
            text: `${zone.aimed ? "▶ " : ""}${zone.id} ${Math.round(zone.fraction * 100)}%`,
            icon: "target",
          })),
          settings,
        );

        fillStrip(
          ammoStrip,
          model.weapons.map((weapon) => ({
            key: weapon.id,
            severity: weapon.severity,
            text: `${weapon.name} ${weapon.readout}`,
            icon: "ammunition",
          })),
          settings,
        );

        fillStrip(
          contextStrip,
          [
            { key: "objective", severity: "info" as const, text: model.objective, icon: "objective" },
            {
              key: "city",
              severity: model.citySafety.severity,
              text: `City ${model.citySafety.text}`,
              icon: "civilians",
            },
            ...(model.squadOrder
              ? [{ key: "squad", severity: "info" as const, text: model.squadOrder, icon: "squad" }]
              : []),
            ...model.abilities.map((ability, index) => ({
              key: `ability.${index}`,
              severity: "info" as const,
              text: ability,
              icon: "ability",
            })),
          ],
          settings,
        );

        fillStrip(
          cockpit,
          model.instruments.map((instrument) => ({
            key: instrument.id,
            severity: instrument.severity,
            text: `${instrument.label} ${instrument.value}`,
            icon: instrument.icon,
          })),
          settings,
        );
      }

      refreshSquad(squadPanel, state.squad, callbacks);
      const readoutValues = state.readout;
      title.textContent = `${readoutValues.jaegerName} · ${readoutValues.markDesignation}`;

      if (lastMode !== readoutValues.cameraMode) {
        lastMode = readoutValues.cameraMode;
        for (const [mode, button] of cameraButtons) {
          button.classList.toggle("is-active", mode === readoutValues.cameraMode);
        }
      }
      lockButton.classList.toggle("is-active", readoutValues.lockedTargetId !== null);

      const set = (key: string, text: string): void => {
        const cell = rows.get(key);
        if (cell) cell.textContent = text;
      };

      set(
        "state",
        `${readoutValues.state}${readoutValues.guarding ? ", guarding" : ""}${state.blocked ? ", blocked" : ""}` +
          `${readoutValues.legDisabled ? ", leg out" : ""}`,
      );
      set("speed", `${readoutValues.speedMps.toFixed(1)} of ${readoutValues.topSpeedMps.toFixed(0)} m/s`);
      // Lag is measured against where the player is looking rather than against
      // the steering intent, because the intent is null the moment the stick is
      // released and a lag that reads zero whenever you stop pushing is useless.
      const lagDeg = Math.abs(
        ((((readoutValues.cameraHeadingDeg - readoutValues.headingDeg) % 360) + 540) % 360) - 180,
      );
      set(
        "heading",
        `${readoutValues.headingDeg.toFixed(0)}° body, ${readoutValues.cameraHeadingDeg.toFixed(0)}° look, ` +
          `${lagDeg.toFixed(0)}° lag`,
      );
      set(
        "ground",
        state.groundHeightMeters === null
          ? `${readoutValues.altitudeMeters.toFixed(1)} m, ground not loaded`
          : `${readoutValues.altitudeMeters.toFixed(1)} m over ${state.groundHeightMeters.toFixed(1)} m` +
              `${readoutValues.grounded ? "" : ", airborne"}`,
      );
      set(
        "water",
        `${readoutValues.waterState}, ${(readoutValues.submergedFraction * 100).toFixed(0)}% submerged`,
      );
      set("booster", `${(readoutValues.boosterCharge * 100).toFixed(0)}% charged`);
      set("stride", `${(readoutValues.stridePhase * 100).toFixed(0)}% through stride`);
      set(
        "camera",
        `${CAMERA_LABELS[readoutValues.cameraMode]}${readoutValues.lockedTargetId ? `, locked on ${readoutValues.lockedTargetId}` : ", free"}` +
          `, impulse ${(readoutValues.impulse * 100).toFixed(0)}%`,
      );
      set(
        "comfort",
        `motion ${(readoutValues.shakeScale * 100).toFixed(0)}%${readoutValues.reducedMotion ? ", reduced" : ""}`,
      );
      set(
        "buffer",
        readoutValues.buffered.length === 0
          ? `empty, ${readoutValues.droppedPresses} expired`
          : `${readoutValues.buffered.join(", ")} pending, ${readoutValues.droppedPresses} expired`,
      );
      const combatState = state.combat;
      combat.hidden = combatState === null;
      if (combatState) {
        const setCombat = (key: string, text: string): void => {
          const cell = combatRows.get(key);
          if (cell) cell.textContent = text;
        };
        setCombat(
          "target",
          `${combatState.targetName}, ${combatState.targetDistanceMeters.toFixed(0)} m` +
            `${combatState.lockedOn ? ", locked" : ""}` +
            `${combatState.aimZoneId ? `, aiming ${combatState.aimZoneId}` : ""}` +
            `${combatState.defeated ? ", down" : combatState.finisherOpen ? ", finisher open" : ""}`,
        );
        setCombat(
          "target-zones",
          combatState.zones
            .map((zone) => `${zone.id} ${Math.round((zone.health / Math.max(1, zone.maxHealth)) * 100)}%`)
            .join(" · "),
        );
        setCombat(
          "resources",
          `stamina ${Math.round(combatState.stamina)}/${Math.round(combatState.staminaMax)} · ` +
            `heat ${Math.round(combatState.heat)}%${combatState.overheated ? " over" : ""} · ` +
            `poise ${Math.round(combatState.poise)}${combatState.guarding ? " · guarding" : ""}`,
        );
        setCombat(
          "move",
          combatState.activeMove ? `${combatState.activeMove} (${combatState.activePhase ?? "?"})` : "ready",
        );
        setCombat(
          "combat-buffer",
          combatState.buffered.length === 0 ? "empty" : combatState.buffered.join(", "),
        );
        setCombat(
          "melee",
          [
            combatState.comboHits > 1 ? `${combatState.comboHits} in a row` : "no combo",
            `best ${combatState.bestCombo}`,
            combatState.chargeProgress > 0
              ? `charging ${Math.round(combatState.chargeProgress * 100)}%`
              : null,
            combatState.grapplePhase === "held"
              ? `holding, ${Math.round(combatState.grappleStruggle * 100)}% loose`
              : null,
            combatState.finisherPhase !== "idle" ? `finisher ${combatState.finisherPhase}` : null,
            combatState.holdingProp
              ? `${combatState.holdingProp}, ${combatState.propSwingsLeft} swings left`
              : null,
          ]
            .filter((part) => part !== null)
            .join(" · "),
        );
        const ai = combatState.creature;
        setCombat("ai-goal", ai === null ? "not running" : `${ai.goal} — ${ai.goalReason}`);
        setCombat(
          "ai-considered",
          ai === null
            ? "-"
            : ai.considered.length === 0
              ? "nothing wants anything"
              : ai.considered
                  .slice(0, 4)
                  .map((entry) => `${entry.goal} ${Math.round(entry.score)}`)
                  .join(" · "),
        );
        setCombat(
          "ai-senses",
          ai === null
            ? "-"
            : ai.contacts.length === 0
              ? "nothing sensed"
              : ai.contacts
                  .map(
                    (contact) =>
                      `${contact.sourceId} by ${contact.kind} ${Math.round(contact.confidence * 100)}% at ${Math.round(contact.distanceMeters)} m`,
                  )
                  .join(" · "),
        );
        setCombat(
          "ai-path",
          ai === null
            ? "-"
            : `${ai.navOutcome} in ${ai.medium} at ${ai.speedMps.toFixed(1)} m/s — ${ai.navReason}`,
        );
        setCombat(
          "ai-body",
          ai === null
            ? "-"
            : [
                ai.phase,
                ai.abilities.length === 0 ? "no abilities left" : ai.abilities.join(", "),
                ai.severed.length > 0 ? `severed: ${ai.severed.join(", ")}` : null,
                ...ai.organs.map(
                  (organ) => `${organ.id.replace("organ.", "")} ${Math.round(organ.fraction * 100)}%`,
                ),
              ]
                .filter((part) => part !== null)
                .join(" · "),
        );
        setCombat(
          "weapons",
          combatState.weapons.length === 0
            ? "none carried"
            : combatState.weapons
                .map((weapon) => {
                  const ammunition =
                    weapon.magazineSize > 0
                      ? `${weapon.magazine}/${weapon.magazineSize} (${weapon.reserve} spare)`
                      : weapon.feed === "heat"
                        ? "heat fed"
                        : "reactor fed";
                  const state = weapon.reloading
                    ? "reloading"
                    : weapon.channelling
                      ? "running"
                      : weapon.ready
                        ? "ready"
                        : "cooling";
                  return `${weapon.displayName}: ${ammunition}, ${state}`;
                })
                .join(" · "),
        );
        setCombat(
          "rounds",
          `${combatState.liveProjectiles}/${combatState.projectileCapacity} in the air` +
            (combatState.targetStatuses.length > 0
              ? ` · target ${combatState.targetStatuses.join(", ")}`
              : ""),
        );
        setCombat("training", combatState.training || "-");
        hitLog.replaceChildren();
        for (const line of combatState.hitLog) {
          const item = document.createElement("li");
          item.textContent = line;
          hitLog.appendChild(item);
        }
        volumes.checked = combatState.debugVolumes;
      }

      const damage = state.damage;
      const hurt = (damage?.components ?? []).filter((entry) => entry.percent < 100);
      set(
        "damage",
        damage === null
          ? "no record"
          : hurt.length === 0
            ? `${damage.integrityPercent}% structure, nothing marked`
            : `${damage.integrityPercent}% structure · ` +
              hurt.map((entry) => `${entry.name} ${entry.percent}% ${entry.state}`).join(" · "),
      );
      set(
        "systems",
        damage === null
          ? "-"
          : [
              damage.offline.length === 0 ? "all answering" : `offline: ${damage.offline.join(", ")}`,
              // The mobility line only earns its place when it says something the
              // offline list has not already said.
              damage.mobility === "all systems answering" ? null : damage.mobility,
              damage.scars > 0 ? `${damage.scars} ${damage.scars === 1 ? "mark" : "marks"}` : null,
            ]
              .filter((part) => part !== null)
              .join(" · "),
      );

      set(
        "scale",
        state.view === null
          ? "no view"
          : `${state.view.scaleReferences} refs, ${state.view.decals}/${state.view.decalCapacity} prints, ` +
              `${state.view.dustParticles} dust, sound +${state.view.soundDelaySeconds.toFixed(2)} s` +
              `${state.view.modelResolved ? "" : ", placeholder body"}`,
      );
    },
    dispose(): void {
      panel.remove();
    },
  };
}
