/**
 * The combat HUD.
 *
 * Centre and lower-middle clear. Lower-left: the machine as a silhouette
 * of six parts coloured by condition, reactor and heat beside it. Lower-right:
 * the weapon in hand and its ammunition, and the current stance. Upper-right:
 * the enemy, its condition and posture. Upper-left: the objective, which
 * minimises after a few seconds. Top-centre: the encounter phase. Warnings
 * appear once, in the upper third, and leave. A prompt teaches a control the
 * first time it matters and never again.
 *
 * The HUD is pure presentation: it is handed a state record each frame and
 * draws it. It never reads the simulation.
 */

export type LimbId = "head" | "torso" | "armL" | "armR" | "legL" | "legR";

export interface HudState {
  readonly limbs: Readonly<Record<LimbId, number>>;
  readonly reactor: number;
  readonly heat: number;
  readonly stamina: number;
  readonly weapon: string;
  readonly ammo: string;
  readonly stance: string;
  readonly enemyName: string | null;
  readonly enemyHealth: number;
  readonly enemyPosture: number;
  readonly enemyState: string;
  readonly objective: string;
  readonly phase: string;
  readonly warning: string | null;
  readonly prompt: string | null;
  readonly distanceMeters: number | null;
}

const LIMBS: readonly LimbId[] = ["head", "armL", "torso", "armR", "legL", "legR"];
const LIMB_LABELS: Readonly<Record<LimbId, string>> = {
  head: "Conn-Pod",
  torso: "Torso",
  armL: "Left arm",
  armR: "Right arm",
  legL: "Left leg",
  legR: "Right leg",
};

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

function meter(className: string): { track: HTMLElement; fill: HTMLElement } {
  const track = el("div", `meter ${className}`.trim());
  const fill = el("i");
  track.appendChild(fill);
  return { track, fill };
}

export class HudScreen {
  readonly root: HTMLElement;
  private readonly limbCells = new Map<LimbId, HTMLElement>();
  private readonly limbText = new Map<LimbId, HTMLElement>();
  private readonly reactor: { track: HTMLElement; fill: HTMLElement };
  private readonly heat: { track: HTMLElement; fill: HTMLElement };
  private readonly stamina: { track: HTMLElement; fill: HTMLElement };
  private readonly weapon: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly stance: HTMLElement;
  private readonly enemy: HTMLElement;
  private readonly enemyName: HTMLElement;
  private readonly enemyHealth: { track: HTMLElement; fill: HTMLElement };
  private readonly enemyPosture: { track: HTMLElement; fill: HTMLElement };
  private readonly enemyState: HTMLElement;
  private readonly distance: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly prompt: HTMLElement;
  private objectiveText = "";
  private objectiveSince = 0;
  private warningText: string | null = null;
  private warningSince = 0;
  private promptText: string | null = null;
  private readonly promptsShown = new Set<string>();
  private elapsed = 0;

  constructor(container: HTMLElement) {
    this.root = el("div", "op hud");
    this.root.dataset["screen"] = "hud";

    const bl = el("div", "corner bl panel quiet");
    const blRow = el("div", "row");
    blRow.style.alignItems = "flex-start";
    const silhouette = el("div", "silhouette");
    silhouette.dataset["field"] = "hud-silhouette";
    for (const limb of LIMBS) {
      const cell = el("i", limb);
      cell.title = LIMB_LABELS[limb];
      cell.dataset["limb"] = limb;
      silhouette.appendChild(cell);
      this.limbCells.set(limb, cell);
    }
    const gauges = el("div", "gauges");
    gauges.style.flex = "1";
    this.reactor = meter("");
    this.heat = meter("amber");
    this.stamina = meter("green");
    gauges.append(el("span", undefined, "Integrity"), this.reactor.track, el("span", "reactorText", ""));
    gauges.append(el("span", undefined, "Heat"), this.heat.track, el("span", "heatText", ""));
    gauges.append(el("span", undefined, "Stamina"), this.stamina.track, el("span", "staminaText", ""));
    blRow.append(silhouette, gauges);
    bl.append(blRow);
    const limbList = el("div", "mono dim");
    limbList.style.marginTop = "6px";
    limbList.style.fontSize = "10px";
    for (const limb of LIMBS) {
      const text = el("span", undefined, "");
      text.style.marginRight = "8px";
      limbList.appendChild(text);
      this.limbText.set(limb, text);
    }
    bl.append(limbList);
    this.root.append(bl);

    const br = el("div", "corner br panel quiet");
    this.weapon = el("div", undefined, "");
    this.weapon.style.font = "600 18px var(--f-display)";
    this.weapon.style.letterSpacing = "0.08em";
    this.weapon.style.textTransform = "uppercase";
    this.ammo = el("div", "mono dim", "");
    this.stance = el("div", "mono amber", "");
    this.stance.style.marginTop = "6px";
    br.append(el("h3", undefined, "In hand"), this.weapon, this.ammo, this.stance);
    this.root.append(br);

    const tr = el("div", "corner tr panel quiet enemy");
    tr.dataset["field"] = "hud-enemy";
    this.enemyName = el("div", "name", "");
    this.enemyHealth = meter("red");
    this.enemyPosture = meter("amber");
    this.enemyPosture.track.style.marginTop = "4px";
    this.enemyPosture.track.style.height = "3px";
    this.enemyState = el("div", "mono dim", "");
    this.distance = el("div", "mono", "");
    tr.append(
      this.enemyName,
      this.enemyHealth.track,
      this.enemyPosture.track,
      this.enemyState,
      this.distance,
    );
    this.enemy = tr;
    this.root.append(tr);

    const tl = el("div", "corner tl panel quiet");
    this.objective = el("div", "objective", "");
    this.objective.dataset["field"] = "hud-objective";
    tl.append(el("h3", undefined, "Objective"), this.objective);
    this.root.append(tl);

    this.phase = el("div", "phase", "");
    this.phase.dataset["field"] = "hud-phase";
    this.warn = el("div", "warn", "");
    this.warn.dataset["field"] = "hud-warning";
    this.warn.hidden = true;
    this.prompt = el("div", "prompt", "");
    this.prompt.dataset["field"] = "hud-prompt";
    this.prompt.hidden = true;
    this.root.append(this.phase, this.warn, this.prompt);
    container.appendChild(this.root);
  }

  /** A control hint, shown once per key for a few seconds. */
  teach(key: string, text: string): void {
    if (this.promptsShown.has(key)) return;
    this.promptsShown.add(key);
    this.promptText = text;
    this.prompt.replaceChildren();
    const parts = text.split(/(\[[^\]]+\])/);
    for (const part of parts) {
      if (part.startsWith("[")) this.prompt.append(el("b", undefined, part.slice(1, -1)));
      else this.prompt.append(document.createTextNode(part));
    }
    this.prompt.hidden = false;
    this.promptSince = this.elapsed;
  }
  private promptSince = 0;

  update(state: HudState, deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    for (const limb of LIMBS) {
      const value = state.limbs[limb];
      const cell = this.limbCells.get(limb);
      const text = this.limbText.get(limb);
      if (!cell || !text) continue;
      cell.className = `${limb} ${value <= 0 ? "gone" : value < 0.35 ? "crit" : value < 0.7 ? "hurt" : "ok"}`;
      text.textContent = value < 0.7 ? `${LIMB_LABELS[limb]} ${Math.round(value * 100)}%` : "";
      text.className = value <= 0 ? "red" : value < 0.35 ? "red" : "amber";
    }
    this.reactor.fill.style.width = `${Math.round(state.reactor * 100)}%`;
    this.heat.fill.style.width = `${Math.round(state.heat * 100)}%`;
    this.heat.track.className = `meter ${state.heat > 0.8 ? "red" : "amber"}`;
    this.stamina.fill.style.width = `${Math.round(state.stamina * 100)}%`;
    const reactorText = this.root.querySelector<HTMLElement>(".reactorText");
    if (reactorText) reactorText.textContent = `${Math.round(state.reactor * 100)}%`;
    const heatText = this.root.querySelector<HTMLElement>(".heatText");
    if (heatText) heatText.textContent = `${Math.round(state.heat * 100)}%`;
    const staminaText = this.root.querySelector<HTMLElement>(".staminaText");
    if (staminaText) staminaText.textContent = `${Math.round(state.stamina * 100)}%`;

    this.weapon.textContent = state.weapon;
    this.ammo.textContent = state.ammo;
    this.stance.textContent = state.stance;

    if (state.enemyName) {
      this.enemy.hidden = false;
      this.enemyName.textContent = state.enemyName;
      this.enemyHealth.fill.style.width = `${Math.round(state.enemyHealth * 100)}%`;
      this.enemyPosture.fill.style.width = `${Math.round(state.enemyPosture * 100)}%`;
      this.enemyState.textContent = state.enemyState;
      this.distance.textContent =
        state.distanceMeters === null ? "" : `${Math.round(state.distanceMeters)} m`;
    } else {
      this.enemy.hidden = true;
    }

    if (state.objective !== this.objectiveText) {
      this.objectiveText = state.objective;
      this.objective.textContent = state.objective;
      this.objectiveSince = this.elapsed;
    }
    this.objective.classList.toggle("minimised", this.elapsed - this.objectiveSince > 6);
    this.phase.textContent = state.phase;

    if (state.warning !== this.warningText) {
      this.warningText = state.warning;
      this.warningSince = this.elapsed;
      this.warn.textContent = state.warning ?? "";
    }
    this.warn.hidden = !state.warning || this.elapsed - this.warningSince > 4;

    if (state.prompt && state.prompt !== this.promptText) {
      this.teach(state.prompt, state.prompt);
    }
    if (!this.prompt.hidden && this.elapsed - this.promptSince > 7) this.prompt.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }
}
