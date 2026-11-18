// dist/wiredown.js: the loader. Load it with a classic <script src="…" defer>.
import { gitea } from "./gitea";
import { rendererUrl, start } from "./loader";

// Only a classic script has currentScript; it gives the loader's own URL.
const script = document.currentScript as HTMLScriptElement | null;
const src = script?.src;
if (!src) console.warn("wiredown: load wiredown.js with a classic <script src>");
else {
  const fonts = script.dataset.fonts;
  const run = () => start({ document, host: gitea, rendererUrl: rendererUrl(src), fonts });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
}
