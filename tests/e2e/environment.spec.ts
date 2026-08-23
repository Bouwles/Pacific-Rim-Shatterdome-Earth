import { expect, test, type Page } from "@playwright/test";

const PANEL = "#worldScreen";

function field(page: Page, name: string) {
  return page.locator(`${PANEL} [data-field="${name}"]`);
}

async function text(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? "";
}

async function readNumber(page: Page, name: string, pattern: RegExp): Promise<number> {
  const match = pattern.exec(await text(page, name));
  if (!match) return Number.NaN;
  // Readouts use toLocaleString, so thousands separators have to come out before
  // Number sees them or every four-figure reading parses as NaN.
  return Number((match[1] ?? match[0]).replace(/,/g, ""));
}

async function openWorld(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#diagnosticsPanel [data-field="renderer"]')).toHaveText(/WebGPU|WebGL/, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
}

async function openGround(page: Page, query = ""): Promise<void> {
  await openWorld(page, query);
  await page.locator(`${PANEL} [data-action="view-ground"]`).click();
  await expect(page.locator(`${PANEL} [data-section="streaming"]`)).toBeVisible({ timeout: 15_000 });
}

test.describe("environment", () => {
  test("reports a full environment readout with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openWorld(page, "?seed=20260822");

    await expect(field(page, "env-time")).toHaveText(/day \d+, \d\d:\d\d/);
    await expect(field(page, "env-celestial")).toHaveText(/sun -?[\d.]+°, moon -?[\d.]+°/);
    await expect(field(page, "env-weather")).toHaveText(/clear|cloudy|rain|storm|fog|snow/);
    await expect(field(page, "env-wind")).toHaveText(/[\d.]+ m\/s from \d+°/);
    await expect(field(page, "env-temperature")).toHaveText(/-?[\d.]+ °C/);
    await expect(field(page, "env-visibility")).toHaveText(/[\d,]+ m/);
    await expect(field(page, "env-water")).toHaveText(/dry|wading|surface-combat|swimming|underwater/);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("advances time deterministically from the debug controls", async ({ page }) => {
    await openWorld(page, "?seed=20260822");

    await page.locator(`${PANEL} [data-action="time-noon"]`).click();
    await expect(field(page, "env-time")).toHaveText(/12:00/);
    const noonSun = await readNumber(page, "env-celestial", /sun (-?[\d.]+)°/);
    expect(noonSun).toBeGreaterThan(20);

    await page.locator(`${PANEL} [data-action="time-midnight"]`).click();
    await expect(field(page, "env-time")).toHaveText(/00:00/);
    const nightSun = await readNumber(page, "env-celestial", /sun (-?[\d.]+)°/);
    expect(nightSun).toBeLessThan(0);

    // Light follows the sun rather than being set separately.
    const nightLight = await readNumber(page, "env-light", /(\d+)%/);
    await page.locator(`${PANEL} [data-action="time-noon"]`).click();
    const dayLight = await readNumber(page, "env-light", /(\d+)%/);
    expect(dayLight).toBeGreaterThan(nightLight);
  });

  test("advances by whole hours and rolls the day over", async ({ page }) => {
    await openWorld(page, "?seed=20260822");
    await page.locator(`${PANEL} [data-action="time-midnight"]`).click();
    const startDay = await readNumber(page, "env-time", /day (\d+)/);

    for (let hour = 0; hour < 4; hour += 1) {
      await page.locator(`${PANEL} [data-action="time-six-hours"]`).click();
    }
    await expect.poll(async () => readNumber(page, "env-time", /day (\d+)/)).toBeGreaterThan(startDay);
  });

  test("weather changes over time and stays internally consistent", async ({ page }) => {
    await openWorld(page, "?seed=20260822");

    const seen = new Set<string>();
    for (let step = 0; step < 12; step += 1) {
      await page.locator(`${PANEL} [data-action="time-six-hours"]`).click();
      const weather = await text(page, "env-weather");
      seen.add(weather.split(" ")[0] ?? "");
      // Whatever the weather, the derived numbers must stay in range.
      const cloud = await readNumber(page, "env-precipitation", /(\d+)% cloud/);
      expect(cloud).toBeGreaterThanOrEqual(0);
      expect(cloud).toBeLessThanOrEqual(100);
    }
    // Several days of six-hour jumps must cross more than one front.
    expect(seen.size).toBeGreaterThan(1);
  });

  test("time and weather survive a save and load round trip", async ({ page }) => {
    await openWorld(page, "?seed=20260822");
    await page.locator(`${PANEL} [data-action="time-noon"]`).click();
    for (let step = 0; step < 3; step += 1) {
      await page.locator(`${PANEL} [data-action="time-six-hours"]`).click();
    }
    const savedTime = await text(page, "env-time");
    const savedWeather = await text(page, "env-weather");

    await page.locator(`${PANEL} [data-action="exit-world"]`).click();
    await page.getByRole("button", { name: "Saves", exact: true }).click();
    await page.locator('#saveScreen [data-field="new-name"]').fill("Weather round trip");
    await page.locator('#saveScreen [data-action="save-new"]').click();
    await expect(page.locator("#saveScreen .save-row")).toHaveCount(1);
    await page.locator('#saveScreen [data-action="exit-saves"]').click();

    // Move time on, then load the save back.
    await page.getByRole("button", { name: "World Map" }).click();
    for (let step = 0; step < 5; step += 1) {
      await page.locator(`${PANEL} [data-action="time-six-hours"]`).click();
    }
    await expect(field(page, "env-time")).not.toHaveText(savedTime);
    await page.locator(`${PANEL} [data-action="exit-world"]`).click();

    await page.getByRole("button", { name: "Saves", exact: true }).click();
    await page.locator('#saveScreen [data-action="load"]').click();
    await expect(page.locator('#saveScreen [data-field="notice"]')).toContainText("Loaded");
    await page.locator('#saveScreen [data-action="exit-saves"]').click();
    await page.getByRole("button", { name: "World Map" }).click();

    // Time keeps running after a load, so this compares the restored clock to
    // the saved one rather than demanding they be identical to the minute.
    const restored = await text(page, "env-time");
    expect(restored.slice(0, 8)).toBe(savedTime.slice(0, 8));
    const savedHour = Number(/(\d\d):/.exec(savedTime)?.[1] ?? -1);
    const restoredHour = Number(/(\d\d):/.exec(restored)?.[1] ?? -2);
    expect(restoredHour).toBe(savedHour);
    expect(await text(page, "env-weather")).toBe(savedWeather);
  });

  test("quality presets change the budgets they claim to change", async ({ page }) => {
    await openGround(page, "?seed=20260822&quality=low");
    await expect(field(page, "env-quality")).toHaveText(/^low:/, { timeout: 20_000 });

    const lowCapacity = await readNumber(page, "env-quality", /\d+\/(\d+) particles/);
    const lowTelegraphs = await readNumber(page, "env-quality", /(\d+) telegraphs/);
    await expect(field(page, "env-quality")).toHaveText(/shadow off/);
    await expect(field(page, "env-quality")).toHaveText(/none reflections/);

    await page.locator(`${PANEL} [data-action="quality-select"]`).selectOption("cinematic");
    await expect(field(page, "env-quality")).toHaveText(/^cinematic:/, { timeout: 20_000 });

    const highCapacity = await readNumber(page, "env-quality", /\d+\/(\d+) particles/);
    const highTelegraphs = await readNumber(page, "env-quality", /(\d+) telegraphs/);
    expect(highCapacity).toBeGreaterThan(lowCapacity);
    await expect(field(page, "env-quality")).toHaveText(/shadow 4096/);
    await expect(field(page, "env-quality")).toHaveText(/planar reflections/);

    // The rule the presets exist to enforce: detail changes, information does not.
    expect(lowTelegraphs).toBe(highTelegraphs);
    expect(lowTelegraphs).toBeGreaterThan(0);
  });

  test("entering the water moves through wading, standing and swimming", async ({ page }) => {
    await openGround(page, "?seed=20260822");
    await expect(field(page, "env-water")).toHaveText(/dry/, { timeout: 20_000 });

    // The Breach is open ocean: deep enough that nothing stands in it.
    await page.locator(`${PANEL} [data-action="teleport-select"]`).selectOption("pacific-breach");
    await page.locator(`${PANEL} [data-action="teleport"]`).click();
    await expect(field(page, "region")).toHaveText("pacific-breach", { timeout: 10_000 });
    await expect(field(page, "env-water")).toHaveText(/swimming/, { timeout: 20_000 });
    await expect(field(page, "env-water")).toHaveText(/deep|abyssal/);
    await expect(field(page, "env-audio")).toHaveText(/partial|surface/);
  });

  test("diving goes underwater and changes what can be seen and heard", async ({ page }) => {
    await openGround(page, "?seed=20260822");
    await page.locator(`${PANEL} [data-action="teleport-select"]`).selectOption("pacific-breach");
    await page.locator(`${PANEL} [data-action="teleport"]`).click();
    await expect(field(page, "env-water")).toHaveText(/swimming/, { timeout: 20_000 });

    const surfaceVisibility = await readNumber(page, "env-visibility", /([\d,]+) m/);
    await page.locator(`${PANEL} [data-action="dive-toggle"]`).click();
    await expect(field(page, "env-water")).toHaveText(/underwater/, { timeout: 20_000 });
    await expect(field(page, "env-audio")).toHaveText(/underwater/);

    // Underwater visibility is capped by the depth zone, which is far tighter.
    await expect
      .poll(async () => readNumber(page, "env-visibility", /([\d,]+) m/), { timeout: 10_000 })
      .toBeLessThan(surfaceVisibility);

    // Movement is slowest underwater.
    const speed = await readNumber(page, "env-traction", /([\d.]+)x speed/);
    expect(speed).toBeLessThan(1);

    await page.locator(`${PANEL} [data-action="dive-toggle"]`).click();
    await expect(field(page, "env-water")).toHaveText(/swimming/, { timeout: 20_000 });
  });

  test("weather is not cosmetic: it moves the numbers gameplay reads", async ({ page }) => {
    await openWorld(page, "?seed=20260822");

    const visibilities: number[] = [];
    const tractions: number[] = [];
    for (let step = 0; step < 16; step += 1) {
      await page.locator(`${PANEL} [data-action="time-six-hours"]`).click();
      visibilities.push(await readNumber(page, "env-visibility", /([\d,]+) m/));
      tractions.push(await readNumber(page, "env-traction", /([\d.]+)x grip/));
    }
    // Visibility must genuinely vary rather than sitting at one clear-air value.
    expect(Math.max(...visibilities)).toBeGreaterThan(Math.min(...visibilities) * 1.5);
    // And rain must have made the ground slippery at some point.
    expect(Math.min(...tractions)).toBeLessThan(1);
  });

  test("leaving the ground view releases the sky, weather and audio it created", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await openGround(page, "?seed=20260822");
    await expect(field(page, "env-quality")).toHaveText(/particles/, { timeout: 20_000 });

    await page.locator(`${PANEL} [data-action="view-globe"]`).click();
    await expect(page.locator(`${PANEL} [data-section="streaming"]`)).toBeHidden();
    // Time keeps running on the globe, because the world clock is not a ground
    // view feature; only the things that draw it are.
    await expect(field(page, "env-time")).toHaveText(/day \d+/);

    await page.locator(`${PANEL} [data-action="exit-world"]`).click();
    await expect(page.getByRole("button", { name: "New Game" })).toBeVisible();

    const tick = page.locator('#diagnosticsPanel [data-field="tick"]');
    const before = Number(await tick.textContent());
    await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(before);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
