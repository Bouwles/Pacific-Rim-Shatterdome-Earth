import { expect, test, type Page } from "@playwright/test";

/**
 * Regional identity, in a real browser.
 *
 * The unit and integration suites prove the profiles, the shaping and the
 * conditions. What only a browser proves is that moving between regions
 * actually changes what the game reports about where you are standing, and that
 * every one of them lays out through the same streaming and city systems
 * without a console error.
 */

const WORLD = "#worldScreen";

function field(page: Page, name: string) {
  return page.locator(`${WORLD} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function worldMap(page: Page, query = "?seed=20260902"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
}

/** Teleports to a region and waits for the world to actually be there. */
async function goTo(page: Page, regionId: string): Promise<void> {
  const select = page.locator(`${WORLD} [data-action="teleport-select"]`);
  await select.selectOption(regionId);
  await page.locator(`${WORLD} [data-action="teleport"]`).click();
  await expect(field(page, "region")).toHaveText(new RegExp(regionId, "i"), { timeout: 15_000 });
}

/** Everything the identity panel currently says, as one string. */
async function identityOf(page: Page): Promise<string> {
  const section = page.locator(`${WORLD} [data-section="identity"]`);
  await expect(section).toBeVisible({ timeout: 15_000 });
  const skyline = await text(page, "identity-skyline");
  const lines = await section.locator('[data-field="identity-lines"] li').allTextContents();
  return [skyline, ...lines].join(" | ");
}

test.describe("regions", () => {
  test("reports what makes the starting region itself", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await worldMap(page);
    const section = page.locator(`${WORLD} [data-section="identity"]`);
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Identity is a set of facts about the place, not a label with a colour.
    const identity = await identityOf(page);
    expect(identity).toMatch(/contracts \d+%/);
    expect(identity).toMatch(/batteries/);
    expect(identity).toMatch(/movements an hour/);
    expect(identity).toMatch(/m of water/);
    expect(identity).toMatch(/approach|approaches/i);
    expect(identity).toMatch(/Rebuilds at \d+ percent/);

    expect(consoleErrors, consoleErrors.join(String.fromCharCode(10))).toEqual([]);
  });

  test("says something different about a different region", async ({ page }) => {
    test.slow();
    await worldMap(page);
    const home = await identityOf(page);

    await goTo(page, "anchorage");
    const anchorage = await identityOf(page);
    expect(anchorage).not.toBe(home);

    await goTo(page, "tokyo");
    const tokyo = await identityOf(page);
    expect(tokyo).not.toBe(anchorage);
    expect(tokyo).not.toBe(home);
  });

  test("gives a shallow region a different fight from a deep one", async ({ page }) => {
    test.slow();
    await worldMap(page);

    // Tokyo sits on a shallow shelf; nothing can submerge there.
    await goTo(page, "tokyo");
    expect(await identityOf(page)).toMatch(/Nothing can submerge here/);

    // Sydney is a deep drowned valley, so it can.
    await goTo(page, "sydney");
    expect(await identityOf(page)).toMatch(/Deep enough to dive/);
  });

  test("tells the crew what the local conditions mean", async ({ page }) => {
    test.slow();
    await worldMap(page);
    await goTo(page, "anchorage");

    const section = page.locator(`${WORLD} [data-section="identity"]`);
    const briefings = await section.locator('[data-field="identity-briefings"] li').allTextContents();
    expect(briefings.length).toBeGreaterThan(0);
    // Not a list of modifier names: sentences a crew could act on.
    for (const line of briefings) expect(line.length).toBeGreaterThan(20);
    expect(briefings.join(" ")).toMatch(/one way in|Footing is poor|too shallow/i);
  });

  test("streams every region through the same systems without errors", async ({ page }) => {
    test.slow();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await worldMap(page);
    await page.locator(`${WORLD} [data-action="view-ground"]`).click();
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });

    // Every city built by the one generator, on the ground, one after another.
    for (const regionId of ["tokyo", "manila", "anchorage", "sydney"]) {
      await goTo(page, regionId);
      await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible();
      await expect(field(page, "identity-skyline")).not.toBeEmpty();
    }

    expect(consoleErrors, consoleErrors.join(String.fromCharCode(10))).toEqual([]);
  });
});
