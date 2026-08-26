import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The assembly bay, in a real browser.
 *
 * The unit and integration suites prove the constraints, the library and the
 * derived chassis. What only a browser proves is that a player can walk to the
 * fabrication hall, swap a part, watch every number move, and be told exactly
 * what is stopping an illegal build from leaving.
 */

const PANEL = "#shatterdomeScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function enterShatterdome(page: Page, query = "?seed=20260831"): Promise<void> {
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

async function focusOn(page: Page, pattern: RegExp, attempts = 18): Promise<boolean> {
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

/** Orders a facility from the construction board and waits for it to stand. */
async function orderFacility(page: Page, facilityId: string): Promise<void> {
  const board = page.locator(`${PANEL} [data-panel="facility"]`);
  await expect(board).toBeVisible();
  const row = board.locator(`[data-facility="${facilityId}"]`);
  await expect(row).toBeVisible();
  const detail = row.locator('[data-field="facility-detail"]');
  if (/operational/.test((await detail.textContent()) ?? "")) return;

  await row.locator('[data-action="order"]').click();
  await expect(detail).toHaveText(/% complete|operational/, { timeout: 30_000 });
  // Nine thousand ticks of work on the hall. Waiting for the state rather than
  // for a duration keeps this about the game and not about the runner.
  await expect(detail).toHaveText(/operational/, { timeout: 420_000 });
}

/** Takes one door, lift or tram, named exactly, and waits to arrive. */
async function travelTo(page: Page, label: RegExp, room: RegExp): Promise<void> {
  expect(await focusOn(page, label)).toBe(true);
  expect(await walkUntilInReach(page)).toBe(true);
  await page.keyboard.press("KeyE");
  await waitForArrival(page);
  await expect(field(page, "room-name")).toHaveText(room, { timeout: 20_000 });
}

/**
 * Builds the route to the fabrication hall, walks it, and opens the builder.
 *
 * The hall is on deck one and LOCCENT is on deck two, so this is a lift down to
 * Logistics and a door across, and both rooms have to exist before either can
 * be walked into.
 */
async function openBuilder(page: Page): Promise<void> {
  expect(await focusOn(page, /Command console/)).toBe(true);
  expect(await walkUntilInReach(page)).toBe(true);
  await page.keyboard.press("KeyE");
  await orderFacility(page, "logistics");
  await orderFacility(page, "manufacture");
  await page.keyboard.press("Escape");

  await travelTo(page, /Logistics/, /Logistics/);
  await travelTo(page, /Fabrication Hall/, /Fabrication Hall/);

  // Named exactly: the hall also has machine posts, and a post is not a control.
  // The hall is the largest room in the complex, so a single walk can end up
  // against a fixture. Unstuck and try again rather than giving up.
  let reached = false;
  for (let attempt = 0; attempt < 4 && !reached; attempt += 1) {
    if (attempt > 0) await page.keyboard.press("KeyU");
    expect(await focusOn(page, /Fabrication control/)).toBe(true);
    reached = await walkUntilInReach(page, 20_000);
  }
  expect(reached).toBe(true);
  await page.keyboard.press("KeyE");
  await expect(page.locator(`${PANEL} [data-panel="builder"]`)).toBeVisible({ timeout: 10_000 });
}

/** Puts the working build back to the starter, so each test starts level. */
async function resetBuild(page: Page): Promise<void> {
  const panel = page.locator(`${PANEL} [data-panel="builder"]`);
  for (const [slot, part] of [
    ["head", "part.head.standard"],
    ["torso", "part.torso.balanced"],
    ["arms", "part.arms.standard"],
    ["legs", "part.legs.standard"],
    ["reactor", "part.reactor.standard"],
    ["armor", "part.armor.plate"],
    ["movement", "part.movement.standard"],
  ] as const) {
    await panel.locator(`[data-slot="${slot}"] [data-part="${part}"]`).click();
  }
}

/**
 * One page for the whole file.
 *
 * Building the fabrication hall takes several minutes of real time, and it has
 * to be built before its terminal exists. Doing that once and running every
 * check against it keeps this a browser test rather than a stress test of the
 * construction queue.
 */
test.describe.configure({ mode: "serial" });

test.describe("the assembly bay", () => {
  let shared: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    shared = await browser.newPage();
    await enterShatterdome(shared);
    await openBuilder(shared);
  });

  test.afterAll(async () => {
    await shared?.close();
  });

  test("shows a build with every number it is made of", async () => {
    const page = shared;
    const panel = page.locator(`${PANEL} [data-panel="builder"]`);
    await expect(panel.locator('[data-field="builder-summary"]')).toHaveText(/\d+ t/);

    // Every axis is shown separately. The failure mode is one capacity bar.
    const stats = panel.locator('[data-field="builder-stats"] li');
    expect(await stats.count()).toBeGreaterThan(8);
    const statText = (await stats.allTextContents()).join(" | ");
    for (const axis of ["Mass", "Power", "Heat", "Actuators", "Balance", "Mobility", "Ammunition"]) {
      expect(statText, axis).toContain(axis);
    }

    // And every slot is a real choice with more than one option in it.
    const slots = panel.locator("[data-slot]");
    expect(await slots.count()).toBeGreaterThan(6);
    expect(await panel.locator('[data-slot="legs"] [data-action="choose-part"]').count()).toBeGreaterThan(1);
  });

  test("changes every affected number when a part is swapped", async () => {
    const page = shared;
    await resetBuild(page);
    const panel = page.locator(`${PANEL} [data-panel="builder"]`);
    const readStats = async () =>
      (await panel.locator('[data-field="builder-stats"] li').allTextContents()).join("|");
    const before = await readStats();

    // Swap the legs for the siege set: heavier, slower, and steadier all at once.
    await panel.locator('[data-slot="legs"] [data-part="part.legs.heavy"]').click();
    await expect(panel.locator('[data-slot="legs"] [data-field="slot-chosen"]')).toHaveText(/Siege Legs/);

    const after = await readStats();
    expect(after).not.toBe(before);
    // Several axes moved, not one.
    const changed = before.split("|").filter((line, index) => line !== after.split("|")[index]);
    expect(changed.length).toBeGreaterThan(2);
  });

  test("refuses an illegal build and says everything that is wrong", async () => {
    const page = shared;
    await resetBuild(page);
    const panel = page.locator(`${PANEL} [data-panel="builder"]`);
    // Sprint legs offer only a light spine; the deep magazine frame needs a
    // heavy one. That plus the weight makes several things wrong at once.
    await panel.locator('[data-slot="legs"] [data-part="part.legs.sprint"]').click();
    await panel.locator('[data-slot="torso"] [data-part="part.torso.magazine"]').click();
    await panel.locator('[data-slot="armor"] [data-part="part.armor.ablative"]').click();

    const issues = panel.locator('[data-field="builder-issues"] li');
    expect(await issues.count()).toBeGreaterThan(0);
    const listed = (await issues.allTextContents()).join(" ");
    expect(listed).toMatch(/Refused:/);

    // The controls that would put it in a fight are shut, and both say why.
    const assembleButton = panel.locator('[data-action="build-custom"]');
    await expect(assembleButton).toBeDisabled();
    expect(await assembleButton.getAttribute("data-refusal")).not.toBe("");

    const testButton = panel.locator('[data-action="test-range"]');
    await expect(testButton).toBeDisabled();
    expect(await testButton.getAttribute("data-refusal")).toMatch(/illegal build/);
  });

  test("will not offer a machine the programme cannot pay for", async () => {
    // Building the route here costs two facilities, so a fresh campaign is
    // genuinely short by this point. The control has to be shut and say so,
    // rather than saying it can act and then failing.
    const page = shared;
    await resetBuild(page);
    const panel = page.locator(`${PANEL} [data-panel="builder"]`);

    const assembleButton = panel.locator('[data-action="build-custom"]');
    const refusal = (await assembleButton.getAttribute("data-refusal")) ?? "";
    if (await assembleButton.isEnabled()) {
      // Affordable: it builds, stamps a serial, and then refuses a second.
      await assembleButton.click();
      await expect(panel.locator('[data-field="builder-built"]')).toHaveText(/CUSTOM-\d+/, {
        timeout: 10_000,
      });
      await expect(assembleButton).toBeDisabled();
      expect(await assembleButton.getAttribute("data-refusal")).toMatch(/already exists/);

      await panel.locator('[data-action="scrap-custom"]').click();
      await expect(panel.locator('[data-field="builder-built"]')).toHaveText(/Nothing built/);
      // The fleet slot is free again. Whether it can be paid for a second time
      // is a separate question, and the refusal says which of the two it is.
      const after = (await assembleButton.getAttribute("data-refusal")) ?? "";
      expect(after).not.toMatch(/already exists/);
      return;
    }

    // Not affordable: the refusal names the shortfall in credits rather than
    // leaving a grey button with nothing behind it.
    expect(refusal).toMatch(/Short /);
    await expect(panel.locator('[data-field="builder-built"]')).toHaveText(/Nothing built/);
    // And the build itself is fine: it is the money that is missing, not the design.
    const issues = await panel.locator('[data-field="builder-issues"] li').allTextContents();
    expect(issues.join(" ")).not.toMatch(/Refused:/);
  });
});
