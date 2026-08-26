import { expect, test, type Page } from "@playwright/test";

/**
 * The map, in a real browser.
 *
 * The unit and integration suites prove placement, claims and routes. What only
 * a browser proves is that a player can open the world map, see the map section
 * report what is known against what is still out there, and be told why a
 * control that cannot act cannot act.
 */

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

function field(page: Page, name: string) {
  return page.locator(`${WORLD} [data-field="${name}"]`);
}

async function worldMap(page: Page, query = "?seed=20260901"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
}

test.describe("the map", () => {
  test("reports what is known against what is still out there", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await worldMap(page);
    const section = page.locator(`${WORLD} [data-section="map"]`);
    await expect(section).toBeVisible({ timeout: 15_000 });

    // The map counts what is known against what is not, rather than showing an
    // empty box that implies a working system. A campaign starts able to see
    // the proving gate on its own pad, so this asserts the shape rather than a
    // particular number.
    await expect(field(page, "map-state")).toHaveText(/\d+ found/);
    await expect(field(page, "map-state")).toHaveText(/still out there/);
    await expect(section.locator('[data-field="map-route"]')).toContainText(/No route planned/);

    // Whatever is on the list, every row carries a distance and a travel time,
    // and an empty list says so in words.
    const sites = section.locator("[data-site]");
    if ((await sites.count()) === 0) {
      await expect(section.locator('[data-field="map-sites"]')).toContainText(/Nothing found yet/);
    } else {
      await expect(sites.first().locator('[data-field="site-cost"]')).toHaveText(/km · \d+ min/);
    }

    expect(consoleErrors, consoleErrors.join(String.fromCharCode(10))).toEqual([]);
  });

  test("reports the squad and the thrusters, which are separate things", async ({ page }) => {
    await worldMap(page);
    await expect(field(page, "map-readiness")).toHaveText(/\d+ of \d+ machines ready/);
    await expect(field(page, "map-readiness")).toHaveText(/allied crew/);
    await expect(field(page, "map-booster")).toHaveText(/\d+% heat/);
  });

  test("finds what the machine walks past, and lets it be worked", async ({ page }) => {
    test.slow();
    await worldMap(page);
    await page.locator(`${WORLD} [data-action="view-ground"]`).click();
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });

    const section = page.locator(`${WORLD} [data-section="map"]`);
    const sites = section.locator("[data-site]");

    // Walk until something turns up. Sites sit a few kilometres out, so this is
    // a real search rather than a scripted reveal.
    for (let step = 0; step < 24 && (await sites.count()) === 0; step += 1) {
      await page.locator(`${WORLD} [data-action="walk-north"]`).click();
      await page.waitForTimeout(120);
    }

    if ((await sites.count()) === 0) {
      // Nothing within walking range of the start on this seed. The map still
      // has to be honest about that rather than pretending otherwise.
      await expect(section.locator('[data-field="map-sites"]')).toContainText(/Nothing found yet/);
      return;
    }

    const first = sites.first();
    await expect(first.locator('[data-field="site-name"]')).not.toBeEmpty();
    await expect(first.locator('[data-field="site-cost"]')).toHaveText(/km · \d+ min/);

    // Every control either acts or says why it will not.
    const work = first.locator('[data-action="work-site"]');
    if (await work.isDisabled()) {
      expect(await work.getAttribute("data-refusal")).not.toBe("");
    }
    const travel = first.locator('[data-action="travel-site"]');
    if (await travel.isDisabled()) {
      expect(await travel.getAttribute("data-refusal")).toMatch(/deployment point/);
    }
  });

  test("plans a route and shows what stopping on the way costs", async ({ page }) => {
    test.slow();
    await worldMap(page);
    await page.locator(`${WORLD} [data-action="view-ground"]`).click();
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });

    const section = page.locator(`${WORLD} [data-section="map"]`);
    const sites = section.locator("[data-site]");
    for (let step = 0; step < 24 && (await sites.count()) === 0; step += 1) {
      await page.locator(`${WORLD} [data-action="walk-north"]`).click();
      await page.waitForTimeout(120);
    }
    if ((await sites.count()) === 0) return;

    await sites.first().locator('[data-action="plan-route"]').click();
    const route = section.locator('[data-field="map-route"]');
    await expect(route).toContainText(/Direct \d+ min/);
    // Both answers are shown, so taking the scenic way is a decision rather
    // than something the game does for you.
    await expect(route).toContainText(/by way of what is known \d+ min/);
  });

  test("keeps the ground view and the map talking about the same world", async ({ page }) => {
    await worldMap(page);
    await page.locator(`${WORLD} [data-action="view-ground"]`).click();
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });

    // The map is on screen at the same time as the world it describes, and both
    // are reporting rather than one being a menu.
    await expect(page.locator(`${WORLD} [data-section="map"]`)).toBeVisible();
    await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible();
    await expect(field(page, "map-state")).toHaveText(/found/);
    void PILOT;
  });
});
