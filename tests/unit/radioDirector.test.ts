import { describe, expect, it } from "vitest";
import {
  createRadioLineRegistry,
  createSpeakerRegistry,
  priorityRank,
  RADIO_LINES,
  SPEAKERS_LIST,
  validateRadioLine,
  validateSpeaker,
  voiceSlots,
  type RadioLineDefinition,
} from "../../src/data/radioLines";
import {
  emptyRadioSnapshot,
  MAX_QUEUE,
  RadioDirector,
  validateRadioSave,
} from "../../src/audio/radioDirector";

const line = (id: string): RadioLineDefinition => RADIO_LINES.find((entry) => entry.id === id)!;

describe("the line catalogue", () => {
  it("registers every speaker and every line", () => {
    expect(createSpeakerRegistry().all()).toHaveLength(SPEAKERS_LIST.length);
    expect(createRadioLineRegistry().all()).toHaveLength(RADIO_LINES.length);
  });

  it("gives every line its own written text, so silence is still readable", () => {
    for (const entry of RADIO_LINES) {
      expect(entry.text.trim().length).toBeGreaterThan(8);
      expect(validateRadioLine(entry)).toEqual([]);
    }
  });

  it("refuses a line that carries no text of its own", () => {
    expect(validateRadioLine({ ...line("radio.victory"), text: "..." }).join(" ")).toMatch(
      /must carry its own text/,
    );
  });

  it("refuses a critical line that something could cut off", () => {
    const wrong = { ...line("radio.reactor.critical"), interruptible: true };
    expect(validateRadioLine(wrong).join(" ")).toMatch(/cannot be interruptible/);
  });

  it("gives every speaker a callsign and a band", () => {
    for (const speaker of SPEAKERS_LIST) {
      expect(validateSpeaker(speaker)).toEqual([]);
      expect(speaker.band[1]).toBeGreaterThan(speaker.band[0]);
    }
  });

  it("puts the copilot in the room and everybody else on the radio", () => {
    expect(SPEAKERS_LIST.find((speaker) => speaker.id === "copilot")?.bus).toBe("dialogue");
    expect(SPEAKERS_LIST.find((speaker) => speaker.id === "loccent")?.bus).toBe("radio");
  });

  it("names a recording slot for the lines that would have one", () => {
    expect(voiceSlots().length).toBeGreaterThan(15);
  });

  it("orders priorities so critical beats everything", () => {
    expect(priorityRank("critical")).toBeGreaterThan(priorityRank("high"));
    expect(priorityRank("chatter")).toBeLessThan(priorityRank("low"));
  });
});

describe("one voice at a time", () => {
  it("speaks when the channel is clear", () => {
    const radio = new RadioDirector();
    const decision = radio.request("radio.deploy.launch", 0);
    expect(decision.outcome).toBe("spoken");
    expect(radio.subtitle()?.callsign).toBe("MARSHAL");
  });

  it("queues an equal-priority line rather than talking over it", () => {
    const radio = new RadioDirector();
    radio.request("radio.deploy.launch", 0);
    const second = radio.request("radio.carrier.approach", 0.1);
    expect(second.outcome).toBe("queued");
    expect(radio.speaking?.line.id).toBe("radio.deploy.launch");
  });

  it("cuts an interruptible line off for something more important", () => {
    const radio = new RadioDirector();
    radio.request("radio.contact.inbound", 0);
    const cut = radio.request("radio.reactor.critical", 0.5);
    expect(cut.outcome).toBe("spoken");
    expect(cut.interrupted).toBe("radio.contact.inbound");
    expect(radio.speaking?.line.id).toBe("radio.reactor.critical");
    expect(radio.records().some((record) => record.outcome === "interrupted")).toBe(true);
  });

  it("never cuts a critical line off for another one", () => {
    const radio = new RadioDirector();
    radio.request("radio.reactor.critical", 0);
    const second = radio.request("radio.conn.pod.failing", 0.2);
    expect(radio.speaking?.line.id).toBe("radio.reactor.critical");
    expect(second.outcome).toBe("queued");
  });

  it("marks a line that came in over another, so the band can explain itself", () => {
    const radio = new RadioDirector();
    radio.request("radio.contact.inbound", 0);
    expect(radio.subtitle()?.interrupting).toBe(false);
    radio.request("radio.breach.detected", 0.4);
    expect(radio.subtitle()?.interrupting).toBe(true);
  });

  it("drops chatter rather than making a warning wait behind it", () => {
    const radio = new RadioDirector();
    radio.request("radio.reactor.critical", 0);
    const chatter = radio.request("radio.chatter.dome", 0.1);
    expect(chatter.outcome).toBe("dropped");
    expect(radio.waiting).toHaveLength(0);
  });

  it("starts the next queued line the moment the channel clears", () => {
    const radio = new RadioDirector();
    radio.request("radio.deploy.launch", 0);
    radio.request("radio.carrier.approach", 0.1);
    radio.update(20);
    expect(radio.speaking?.line.id).toBe("radio.carrier.approach");
  });

  it("puts a more important queued line in front of a less important one", () => {
    const radio = new RadioDirector();
    // A critical line nothing may cut off, so both of the others have to wait
    // and the order they wait in is the thing under test.
    radio.request("radio.breach.detected", 0);
    radio.request("radio.site.discovered", 0.1);
    radio.request("radio.ally.down", 0.2);
    expect(radio.waiting.map((entry) => entry.id)).toEqual(["radio.ally.down", "radio.site.discovered"]);
  });

  it("bounds the queue and drops the least important thing waiting", () => {
    const radio = new RadioDirector();
    radio.request("radio.breach.detected", 0);
    for (const entry of RADIO_LINES) radio.request(entry.id, 0.1);
    expect(radio.waiting.length).toBeLessThanOrEqual(MAX_QUEUE);
    expect(radio.records().filter((r) => r.priority === "critical" && r.outcome === "dropped")).toHaveLength(
      0,
    );
  });

  it("refuses to repeat a line while its cooldown is running", () => {
    const radio = new RadioDirector();
    radio.request("radio.victory", 0);
    radio.update(10);
    const again = radio.request("radio.victory", 5);
    expect(again.outcome).toBe("refused");
    expect(again.reason).toMatch(/cooldown/);
    expect(radio.request("radio.victory", 500).outcome).toBe("spoken");
  });

  it("refuses a line that is already waiting rather than queuing it twice", () => {
    const radio = new RadioDirector();
    radio.request("radio.deploy.launch", 0);
    radio.request("radio.carrier.approach", 0.1);
    expect(radio.request("radio.carrier.approach", 0.2).outcome).toBe("refused");
  });

  it("refuses a line nobody wrote", () => {
    expect(new RadioDirector().request("radio.nonsense", 0).outcome).toBe("refused");
  });
});

describe("ducking", () => {
  it("asks for nothing while nobody is speaking", () => {
    expect(new RadioDirector().duckRequests()).toEqual([]);
  });

  it("pushes hardest for a critical line", () => {
    const radio = new RadioDirector();
    radio.request("radio.reactor.critical", 0);
    expect(radio.duckRequests()[0]?.strength).toBe(1);
  });

  it("ducks on the speaker's own bus, so the copilot is not a radio call", () => {
    const radio = new RadioDirector();
    radio.request("radio.drift.stable", 0);
    expect(radio.duckRequests()[0]?.busId).toBe("dialogue");
  });
});

describe("the conversation record", () => {
  it("keeps what was said, in order, with a time on it", () => {
    const radio = new RadioDirector();
    radio.request("radio.deploy.launch", 0);
    radio.update(10);
    radio.request("radio.victory", 20);
    radio.update(40);
    const records = radio.records();
    expect(records).toHaveLength(2);
    expect(records[0]?.lineId).toBe("radio.deploy.launch");
    expect(records[1]?.atSeconds).toBe(20);
  });

  it("reads back newest first", () => {
    const radio = new RadioDirector();
    radio.request("radio.deploy.launch", 0);
    radio.update(10);
    radio.request("radio.victory", 20);
    radio.update(40);
    expect(radio.transcript(1)[0]?.lineId).toBe("radio.victory");
  });

  it("is bounded, dropping the oldest rather than growing forever", () => {
    const radio = new RadioDirector({ maxRecords: 3 });
    let at = 0;
    for (let round = 0; round < 4; round += 1) {
      for (const entry of RADIO_LINES.slice(0, 3)) {
        radio.request(entry.id, at);
        at += 400;
        radio.update(at);
      }
    }
    expect(radio.records().length).toBeLessThanOrEqual(3);
  });

  it("survives a save and a load, cooldowns included", () => {
    const radio = new RadioDirector();
    radio.request("radio.breach.detected", 0);
    radio.update(10);
    const saved = radio.toSave();
    expect(validateRadioSave(saved)).toEqual([]);

    const reloaded = new RadioDirector();
    reloaded.restore(saved);
    expect(reloaded.records()).toHaveLength(1);
    // Still on cooldown, so reloading does not let the breach warning fire again.
    expect(reloaded.request("radio.breach.detected", 11).outcome).toBe("refused");
  });

  it("skips a record for a line that no longer exists rather than refusing to load", () => {
    const radio = new RadioDirector();
    radio.restore({
      schemaVersion: 1,
      records: [
        {
          lineId: "radio.deleted",
          speaker: "loccent",
          text: "Something a previous build said.",
          priority: "normal",
          atSeconds: 4,
          outcome: "spoken",
        },
      ],
      lastSpoken: { "radio.deleted": 4 },
    });
    expect(radio.records()).toHaveLength(0);
  });

  it("starts empty for a campaign that has heard nothing", () => {
    expect(emptyRadioSnapshot().records).toEqual([]);
    expect(validateRadioSave(emptyRadioSnapshot())).toEqual([]);
  });

  it("refuses a radio section that is the wrong shape", () => {
    expect(validateRadioSave(null).length).toBeGreaterThan(0);
    expect(validateRadioSave({ schemaVersion: 1, records: "no", lastSpoken: {} }).length).toBeGreaterThan(0);
  });

  it("clears the channel and records what was cut when a scene changes", () => {
    const radio = new RadioDirector();
    radio.request("radio.contact.inbound", 0);
    radio.request("radio.deploy.launch", 0.1);
    radio.silence(1);
    expect(radio.speaking).toBeNull();
    expect(radio.waiting).toHaveLength(0);
    expect(radio.records().map((record) => record.outcome)).toEqual(["interrupted", "dropped"]);
  });
});
