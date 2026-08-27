/**
 * Stamps the built service worker with the build it belongs to.
 *
 * Update detection is byte comparison of sw.js: a worker that never changes
 * would never announce a new app version. The public/ copy keeps a fixed
 * placeholder so development is deterministic; every production build writes a
 * unique stamp into dist/, which is what makes "an update is ready" fire.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../dist/sw.js", import.meta.url);
const stamp = `${Date.now().toString(36)}`;
const source = readFileSync(path, "utf8");
if (!source.includes("__BUILD__")) {
  console.error("dist/sw.js has no __BUILD__ placeholder; the update signal would never fire.");
  process.exit(1);
}
writeFileSync(path, source.replace("__BUILD__", stamp));
console.log(`Stamped dist/sw.js as build ${stamp}.`);
