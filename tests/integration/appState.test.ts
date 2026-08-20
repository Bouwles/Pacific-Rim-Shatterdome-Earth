import { describe, expect, it } from "vitest";
import { AppState, AppStateMachine } from "../../src/app/appState";

describe("AppStateMachine (module boundary: app state graph)", () => {
  it("starts in Boot and follows the Milestone 00 happy path", () => {
    const machine = new AppStateMachine();
    expect(machine.state).toBe(AppState.Boot);

    machine.transition(AppState.MainMenu);
    machine.transition(AppState.Loading);
    machine.transition(AppState.Shatterdome);
    machine.transition(AppState.MainMenu);

    expect(machine.state).toBe(AppState.MainMenu);
  });

  it("rejects transitions that skip states with no valid edge", () => {
    const machine = new AppStateMachine();
    expect(machine.canTransition(AppState.Combat)).toBe(false);
    expect(() => machine.transition(AppState.Combat)).toThrow(/Illegal app state transition/);
    expect(machine.state).toBe(AppState.Boot);
  });

  it("Boot can reach Error, and Error can only return to MainMenu", () => {
    const machine = new AppStateMachine();
    expect(machine.canTransition(AppState.Error)).toBe(true);

    machine.transition(AppState.Error);
    expect(machine.canTransition(AppState.MainMenu)).toBe(true);
    expect(machine.canTransition(AppState.Shatterdome)).toBe(false);
  });

  it("notifies listeners with (to, from) and supports unsubscribe", () => {
    const machine = new AppStateMachine();
    const seen: Array<[AppState, AppState]> = [];
    const unsubscribe = machine.onChange((to, from) => seen.push([to, from]));

    machine.transition(AppState.MainMenu);
    unsubscribe();
    machine.transition(AppState.Loading);

    expect(seen).toEqual([[AppState.MainMenu, AppState.Boot]]);
  });
});
