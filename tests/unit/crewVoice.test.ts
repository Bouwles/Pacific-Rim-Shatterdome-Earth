import { describe, expect, it } from "vitest";
import { createPilotRegistry } from "../../src/data/pilots";
import { CREW_MOMENTS, crewLineId, crewLines, durationOf } from "../../src/audio/crewVoice";
import { validateRadioLine } from "../../src/data/radioLines";
import { RadioDirector } from "../../src/audio/radioDirector";

const pilots = createPilotRegistry().all();
const first = pilots[0]!;

describe("the crew on the radio", () => {
  it("turns every authored line into a radio line", () => {
    const authored = CREW_MOMENTS.reduce((sum, moment) => sum + first.dialogue[moment].length, 0);
    expect(crewLines(first)).toHaveLength(authored);
  });

  it("produces lines the radio would accept", () => {
    for (const pilot of pilots) {
      for (const line of crewLines(pilot)) expect(validateRadioLine(line)).toEqual([]);
    }
  });

  it("puts the crew in the pod rather than on a radio", () => {
    for (const line of crewLines(first)) expect(line.speaker).toBe("copilot");
  });

  it("says who is speaking, in the line itself", () => {
    for (const line of crewLines(first)) expect(line.text.startsWith(first.callsign)).toBe(true);
  });

  it("never lets the crew sit on top of a warning", () => {
    for (const line of crewLines(first)) expect(line.interruptible).toBe(true);
  });

  it("makes off-duty talk droppable and damage calls not", () => {
    const lines = crewLines(first);
    const offDuty = lines.find((line) => line.id.includes(".offDuty."));
    const damage = lines.find((line) => line.id.includes(".onDamage."));
    expect(offDuty?.priority).toBe("chatter");
    expect(damage?.priority).toBe("high");
  });

  it("promises no recording, so a missing file is never a missing line", () => {
    for (const line of crewLines(first)) expect(line.assetSlot).toBe("");
  });

  it("lets a chattier pilot come up more often", () => {
    const sorted = [...pilots].sort((a, b) => a.dialogue.chattiness - b.dialogue.chattiness);
    const quiet = crewLines(sorted[0]!)[0]!;
    const loud = crewLines(sorted[sorted.length - 1]!)[0]!;
    expect(loud.cooldownSeconds).toBeLessThanOrEqual(quiet.cooldownSeconds);
  });

  it("scales how long a line takes to how much there is to say", () => {
    expect(durationOf("Go.")).toBeLessThan(durationOf("Reactor is nominal, and I intend to keep it there."));
    expect(durationOf("Go.")).toBeGreaterThanOrEqual(1_400);
  });

  it("registers with the radio and then speaks through the ordinary queue", () => {
    const radio = new RadioDirector();
    const line = crewLines(first).find((entry) => entry.id.includes(".onDeploy."))!;
    expect(radio.define(line)).toEqual([]);
    expect(radio.request(line.id, 0).outcome).toBe("spoken");
    expect(radio.subtitle()?.text).toContain(first.callsign);

    // And a warning still cuts straight through them.
    const cut = radio.request("radio.reactor.critical", 0.2);
    expect(cut.outcome).toBe("spoken");
    expect(cut.interrupted).toBe(line.id);
  });

  it("replaces a pilot's lines rather than doubling them when registered twice", () => {
    const radio = new RadioDirector();
    const line = crewLines(first)[0]!;
    radio.define(line);
    radio.define(line);
    expect(radio.request(line.id, 0).outcome).toBe("spoken");
  });

  it("refuses a runtime line that carries no text", () => {
    const radio = new RadioDirector();
    const broken = { ...crewLines(first)[0]!, text: "hm" };
    expect(radio.define(broken).length).toBeGreaterThan(0);
    expect(radio.request(broken.id, 0).outcome).toBe("refused");
  });

  it("gives a stable id, so a cooldown survives a save", () => {
    expect(crewLineId("pilot.example", "onDeploy", 0)).toBe("radio.crew.pilot.example.onDeploy.0");
  });
});
