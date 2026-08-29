/**
 * The action HUD.
 *
 * Bars and icons, no paragraphs. Top-left: integrity, stamina, the overdrive
 * meter. Top-right: the boss, its health, its posture, the phase badge and
 * the lock mark. Bottom-left: four ability icons with key labels, radial
 * cooldowns and ammunition. A combo counter appears only while a chain is
 * running; the objective fades after it is read; confirmations (hit, perfect
 * guard, armour break, ultimate ready) flash once and go. The centre stays
 * clear.
 */

export interface AbilityView {
  readonly key: string;
  readonly label: string;
  /** 0 when cooling down, 1 when ready. */
  readonly ready: number;
  readonly ammo: string;
  readonly active: boolean;
}

export interface ActionHudState {
  readonly health: number;
  readonly stamina: number;
  readonly overdrive: number;
  readonly enemyName: string | null;
  readonly enemyHealth: number;
  readonly enemyPosture: number;
  readonly phase: string;
  readonly locked: boolean;
  readonly abilities: readonly AbilityView[];
  readonly combo: number;
  readonly objective: string;
  readonly flash: string | null;
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

function bar(className: string): { track: HTMLElement; fill: HTMLElement } {
  const track = el("div", `hbar ${className}`.trim());
  const fill = el("i");
  track.appendChild(fill);
  return { track, fill };
}

const SVG = "http://www.w3.org/2000/svg";
const RING_RADIUS = 22;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

interface AbilitySlot {
  readonly root: HTMLElement;
  readonly ring: SVGCircleElement;
  readonly label: HTMLElement;
  readonly ammo: HTMLElement;
}

export class ActionHud {
  readonly root: HTMLElement;
  private readonly health: { track: HTMLElement; fill: HTMLElement };
  private readonly stamina: { track: HTMLElement; fill: HTMLElement };
  private readonly overdrive: { track: HTMLElement; fill: HTMLElement };
  private readonly enemy: HTMLElement;
  private readonly enemyName: HTMLElement;
  private readonly enemyHealth: { track: HTMLElement; fill: HTMLElement };
  private readonly enemyPosture: { track: HTMLElement; fill: HTMLElement };
  private readonly phase: HTMLElement;
  private readonly lock: HTMLElement;
  private readonly slots: AbilitySlot[] = [];
  private readonly combo: HTMLElement;
  private readonly comboCount: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly flash: HTMLElement;
  private objectiveText = "";
  private objectiveSince = 0;
  private flashText: string | null = null;
  private flashSince = 0;
  private overdriveWasFull = false;
  private elapsed = 0;

  constructor(container: HTMLElement) {
    this.root = el("div", "op hud2");
    this.root.dataset["screen"] = "hud";

    const player = el("div", "player");
    this.health = bar("health");
    this.stamina = bar("stamina");
    this.overdrive = bar("overdrive");
    const healthRow = el("div", "row-bar");
    healthRow.append(el("span", "lbl", "Integrity"), this.health.track);
    const staminaRow = el("div", "row-bar");
    staminaRow.append(el("span", "lbl", "Stamina"), this.stamina.track);
    const overdriveRow = el("div", "row-bar");
    overdriveRow.append(el("span", "lbl", "Overdrive"), this.overdrive.track);
    player.append(healthRow, staminaRow, overdriveRow);
    this.root.append(player);

    this.enemy = el("div", "boss");
    this.enemy.dataset["field"] = "hud-enemy";
    const bossHead = el("div", "boss-head");
    this.enemyName = el("span", "boss-name", "");
    this.lock = el("span", "lock", "LOCK");
    this.phase = el("span", "phase", "");
    this.phase.dataset["field"] = "hud-phase";
    bossHead.append(this.enemyName, this.lock, this.phase);
    this.enemyHealth = bar("boss-health");
    this.enemyPosture = bar("boss-posture");
    this.enemy.append(bossHead, this.enemyHealth.track, this.enemyPosture.track);
    this.root.append(this.enemy);

    const abilities = el("div", "abilities");
    abilities.dataset["field"] = "hud-abilities";
    for (let index = 0; index < 4; index += 1) {
      const slot = el("div", "ability");
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("viewBox", "0 0 52 52");
      const back = document.createElementNS(SVG, "circle");
      back.setAttribute("cx", "26");
      back.setAttribute("cy", "26");
      back.setAttribute("r", String(RING_RADIUS));
      back.setAttribute("class", "ring-back");
      const ring = document.createElementNS(SVG, "circle");
      ring.setAttribute("cx", "26");
      ring.setAttribute("cy", "26");
      ring.setAttribute("r", String(RING_RADIUS));
      ring.setAttribute("class", "ring");
      ring.setAttribute("stroke-dasharray", String(RING_LENGTH));
      ring.setAttribute("stroke-dashoffset", "0");
      svg.append(back, ring);
      const key = el("span", "key", String(index + 1));
      const label = el("span", "label", "");
      const ammo = el("span", "ammo", "");
      slot.append(svg, key, label, ammo);
      abilities.append(slot);
      this.slots.push({ root: slot, ring, label, ammo });
    }
    this.root.append(abilities);

    this.combo = el("div", "combo");
    this.comboCount = el("span", "count", "");
    this.combo.append(this.comboCount, el("span", "word", "HITS"));
    this.combo.hidden = true;
    this.root.append(this.combo);

    this.objective = el("div", "objective2");
    this.objective.dataset["field"] = "hud-objective";
    this.root.append(this.objective);

    this.flash = el("div", "flash");
    this.flash.dataset["field"] = "hud-flash";
    this.flash.hidden = true;
    this.root.append(this.flash);
    container.appendChild(this.root);
  }

  /** A one-off confirmation: hit, perfect guard, armour break, ultimate ready. */
  announce(text: string): void {
    this.flashText = text;
    this.flashSince = this.elapsed;
    this.flash.textContent = text;
    this.flash.hidden = false;
    this.flash.classList.remove("pop");
    void this.flash.offsetWidth;
    this.flash.classList.add("pop");
  }

  update(state: ActionHudState, deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.health.fill.style.width = `${Math.round(Math.max(0, Math.min(1, state.health)) * 100)}%`;
    this.health.track.classList.toggle("low", state.health < 0.3);
    this.stamina.fill.style.width = `${Math.round(Math.max(0, Math.min(1, state.stamina)) * 100)}%`;
    this.overdrive.fill.style.width = `${Math.round(Math.max(0, Math.min(1, state.overdrive)) * 100)}%`;
    const full = state.overdrive >= 0.999;
    this.overdrive.track.classList.toggle("full", full);
    if (full && !this.overdriveWasFull) this.announce("Ultimate ready");
    this.overdriveWasFull = full;

    if (state.enemyName) {
      this.enemy.hidden = false;
      this.enemyName.textContent = state.enemyName;
      this.enemyHealth.fill.style.width = `${Math.round(Math.max(0, Math.min(1, state.enemyHealth)) * 100)}%`;
      this.enemyPosture.fill.style.width = `${Math.round(Math.max(0, Math.min(1, state.enemyPosture)) * 100)}%`;
      this.enemyPosture.track.classList.toggle("broken", state.enemyPosture <= 0.02);
      this.phase.textContent = state.phase;
      this.phase.hidden = state.phase === "";
      this.lock.classList.toggle("on", state.locked);
    } else {
      this.enemy.hidden = true;
    }

    state.abilities.forEach((ability, index) => {
      const slot = this.slots[index];
      if (!slot) return;
      const ready = Math.max(0, Math.min(1, ability.ready));
      slot.ring.setAttribute("stroke-dashoffset", String(RING_LENGTH * (1 - ready)));
      slot.root.classList.toggle("ready", ready >= 0.999);
      slot.root.classList.toggle("active", ability.active);
      slot.root.querySelector(".key")!.textContent = ability.key;
      slot.label.textContent = ability.label;
      slot.ammo.textContent = ability.ammo;
    });

    if (state.combo > 1) {
      this.combo.hidden = false;
      if (this.comboCount.textContent !== String(state.combo)) {
        this.comboCount.textContent = String(state.combo);
        this.combo.classList.remove("pop");
        void this.combo.offsetWidth;
        this.combo.classList.add("pop");
      }
    } else {
      this.combo.hidden = true;
    }

    if (state.objective !== this.objectiveText) {
      this.objectiveText = state.objective;
      this.objective.textContent = state.objective;
      this.objectiveSince = this.elapsed;
    }
    this.objective.classList.toggle("faded", this.elapsed - this.objectiveSince > 5);

    if (state.flash && state.flash !== this.flashText) this.announce(state.flash);
    if (!this.flash.hidden && this.elapsed - this.flashSince > 1.1) {
      this.flash.hidden = true;
      this.flashText = null;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
