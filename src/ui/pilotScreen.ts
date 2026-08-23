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

export interface PilotScreenState {
  readonly readout: PilotReadout;
  readonly view: PilotViewStats | null;
  readonly groundHeightMeters: number | null;
  readonly headingErrorDeg: number;
  readonly blocked: boolean;
}

export interface PilotScreenCallbacks {
  readonly onCameraMode: (mode: CameraMode) => void;
  readonly onShakeScale: (value: number) => void;
  readonly onReducedMotion: (value: boolean) => void;
  readonly onInvertPitch: (value: boolean) => void;
  readonly onLockToggle: () => void;
  readonly onSwitchJaeger: (jaegerId: string) => void;
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

  const hint = document.createElement("p");
  hint.className = "pilot-hint";
  hint.textContent =
    "WASD drive · Shift run · F guard · Space booster · Q/E turn · Mouse or arrows look · C camera · T lock · M reduced motion · Esc leave";

  panel.append(header, cameraRow, rosterRow, comfortRow, readout, hint);
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
