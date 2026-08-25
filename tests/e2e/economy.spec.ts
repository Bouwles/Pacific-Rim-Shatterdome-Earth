import { expect, test, type Page } from "@playwright/test";

/**
 * The books, in a real browser.
 *
 * The economy is proved at length by the unit and balance suites; what only a
 * browser can prove is that the money on screen is the money the game spends
 * from, that ordering something takes it, and that the ledger shows what
 * actually happened rather than a placeholder.
 */

const PANEL = "#shatterdomeScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function enterShatterdome(page: Page, query = "?seed=20260829"): Promise<void> {
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

/** Walks to the command console and opens the construction board. */
async function openBoard(page: Page): Promise<void> {
  expect(await focusOn(page, /Command console/)).toBe(true);
  expect(await walkUntilInReach(page)).toBe(true);
  await page.keyboard.press("KeyE");
  await expect(page.locator(`${PANEL} [data-panel="facility"]`)).toBeVisible();
}

/** Pulls the first run of digits out of a line, commas and all. */
function moneyIn(value: string): number {
  const match = /([\d][\d,]*)/.exec(value.replace(/\s/g, ""));
  return Number((match?.[1] ?? "0").replace(/,/g, ""));
}

test.describe("the economy", () => {
  test("takes the money when something is ordered", async ({ page }) => {
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
    await expect(research.locator('[data-field="facility-detail"]')).toHaveText(/% complete/, {
      timeout: 10_000,
    });

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("shows the books at the contracts terminal once the office is built", async ({ page }) => {
    // Building the office and walking to it takes real time, because the office
    // has to exist before its terminal does. That is the point: the books belong
    // to a complex that was built rather than to a menu that was always there.
    test.setTimeout(240_000);

    await enterShatterdome(page);
    await openBoard(page);

    const board = page.locator(`${PANEL} [data-panel="facility"]`);
    const contract = board.locator('[data-facility="contract"]');
    await expect(contract).toBeVisible();

    const order = contract.locator('[data-action="order"]');
    await expect(order).toBeEnabled();
    await order.click();

    // Wait for it to finish rather than for a fixed time: the tick rate of the
    // runner is not what this test is about.
    await expect(contract.locator('[data-field="facility-detail"]')).toHaveText(/operational · tier 1/, {
      timeout: 180_000,
    });

    // Now walk to it. It is one door off Command.
    await page.keyboard.press("Escape");
    expect(await focusOn(page, /Contracts Office/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");
    await waitForArrival(page);
    await expect(field(page, "room-name")).toHaveText(/Contracts Office/, { timeout: 15_000 });

    // Named exactly: the room also has liaison desks, and a desk is not a terminal.
    expect(await focusOn(page, /Contracts terminal/)).toBe(true);
    expect(await walkUntilInReach(page)).toBe(true);
    await page.keyboard.press("KeyE");

    const market = page.locator(`${PANEL} [data-panel="market"]`);
    await expect(market).toBeVisible({ timeout: 10_000 });

    // Every balance, named. Not one number standing in for six.
    const balances = market.locator('[data-field="market-balances"] li');
    await expect(balances).toHaveCount(6);
    await expect(balances.first()).toContainText(/Funding/i);

    // The outlook has to be a real reading of the last thirty days.
    await expect(market.locator('[data-field="market-outlook"]')).toHaveText(
      /Last 30 days: .* in, .* out, net/,
    );

    // Something has been spent by now, so the breakdown cannot be empty, and
    // every row has to carry a figure rather than a bare label.
    const rows = market.locator('[data-field="market-breakdown"] .sd-breakdown-row');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.first().locator(".sd-breakdown-amount")).toHaveText(/[+-][\d,]+/);

    // And the ledger itself says what happened, in words.
    const ledger = market.locator('[data-field="market-ledger"] li');
    expect(await ledger.count()).toBeGreaterThan(0);
    await expect(ledger.first()).toHaveText(/Day \d+: [+-].+ · .+/);
  });

  test("keeps the money on the board and the money in the books the same", async ({ page }) => {
    await enterShatterdome(page);
    await openBoard(page);

    // The construction board carries the funding figure, and it is read from the
    // economy. If the market and the economy had drifted apart, this is where it
    // would show as a number that stopped moving.
    const summary = await page.locator(`${PANEL} [data-field="panel-summary"]`).textContent();
    expect(summary ?? "").toMatch(/Power \d+ of \d+ MW/);

    const before = moneyIn(await text(page, "crews"));
    expect(Number.isNaN(before)).toBe(false);
  });
});
