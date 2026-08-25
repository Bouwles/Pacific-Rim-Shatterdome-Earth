import { expect, test, type Page } from "@playwright/test";

/**
 * The research board, in a real browser.
 *
 * The unit and integration suites prove the tree, the samples and the
 * countermeasures. What only a browser can prove is that a player can walk to
 * the research wing, see programmes with real requirements read off real stores,
 * and be told exactly why one cannot be started.
 */

const PANEL = "#shatterdomeScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function enterShatterdome(page: Page, query = "?seed=20260830"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "New Game" }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
  await expect(field(page, "room-name")).toHaveText(/LOCCENT Command/);
}

async function waitForArrival(page: Page): Promise<void> {
  await expect(field(page, "prompt")).not.toHaveText(/(Door|Lift|Tram)\.\.\./, { timeout: 15_000 });
}

async function focusOn(page: Page, pattern: RegExp, attempts = 16): Promise<boolean> {
  for (let index = 0; index < attempts; index += 1) {
    await page.keyboard.press("Tab");
    if (pattern.test(await text(page, "prompt"))) return true;
  }
  return false;
}

async function walkUntilInReach(page: Page, maxMs = 30_000): Promise<boolean> {
  await page.keyboard.down("w");
  try {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (/^E — /.test(await text(page, "prompt"))) return true;
      await page.waitForTimeout(250);
    }
  } finally {
    await page.keyboard.up("w");
  }
  return /^E — /.test(await text(page, "prompt"));
}

async function openBoard(page: Page): Promise<void> {
  expect(await focusOn(page, /Command console/)).toBe(true);
  expect(await walkUntilInReach(page)).toBe(true);
  await page.keyboard.press("KeyE");
  await expect(page.locator(`${PANEL} [data-panel="facility"]`)).toBeVisible();
}

test.describe("research", () => {
  test("shows the board at the research wing once it is built", async ({ page }) => {
    // The wing has to exist before its terminal does, so this builds it first.
    test.setTimeout(240_000);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await enterShatterdome(page);
    await openBoard(page);

    const board = page.locator(`${PANEL} [data-panel="facility"]`);
    const research = board.locator('[data-facility="research"]');
    await expect(research.locator('[data-field="facility-detail"]')).toHaveText(/absent/);
    await research.locator('[data-action="order"]').click();
    await expect(research.locator('[data-field="facility-detail"]')).toHaveText(/operational · tier 1/, {
      timeout: 180_000,
    });

    await page.keyboard.press("Escape");
    expect(await focusOn(page, /Research/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await waitForArrival(page);
    await expect(field(page, "room-name")).toHaveText(/Research/, { timeout: 15_000 });

    // Named exactly: the room also has analysis benches, and a bench is not a console.
    expect(await focusOn(page, /Research console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");

    const panel = page.locator(`${PANEL} [data-panel="research"]`);
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // A real board: programmes, with what they need and what they hand over.
    await expect(panel.locator('[data-field="research-summary"]')).toHaveText(
      /\d+ of \d+ programmes finished/,
    );
    const rows = panel.locator("[data-node]");
    expect(await rows.count()).toBeGreaterThan(5);

    const first = rows.first();
    await expect(first.locator('[data-field="node-benefits"] li').first()).not.toBeEmpty();
    await expect(first.locator('[data-field="node-requirements"] li').first()).toContainText(/ of /);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("greys a programme it cannot start and says exactly what is missing", async ({ page }) => {
    test.setTimeout(240_000);
    await enterShatterdome(page);
    await openBoard(page);

    const board = page.locator(`${PANEL} [data-panel="facility"]`);
    const research = board.locator('[data-facility="research"]');
    await research.locator('[data-action="order"]').click();
    await expect(research.locator('[data-field="facility-detail"]')).toHaveText(/operational · tier 1/, {
      timeout: 180_000,
    });

    await page.keyboard.press("Escape");
    expect(await focusOn(page, /Research/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await waitForArrival(page);
    // Named exactly: the room also has analysis benches, and a bench is not a console.
    expect(await focusOn(page, /Research console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");

    const panel = page.locator(`${PANEL} [data-panel="research"]`);
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Nothing has been fought yet, so nothing can be started, and every greyed
    // button has to carry a reason rather than only being grey.
    const blocked = panel.locator('[data-node][data-state="blocked"]');
    expect(await blocked.count()).toBeGreaterThan(0);
    const button = blocked.first().locator('[data-action="start-research"]');
    await expect(button).toBeDisabled();
    const refusal = await button.getAttribute("data-refusal");
    expect(refusal ?? "").not.toBe("");
  });

  test("says plainly that nothing has been learned yet", async ({ page }) => {
    test.setTimeout(240_000);
    await enterShatterdome(page);
    await openBoard(page);

    const board = page.locator(`${PANEL} [data-panel="facility"]`);
    const research = board.locator('[data-facility="research"]');
    await research.locator('[data-action="order"]').click();
    await expect(research.locator('[data-field="facility-detail"]')).toHaveText(/operational · tier 1/, {
      timeout: 180_000,
    });

    await page.keyboard.press("Escape");
    expect(await focusOn(page, /Research/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await waitForArrival(page);
    // Named exactly: the room also has analysis benches, and a bench is not a console.
    expect(await focusOn(page, /Research console/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");

    const panel = page.locator(`${PANEL} [data-panel="research"]`);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    // An empty panel that implies a working system is the thing this project
    // refuses. It has to say, in words, that nothing is in effect yet.
    await expect(panel.locator('[data-field="research-countermeasures"]')).toContainText(
      /Nothing learned yet/,
    );
    await expect(panel.locator('[data-field="research-samples"]')).toContainText(/Nothing on the shelf/);
  });
});

const WORLD = "#worldScreen";
const PILOT = "#pilotScreen";

async function worldMap(page: Page, query = "?seed=20260825"): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(WORLD)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${WORLD} [data-action="crisis-frequency"]`).selectOption("2");
}

async function waitForAlert(page: Page, maxSkips = 40): Promise<boolean> {
  for (let skip = 0; skip < maxSkips; skip += 1) {
    if ((await page.locator(`${WORLD} [data-field="alert-headline"]`).count()) > 0) return true;
    await page.locator(`${WORLD} [data-action="time-six-hours"]`).click();
    await page.waitForTimeout(120);
  }
  return (await page.locator(`${WORLD} [data-field="alert-headline"]`).count()) > 0;
}

test.describe("recovery after a sortie", () => {
  test("settles a real mission without the sample recovery throwing", async ({ page }) => {
    // The award rules are covered by the unit suite. What only a browser proves
    // is that the block that runs them when a sortie settles actually runs:
    // it reads the incident, the arena, the weather and the objectives, and any
    // one of those being wrong would throw here rather than in a test double.
    test.slow();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await worldMap(page);
    expect(await waitForAlert(page)).toBe(true);

    await page.locator(`${WORLD} [data-action="incident-deploy"]`).first().click();
    await page.waitForTimeout(400);
    await page.locator(`${WORLD} [data-action="skip-carrier"]`).click();
    await expect(page.locator(PILOT)).toBeVisible({ timeout: 30_000 });

    await page.locator(`${WORLD} [data-action="abort-mission"]`).click();
    await page.waitForTimeout(800);

    // The results block explains itself, and nothing threw on the way here.
    await expect(page.locator(`${WORLD} [data-section="results"]`)).toBeVisible({ timeout: 15_000 });
    expect(consoleErrors, consoleErrors.join(String.fromCharCode(10))).toEqual([]);
  });
});
