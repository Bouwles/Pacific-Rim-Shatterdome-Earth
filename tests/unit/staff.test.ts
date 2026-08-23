import { describe, expect, it } from "vitest";
import {
  CHATTER_INTERVAL_TICKS,
  activeStaffPoses,
  ambientChatter,
  fillLine,
  lineFrom,
  shiftLoadFor,
  type ChatterContext,
} from "../../src/shatterdome/staff";
import {
  CREW_MEMBERS,
  SHIFTS,
  createCrewRegistry,
  shiftAt,
  shiftCovers,
  validateCrewMember,
} from "../../src/data/personnel";
import { room } from "./onFootFixtures";

const CONTEXT: ChatterContext = {
  facilityId: "command",
  facilityName: "LOCCENT Command",
  tier: 1,
  status: "operational",
  powerText: "162 of 220 MW",
  crewText: "3 of 3",
  staffText: "6",
  timeText: "10:48",
};

describe("named crew", () => {
  it("registers everyone with a real post and a real shift", () => {
    const registry = createCrewRegistry();
    expect(registry.all().length).toBe(CREW_MEMBERS.length);
    for (const member of registry.all()) {
      expect(member.lines.length).toBeGreaterThan(0);
      expect(SHIFTS).toContain(member.shift);
    }
  });

  it("refuses a line with a placeholder nothing can fill", () => {
    const base = CREW_MEMBERS[0];
    if (!base) throw new Error("no crew");
    const errors = validateCrewMember({ ...base, lines: ["Reactor at {gigawatts}."] });
    expect(errors.join(" ")).toMatch(/gigawatts/);
  });

  it("covers the whole day with three shifts and no gap", () => {
    for (let fraction = 0; fraction < 1; fraction += 0.01) {
      const covering = SHIFTS.filter((shift) => shiftCovers(shift, fraction));
      expect(covering).toHaveLength(1);
      expect(shiftAt(fraction)).toBe(covering[0]);
    }
  });

  it("puts named crew in more than one facility, so the complex is not one room", () => {
    const facilities = new Set(CREW_MEMBERS.map((member) => member.facilityId));
    expect(facilities.size).toBeGreaterThan(6);
  });
});

describe("shift loads", () => {
  it("staffs a facility from its slots, thinning out overnight", () => {
    const day = shiftLoadFor("command", 12, 0.5);
    const night = shiftLoadFor("command", 12, 0.98);
    expect(day.onShift).toBeGreaterThan(night.onShift);
    expect(day.onShift).toBeLessThanOrEqual(day.slots);
    expect(night.shift).toBe("night");
  });

  it("never rounds a staffed facility down to nobody", () => {
    expect(shiftLoadFor("archive", 2, 0.98).onShift).toBeGreaterThan(0);
  });

  it("reports nobody in a facility with no posts", () => {
    expect(shiftLoadFor("archive", 0, 0.5).onShift).toBe(0);
  });

  it("costs one number per facility however many people are in it", () => {
    // A thousand-slot facility is the same amount of work to answer as a two.
    const huge = shiftLoadFor("quarters", 1_000, 0.5);
    expect(huge.onShift).toBeGreaterThan(500);
    expect(Object.keys(huge)).toEqual(["facilityId", "shift", "slots", "onShift"]);
  });
});

describe("ambient work", () => {
  it("puts people at the posts the room has", () => {
    const space = room({
      staffSlots: 6,
      staffPosts: [
        { x: -3, z: 2 },
        { x: 3, z: 2 },
      ],
    });
    const poses = activeStaffPoses(space, 100, 0.5, 20);
    expect(poses.length).toBeGreaterThan(0);
    for (const pose of poses) {
      expect(Math.abs(pose.x)).toBeLessThan(space.widthMeters / 2);
      expect(Math.abs(pose.z)).toBeLessThan(space.depthMeters / 2);
    }
  });

  it("never draws more people than the quality budget allows", () => {
    const space = room({ staffSlots: 200, staffPosts: [{ x: 0, z: 0 }] });
    expect(activeStaffPoses(space, 0, 0.5, 6)).toHaveLength(6);
    expect(activeStaffPoses(space, 0, 0.5, 0)).toHaveLength(0);
  });

  it("has nobody to draw in a room with no posts", () => {
    expect(activeStaffPoses(room({ staffSlots: 10, staffPosts: [] }), 0, 0.5, 10)).toHaveLength(0);
  });

  it("is the same room at the same tick every time, with no state in between", () => {
    const space = room({
      staffSlots: 8,
      staffPosts: [
        { x: -2, z: 1 },
        { x: 2, z: 1 },
      ],
    });
    expect(activeStaffPoses(space, 1_234, 0.5, 12)).toEqual(activeStaffPoses(space, 1_234, 0.5, 12));
  });

  it("moves some people between posts and keeps others working where they stand", () => {
    const space = room({
      staffSlots: 10,
      staffPosts: [
        { x: -4, z: 1 },
        { x: 4, z: 1 },
      ],
    });
    const early = activeStaffPoses(space, 0, 0.5, 12);
    const later = activeStaffPoses(space, 600, 0.5, 12);
    expect(early.some((pose) => pose.activity === "walking")).toBe(true);
    expect(early.some((pose) => pose.activity === "working")).toBe(true);
    const walkerEarly = early.find((pose) => pose.activity === "walking");
    const walkerLater = later.find((pose) => pose.index === walkerEarly?.index);
    expect(walkerLater?.x).not.toBe(walkerEarly?.x);
  });
});

describe("radio chatter", () => {
  it("fills a line from live state rather than from prose", () => {
    expect(fillLine("{facility} at tier {tier}: {power}, {crews} crews.", CONTEXT)).toBe(
      "LOCCENT Command at tier 1: 162 of 220 MW, 3 of 3 crews.",
    );
  });

  it("leaves no placeholder unfilled in any shipped line", () => {
    for (const member of CREW_MEMBERS) {
      for (const line of member.lines) {
        expect(fillLine(line, { ...CONTEXT, facilityId: member.facilityId })).not.toMatch(/[{}]/);
      }
    }
  });

  it("says the same thing at the same tick every run", () => {
    const first = ambientChatter(CREW_MEMBERS, CONTEXT, 100, 0.4);
    expect(ambientChatter(CREW_MEMBERS, CONTEXT, 100, 0.4)).toEqual(first);
    expect(first?.tick).toBe(100);
  });

  it("moves on to a new line in the next interval", () => {
    const first = ambientChatter(CREW_MEMBERS, CONTEXT, 10, 0.4);
    const next = ambientChatter(CREW_MEMBERS, CONTEXT, CHATTER_INTERVAL_TICKS * 4 + 10, 0.4);
    expect(next?.id).not.toBe(first?.id);
  });

  it("holds a line for the whole interval, so the radio is not a stream", () => {
    const inBucket = ambientChatter(CREW_MEMBERS, CONTEXT, 10, 0.4);
    const stillInBucket = ambientChatter(CREW_MEMBERS, CONTEXT, CHATTER_INTERVAL_TICKS - 1, 0.4);
    expect(stillInBucket?.text).toBe(inBucket?.text);
  });

  it("prefers whoever is actually on shift", () => {
    const night = ambientChatter(CREW_MEMBERS, CONTEXT, 5, 0.98);
    // The night line in command belongs to the LOCCENT officer, not the Marshal.
    expect(night?.speaker).toBe("Lieutenant Bo Ferrant");
  });

  it("says nothing for a facility nobody is posted to", () => {
    expect(ambientChatter([], CONTEXT, 0, 0.5)).toBeNull();
  });

  it("gives a named character their own line when spoken to", () => {
    const marshal = CREW_MEMBERS.find((member) => member.id === "crew.marshal");
    if (!marshal) throw new Error("no marshal");
    const line = lineFrom(marshal, CONTEXT, 500);
    expect(line.speaker).toBe(marshal.name);
    expect(line.role).toBe(marshal.role);
    expect(line.text.length).toBeGreaterThan(0);
    expect(lineFrom(marshal, CONTEXT, 500)).toEqual(line);
  });
});
