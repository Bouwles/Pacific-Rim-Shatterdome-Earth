import { describe, expect, it } from "vitest";
import {
  COMPONENT_DEFINITIONS,
  componentHealth,
  createComponentRegistry,
  kindScale,
  structureBudget,
  validateComponent,
  type ComponentDefinition,
} from "../../src/data/components";
import {
  MAX_SCARS,
  applyComponentDamage,
  componentFraction,
  componentState,
  createDamageState,
  disabledSystems,
  isDisabled,
  liveMounts,
  mobilityPenalty,
  recordScar,
  repairComponent,
  repairOrder,
  restoreDamage,
  serializeDamage,
  stateForFraction,
  structuralIntegrity,
  validateDamageSnapshot,
} from "../../src/jaegers/damage";
import { jaegerRegistry } from "../../src/data/jaegers";

const registry = createComponentRegistry();
const JAEGER = jaegerRegistry.getOrThrow("placeholder-mk0");

function damaged() {
  return createDamageState(JAEGER, registry);
}

function componentBy(id: string): ComponentDefinition {
  return registry.getOrThrow(id);
}

describe("the component table", () => {
  it("ships components that all validate", () => {
    for (const component of COMPONENT_DEFINITIONS) {
      expect(validateComponent(component), component.id).toEqual([]);
    }
  });

  it("divides exactly one machine between them", () => {
    const shares = COMPONENT_DEFINITIONS.reduce((total, entry) => total + entry.healthShare, 0);
    expect(shares).toBeCloseTo(1, 3);
  });

  it("has at least one component whose loss ends the sortie", () => {
    expect(COMPONENT_DEFINITIONS.some((entry) => entry.critical)).toBe(true);
  });

  it("refuses a component nobody would feel the loss of", () => {
    const errors = validateComponent({
      ...componentBy("component.torso"),
      id: "component.decoration",
      disables: [],
      mounts: [],
      critical: false,
    });
    expect(errors.join(" ")).toMatch(/losing it has to cost something/);
  });

  it("refuses impossible armour and shares", () => {
    expect(validateComponent({ ...componentBy("component.torso"), armor: 1 }).join(" ")).toMatch(
      /armor must be between zero and one/,
    );
    expect(validateComponent({ ...componentBy("component.torso"), healthShare: 0 }).join(" ")).toMatch(
      /healthShare must be above zero/,
    );
  });

  it("scales a component with the machine it is on", () => {
    const heavy = jaegerRegistry.getOrThrow("heavy-mk4");
    expect(structureBudget(heavy)).toBeGreaterThan(structureBudget(JAEGER));
    expect(componentHealth(heavy, componentBy("component.torso"))).toBeGreaterThan(
      componentHealth(JAEGER, componentBy("component.torso")),
    );
  });

  it("routes damage kinds to the components that fear them", () => {
    // A neural weapon is worth more against a Conn-Pod than against a leg, and
    // nobody has to know a weapon by name for that to be true.
    expect(kindScale(componentBy("component.conn-pod"), "neural")).toBeGreaterThan(
      kindScale(componentBy("component.leg.left"), "neural"),
    );
    expect(kindScale(componentBy("component.reactor"), "pierce")).toBeGreaterThan(1);
    expect(kindScale(componentBy("component.torso"), "neural")).toBe(1);
  });
});

describe("component damage", () => {
  it("is not one health bar", () => {
    const state = damaged();
    expect(state.components.length).toBe(COMPONENT_DEFINITIONS.length);
    const arm = state.components.find((entry) => entry.componentId === "component.arm.right");
    const leg = state.components.find((entry) => entry.componentId === "component.leg.left");
    applyComponentDamage(state, registry, "component.arm.right", 5_000, "shear", 1);
    expect(componentState(arm!)).toBe("destroyed");
    // The rest of the machine is untouched, which is the entire point.
    expect(componentState(leg!)).toBe("intact");
  });

  it("routes by kind, so the same blow is worth more in the wrong place", () => {
    const podState = damaged();
    const legState = damaged();
    const pod = applyComponentDamage(podState, registry, "component.conn-pod", 200, "neural", 7);
    const leg = applyComponentDamage(legState, registry, "component.leg.left", 200, "neural", 7);
    const podFraction =
      1 - componentFraction(podState.components.find((e) => e.componentId === "component.conn-pod")!);
    const legFraction =
      1 - componentFraction(legState.components.find((e) => e.componentId === "component.leg.left")!);
    expect(pod?.applied).toBeGreaterThan(0);
    expect(leg?.applied).toBeGreaterThan(0);
    expect(podFraction).toBeGreaterThan(legFraction);
  });

  it("names the states rather than leaving a number to interpret", () => {
    expect(stateForFraction(1)).toBe("intact");
    expect(stateForFraction(0.8)).toBe("scarred");
    expect(stateForFraction(0.5)).toBe("damaged");
    expect(stateForFraction(0.1)).toBe("critical");
    expect(stateForFraction(0)).toBe("destroyed");
  });

  it("says what went offline, in words", () => {
    const state = damaged();
    const result = applyComponentDamage(state, registry, "component.arm.right", 9_000, "shear", 3);
    expect(result?.destroyed).toBe(true);
    expect(result?.message).toMatch(/Right arm destroyed/);
    expect(result?.disabled).toContain("weapons.right");
  });

  it("stops a destroyed component absorbing anything more", () => {
    const state = damaged();
    applyComponentDamage(state, registry, "component.arm.right", 9_000, "shear", 3);
    const again = applyComponentDamage(state, registry, "component.arm.right", 500, "shear", 4);
    expect(again?.applied).toBe(0);
    expect(again?.message).toMatch(/already gone/);
  });

  it("derives what is offline instead of storing it", () => {
    const state = damaged();
    expect(disabledSystems(state, registry)).toEqual([]);
    applyComponentDamage(state, registry, "component.leg.left", 9_000, "crush", 5);
    expect(disabledSystems(state, registry)).toContain("movement");
    expect(isDisabled(state, registry)).toBe(false);
    applyComponentDamage(state, registry, "component.reactor", 20_000, "pierce", 6);
    // The reactor is critical, so now the machine is out of the fight.
    expect(isDisabled(state, registry)).toBe(true);
  });

  it("takes the weapon mounts with the arm they were on", () => {
    const state = damaged();
    expect(liveMounts(state, registry)).toContain("arm.right");
    applyComponentDamage(state, registry, "component.arm.right", 9_000, "shear", 8);
    expect(liveMounts(state, registry)).not.toContain("arm.right");
    expect(liveMounts(state, registry)).toContain("arm.left");
  });

  it("slows a machine with a bad leg and stops one with no leg", () => {
    const fine = mobilityPenalty(damaged(), registry);
    expect(fine.speedScale).toBe(1);
    expect(fine.summary).toBe("all systems answering");

    const limping = damaged();
    applyComponentDamage(limping, registry, "component.leg.left", 300, "crush", 9);
    const limp = mobilityPenalty(limping, registry);
    expect(limp.speedScale).toBeLessThan(1);

    const towed = damaged();
    applyComponentDamage(towed, registry, "component.leg.left", 9_000, "crush", 10);
    const hobbled = mobilityPenalty(towed, registry);
    expect(hobbled.speedScale).toBeLessThan(limp.speedScale);
    expect(hobbled.summary).toMatch(/one leg/);
  });
});

describe("scars", () => {
  it("records a mark for a blow worth remembering and ignores a scratch", () => {
    const state = damaged();
    expect(recordScar(state, "component.torso", 0.01, "impact", 11)).toBeNull();
    expect(recordScar(state, "component.torso", 0.4, "impact", 11)).not.toBeNull();
    expect(state.scars.length).toBe(1);
  });

  it("is bounded, and keeps the worst rather than the newest", () => {
    const state = damaged();
    for (let index = 0; index < MAX_SCARS + 10; index += 1) {
      recordScar(state, "component.torso", 0.1 + index * 0.01, "impact", index);
    }
    expect(state.scars.length).toBe(MAX_SCARS);
    const mildest = Math.min(...state.scars.map((scar) => scar.severity));
    // The very first, mildest marks are the ones that went.
    expect(mildest).toBeGreaterThan(0.1);
  });

  it("is four numbers, not a pile of debris transforms", () => {
    const state = damaged();
    recordScar(state, "component.torso", 0.5, "shear", 42);
    const snapshot = serializeDamage(state);
    const scar = snapshot.scars[0];
    expect(Object.keys(scar ?? {}).sort()).toEqual(["componentId", "kind", "seed", "severity"]);
  });
});

describe("repair", () => {
  it("prices and times the work from the damage itself", () => {
    const state = damaged();
    expect(repairOrder(state, registry).lines).toEqual([]);
    applyComponentDamage(state, registry, "component.arm.right", 400, "shear", 12);
    const order = repairOrder(state, registry);
    expect(order.lines.length).toBe(1);
    expect(order.totalHours).toBeGreaterThan(0);
    expect(order.totalCost).toBeGreaterThan(0);
    expect(order.summary).toMatch(/hours/);
  });

  it("charges more to replace a component than to patch one", () => {
    const patched = damaged();
    applyComponentDamage(patched, registry, "component.arm.right", 300, "shear", 13);
    const wrecked = damaged();
    applyComponentDamage(wrecked, registry, "component.arm.right", 90_000, "shear", 13);
    const patchedLine = repairOrder(patched, registry).lines[0];
    const wreckedLine = repairOrder(wrecked, registry).lines[0];
    expect(wreckedLine?.replace).toBe(true);
    expect(patchedLine?.replace).toBe(false);
    expect(wreckedLine!.cost / wreckedLine!.missing).toBeGreaterThan(
      patchedLine!.cost / patchedLine!.missing,
    );
  });

  it("puts hours in and gets structure back, and clears the marks with the plate", () => {
    const state = damaged();
    applyComponentDamage(state, registry, "component.arm.right", 400, "shear", 14);
    expect(state.scars.some((scar) => scar.componentId === "component.arm.right")).toBe(true);
    const order = repairOrder(state, registry);
    const partial = repairComponent(state, registry, "component.arm.right", order.totalHours / 2);
    expect(partial.finished).toBe(false);
    expect(partial.restored).toBeGreaterThan(0);
    // Half the work is half the job, and the marks are still there.
    expect(state.scars.length).toBeGreaterThan(0);
    repairComponent(state, registry, "component.arm.right", order.totalHours);
    expect(structuralIntegrity(state)).toBeCloseTo(1, 5);
    expect(state.scars.some((scar) => scar.componentId === "component.arm.right")).toBe(false);
  });

  it("says so plainly when there is nothing to do", () => {
    const state = damaged();
    expect(repairComponent(state, registry, "component.torso", 5).message).toMatch(/needs nothing/);
    expect(repairComponent(state, registry, "component.nonsense", 5).message).toMatch(/No component/);
  });
});

describe("the saved record", () => {
  it("is compact: fractions and marks, not health bars and debris", () => {
    const state = damaged();
    applyComponentDamage(state, registry, "component.leg.left", 500, "crush", 15);
    const snapshot = serializeDamage(state);
    expect(validateDamageSnapshot(snapshot)).toEqual([]);
    expect(JSON.stringify(snapshot).length).toBeLessThan(2_000);
    for (const entry of snapshot.components) {
      expect(entry.fraction).toBeGreaterThanOrEqual(0);
      expect(entry.fraction).toBeLessThanOrEqual(1);
    }
  });

  it("comes back the same machine", () => {
    const state = damaged();
    applyComponentDamage(state, registry, "component.leg.left", 500, "crush", 16);
    applyComponentDamage(state, registry, "component.arm.right", 9_000, "shear", 17);
    const restored = restoreDamage(serializeDamage(state), JAEGER, registry);
    expect(Math.round(structuralIntegrity(restored) * 1000)).toBe(
      Math.round(structuralIntegrity(state) * 1000),
    );
    expect(disabledSystems(restored, registry)).toEqual(disabledSystems(state, registry));
    expect(restored.scars.length).toBe(state.scars.length);
  });

  it("takes maximum health from the build rather than the file", () => {
    const state = damaged();
    applyComponentDamage(state, registry, "component.torso", 400, "impact", 18);
    const heavy = jaegerRegistry.getOrThrow("heavy-mk4");
    const restored = restoreDamage(serializeDamage(state), heavy, registry);
    const torso = restored.components.find((entry) => entry.componentId === "component.torso");
    // Rebalancing a chassis must not leave an old save carrying the old numbers.
    expect(torso?.maxHealth).toBe(componentHealth(heavy, componentBy("component.torso")));
  });

  it("ignores a component this build has never heard of", () => {
    const snapshot = {
      jaegerId: JAEGER.id,
      components: [{ id: "component.tail", fraction: 0.5 }],
      scars: [{ componentId: "component.tail", severity: 0.5, kind: "impact" as const, seed: 1 }],
    };
    const restored = restoreDamage(snapshot, JAEGER, registry);
    expect(restored.scars).toEqual([]);
    expect(structuralIntegrity(restored)).toBe(1);
  });

  it("refuses a snapshot that is not one", () => {
    expect(validateDamageSnapshot(null).length).toBeGreaterThan(0);
    expect(validateDamageSnapshot({ jaegerId: "", components: "no", scars: 3 }).length).toBeGreaterThan(0);
    expect(
      validateDamageSnapshot({
        jaegerId: "x",
        components: [{ id: "component.torso", fraction: 4 }],
        scars: [],
      }).join(" "),
    ).toMatch(/between zero and one/);
  });
});
