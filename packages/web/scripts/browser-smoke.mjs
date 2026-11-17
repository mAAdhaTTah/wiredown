// MANUAL check, outside Vitest and CI. These are Gitea-shaped STAND-IN pages,
// using src/gitea.ts's HTML/URL assumptions, not a test of a live Gitea.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    browser: { type: "string" },
  },
});
const dist = new URL("../dist/", import.meta.url);
const { run } = await import("../../cli/dist/index.js");
const site = await mkdtemp(join(tmpdir(), "wiredown-smoke-site-"));
const out = values.out
  ? resolve(values.out)
  : await mkdtemp(join(tmpdir(), "wiredown-smoke-shots-"));
const note = "Maja accepts the invitation.";
const types = {
  ".js": "text/javascript",
  ".woff2": "font/woff2",
  ".md": "text/plain; charset=utf-8",
};
// A strict site-wide policy, sent with every response as a forge would: no
// 'unsafe-eval' (see the README's "On Gitea").
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:";
let strict = false;
// Under it Excalidraw cannot subset the font: its worker fails, then the page
// does, and it inlines the whole font. These errors, and only these, are allowed.
const SUBSETTING = [
  /^pageerror: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script/,
  /^console error: Failed to use workers for subsetting, falling back to the main thread\./,
  /^console error: Skipped glyph subsetting EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script/,
];
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
function renderMd(md) {
  const lines = md.split("\n"),
    out = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\w*)/.exec(lines[i]);
    if (fence) {
      const body = [];
      while (++i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i]);
      out.push(
        `<div class="code-block-container"><pre><code class="language-${fence[1]}">${esc(body.join("\n"))}\n</code></pre></div>`,
      );
    } else if (lines[i].trim()) out.push(`<p>${esc(lines[i])}</p>`);
  }
  return out.join("\n");
}
function html(theme, body, fonts) {
  const tag = fonts ? ` data-fonts="${fonts}"` : "";
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{font-family:sans-serif;margin:24px;${theme === "gitea-dark" ? "background:#1e1e1e;color:#ddd" : ""}}</style></head><body><div class="file-view markup">${body}</div><script src="/assets/wiredown/wiredown.js"${tag} defer></script></body></html>`;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (strict) res.setHeader("content-security-policy", CSP);
  try {
    if (url.pathname.startsWith("/assets/wiredown/")) {
      const path = url.pathname.slice("/assets/wiredown/".length);
      // A font folder a site added next to the bundle (README, "Other fonts").
      const file = path.startsWith("fonts/Virgil/")
        ? join(site, path)
        : new URL(path, dist).pathname;
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
      return;
    }
    const match = /^\/me\/app\/(raw|src)\/branch\/main\/(.+)$/.exec(url.pathname);
    if (match) {
      // rawUrl() discards query parameters, so give the failure page its own
      // file URL; its Referer carries the flag to the raw endpoint.
      if (
        match[1] === "raw" &&
        new URL(req.headers.referer ?? "http://localhost").searchParams.has("failRaw")
      ) {
        res.writeHead(500);
        res.end("Deliberate raw-file failure");
        return;
      }
      const md = await readFile(join(site, match[2]), "utf8");
      res.setHeader("content-type", match[1] === "raw" ? types[".md"] : "text/html; charset=utf-8");
      res.end(
        match[1] === "raw"
          ? md
          : html(
              url.searchParams.get("theme") ?? "gitea-light",
              renderMd(md),
              url.searchParams.get("fonts"),
            ),
      );
      return;
    }
    if (url.pathname === "/plain") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html("gitea-light", "<p>No wireframes here.</p>"));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  } catch (error) {
    res.writeHead(404);
    res.end(String(error));
  }
});
let browser;
try {
  await mkdir(out, { recursive: true });
  await cp(
    new URL("../node_modules/@excalidraw/excalidraw/dist/prod/fonts/Virgil/", import.meta.url),
    join(site, "fonts/Virgil"),
    { recursive: true },
  );
  // Copy the proposal's running example and explicit-replace variant verbatim.
  const proposal = await readFile(
    new URL("../../../docs/prds/initial-implementation/syntax-proposal.md", import.meta.url),
    "utf8",
  );
  const examples = [
    ...proposal.matchAll(/```wiredown\n([^`]*?)```\n\^(team-members(?:-after-remove)?)/g),
  ];
  assert.equal(examples.length, 2, "running examples missing from syntax proposal");
  await writeFile(
    join(site, "screens.md"),
    examples.map((m) => `\`\`\`wiredown\n${m[1]}\`\`\`\n^${m[2]}\n`).join("\n"),
  );
  const flow = join(site, "flows/f.excalidraw.md");
  for (const args of [
    ["new", flow, "team-members", "team-members-after-remove"],
    ["highlight", flow, "F1", "invite"],
    ["mark", flow, "F1", "members", "3"],
    ["note", flow, "F2", note],
  ]) {
    const result = await run(["flow", ...args]);
    assert.equal(result.exitCode, 0, `flow ${args[0]}: ${result.stderr}`);
  }
  const { parseFlow, serializeFlow } = await import("../../excalidraw/dist/index.js");
  const original = parseFlow(await readFile(flow, "utf8"));
  original.elements.find((e) => e.type === "text" && e.text === note).fontFamily = 1;
  await writeFile(flow, serializeFlow(original));
  const adversarial = parseFlow(serializeFlow(original));
  const image = adversarial.elements.find((e) => e.type === "image");
  for (const [i, dataURL] of [
    "https://attacker.invalid/track.png",
    "//attacker.invalid/x",
    "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="https://attacker.invalid/inner.png" width="20" height="20"/></svg>',
      ),
  ].entries()) {
    const id = `attack${i}`;
    adversarial.files[id] = {
      id,
      dataURL,
      mimeType: i === 2 ? "image/svg+xml" : "image/png",
      created: 1,
    };
    adversarial.elements.push({
      ...image,
      id,
      fileId: id,
      x: i * 30,
      y: -100,
      width: 20,
      height: 20,
    });
  }
  await writeFile(join(site, "flows/attack.excalidraw.md"), serializeFlow(adversarial));
  const executablePath = values.browser ?? process.env.WIREDOWN_SMOKE_BROWSER;
  try {
    // Default headless launch honors PLAYWRIGHT_BROWSERS_PATH or the standard cache.
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    throw new Error(
      `${error.message.split("\n")[0]}\nRun: pnpm --filter @wiredown/web exec playwright-core install chromium-headless-shell (or pass --browser /path/to/chromium)`,
    );
  }
  console.log(`Chromium ${browser.version()}`);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function visit(name, path, kind) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const errors = [],
      assets = [],
      responses = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console error: ${m.text()}`);
    });
    page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
    page.on("response", (r) => responses.push({ url: r.url(), status: r.status() }));
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (!["data:", "blob:"].includes(url.protocol) && url.origin !== base)
        errors.push(`external request: ${url.href}`);
      if (url.pathname.startsWith("/assets/wiredown/")) assets.push(url.pathname);
    });
    try {
      await page.goto(base + path);
      if (kind === "screens")
        await page.waitForFunction(
          () => document.querySelectorAll(".wiredown-block svg").length === 2,
        );
      if (kind === "flow" || kind === "attack") await page.waitForSelector(".wiredown-flow svg");
      if (kind === "failure") await page.waitForSelector(".wiredown-notice");
      await page.waitForLoadState("networkidle");
      if (kind === "plain") {
        assert.deepEqual(assets, ["/assets/wiredown/wiredown.js"], `${name}: unexpected assets`);
        assert.equal(await page.locator(".wiredown-block, svg").count(), 0);
      }
      if (kind === "screens") {
        assert(
          assets
            .filter((p) => p.includes("/fonts/"))
            .every((p) => p.includes("/fonts/Excalifont/")),
          "existing screens load no added fonts",
        );
        assert.match(
          await page.locator(".wiredown-block svg").nth(1).textContent(),
          /2 of 5 seats used/,
        );
        assert.equal(
          await page
            .locator("details summary")
            .allTextContents()
            .then((s) => s.join(",")),
          "Source,Source",
        );
        for (const details of await page.locator("details").all()) {
          await details.locator("summary").click();
          assert(
            await details.locator("pre code.language-wiredown").isVisible(),
            "Source must open",
          );
        }
        assert.match(await page.locator(".wiredown-block svg").first().innerHTML(), /@font-face/);
        const base = page.locator(".wiredown-block svg").first();
        for (const text of ["3 of 5 seats used", "Invite member"])
          assert((await base.textContent()).includes(text), `first screen missing ${text}`);
        for (const svg of await page.locator(".wiredown-block svg").all()) {
          const box = await svg.boundingBox();
          assert(box && box.width > 200 && box.height > 100, "a screen has no size");
        }
      }
      if (["flow", "attack"].includes(kind)) {
        assert(await page.locator(".wiredown-flow > details.wiredown-source").count());
        assert.equal(await page.locator("details.wiredown-source").getAttribute("open"), null);
        assert.equal(await page.locator("details.wiredown-source pre").first().isVisible(), false);
        // Only Excalifont ships; the Virgil note loads Virgil only when the
        // site added it (data-fonts), and is otherwise drawn in Excalifont.
        const virgil = path.includes("fonts=Virgil");
        assert.equal(
          assets.some((p) => p.includes("/fonts/Virgil/")),
          virgil,
          virgil ? "added Virgil must load" : "no request for a Virgil font",
        );
        const fallback = "text in font 1 is drawn in a fallback font";
        const notices = await page.locator(".wiredown-notice").allTextContents();
        assert.equal(notices.join("").includes(fallback), !virgil, "Virgil fallback notice");
        assert(!responses.some((r) => r.status >= 400), "no missing assets");
      }
      if (kind === "attack") {
        const notice = await page.locator(".wiredown-notice").textContent();
        assert(
          notice.includes("Not drawn:") &&
            notice.includes("image file attack0:") &&
            notice.includes("image file attack1:"),
        );
        assert(!notice.includes("image file attack2:"), "inline SVG stays an image");
        const inlineImages = await page
          .locator(".wiredown-flow svg image")
          .evaluateAll((images) => images.map((image) => image.getAttribute("href") ?? ""));
        assert(
          inlineImages.some(
            (url) =>
              url.startsWith("data:image/svg+xml,") &&
              decodeURIComponent(url).includes("https://attacker.invalid/inner.png"),
          ),
          "nested external reference remains inside an SVG image",
        );
        assert.equal(await page.locator(".wiredown-flow svg").count(), 1);
      }
      if (kind === "flow") {
        assert.equal(
          (await page.locator(".wiredown-error").count()) +
            (path.includes("fonts=Virgil") ? await page.locator(".wiredown-notice").count() : 0),
          0,
        );
        assert.equal(await page.locator(".wiredown-flow svg").count(), 1);
        const svg = page.locator(".wiredown-flow svg");
        for (const text of ["F1", "F2", note])
          assert((await svg.textContent()).includes(text), `flow missing ${text}`);
        assert.equal(await svg.locator("image").count(), 2, "both screens embedded");
        // the mark's label, and enough strokes for the arrow, the highlight and the badge
        assert((await svg.locator("text").allTextContents()).includes("3"), "flow missing mark");
        assert((await svg.locator("path").count()) >= 4, "flow missing its drawn shapes");
        const box = await svg.boundingBox();
        assert(box && box.width > 400 && box.height > 100, "the flow has no size");
      }
      if (kind === "failure") {
        assert(
          responses.some((r) => r.url.includes("/raw/") && r.status === 500),
          "raw request must fail",
        );
        assert(await page.locator(".file-view").isVisible(), "original flow must stay visible");
        assert((await page.locator(".file-view").textContent()).includes("excalidraw"));
        assert.equal(await page.locator(".wiredown-flow svg").count(), 0);
        assert.equal(await page.locator("details.wiredown-source").count(), 0);
        assert(await page.locator(".file-view pre").first().isVisible());
        // Chromium reports the deliberately served HTTP 500 as a console error.
        assert.equal(
          errors.filter(
            (e) =>
              e ===
              "console error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
          ).length,
          1,
        );
        errors.splice(
          errors.indexOf(
            "console error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
          ),
          1,
        );
      } else if (kind === "screens" || kind === "plain")
        assert.equal(await page.locator(".wiredown-notice, .wiredown-error").count(), 0);
      if (strict) {
        // the policy blocks styles and fonts silently: check they applied
        assert(
          await page.evaluate(() => [...document.fonts].every((f) => f.status === "loaded")),
          "fonts load under the policy",
        );
        assert.equal(
          await page.locator(".wiredown-svg").evaluate((svg) => getComputedStyle(svg).display),
          "block",
          "the renderer's styles apply under the policy",
        );
      }
      const unexpected = errors.filter((e) => !(strict && SUBSETTING.some((m) => m.test(e))));
      assert.deepEqual(unexpected, [], `${name}: browser errors`);
      await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
      console.log(
        `FONT ${name}: ${assets.filter((p) => p.includes("/fonts/")).join(", ") || "none"}`,
      );
      console.log(
        `PASS ${name}: ${assets.length} asset requests; no unexpected errors, failed requests or external requests${strict ? `; ${errors.length} font subsetting errors allowed` : ""}`,
      );
      return await page
        .locator(".wiredown-block svg")
        .evaluateAll((svgs) => svgs.map((s) => s.outerHTML).join("\n"));
    } catch (error) {
      throw new Error(`${name}: ${error.message}`, { cause: error });
    } finally {
      await page.close();
    }
  }
  await visit("adversarial", "/me/app/src/branch/main/flows/attack.excalidraw.md", "attack");
  await visit("plain", "/plain", "plain");
  for (const kind of ["screens", "flow"]) {
    const path = `/me/app/src/branch/main/${kind === "screens" ? "screens.md" : "flows/f.excalidraw.md"}`;
    const light = await visit(`${kind}-light`, path, kind);
    const dark = await visit(`${kind}-dark`, `${path}?theme=gitea-dark`, kind);
    assert.notEqual(dark, light, `${kind}: dark SVG must differ from light`);
  }
  strict = true;
  await visit("flow-csp", "/me/app/src/branch/main/flows/f.excalidraw.md", "flow");
  strict = false;
  await visit("flow-virgil", "/me/app/src/branch/main/flows/f.excalidraw.md?fonts=Virgil", "flow");
  await visit("raw-failure", "/me/app/src/branch/main/flows/f.excalidraw.md?failRaw=1", "failure");
  console.log(`PASS browser smoke. Screenshots: ${out}`);
} catch (error) {
  console.error(`FAIL browser smoke: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(site, { recursive: true, force: true });
}
