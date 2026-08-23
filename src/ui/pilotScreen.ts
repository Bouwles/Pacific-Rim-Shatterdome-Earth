import type { CameraMode } from "../jaegers/camera";
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
}

export interface PilotScreenState {
  readonly readout: PilotReadout;
  readonly view: PilotViewStats | null;
  readonly groundHeightMeters: number | null;
  readonly headingErrorDeg: number;
  readonly blocked: boolean;
  readonly combat: PilotCombatState | null;
}

export interface PilotScreenCallbacks {
  readonly onCameraMode: (mode: CameraMode) => void;
  readonly onShakeScale: (value: number) => void;
  readonly onReducedMotion: (value: boolean) => void;
  readonly onInvertPitch: (value: boolean) => void;
  readonly onLockToggle: () => void;
  readonly onSwitchJaeger: (jaegerId: string) => void;
  readonly onSpawnTarget: () => void;
  readonly onClearTarget: () => void;
  readonly onDebugVolumes: (enabled: boolean) => void;
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

export function renderPilotScreen(
  container: HTMLElement,
  roster: readonly PilotRosterEntry[],
  callbacks: PilotScreenCallbacks,
): PilotScreenHandle {
  // Appended, never replacing: the world panel is still live behind this one and
  // clearing the container took the streaming readout down with it.
  const panel = document.createElement("div");
  panel.className = "screen screen-pilot";
  panel.id = "pilotScreen";

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

  comfortRow.append(shakeLabel, reducedLabel, invertLabel);

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

  const hitLog = document.createElement("ul");
  hitLog.className = "pilot-hitlog";
  hitLog.dataset["field"] = "hit-log";
  combat.appendChild(hitLog);

  const hint = document.createElement("p");
  hint.className = "pilot-hint";
  hint.textContent =
    "WASD drive · Shift run · Space booster · Q/E turn · Mouse or arrows look · C camera · T lock · M reduced motion · Esc leave. " +
    "Fight: 1 jab · 2 cross · 3 heavy · 4 launcher · 5 shoulder · 6 finisher · F guard · R aim mode";

  panel.append(header, cameraRow, rosterRow, comfortRow, combatRow, readout, combat, hint);
  container.appendChild(panel);

  let lastMode: CameraMode | null = null;

  return {
    update(state: PilotScreenState): void {
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
        hitLog.replaceChildren();
        for (const line of combatState.hitLog) {
          const item = document.createElement("li");
          item.textContent = line;
          hitLog.appendChild(item);
        }
        volumes.checked = combatState.debugVolumes;
      }

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
