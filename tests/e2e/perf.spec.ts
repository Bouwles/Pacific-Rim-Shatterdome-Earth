import { expect, test, type Page } from "@playwright/test";

/**
 * The performance contract, in a real browser.
 *
 * The unit and integration suites prove the budgets, the profiler, the
 * adaptive hysteresis and the headless stress scenes. What only a browser
 * proves is that the report carries real environment fields, that repeated
 * combat entry and exit returns the scene to baseline resource counts, and
 * that the browser stress runner produces an exportable report for a real
 * scene.
 */

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

async function ground(page: Page, query = "?seed=20260918"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${WORLD} [data-action="view-ground"]`).click();
  await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });
}

test.describe("the performance contract", () => {
  test("shows the profiler and quality lines with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await ground(page);
    await expect(page.locator('#diagnosticsPanel [data-field="perf"]')).toContainText(/p95/, {
      timeout: 15_000,
    });
    await expect(page.locator('#diagnosticsPanel [data-field="adaptive"]')).toContainText(/manual|auto/);
    expect(consoleErrors).toEqual([]);
  });

  test("exports a report with version, browser, GPU, preset and seed", async ({ page }) => {
    await ground(page);
    await page.waitForTimeout(2_000);
    type Report = {
      kind: string;
      appVersion: string;
      browser: string;
      gpu: string;
      preset: string;
      seed: number;
      frames: { frames: number };
      counters: Record<string, number>;
      breaches: string[];
    };
    const report = await page.evaluate(
      () => (window as { debugPerfReport?: () => Report }).debugPerfReport?.() ?? null,
    );
    expect(report).not.toBeNull();
    expect(report!.kind).toBe("shatterdome.perf-report");
    expect(report!.appVersion.length).toBeGreaterThan(0);
    expect(report!.browser).toContain("Mozilla");
    expect(report!.gpu).toMatch(/WebGPU|WebGL/);
    expect(["low", "medium", "high", "cinematic"]).toContain(report!.preset);
    expect(report!.seed).toBe(20260918);
    expect(report!.frames.frames).toBeGreaterThan(0);
    // The counters are real reads, not placeholders.
    expect(report!.counters["meshes"]).toBeGreaterThan(0);
    expect(report!.counters["workers"]).toBe(1);
    // And the whole thing survives JSON, which is what export means.
    const text = await page.evaluate(() =>
      JSON.stringify((window as { debugPerfReport?: () => unknown }).debugPerfReport?.()),
    );
    expect(JSON.parse(text!)).toBeTruthy();
  });

  test("repeated combat entry and exit returns to baseline resources", async ({ page }) => {
    await ground(page);
    await page.locator(`${WORLD} [data-action="pilot"]`).click();
    await expect(page.locator(PILOT)).toBeVisible({ timeout: 15_000 });

    type Diff = { clean: boolean; summary: string; grown: Record<string, number> };
    // One throwaway cycle first: the first fight lazily allocates a handful of
    // shared singletons (a default material, warmed shaders) that are reused
    // for ever after. Steady state, not growth, and the baseline is taken
    // after it, once streaming has also settled.
    await page.locator(`${PILOT} [data-action="spawn-target"]`).dispatchEvent("click");
    await page.waitForTimeout(1_500);
    await page.locator(`${PILOT} [data-action="clear-target"]`).dispatchEvent("click");
    await page.waitForTimeout(6_000);
    await page.evaluate(() => (window as { debugLeakBaseline?: () => unknown }).debugLeakBaseline?.());

    for (let cycle = 0; cycle < 3; cycle += 1) {
      // Dispatched: the canvas overlaps the panel edge at this viewport and
      // intercepts the pointer, which is not the thing under test.
      await page.locator(`${PILOT} [data-action="spawn-target"]`).dispatchEvent("click");
      await page.locator("canvas").click();
      await page.keyboard.press("J");
      await page.waitForTimeout(1_500);
      await page.locator(`${PILOT} [data-action="clear-target"]`).dispatchEvent("click");
      await page.waitForTimeout(1_500);
    }
    // Let the last effect bursts age out before auditing.
    await page.waitForTimeout(2_500);

    const audit = await page.evaluate(
      () => ((window as { debugLeakAudit?: () => Diff }).debugLeakAudit?.() ?? null)!,
    );
    expect(audit, "three combat cycles must not grow the scene").not.toBeNull();
    expect(audit.clean, audit.summary).toBe(true);
  });

  test("runs a browser stress scene and reports against its budget", async ({ page }) => {
    await ground(page);
    type Report = { sceneId: string; seed: number; frames: { frames: number }; breaches: string[] };
    const report = await page.evaluate(async () => {
      const run = (window as { debugRunStress?: (id: string, frames?: number) => Promise<Report> })
        .debugRunStress;
      return run ? await run("stress.dense-city", 90) : null;
    });
    expect(report).not.toBeNull();
    expect(report!.sceneId).toBe("stress.dense-city");
    expect(report!.seed).toBe(20260911);
    expect(report!.frames.frames).toBeGreaterThanOrEqual(60);
  });

  test("refuses a stress scene the catalogue does not list", async ({ page }) => {
    await ground(page);
    const message = await page.evaluate(async () => {
      try {
        await (window as { debugRunStress?: (id: string) => Promise<unknown> }).debugRunStress?.(
          "stress.invented",
        );
        return "ran";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(message).toMatch(/No stress scene called/);
  });

  test("adaptive quality is a real control that hands back to manual", async ({ page }) => {
    await ground(page);
    const auto = page.locator(`${WORLD} [data-action="quality-auto"]`);
    await expect(auto).toBeVisible({ timeout: 10_000 });
    await auto.check();
    await expect(page.locator('#diagnosticsPanel [data-field="adaptive"]')).toContainText(/auto/, {
      timeout: 10_000,
    });
    // Choosing a level by hand pins it and turns the controller off.
    await page.locator(`${WORLD} [data-action="quality-select"]`).selectOption("medium");
    await expect(page.locator('#diagnosticsPanel [data-field="adaptive"]')).toContainText(/manual/, {
      timeout: 20_000,
    });
  });
});
