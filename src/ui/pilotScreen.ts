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
  /** Null only before a machine is taken out. */
  readonly damage: PilotDamageState | null;
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
  readonly onMoveList: (open: boolean) => void;
  readonly onHoldToComplete: (enabled: boolean) => void;
  readonly onSkipSequences: (enabled: boolean) => void;
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
  moveList: readonly MoveListEntry[],
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

  panel.append(header, cameraRow, rosterRow, comfortRow, combatRow, readout, combat, moves, hint);
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
