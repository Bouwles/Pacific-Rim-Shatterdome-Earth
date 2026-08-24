import { NullEngine, Scene } from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CombatView } from "../../src/engine/combatView";
import { AssetResolver } from "../../src/assets/resolver";
import { createGeneratorRegistry } from "../../src/assets/generators";
import { createAssetRegistry } from "../../src/assets/manifest";
import { createQualityRegistry } from "../../src/data/quality";
import { createKaijuRegistry } from "../../src/data/kaiju";

/**
 * The drawn side of ranged combat.
 *
 * A round that the simulation says is live has to end up in the buffer the
 * renderer hands the GPU, and one that has retired has to leave it. This is the
 * only place that can be proved without looking at a screen.
 */

const quality = createQualityRegistry().getOrThrow("high");
const kaiju = createKaijuRegistry().getOrThrow("kaiju.test-dummy");

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

function makeView(): CombatView {
  return new CombatView({
    scene,
    quality,
    resolver: new AssetResolver(createGeneratorRegistry()),
    assets: createAssetRegistry(),
    kaiju,
    groundHeightAt: () => 0,
  });
}

describe("combat view projectiles", () => {
  it("draws exactly the rounds the pool says are live", () => {
    const view = makeView();
    expect(view.stats().roundsDrawn).toBe(0);

    view.updateProjectiles([
      { east: 10, north: 20, up: 30 },
      { east: 11, north: 21, up: 31 },
      { east: 12, north: 22, up: 32 },
    ]);
    expect(view.stats().roundsDrawn).toBe(3);

    // One landed. What is drawn follows the simulation down as well as up.
    view.updateProjectiles([{ east: 10, north: 20, up: 30 }]);
    expect(view.stats().roundsDrawn).toBe(1);

    view.updateProjectiles([]);
    expect(view.stats().roundsDrawn).toBe(0);
    view.dispose();
  });

  it("never draws more rounds than the quality preset allows", () => {
    const view = makeView();
    const flood = Array.from({ length: quality.maxProjectiles + 40 }, (_, index) => ({
      east: index,
      north: index,
      up: 50,
    }));
    view.updateProjectiles(flood);
    // The ceiling is the budget, not whatever was handed in.
    expect(view.stats().roundsDrawn).toBe(quality.maxProjectiles);
    view.dispose();
  });

  it("stops drawing once disposed", () => {
    const view = makeView();
    view.updateProjectiles([{ east: 1, north: 2, up: 3 }]);
    view.dispose();
    expect(() => view.updateProjectiles([{ east: 1, north: 2, up: 3 }])).not.toThrow();
  });
});
