import { startApp, type AppHandle } from "./app/bootstrap";

const root = document.getElementById("appRoot");
if (!root) throw new Error("main: #appRoot not found in index.html");

let handle: AppHandle | undefined;
startApp(root)
  .then((h) => {
    handle = h;
  })
  .catch((err) => {
    console.error("Fatal bootstrap error", err);
  });

// Vite HMR reloads this module without a full page reload — dispose the previous
// engine/scene/listeners first so we never end up with duplicate render loops or canvases.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    handle?.dispose();
  });
}
