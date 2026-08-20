import { expect, test, type Page } from "@playwright/test";

function field(page: Page, name: string) {
  return page.locator(`#diagnosticsPanel [data-field="${name}"]`);
}

async function readTick(page: Page): Promise<number> {
  return Number(await field(page, "tick").textContent());
}

async function waitForFirstTicks(page: Page): Promise<void> {
  await expect(field(page, "renderer")).toHaveText(/WebGPU|WebGL/, { timeout: 15_000 });
  await expect.poll(async () => readTick(page), { timeout: 10_000 }).toBeGreaterThan(0);
}

test.describe("debug overlay", () => {
  test("reports renderer, simulation, and seed state without inventing a physics number", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForFirstTicks(page);

    await expect(field(page, "babylon")).toHaveText(/^\d+\.\d+/);
    await expect(field(page, "fps")).toHaveText(/^\d+$/);
    await expect(field(page, "frameTime")).toHaveText(/ms$/);
    await expect(field(page, "drawCalls")).toHaveText(/^\d+$/);
    await expect(field(page, "entities")).toHaveText(/^\d+$/);
    await expect(field(page, "seed")).toHaveText(/^\d+$/);
    await expect(field(page, "runState")).toHaveText(/running 1x/);

    // No physics backend exists yet, so the overlay must say so rather than print 0.
    await expect(field(page, "physicsBodies")).toHaveText("n/a (no backend)");
  });

  test("simulation ticks advance on their own while running", async ({ page }) => {
    await page.goto("/");
    await waitForFirstTicks(page);

    const before = await readTick(page);
    await page.waitForTimeout(600);
    expect(await readTick(page)).toBeGreaterThan(before);
  });

  test("pause halts ticks, step advances exactly one, resume continues", async ({ page }) => {
    await page.goto("/");
    await waitForFirstTicks(page);

    const pauseButton = page.locator('#diagnosticsPanel [data-action="pause"]');
    await pauseButton.click();
    await expect(pauseButton).toHaveText("Resume");
    await expect(field(page, "runState")).toHaveText("paused");

    // Let real time pass; a paused simulation must not advance at all.
    await page.waitForTimeout(500);
    const paused = await readTick(page);
    await page.waitForTimeout(500);
    expect(await readTick(page)).toBe(paused);

    await page.locator('#diagnosticsPanel [data-action="step"]').click();
    await expect.poll(async () => readTick(page), { timeout: 5_000 }).toBe(paused + 1);

    // One click is one tick — it must not leave the simulation running.
    await page.waitForTimeout(400);
    expect(await readTick(page)).toBe(paused + 1);

    await pauseButton.click();
    await expect(pauseButton).toHaveText("Pause");
    await expect.poll(async () => readTick(page), { timeout: 5_000 }).toBeGreaterThan(paused + 1);
  });

  test("slow motion advances the simulation more slowly than normal speed", async ({ page }) => {
    await page.goto("/");
    await waitForFirstTicks(page);

    const sampleWindowMs = 1000;
    const normalStart = await readTick(page);
    await page.waitForTimeout(sampleWindowMs);
    const normalTicks = (await readTick(page)) - normalStart;

    await page.locator('#diagnosticsPanel [data-action="timescale"]').selectOption("0.25");
    await expect(field(page, "runState")).toHaveText("running 0.25x");

    const slowStart = await readTick(page);
    await page.waitForTimeout(sampleWindowMs);
    const slowTicks = (await readTick(page)) - slowStart;

    expect(slowTicks).toBeGreaterThan(0);
    expect(slowTicks).toBeLessThan(normalTicks);
  });

  test("F3 toggles overlay visibility", async ({ page }) => {
    await page.goto("/");
    await waitForFirstTicks(page);

    const panel = page.locator("#diagnosticsPanel");
    await expect(panel).toBeVisible();

    await page.keyboard.press("F3");
    await expect(panel).toBeHidden();

    await page.keyboard.press("F3");
    await expect(panel).toBeVisible();
  });

  test("?seed= drives the simulation seed for reproducible runs", async ({ page }) => {
    await page.goto("/?seed=13579");
    await waitForFirstTicks(page);
    await expect(field(page, "seed")).toHaveText("13579");
  });
});
