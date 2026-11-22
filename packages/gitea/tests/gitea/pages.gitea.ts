// The README's "Verify on Gitea" list, run on a real Gitea with headless
// Chromium. Run with `pnpm test:gitea` (needs Docker and Playwright's
// headless Chromium).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@wiredown/cli";
import { parseFlow, serializeFlow } from "@wiredown/excalidraw";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { commit, PASSWORD, startGitea, USER, type Gitea } from "./gitea";

const NOTE = "Maja accepts the invitation.";
const REPO = `/${USER}/app`;
const FILE = `${REPO}/src/branch/main`;
// Screenshots for a person to look at; CI uploads this folder.
const SHOTS = join(tmpdir(), "wiredown-gitea");
const BROKEN = "```wiredown\nwindow: Broken\n  bogus thing\n```\n";

let gitea: Gitea;
let browser: Browser;
let anonymous: BrowserContext;
let user: BrowserContext;
let blocks: string;

/** The proposal's running example and its variant, as a screens file. */
async function screensFile(): Promise<string> {
  const proposal = await readFile(
    new URL("../../../../docs/prds/initial-implementation/syntax-proposal.md", import.meta.url),
    "utf8",
  );
  const examples = [
    ...proposal.matchAll(/```wiredown\n([^`]*?)```\n\^(team-members(?:-after-remove)?)/g),
  ];
  expect(examples).toHaveLength(2);
  return examples.map((m) => `\`\`\`wiredown\n${m[1]}\`\`\`\n^${m[2]}\n`).join("\n");
}

/** The repository's files: screens, a broken block, and flows made with the CLI. */
async function fixtures(): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "wd-gitea-"));
  try {
    await mkdir(join(dir, "flows"));
    const screens = join(dir, "screens.md");
    const flow = join(dir, "flows/f.excalidraw.md");
    await writeFile(screens, blocks);
    for (const args of [
      ["new", flow, "team-members", "team-members-after-remove", "--screens", screens],
      ["highlight", flow, "F1", "invite"],
      ["mark", flow, "F1", "members", "3"],
      ["note", flow, "F2", NOTE],
    ]) {
      const result = await run(["flow", ...args]);
      expect(result.exitCode, result.stderr).toBe(0);
    }
    // The note in Virgil, which is not shipped.
    const scene = parseFlow(await readFile(flow, "utf8"));
    scene.elements.find((e) => e.type === "text" && e.text === NOTE)!.fontFamily = 1;
    const text = serializeFlow(scene);
    // Hostile images: remote, protocol-relative, and an SVG that references a remote image.
    const attack = parseFlow(text);
    const image = attack.elements.find((e) => e.type === "image")!;
    const urls = [
      "https://attacker.invalid/track.png",
      "//attacker.invalid/x",
      "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="https://attacker.invalid/inner.png" width="20" height="20"/></svg>',
        ),
    ];
    for (const [i, dataURL] of urls.entries()) {
      const id = `attack${i}`;
      attack.files[id] = {
        id,
        dataURL,
        mimeType: i === 2 ? "image/svg+xml" : "image/png",
        created: 1,
      };
      attack.elements.push({ ...image, id, fileId: id, x: i * 30, y: -100 });
    }
    return {
      "screens.md": await readFile(screens, "utf8"),
      "broken.md": BROKEN,
      "flows/f.excalidraw.md": text,
      // A screen renamed in the screens file after the flow was made.
      "flows/renamed.excalidraw.md": text.replaceAll(
        "#^team-members-after-remove",
        "#^team-members-renamed",
      ),
      "flows/attack.excalidraw.md": serializeFlow(attack),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
  blocks = await screensFile();
  gitea = await startGitea();
  await gitea.api("POST", "/user/repos", { name: "app", auto_init: true, default_branch: "main" });
  await commit(gitea, "app", await fixtures());
  await commit(gitea, "app", { "change.md": "A change.\n" }, "change");
  const pr = await gitea.api<{ number: number }>("POST", `/repos/${USER}/app/pulls`, {
    head: "change",
    base: "main",
    title: "A change",
  });
  expect(pr.number).toBe(1);
  await gitea.api("POST", `/repos/${USER}/app/issues/1/comments`, { body: blocks });
  await gitea.api("PATCH", "/user/settings", { theme: "gitea-dark" });
  browser = await chromium.launch();
  console.log(`Chromium ${browser.version()}, ${gitea.url}`);
  anonymous = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  user = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await user.newPage();
  await page.goto(`${gitea.url}/user/login`);
  await page.fill("#user_name", USER);
  await page.fill("#password", PASSWORD);
  await page.locator("form button.primary").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/user/login"));
  await page.close();
});

afterAll(async () => {
  await browser?.close();
  gitea?.stop();
});

interface Visit {
  page: Page;
  /** Paths requested under /assets/wiredown/. */
  assets: string[];
  /** Page errors, console errors, failed requests and requests that leave Gitea. */
  errors: string[];
}

/** Opens `path` and records what the page did; the caller waits for what it expects. */
async function open(context: BrowserContext, path: string): Promise<Visit> {
  const page = await context.newPage();
  const assets: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ""}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console error: ${m.text()}`);
  });
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["data:", "blob:"].includes(url.protocol) && url.origin !== gitea.url)
      errors.push(`external request: ${url.href}`);
    if (url.pathname.includes("/assets/wiredown/")) assets.push(url.pathname);
  });
  await page.goto(gitea.url + path);
  return { page, assets, errors };
}

async function settle({ page }: Visit) {
  await page.waitForLoadState("networkidle");
}

it("loads only the loader on a page with no wireframes, from footer.tmpl", async () => {
  const visit = await open(anonymous, REPO);
  await settle(visit);
  expect(visit.assets).toEqual([
    expect.stringMatching(/^\/assets\/wiredown\/[^/]+\/wiredown\.js$/),
  ]);
  expect(await visit.page.locator(".wiredown-block").count()).toBe(0);
  expect(visit.errors).toEqual([]);
  console.log(
    `Gitea's theme for a visitor: ${await visit.page.locator("html").getAttribute("data-theme")}`,
  );
  console.log(
    `Gitea's CSP: ${(await visit.page.request.get(gitea.url + REPO)).headers()["content-security-policy"] ?? "none"}`,
  );
  await visit.page.close();
});

it("draws a screens file, its variant from the raw file, and keeps the source", async () => {
  const visit = await open(anonymous, `${FILE}/screens.md`);
  const svgs = visit.page.locator(".wiredown-block svg.wiredown-svg");
  await expect.poll(() => svgs.count()).toBe(2);
  await settle(visit);
  expect(await svgs.first().textContent()).toContain("3 of 5 seats used");
  expect(await svgs.nth(1).textContent()).toContain("2 of 5 seats used");
  expect(await svgs.first().innerHTML()).toContain("@font-face");
  for (const details of await visit.page.locator(".wiredown-block details").all()) {
    await details.locator("summary").click();
    expect(await details.locator("pre code.language-wiredown").isVisible()).toBe(true);
  }
  expect(await visit.page.locator(".wiredown-notice, .wiredown-error").count()).toBe(0);
  expect(visit.errors).toEqual([]);
  await visit.page.screenshot({ path: join(SHOTS, "screens.png"), fullPage: true });
  await visit.page.close();
});

it("shows a block's error with its line in the file, and the code", async () => {
  const visit = await open(anonymous, `${FILE}/broken.md`);
  const error = visit.page.locator(".wiredown-error");
  await error.waitFor();
  await settle(visit);
  expect(await error.textContent()).toMatch(/^line \d+: /);
  expect(await visit.page.locator("pre code.language-wiredown").isVisible()).toBe(true);
  expect(visit.errors).toEqual([]);
  await visit.page.close();
});

it("draws a flow above its Markdown, with every screen", async () => {
  const visit = await open(anonymous, `${FILE}/flows/f.excalidraw.md`);
  const svg = visit.page.locator(".wiredown-flow svg.wiredown-svg");
  await svg.waitFor();
  await settle(visit);
  for (const text of ["F1", "F2", NOTE]) expect(await svg.textContent()).toContain(text);
  expect(await svg.locator("image").count()).toBe(2);
  expect(await svg.locator("text").allTextContents()).toContain("3");
  // The Virgil note is drawn in Excalifont, with a notice and no font request.
  expect(await visit.page.locator(".wiredown-notice").textContent()).toContain(
    "text in font 1 is drawn in a fallback font",
  );
  expect(visit.assets.filter((p) => p.includes("/fonts/Virgil/"))).toEqual([]);
  expect(await visit.page.locator("details.wiredown-source").getAttribute("open")).toBeNull();
  expect(visit.errors).toEqual([]);
  await visit.page.screenshot({ path: join(SHOTS, "flow.png"), fullPage: true });
  await visit.page.close();
});

it("lists a renamed screen under Not drawn", async () => {
  const visit = await open(anonymous, `${FILE}/flows/renamed.excalidraw.md`);
  const notice = visit.page.locator(".wiredown-flow .wiredown-notice");
  await notice.waitFor();
  await settle(visit);
  expect(await notice.textContent()).toContain("#^team-members-renamed]]: no such screen");
  expect(visit.errors).toEqual([]);
  await visit.page.close();
});

it("draws a hostile flow without leaving Gitea's origin", async () => {
  const visit = await open(anonymous, `${FILE}/flows/attack.excalidraw.md`);
  const notice = visit.page.locator(".wiredown-flow .wiredown-notice");
  await notice.waitFor();
  await settle(visit);
  const text = await notice.textContent();
  expect(text).toContain("image file attack0:");
  expect(text).toContain("image file attack1:");
  expect(text).not.toContain("image file attack2:");
  expect(visit.errors).toEqual([]);
  await visit.page.close();
});

it("draws dark for a user with the dark theme", async () => {
  const draw = async (context: BrowserContext) => {
    const visit = await open(context, `${FILE}/screens.md`);
    const svgs = visit.page.locator(".wiredown-block svg.wiredown-svg");
    await expect.poll(() => svgs.count()).toBe(2);
    // Not networkidle: a signed-in page keeps a connection open to Gitea.
    await visit.page.waitForLoadState("load");
    expect(visit.errors).toEqual([]);
    const theme = await visit.page.locator("html").getAttribute("data-theme");
    const html = await svgs.first().evaluate((svg) => svg.outerHTML);
    await visit.page.close();
    return { theme, html };
  };
  const light = await draw(anonymous);
  const dark = await draw(user);
  expect(dark.theme).toBe("gitea-dark");
  expect(dark.html).not.toBe(light.html);
});

it("draws blocks in a pull request comment, and in a comment's preview", async () => {
  const visit = await open(user, `${REPO}/pulls/1`);
  const comment = visit.page.locator(
    // Posted comments only: the comment form is also a .timeline-item.comment.
    '[id^="issuecomment-"] .wiredown-block svg.wiredown-svg',
  );
  await expect.poll(() => comment.count()).toBe(2);
  // Write a comment and preview it: Gitea adds the preview without a reload.
  const form = visit.page.locator("#comment-form");
  await form.locator("textarea").fill(blocks);
  await form.getByText("Preview", { exact: true }).click();
  await expect.poll(() => form.locator(".wiredown-block svg.wiredown-svg").count()).toBe(2);
  await form.getByRole("button", { name: "Comment", exact: true }).click();
  // DIAGNOSTIC, to remove: what the page shows after posting.
  await new Promise((r) => setTimeout(r, 5000));
  await visit.page.screenshot({ path: join(SHOTS, "pr-posted.png"), fullPage: true });
  console.log(
    "after posting:",
    visit.page.url(),
    JSON.stringify(
      await visit.page
        .locator('[id^="issuecomment-"]')
        .evaluateAll((els) =>
          els.map(
            (e) =>
              `${e.id} ${e.className} blocks=${e.querySelectorAll(".wiredown-block").length} code=${e.querySelectorAll("code.language-wiredown").length} done=${e.querySelectorAll("[data-wiredown]").length}`,
          ),
        ),
    ),
    JSON.stringify(visit.errors),
  );
  await expect.poll(() => comment.count()).toBe(4);
  await visit.page.waitForLoadState("load");
  expect(visit.errors).toEqual([]);
  await visit.page.screenshot({ path: join(SHOTS, "pr.png"), fullPage: true });
  await visit.page.close();
});

it("leaves blocks as code with a notice when the renderer is missing", async () => {
  const page = await anonymous.newPage();
  await page.route("**/wiredown-renderer.js", (route) => route.fulfill({ status: 404 }));
  await page.goto(`${gitea.url}${FILE}/screens.md`);
  await page.locator(".wiredown-notice").first().waitFor();
  expect(await page.locator(".wiredown-notice").first().textContent()).toBe(
    "Wiredown could not load its renderer; showing the source.",
  );
  expect(await page.locator("pre code.language-wiredown").first().isVisible()).toBe(true);
  expect(await page.locator(".wiredown-block svg.wiredown-svg").count()).toBe(0);
  await page.close();
});

it("leaves a flow as it was with a notice when its raw file fails", async () => {
  const page = await anonymous.newPage();
  await page.route("**/raw/branch/main/flows/f.excalidraw.md", (route) =>
    route.fulfill({ status: 500 }),
  );
  await page.goto(`${gitea.url}${FILE}/flows/f.excalidraw.md`);
  await page.locator(".wiredown-notice").waitFor();
  expect(await page.locator(".wiredown-flow").count()).toBe(0);
  expect(await page.locator(".file-view").isVisible()).toBe(true);
  await page.close();
});

// The README's example policy: no 'unsafe-eval'.
const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:";
// Under it Excalidraw cannot subset its font: the worker fails, then the page
// does, and the whole font is inlined. Only these errors are allowed, and the
// page error only from the subsetting worker.
function unexpectedUnderCsp(errors: string[]): string[] {
  const eval_ =
    "Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script";
  return errors.filter(
    (e) =>
      !e.startsWith(
        "console error: Failed to use workers for subsetting, falling back to the main thread.",
      ) &&
      !e.startsWith(`console error: Skipped glyph subsetting EvalError: ${eval_}`) &&
      !(
        e.startsWith(`pageerror: ${eval_}`) &&
        /\/assets\/wiredown\/[^/]+\/chunks\/subset-worker\.chunk-[\w-]+\.js:\d+:\d+/.test(e)
      ),
  );
}

it("draws a flow under a strict CSP, with its fonts and styles", async () => {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  // Gitea's own responses, with the strict policy added.
  await context.route("**/*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": STRICT_CSP },
    });
  });
  const visit = await open(context, `${FILE}/flows/f.excalidraw.md`);
  await visit.page.locator(".wiredown-flow svg.wiredown-svg").waitFor();
  await settle(visit);
  // The policy blocks fonts silently. Gitea's own unused faces stay unloaded.
  const fonts = await visit.page.evaluate(() =>
    [...document.fonts].map((f) => `${f.family} ${f.status}`),
  );
  console.log(`fonts under the strict CSP: ${fonts.join(", ")}`);
  expect(fonts.filter((f) => f.endsWith(" error"))).toEqual([]);
  expect(fonts).toContain("Excalifont loaded");
  expect(
    await visit.page.locator(".wiredown-svg").evaluate((svg) => getComputedStyle(svg).display),
  ).toBe("block");
  expect(unexpectedUnderCsp(visit.errors)).toEqual([]);
  console.log(`strict CSP: ${visit.errors.length} font subsetting errors allowed`);
  // An unrelated eval under the same policy is not allowed.
  const control = await open(context, "/");
  await control.page.route(`${gitea.url}/unrelated-eval.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'eval("1")' }),
  );
  await control.page.addScriptTag({ url: "/unrelated-eval.js" }).catch(() => {});
  await expect.poll(() => unexpectedUnderCsp(control.errors).length).toBeGreaterThan(0);
  await context.close();
});
