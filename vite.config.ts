import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

export default defineConfig(({ command }) => ({
  // A production build is relocatable: every URL is relative to index.html,
  // so the same dist runs at a domain root, in a subfolder and on GitHub
  // Pages. The dev server stays at "/" for the tests and the direct routes.
  base: command === "build" ? "./" : "/",
  server: { port: 5173, strictPort: false },
  build: { target: "es2022", sourcemap: true },
  test: {
    // Playwright owns tests/e2e — vitest must not try to execute those specs.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
}));
