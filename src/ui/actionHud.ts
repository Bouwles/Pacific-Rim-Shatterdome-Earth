/**
 * The action HUD for the hunt.
 *
 * One visual system: the creature's plate at the top centre with its health,
 * its stability and the state of each body region; the machine's integrity
 * and heat at the lower left beside a six-part silhouette; a four-icon action
 * bar at the bottom centre with cooldown arcs and heat or ammunition; Drift
 * Flow and the Breaker charge as arcs either side of the bar; a combo count;
 * short notices that animate in and fade; a fading objective; and, only when
 * it applies, a prompt in the lower middle for a clash, the Breaker, a grab
 * or a slam. The centre of the screen stays clear. No developer text.
 */

export type HudRegionId = "head" | "arm.L" | "arm.R" | "torso" | "leg.L" | "leg.R" | "tail";

export interface RegionView {
  readonly id: HudRegionId;
  readonly label: string;
  /** Armour left, 0 to 1. */
  readonly armor: number;
  readonly broken: boolean;
  readonly severed: boolean;
}

export interface AbilityView {
  readonly key: string;
  readonly label: string;
  /** 0 cooling, 1 ready. */
  readonly ready: number;
  /** Ammunition or heat text, empty for none. */
  readonly ammo: string;
  readonly active: boolean;
  readonly icon: "elbow" | "plasma" | "sword" | "purge";
}

export type HudPrompt = {
  readonly kind: "clash" | "breaker" | "grapple" | "slam";
  readonly text: string;
  readonly direction?: "L" | "R" | "F" | "B" | null;
} | null;

export interface ActionHudState {
  readonly health: number;
  readonly stamina: number;
  readonly heat: number;
  readonly overheated: boolean;
  readonly integrityRegions: Partial<
    Record<"arm.L" | "arm.R" | "leg.L" | "leg.R" | "torso" | "reactor", number>
  >;
  readonly enemyName: string | null;
  readonly enemyHealth: number;
  readonly enemyStability: number;
  readonly phase: string;
  readonly regions: readonly RegionView[];
  readonly targetRegion: HudRegionId | null;
  readonly locked: boolean;
  readonly abilities: readonly AbilityView[];
  readonly flow: number;
  readonly flowLevel: number;
  readonly ultimate: number;
  readonly combo: number;
  readonly objective: string;
  readonly flash: string | null;
  readonly prompt: HudPrompt;
  readonly weaponMode: "fists" | "sword" | "plasma";
  readonly aiming: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
const RING_RADIUS = 22;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const ARC_RADIUS = 30;

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

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function bar(className: string): { track: HTMLElement; fill: HTMLElement } {
  const track = el("div", `hbar ${className}`.trim());
  const fill = el("i");
  track.append(fill);
  return { track, fill };
}

const ICON_PATHS: Record<AbilityView["icon"], string> = {
  elbow: "M14 36 L26 16 L38 36 M20 36 L26 26 L32 36",
  plasma: "M26 14 A12 12 0 1 0 26.01 14 M26 20 A6 6 0 1 0 26.01 20 M26 8 L26 12 M26 40 L26 44",
  sword: "M18 40 L34 12 M30 12 L36 14 M16 36 L22 42 M14 30 L26 30",
  purge: "M16 18 L16 34 M22 14 L22 38 M30 14 L30 38 M36 18 L36 34",
};

const REGION_ORDER: readonly HudRegionId[] = ["head", "arm.L", "torso", "arm.R", "leg.L", "tail", "leg.R"];
const REGION_GLYPH: Record<HudRegionId, string> = {
  head: "H",
  "arm.L": "L",
  "arm.R": "R",
  torso: "T",
  "leg.L": "l",
  "leg.R": "r",
  tail: "t",
};

const ARROW: Record<"L" | "R" | "F" | "B", string> = { L: "←", R: "→", F: "↑", B: "↓" };

export class ActionHud {
  readonly root: HTMLElement;
  private readonly health: { track: HTMLElement; fill: HTMLElement };
  private readonly stamina: { track: HTMLElement; fill: HTMLElement };
  private readonly heat: { track: HTMLElement; fill: HTMLElement };
  private readonly silhouette: Record<string, SVGRectElement | SVGCircleElement>;
  private readonly enemy: HTMLElement;
  private readonly enemyName: HTMLElement;
  private readonly lock: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly enemyHealth: { track: HTMLElement; fill: HTMLElement };
  private readonly enemyStability: { track: HTMLElement; fill: HTMLElement };
  private readonly regionPips = new Map<HudRegionId, HTMLElement>();
  private readonly slots: {
    root: HTMLElement;
    ring: SVGCircleElement;
    icon: SVGPathElement;
    label: HTMLElement;
    ammo: HTMLElement;
  }[] = [];
  private readonly flowArc: SVGCircleElement;
  private readonly flowLevel: HTMLElement;
  private readonly ultimateArc: SVGCircleElement;
  private readonly ultimateMark: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboCount: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptArrow: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly reticle: HTMLElement;
  private objectiveText = "";
  private objectiveAge = 0;
  private lastFlash: string | null = null;
  private ultimateWasReady = false;
  private noticeCount = 0;

  constructor(container: HTMLElement) {
    this.root = el("div", "op hud2 hud3");
    this.root.dataset["screen"] = "hud";

    // Machine: integrity, stamina, heat and the six-part silhouette.
    const player = el("div", "player");
    const silhouette = svg("svg", { viewBox: "0 0 40 64", class: "silhouette" });
    const part = (name: string, x: number, y: number, w: number, h: number): SVGRectElement => {
      const rect = svg("rect", {
        x: String(x),
        y: String(y),
        width: String(w),
        height: String(h),
        rx: "1.5",
      });
      rect.dataset["part"] = name;
      silhouette.append(rect);
      return rect;
    };
    const reactor = svg("circle", { cx: "20", cy: "24", r: "3.2" });
    this.silhouette = {
      head: part("head", 15, 2, 10, 8),
      torso: part("torso", 12, 12, 16, 22),
      "arm.L": part("arm.L", 4, 13, 6, 20),
      "arm.R": part("arm.R", 30, 13, 6, 20),
      "leg.L": part("leg.L", 12, 36, 7, 26),
      "leg.R": part("leg.R", 21, 36, 7, 26),
      reactor,
    };
    silhouette.append(reactor);
    const bars = el("div", "bars");
    this.health = bar("health");
    this.stamina = bar("stamina");
    this.heat = bar("heat");
    const row = (label: string, track: HTMLElement): HTMLElement => {
      const line = el("div", "row-bar");
      line.append(el("span", "lbl", label), track);
      return line;
    };
    bars.append(
      row("Integrity", this.health.track),
      row("Stamina", this.stamina.track),
      row("Heat", this.heat.track),
    );
    player.append(silhouette, bars);

    // Creature: name, lock, phase, health, stability, regions.
    this.enemy = el("div", "boss");
    this.enemy.dataset["field"] = "hud-enemy";
    const bossHead = el("div", "boss-head");
    this.enemyName = el("span", "boss-name", "");
    this.lock = el("span", "lock", "");
    this.lock.title = "Locked";
    this.phase = el("span", "phase", "");
    this.phase.dataset["field"] = "hud-phase";
    bossHead.append(this.lock, this.enemyName, this.phase);
    this.enemyHealth = bar("boss-health");
    this.enemyStability = bar("boss-stability");
    const pips = el("div", "regions");
    pips.dataset["field"] = "hud-regions";
    for (const id of REGION_ORDER) {
      const pip = el("div", "pip");
      pip.dataset["region"] = id;
      pip.append(el("i"), el("span", undefined, REGION_GLYPH[id]));
      this.regionPips.set(id, pip);
      pips.append(pip);
    }
    this.enemy.append(bossHead, this.enemyHealth.track, this.enemyStability.track, pips);

    // Objective, quietly, under the plate.
    this.objective = el("div", "objective2");
    this.objective.dataset["field"] = "hud-objective";

    // Action bar: flow arc, four abilities, ultimate arc.
    const bar3 = el("div", "actionbar");
    const arc = (className: string): { wrap: HTMLElement; arc: SVGCircleElement; mark: HTMLElement } => {
      const wrap = el("div", `arc ${className}`);
      const graphic = svg("svg", { viewBox: "0 0 72 72" });
      graphic.append(svg("circle", { class: "arc-back", cx: "36", cy: "36", r: String(ARC_RADIUS) }));
      const fill = svg("circle", { class: "arc-fill", cx: "36", cy: "36", r: String(ARC_RADIUS) });
      const length = 2 * Math.PI * ARC_RADIUS;
      fill.style.strokeDasharray = `${length}`;
      fill.style.strokeDashoffset = `${length}`;
      graphic.append(fill);
      const mark = el("span", "mark", "");
      wrap.append(graphic, mark);
      return { wrap, arc: fill, mark };
    };
    const flow = arc("flow");
    this.flowArc = flow.arc;
    this.flowLevel = flow.mark;
    flow.wrap.dataset["field"] = "hud-flow";
    const abilities = el("div", "abilities");
    abilities.dataset["field"] = "hud-abilities";
    for (let index = 0; index < 4; index += 1) {
      const slot = el("div", "ability");
      const graphic = svg("svg", { viewBox: "0 0 52 52" });
      graphic.append(svg("circle", { class: "ring-back", cx: "26", cy: "26", r: String(RING_RADIUS) }));
      const ring = svg("circle", { class: "ring", cx: "26", cy: "26", r: String(RING_RADIUS) });
      ring.style.strokeDasharray = `${RING_LENGTH}`;
      graphic.append(ring);
      const icon = svg("path", { class: "glyph", d: ICON_PATHS.elbow });
      graphic.append(icon);
      const key = el("span", "key", String(index + 1));
      const label = el("span", "label", "");
      const ammo = el("span", "ammo", "");
      slot.append(graphic, key, label, ammo);
      abilities.append(slot);
      this.slots.push({ root: slot, ring, icon, label, ammo });
    }
    const ultimate = arc("ultimate");
    this.ultimateArc = ultimate.arc;
    this.ultimateMark = ultimate.mark;
    ultimate.wrap.dataset["field"] = "hud-ultimate";
    bar3.append(flow.wrap, abilities, ultimate.wrap);

    this.combo = el("div", "combo");
    this.comboCount = el("span", "count", "");
    this.combo.append(this.comboCount, el("span", "word", "HITS"));
    this.combo.hidden = true;

    this.notices = el("div", "notices");
    this.notices.dataset["field"] = "hud-flash";

    this.prompt = el("div", "prompt");
    this.prompt.dataset["field"] = "hud-prompt";
    this.promptArrow = el("span", "arrow", "");
    this.promptText = el("span", "text", "");
    this.prompt.append(this.promptArrow, this.promptText);
    this.prompt.hidden = true;

    this.reticle = el("div", "reticle");
    this.reticle.hidden = true;

    this.root.append(
      player,
      this.enemy,
      this.objective,
      bar3,
      this.combo,
      this.notices,
      this.prompt,
      this.reticle,
    );
    container.append(this.root);
  }

  /** A short notice: animates in above the bar, fades on its own. */
  announce(text: string): void {
    if (!text) return;
    this.noticeCount += 1;
    const note = el("div", "notice", text);
    this.notices.append(note);
    while (this.notices.children.length > 4) this.notices.firstElementChild?.remove();
    window.setTimeout(() => {
      note.classList.add("fade");
      window.setTimeout(() => note.remove(), 500);
    }, 1_400);
  }

  update(state: ActionHudState, deltaSeconds: number): void {
    this.health.fill.style.width = `${Math.round(clamp01(state.health) * 100)}%`;
    this.health.track.classList.toggle("low", state.health < 0.3);
    this.stamina.fill.style.width = `${Math.round(clamp01(state.stamina) * 100)}%`;
    this.heat.fill.style.width = `${Math.round(clamp01(state.heat) * 100)}%`;
    this.heat.track.classList.toggle("hot", state.overheated || state.heat > 0.8);
    for (const [part, node] of Object.entries(this.silhouette)) {
      const damage = clamp01(
        state.integrityRegions[part as keyof ActionHudState["integrityRegions"]] ?? (part === "head" ? 0 : 0),
      );
      node.style.opacity = `${1 - damage * 0.55}`;
      node.classList.toggle("hurt", damage > 0.45);
      node.classList.toggle("critical", damage > 0.8);
    }

    if (state.enemyName) {
      this.enemy.hidden = false;
      if (this.enemyName.textContent !== state.enemyName) this.enemyName.textContent = state.enemyName;
      this.enemyHealth.fill.style.width = `${Math.round(clamp01(state.enemyHealth) * 100)}%`;
      this.enemyStability.fill.style.width = `${Math.round(clamp01(state.enemyStability) * 100)}%`;
      this.enemyStability.track.classList.toggle("broken", state.enemyStability <= 0.03);
      this.phase.textContent = state.phase;
      this.phase.hidden = state.phase === "";
      this.lock.classList.toggle("on", state.locked);
      for (const region of state.regions) {
        const pip = this.regionPips.get(region.id);
        if (!pip) continue;
        const fill = pip.firstElementChild as HTMLElement | null;
        if (fill) fill.style.height = `${Math.round(clamp01(region.armor) * 100)}%`;
        pip.classList.toggle("broken", region.broken && !region.severed);
        pip.classList.toggle("severed", region.severed);
        pip.classList.toggle("target", state.targetRegion === region.id);
      }
    } else {
      this.enemy.hidden = true;
    }

    state.abilities.forEach((ability, index) => {
      const slot = this.slots[index];
      if (!slot) return;
      slot.ring.style.strokeDashoffset = `${RING_LENGTH * (1 - clamp01(ability.ready))}`;
      slot.root.classList.toggle("ready", ability.ready >= 0.999);
      slot.root.classList.toggle("active", ability.active);
      const path = ICON_PATHS[ability.icon];
      if (slot.icon.getAttribute("d") !== path) slot.icon.setAttribute("d", path);
      if (slot.label.textContent !== ability.label) slot.label.textContent = ability.label;
      if (slot.ammo.textContent !== ability.ammo) slot.ammo.textContent = ability.ammo;
    });

    const flowLength = 2 * Math.PI * ARC_RADIUS;
    this.flowArc.style.strokeDashoffset = `${flowLength * (1 - clamp01(state.flow))}`;
    this.flowArc.classList.toggle("deep", state.flowLevel >= 2);
    this.flowLevel.textContent = state.flowLevel > 0 ? "I".repeat(state.flowLevel) : "";
    this.ultimateArc.style.strokeDashoffset = `${flowLength * (1 - clamp01(state.ultimate))}`;
    const ready = state.ultimate >= 0.999;
    this.ultimateArc.classList.toggle("ready", ready);
    this.ultimateMark.textContent = ready ? "R" : "";
    this.ultimateWasReady = ready;

    if (state.combo > 1) {
      this.combo.hidden = false;
      const text = String(state.combo);
      if (this.comboCount.textContent !== text) {
        this.comboCount.textContent = text;
        this.combo.classList.remove("pop");
        void this.combo.offsetWidth;
        this.combo.classList.add("pop");
      }
    } else this.combo.hidden = true;

    if (state.objective !== this.objectiveText) {
      this.objectiveText = state.objective;
      this.objective.textContent = state.objective;
      this.objectiveAge = 0;
      this.objective.classList.remove("faded");
    } else {
      this.objectiveAge += deltaSeconds;
      if (this.objectiveAge > 5) this.objective.classList.add("faded");
    }

    if (state.flash && state.flash !== this.lastFlash) this.announce(state.flash);
    this.lastFlash = state.flash;

    if (state.prompt) {
      this.prompt.hidden = false;
      this.prompt.dataset["kind"] = state.prompt.kind;
      this.promptArrow.textContent = state.prompt.direction ? ARROW[state.prompt.direction] : "";
      this.promptArrow.hidden = !state.prompt.direction;
      if (this.promptText.textContent !== state.prompt.text) this.promptText.textContent = state.prompt.text;
    } else this.prompt.hidden = true;

    this.reticle.hidden = !state.aiming;
    this.root.dataset["weapon"] = state.weaponMode;
  }

  dispose(): void {
    this.root.remove();
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
