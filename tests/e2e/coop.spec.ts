import { expect, test, type Page } from "@playwright/test";

/**
 * Two browser windows, one fight, one result.
 *
 * The unit and integration suites prove the protocol and the authority rules
 * without a browser. What only a browser proves is that two real windows find
 * each other, that the seat the host opens is the seat the guest takes, that
 * the guest's keys reach the host's arena, and that the whole thing tears down
 * without leaving anything behind.
 *
 * Both windows share a browser context on purpose: `BroadcastChannel` is
 * same-origin and same-browser, which is exactly what same-machine co-op is.
 */

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";
const COOP = `${PILOT} [data-section="coop"]`;

async function pilot(page: Page, query = "?seed=20260907"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${WORLD} [data-action="view-ground"]`).click();
  await expect(page.locator(`${WORLD} [data-section="streaming"]`)).toBeVisible({ timeout: 20_000 });
  await page.locator(`${WORLD} [data-action="pilot"]`).click();
  await expect(page.locator(PILOT)).toBeVisible({ timeout: 15_000 });
}

test.describe("two-player battles", () => {
  test("shows the co-op row with nothing connected, and no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await pilot(page);
    await expect(page.locator(COOP)).toBeVisible({ timeout: 10_000 });
    // Nothing implies a live link before there is one.
    await expect(page.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/Not connected/);
    await expect(page.locator(`${COOP} [data-action="coop-leave"]`)).toBeDisabled();
    await expect(page.locator(`${COOP} [data-action="coop-pause"]`)).toBeDisabled();
    expect(consoleErrors).toEqual([]);
  });

  test("refuses to open a seat before there is a fight, and says why", async ({ page }) => {
    await pilot(page);
    await page.locator(`${COOP} [data-action="coop-host"]`).click();
    await expect(page.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/nothing to join/, {
      timeout: 10_000,
    });
  });

  test("opens a seat once a target is up, and a second window takes it", async ({ context }) => {
    const host = await context.newPage();
    await pilot(host);
    await host.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await host.locator(`${COOP} [data-action="coop-host"]`).click();
    await expect(host.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/Seat open/, {
      timeout: 10_000,
    });

    const guest = await context.newPage();
    await pilot(guest, "?seed=20260907");
    await guest.locator(`${COOP} [data-action="coop-join"]`).click();

    // The host names the partner and the machine it lent them.
    await expect(host.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/With: Second player/, {
      timeout: 15_000,
    });
    await expect(host.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/Lending:/);
    // The guest is told which machine it is driving, and did not choose it.
    await expect(guest.locator(`${COOP} [data-field="coop-log"]`)).toContainText(/lent by the host/, {
      timeout: 15_000,
    });

    await guest.close();
    await host.close();
  });

  test("the guest's keys reach the host's fight, and the host counts them", async ({ context }) => {
    const host = await context.newPage();
    await pilot(host);
    await host.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await host.locator(`${COOP} [data-action="coop-host"]`).click();

    const guest = await context.newPage();
    await pilot(guest, "?seed=20260907");
    await guest.locator(`${COOP} [data-action="coop-join"]`).click();
    await expect(host.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/With: Second player/, {
      timeout: 15_000,
    });

    await guest.locator("canvas").click();
    for (const key of ["KeyJ", "KeyK", "KeyJ", "KeyK"]) {
      await guest.keyboard.press(key.replace("Key", ""));
      await guest.waitForTimeout(120);
    }

    // The host is the thing counting, and it counted them.
    await expect(host.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/inputs applied/, {
      timeout: 15_000,
    });

    await guest.close();
    await host.close();
  });

  test("pausing from the host reaches the guest, and resuming does too", async ({ context }) => {
    const host = await context.newPage();
    await pilot(host);
    await host.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await host.locator(`${COOP} [data-action="coop-host"]`).click();

    const guest = await context.newPage();
    await pilot(guest, "?seed=20260907");
    await guest.locator(`${COOP} [data-action="coop-join"]`).click();
    await expect(host.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/With: Second player/, {
      timeout: 15_000,
    });

    await host.locator(`${COOP} [data-action="coop-pause"]`).click();
    await expect(guest.locator(`${COOP} [data-field="coop-log"]`)).toContainText(/Paused/, {
      timeout: 15_000,
    });
    await host.locator(`${COOP} [data-action="coop-pause"]`).click();
    await expect(guest.locator(`${COOP} [data-field="coop-log"]`)).toContainText(/Resumed/, {
      timeout: 15_000,
    });

    await guest.close();
    await host.close();
  });

  test("ending the session tells the guest, and leaves both windows usable", async ({ context }) => {
    const host = await context.newPage();
    await pilot(host);
    await host.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await host.locator(`${COOP} [data-action="coop-host"]`).click();

    const guest = await context.newPage();
    await pilot(guest, "?seed=20260907");
    await guest.locator(`${COOP} [data-action="coop-join"]`).click();
    await expect(host.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/With: Second player/, {
      timeout: 15_000,
    });

    await host.locator(`${COOP} [data-action="coop-leave"]`).click();
    await expect(guest.locator(`${COOP} [data-field="coop-log"]`)).toContainText(/ended it/, {
      timeout: 15_000,
    });
    // The host window is back to where it started, ready to open another seat.
    await expect(host.locator(`${COOP} [data-action="coop-host"]`)).toBeEnabled({ timeout: 10_000 });

    await guest.close();
    await host.close();
  });

  test("single player is unaffected: the fight runs with nobody connected", async ({ page }) => {
    await pilot(page);
    await page.locator(`${PILOT} [data-action="spawn-target"]`).click();
    await page.locator("canvas").click();
    await page.keyboard.press("J");
    // The combat log is the single-player path, and it is still the one running.
    await expect(page.locator(`${PILOT} [data-field="hit-log"]`)).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator(`${COOP} [data-field="coop-status"]`)).toContainText(/Not connected/);
  });
});
