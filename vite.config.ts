import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

export default defineConfig({
  server: { port: 5173, strictPort: false },
  build: { target: "es2022", sourcemap: true },
  test: {
    // Playwright owns tests/e2e — vitest must not try to execute those specs.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
