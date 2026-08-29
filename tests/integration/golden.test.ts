import { describe, expect, it } from "vitest";
import { kernelSmokeScenario, runScenario } from "../../src/debug/scenarioRunner";
import { compareStrategies } from "../../src/debug/economyScenario";
import { runCoopBattle } from "../../src/debug/coopScenario";
import { runSandbox } from "../../src/debug/sandboxScenario";
import { runAudioScenario } from "../../src/debug/audioScenario";
import { runFourCombatants, runMaxDestruction, runProjectileBarrage } from "../../src/debug/perfScenario";

/**
 * The golden hashes: the release candidate's simulation, pinned.
 *
 * Every scenario here is deterministic by construction, and its digest is the
 * whole of its behaviour folded to a number. Pinning the numbers turns "the
 * simulation changed" from a feeling into a failed test that names the system
 * that moved.
 *
 * When one of these fails, there are exactly two honest outcomes. Either the
 * change was unintended, and the fix is in the system, or it was intended, and
 * the fix is here, in the same commit, with the change described in its
 * message. Updating a golden value in a commit that claims to change nothing
 * is the lie this file exists to catch.
 */

describe("golden simulation hashes for 1.0.0-rc.1", () => {
  it("the kernel: scatter spawns, 120 ticks of motion, a mid-run despawn", () => {
    expect(runScenario(kernelSmokeScenario).hash).toBe("a72b8e6e321812b1");
  });

  it("the economy: a year of each strategy at standard difficulty", () => {
    expect(compareStrategies().map((run) => ({ strategy: run.strategy, digest: run.digest }))).toEqual([
      { strategy: "fly-everything", digest: 928624916 },
      { strategy: "pick-battles", digest: 1309250875 },
      { strategy: "stand-down", digest: 659846195 },
      { strategy: "explorer", digest: 2745999229 },
    ]);
  });

  it("co-op: a scripted two-player battle on a clean link", () => {
    expect(runCoopBattle().hostDigest).toBe(93817108);
  });

  it("the sandbox: the default scenario under default rules", () => {
    expect(runSandbox().digest).toBe(4196185729);
  });

  it("the soundscape: the four-stage transition journey", () => {
    expect(runAudioScenario().digest).toBe(3481512685);
  });

  it("stress: four combatants", () => {
    expect(runFourCombatants().digest).toBe(2766860353);
  });

  it("stress: the projectile barrage", () => {
    expect(runProjectileBarrage().digest).toBe(3392332748);
  });

  it("stress: maximum destruction", () => {
    expect(runMaxDestruction().digest).toBe(4161602297);
  });
});
