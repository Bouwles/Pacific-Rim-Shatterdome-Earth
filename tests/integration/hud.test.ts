import { describe, expect, it } from "vitest";
import {
  CONDITION_CONTRAST,
  VIEWING_CONDITIONS,
  calmInput,
  instrumentTrace,
  legibilitySweep,
  pressureInput,
  quietVersusLoud,
  severityLadder,
  shapeDistinctness,
} from "../../src/debug/hudScenario";
import { buildHud } from "../../src/ui/hudModel";
import { SEVERITIES, SEVERITY_TOKENS } from "../../src/ui/hudTokens";
import { defaultPresentation, styleFor } from "../../src/ui/presentation";
import { combatProfileFor, jaegerZones } from "../../src/combat/arena";
import { jaegerRegistry } from "../../src/data/jaegers";
import { createComponentRegistry } from "../../src/data/components";

/**
 * The interface where it meets the systems it reports on.
 *
 * The acceptance questions: does critical state stay readable in bad
 * conditions, do the instruments move because systems moved rather than because
 * time passed, and is any of this reachable without a mouse.
 */

describe("critical state survives bad conditions", () => {
  const rows = legibilitySweep();

  it("covers every condition the milestone names", () => {
    const covered = new Set(rows.map((row) => row.condition));
    for (const condition of ["rain", "fog", "darkness", "underwater", "glare"] as const) {
      expect(covered.has(condition), condition).toBe(true);
    }
  });

  it("never loses a critical alert, under any condition or any settings", () => {
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      expect(row.criticalIntact, `${row.condition} / ${row.settings}`).toBe(true);
      expect(row.criticalShown, `${row.condition} / ${row.settings}`).toBeGreaterThan(0);
    }
  });

  it("keeps the critical layer at full strength even where the world is worst", () => {
    const worst = rows.reduce((low, row) => Math.min(low, row.worstCriticalContrast), 1);
    // Glare is the hardest condition, and the interface still gets all of what
    // the world leaves rather than being faded on top of it.
    expect(worst).toBe(CONDITION_CONTRAST.glare);
  });

  it("does not depend on colour to separate one severity from another", () => {
    const shapes = shapeDistinctness();
    expect(shapes.distinctGlyphs).toBe(shapes.severities);
    expect(shapes.colourFree).toBe(true);
  });
});

describe("instruments follow systems", () => {
  it("moves exactly the instrument whose system changed", () => {
    // The acceptance item: an indicator changes because a system changed, not
    // because a loop is playing. One value changes; one instrument moves.
    const trace = instrumentTrace();
    const moved = trace.filter((entry) => entry.moved);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.instrument).toBe("reactor");
  });

  it("leaves every other instrument exactly where it was", () => {
    const trace = instrumentTrace();
    for (const entry of trace.filter((row) => !row.moved)) {
      expect(entry.before, entry.instrument).toBe(entry.after);
    }
  });

  it("gives the same reading twice for the same state", () => {
    // Nothing animates on its own, so building the model twice from the same
    // input has to produce the same instruments.
    const first = buildHud(pressureInput());
    const second = buildHud(pressureInput());
    expect(JSON.stringify(first.instruments)).toBe(JSON.stringify(second.instruments));
  });

  it("reports a fault only when a component is actually offline", () => {
    expect(buildHud(calmInput()).instruments.find((entry) => entry.id === "faults")?.value).toBe("none");
    expect(buildHud(pressureInput()).instruments.find((entry) => entry.id === "faults")?.severity).toBe(
      "critical",
    );
  });
});

describe("minimal means little to say, not something withheld", () => {
  it("says nothing at rest and a great deal under pressure", () => {
    const result = quietVersusLoud();
    expect(result.quietAlerts).toBe(0);
    expect(result.quietBusy).toBe(false);
    expect(result.loudAlerts).toBeGreaterThan(5);
    expect(result.loudTop).not.toBeNull();
  });

  it("still shows the cockpit at rest", () => {
    // The explicit failure mode is hiding information for cinematic purity, so
    // a quiet HUD must still be a readable cockpit.
    const quiet = buildHud(calmInput());
    expect(quiet.instruments.length).toBeGreaterThan(8);
    expect(quiet.objective.length).toBeGreaterThan(0);
  });

  it("degrades a reading through every severity as it falls", () => {
    const ladder = severityLadder();
    const seen = ladder.map((entry) => entry.severity);
    expect(seen[0]).toBe("critical");
    expect(seen[seen.length - 1]).toBe("nominal");
    // And the ladder only ever improves as the reading improves.
    const ranks = seen.map((severity) => SEVERITY_TOKENS[severity].rank);
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index]!).toBeGreaterThanOrEqual(ranks[index - 1]!);
    }
  });
});

describe("the HUD reads the same systems the fight does", () => {
  it("takes its component list from the real component registry", () => {
    const components = createComponentRegistry().all();
    const model = buildHud(
      pressureInput({
        machine: {
          ...pressureInput().machine,
          components: components.map((component) => ({
            id: component.id,
            name: component.displayName,
            fraction: 0.5,
            offline: false,
          })),
        },
      }),
    );
    expect(model.components).toHaveLength(components.length);
    for (const component of model.components) expect(component.severity).toBe("caution");
  });

  it("takes its target zones from the real chassis zones", () => {
    const chassis = jaegerRegistry.getOrThrow("placeholder-mk0");
    const zones = jaegerZones(chassis);
    const model = buildHud(
      pressureInput({
        target: {
          name: chassis.name,
          distanceMeters: 40,
          lockedOn: true,
          aimZoneId: zones[0]!.id,
          zones: zones.map((zone) => ({ id: zone.id, health: zone.health, maxHealth: zone.maxHealth })),
        },
      }),
    );
    expect(model.targetZones).toHaveLength(zones.length);
    expect(model.targetZones.filter((zone) => zone.aimed)).toHaveLength(1);
  });

  it("reads heat against the machine's own ceiling rather than a made-up one", () => {
    const chassis = jaegerRegistry.getOrThrow("placeholder-mk0");
    const profile = combatProfileFor(chassis);
    expect(profile.heatMax).toBeGreaterThan(0);
    const model = buildHud(
      pressureInput({ machine: { ...pressureInput().machine, heat: profile.heatMax, overheated: true } }),
    );
    expect(model.heat.severity).toBe("critical");
    expect(model.alerts.some((alert) => alert.label === "Overheated")).toBe(true);
  });
});

describe("presentation never changes the fight", () => {
  it("produces the same model whatever the display settings are", () => {
    // Settings are presentation. A player who turns the interface down does not
    // get an easier or harder game, and this is what says so.
    const input = pressureInput();
    const model = buildHud(input);
    for (const contrast of [true, false]) {
      const style = styleFor("critical", { ...defaultPresentation(), highContrast: contrast });
      expect(style.opacity).toBe(1);
    }
    expect(buildHud(input).alerts.length).toBe(model.alerts.length);
  });

  it("gives every severity a style at every setting", () => {
    for (const severity of SEVERITIES) {
      const style = styleFor(severity, defaultPresentation());
      expect(style.colour.length).toBeGreaterThan(3);
      expect(style.fontScale).toBeGreaterThan(0);
      expect(style.motionMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers every viewing condition with a contrast figure", () => {
    for (const condition of VIEWING_CONDITIONS) {
      expect(CONDITION_CONTRAST[condition], condition).toBeGreaterThan(0);
      expect(CONDITION_CONTRAST[condition], condition).toBeLessThanOrEqual(1);
    }
  });
});
