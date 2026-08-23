import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  /**
   * One worker, deliberately.
   *
   * Playwright otherwise runs spec files across half the CPUs, and every test in
   * this suite now boots a WebGPU context, a terrain worker and a set of particle
   * systems. Eight of those at once thrash the GPU and time each other out: the
   * same run failed a different test each time, none of them for a real reason.
   * A serial suite is slower and says the same thing twice.
   */
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
