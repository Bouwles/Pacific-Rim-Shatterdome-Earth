import { describe, expect, it } from "vitest";
import {
  COLOUR_VISION_PRESETS,
  ICON_TOKENS,
  MAX_MOTION_MS,
  MOTION_TOKENS,
  SEVERITIES,
  SEVERITY_TOKENS,
  TEXT_SCALES,
  motionDuration,
  severityColour,
  tokenTable,
} from "../../src/ui/hudTokens";
import { buildHud, fallingSeverity, iconFor, risingSeverity } from "../../src/ui/hudModel";
import {
  MIN_HUD_OPACITY,
  criticalRemainsVisible,
  defaultPresentation,
  motionIsBounded,
  normalisePresentation,
  shakeFor,
  styleFor,
  validatePresentation,
} from "../../src/ui/presentation";
import { calmInput, pressureInput, shapeDistinctness } from "../../src/debug/hudScenario";

describe("the token vocabulary", () => {
  it("gives every severity a distinct glyph, so colour is never the only signal", () => {
    const glyphs = SEVERITIES.map((severity) => SEVERITY_TOKENS[severity].glyph);
    expect(new Set(glyphs).size).toBe(SEVERITIES.length);
    expect(shapeDistinctness().colourFree).toBe(true);
  });

  it("gives every severity a rank, ordered most urgent first", () => {
    const ranks = SEVERITIES.map((severity) => SEVERITY_TOKENS[severity].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(SEVERITY_TOKENS.critical.rank).toBeLessThan(SEVERITY_TOKENS.nominal.rank);
  });

  it("says what every severity means, so nothing is a bare colour", () => {
    for (const severity of SEVERITIES) {
      expect(SEVERITY_TOKENS[severity].meaning.length, severity).toBeGreaterThan(15);
    }
  });

  it("keeps every colour vision preset separating the severities", () => {
    for (const preset of COLOUR_VISION_PRESETS) {
      const colours = SEVERITIES.map((severity) => severityColour(severity, { colourVision: preset }));
      expect(new Set(colours).size, preset).toBe(SEVERITIES.length);
    }
  });

  it("lets high contrast win over a colour vision preset", () => {
    const contrast = severityColour("critical", { highContrast: true, colourVision: "tritanopia" });
    expect(contrast).toBe(SEVERITY_TOKENS.critical.contrastColour);
  });

  it("bounds every motion token, and lets nothing loop", () => {
    for (const token of Object.values(MOTION_TOKENS)) {
      expect(token.durationMs, token.id).toBeLessThanOrEqual(MAX_MOTION_MS);
      expect(token.use.length, token.id).toBeGreaterThan(10);
    }
  });

  it("turns every motion off when motion is reduced", () => {
    for (const id of Object.keys(MOTION_TOKENS)) {
      expect(motionDuration(id, true), id).toBe(0);
    }
  });

  it("only allows a pulse where the meaning justifies one", () => {
    expect(SEVERITY_TOKENS.critical.mayPulse).toBe(true);
    expect(SEVERITY_TOKENS.info.mayPulse).toBe(false);
    expect(SEVERITY_TOKENS.nominal.mayPulse).toBe(false);
  });

  it("documents itself, so the written record cannot drift from the code", () => {
    const rows = tokenTable();
    expect(rows.length).toBe(
      SEVERITIES.length + Object.keys(ICON_TOKENS).length + Object.keys(MOTION_TOKENS).length,
    );
    for (const row of rows) {
      expect(row.meaning.length, row.id).toBeGreaterThan(5);
      expect(row.value.length, row.id).toBeGreaterThan(0);
    }
  });

  it("names an icon for every meaning the model asks for", () => {
    for (const name of ["structure", "reactor", "heat", "ammunition", "target", "drift", "fault"]) {
      expect(ICON_TOKENS[name], name).toBeDefined();
      expect(iconFor(name)).toBe(ICON_TOKENS[name]);
    }
  });
});

describe("severity from a reading", () => {
  it("gets worse as a falling value falls", () => {
    expect(fallingSeverity(1)).toBe("nominal");
    expect(fallingSeverity(0.5)).toBe("caution");
    expect(fallingSeverity(0.3)).toBe("warning");
    expect(fallingSeverity(0.1)).toBe("critical");
    expect(fallingSeverity(0)).toBe("critical");
  });

  it("gets worse as a rising value rises", () => {
    expect(risingSeverity(0.2)).toBe("nominal");
    expect(risingSeverity(0.7)).toBe("caution");
    expect(risingSeverity(0.9)).toBe("warning");
    expect(risingSeverity(1)).toBe("critical");
  });
});

describe("what the interface says", () => {
  const loud = buildHud(pressureInput());
  const quiet = buildHud(calmInput());

  it("says nothing when nothing is happening", () => {
    // Minimal because there is little worth saying, not because anything is
    // being withheld.
    expect(quiet.alerts).toHaveLength(0);
    expect(quiet.busy).toBe(false);
    expect(quiet.topAlert).toBeNull();
  });

  it("still reports every instrument when nothing is happening", () => {
    // Minimal is not empty: the cockpit is always readable.
    expect(quiet.instruments.length).toBeGreaterThan(8);
  });

  it("raises the worst thing to the top when a fight goes badly", () => {
    expect(loud.alerts.length).toBeGreaterThan(4);
    expect(loud.topAlert?.severity).toBe("critical");
  });

  it("orders alerts by severity, never by when they happened", () => {
    const ranks = loud.alerts.map((alert) => SEVERITY_TOKENS[alert.severity].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("reports an offline component as critical whatever its reading", () => {
    const offline = loud.components.find((component) => component.offline);
    expect(offline?.severity).toBe("critical");
    expect(loud.alerts.some((alert) => alert.label.includes("offline"))).toBe(true);
  });

  it("says what to do about a warning rather than only naming it", () => {
    for (const alert of loud.alerts) {
      expect(alert.detail.length, alert.id).toBeGreaterThan(10);
      expect(alert.label.length, alert.id).toBeLessThan(40);
    }
  });

  it("covers everything the milestone asks a HUD to show", () => {
    expect(loud.components.length).toBeGreaterThan(0);
    expect(loud.targetZones.length).toBeGreaterThan(0);
    expect(loud.weapons.length).toBeGreaterThan(0);
    expect(loud.heat.fraction).toBeGreaterThan(0);
    expect(loud.reactor.fraction).toBeGreaterThan(0);
    expect(loud.abilities.length).toBeGreaterThan(0);
    expect(loud.squadOrder).not.toBeNull();
    expect(loud.objective.length).toBeGreaterThan(0);
    expect(loud.citySafety.text).toMatch(/% intact/);
  });

  it("marks the zone the player is aiming at", () => {
    const aimed = loud.targetZones.filter((zone) => zone.aimed);
    expect(aimed).toHaveLength(1);
    expect(aimed[0]!.id).toBe("head");
  });

  it("reads a heat weapon as heat fed rather than as an empty magazine", () => {
    const plasma = loud.weapons.find((weapon) => weapon.id === "weapon.plasma-caster");
    expect(plasma?.readout).toBe("heat fed");
    expect(plasma?.severity).not.toBe("critical");
  });

  it("calls a dry weapon dry", () => {
    const cannon = loud.weapons.find((weapon) => weapon.id === "weapon.rotary-cannon");
    expect(cannon?.severity).toBe("critical");
    expect(loud.alerts.some((alert) => alert.label.includes("dry"))).toBe(true);
  });

  it("covers every cockpit instrument the milestone names", () => {
    const ids = new Set(loud.instruments.map((instrument) => instrument.id));
    for (const id of [
      "heading",
      "depth",
      "speed",
      "reactor",
      "drift",
      "faults",
      "weapons",
      "targeting",
      "weather",
      "radio",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("says no contact rather than pretending to a target", () => {
    const targeting = quiet.instruments.find((instrument) => instrument.id === "targeting");
    expect(targeting?.value).toBe("no contact");
  });

  it("says the radio is quiet rather than showing an empty line", () => {
    expect(quiet.instruments.find((instrument) => instrument.id === "radio")?.value).toBe("quiet");
  });
});

describe("presentation settings", () => {
  it("start sensible", () => {
    expect(validatePresentation(defaultPresentation())).toEqual([]);
  });

  it("refuse settings that are not settings", () => {
    expect(validatePresentation(null).length).toBeGreaterThan(0);
    expect(validatePresentation({ ...defaultPresentation(), textScale: 4 }).length).toBeGreaterThan(0);
    expect(validatePresentation({ ...defaultPresentation(), colourVision: "none" }).length).toBeGreaterThan(
      0,
    );
  });

  it("clamp rather than refuse, so presentation never blocks a load", () => {
    const recovered = normalisePresentation({ hudOpacity: 0, shakeScale: 9, textScale: 3 as never });
    expect(recovered.hudOpacity).toBe(MIN_HUD_OPACITY);
    expect(recovered.shakeScale).toBe(1);
    expect(TEXT_SCALES).toContain(recovered.textScale);
    expect(validatePresentation(recovered)).toEqual([]);
  });

  it("never let the interface fade to nothing", () => {
    expect(MIN_HUD_OPACITY).toBeGreaterThan(0.25);
    expect(normalisePresentation({ hudOpacity: -5 }).hudOpacity).toBe(MIN_HUD_OPACITY);
  });

  it("keep a critical warning at full strength however far the HUD is faded", () => {
    // The explicit failure mode: hiding critical information for a clean look.
    const faded = { ...defaultPresentation(), hudOpacity: MIN_HUD_OPACITY };
    expect(styleFor("critical", faded).opacity).toBe(1);
    expect(styleFor("info", faded).opacity).toBe(MIN_HUD_OPACITY);
    expect(criticalRemainsVisible(faded)).toBe(true);
  });

  it("keep a critical warning readable at the smallest text size", () => {
    const small = { ...defaultPresentation(), textScale: TEXT_SCALES[0]! };
    expect(criticalRemainsVisible(small)).toBe(true);
    // And critical text is larger than ordinary text at any setting.
    expect(styleFor("critical", small).fontScale).toBeGreaterThan(styleFor("info", small).fontScale);
  });

  it("stop everything moving when motion is reduced", () => {
    const reduced = { ...defaultPresentation(), reducedMotion: true };
    expect(motionIsBounded(reduced)).toBe(true);
    for (const severity of SEVERITIES) expect(styleFor(severity, reduced).motionMs).toBe(0);
    expect(styleFor("critical", reduced).mayPulse).toBe(false);
  });

  it("keep every animation inside the ceiling otherwise", () => {
    expect(motionIsBounded(defaultPresentation())).toBe(true);
  });

  it("scale shake down but never up", () => {
    expect(shakeFor(1, defaultPresentation())).toBe(1);
    expect(shakeFor(1, { ...defaultPresentation(), shakeScale: 0.5 })).toBe(0.5);
    expect(shakeFor(1, { ...defaultPresentation(), reducedMotion: true })).toBe(0);
    expect(shakeFor(1, normalisePresentation({ shakeScale: 5 }))).toBe(1);
  });

  it("survive every combination without losing anything critical", () => {
    for (const preset of COLOUR_VISION_PRESETS) {
      for (const scale of TEXT_SCALES) {
        for (const contrast of [true, false]) {
          const settings = {
            ...defaultPresentation(),
            colourVision: preset,
            textScale: scale,
            highContrast: contrast,
            hudOpacity: MIN_HUD_OPACITY,
          };
          expect(criticalRemainsVisible(settings), `${preset} ${scale} ${contrast}`).toBe(true);
        }
      }
    }
  });
});
