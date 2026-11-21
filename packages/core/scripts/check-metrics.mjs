// Compare table widths with the browser canvas used by Excalidraw.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { EXCALIFONT } from "../dist/metrics-excalifont.js";
import { fontMeasurer } from "../dist/metrics.js";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const dir = join(dirname(require.resolve("@excalidraw/excalidraw")), "fonts/Excalifont");
const faces = readdirSync(dir)
  .filter((f) => f.endsWith(".woff2"))
  .map(
    (f, i) =>
      `@font-face{font-family:XF${i};src:url(data:font/woff2;base64,${readFileSync(join(dir, f)).toString("base64")})}`,
  );
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${faces.join("")}</style>`);
  const samples = [
    "Team settings",
    "AV To WA",
    "Invite member",
    "1234567890",
    "Save (draft)",
    "Hello, world!",
  ];
  const widths = await page.evaluate(
    async ({ n, samples }) => {
      for (let i = 0; i < n; i++) await document.fonts.load(`1000px XF${i}`, samples.join(""));
      await document.fonts.ready;
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `1000px ${Array.from({ length: n }, (_, i) => `XF${i}`).join(",")}`;
      return samples.map((s) => (ctx.measureText(s).width * 16) / 1000);
    },
    { n: faces.length, samples },
  );
  const { measure } = fontMeasurer(EXCALIFONT);
  samples.forEach((s, i) =>
    assert(Math.abs(measure(s, { fontSize: 16 }).w - widths[i]) < 0.015, `${s}: ${widths[i]}`),
  );
  console.log(`Verified ${samples.length} canvas widths within 0.015 px`);
} finally {
  await browser.close();
}
