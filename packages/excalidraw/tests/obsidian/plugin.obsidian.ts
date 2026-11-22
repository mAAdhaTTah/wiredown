// Opens notes with wiredown blocks in real Obsidian with the wiredown and
// Excalidraw plugins and checks what the plugin draws in a note: the items of
// the plugin README's "Checked in Obsidian" list. Run with `pnpm test:obsidian`.
import { afterAll, beforeAll, expect, it } from "vitest";
import { startObsidian, type Obsidian } from "./obsidian";

const fence = (source: string, id: string) => `\`\`\`wiredown\n${source}\n\`\`\`\n^${id}\n`;
const BASE = "window: Base\n  text: Hello #hello";
const VARIANT = "extends: base\nreplace: hello\n  text: Changed";
const MISSING_PLUGIN =
  "Wiredown needs the Excalidraw plugin. Install and enable it, then reopen this note.";

interface Drawn {
  renderer?: string;
  /** The text of the drawn screen, top to bottom. */
  text: string[];
  /** The block's error and warning lines. */
  errors: string[];
  warnings: string[];
  /** The source shown with an error. */
  code?: string;
  /** Whether the SVG embeds Excalifont in an @font-face rule. */
  font: boolean;
  filter?: string;
}

let obsidian: Obsidian;
beforeAll(async () => {
  obsidian = await startObsidian({
    "note.md": `${fence(BASE, "base")}\n${fence(VARIANT, "variant")}`,
    "invalid.md": fence("window: Broken\n  bogus: y", "invalid"),
    "warning.md": fence("text: {warnin}", "warning"),
    "dependency.md": fence("text: Needs Excalidraw", "dependency"),
  });
  // Errors Obsidian logs from here on, for the last test.
  await obsidian.run(`(() => {
    window.wiredownErrors = [];
    const error = console.error;
    console.error = (...args) => {
      wiredownErrors.push(args.map(String).join(" "));
      error(...args);
    };
    window.addEventListener("error", (e) => wiredownErrors.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => wiredownErrors.push(String(e.reason)));
  })()`);
});
afterAll(() => obsidian?.close());

/** Opens `path` in a new tab in `mode` and returns each wiredown block drawn. */
function open(path: string, mode: "preview" | "live" = "preview"): Promise<Drawn[]> {
  const state = mode === "preview" ? { mode: "preview" } : { mode: "source", source: false };
  return obsidian.run<Drawn[]>(`(async () => {
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(path)}, ...${JSON.stringify(state)} } });
    window.wiredownLeaf = leaf;
    await new Promise((r) => setTimeout(r, 2000));
    return (${DRAWN})(${JSON.stringify(mode)});
  })()`);
}

/** Each block drawn in the last opened tab, as a function to run in Obsidian. */
const DRAWN = `((mode) => {
  const view = mode === "preview" ? ".markdown-reading-view" : ".markdown-source-view";
  const all = (el, selector) => [...el.querySelectorAll(selector)].map((e) => e.textContent);
  return [...wiredownLeaf.view.containerEl.querySelectorAll(view + " .wiredown-block")].map((b) => {
    const svg = b.querySelector(":scope > svg.wiredown-svg");
    return {
      renderer: b.dataset.renderer,
      text: svg ? all(svg, "text") : [],
      errors: all(b, ".wiredown-error li"),
      warnings: all(b, ".wiredown-warning"),
      code: b.querySelector("pre code")?.textContent,
      font: svg ? /@font-face[^}]*Excalifont/.test(svg.innerHTML) : false,
      filter: svg ? getComputedStyle(svg).filter : undefined,
    };
  });
})`;

const redraw = () =>
  obsidian.run<Drawn[]>(`(async () => {
    await new Promise((r) => setTimeout(r, 2000));
    return (${DRAWN})("preview");
  })()`);

it.each(["preview", "live"] as const)(
  "draws base and variant blocks with Excalidraw and embeds Excalifont: %s",
  async (mode) => {
    const drawn = await open("note.md", mode);
    expect(drawn.map(({ renderer, text, font }) => ({ renderer, text, font }))).toEqual([
      { renderer: "excalidraw", text: ["Hello", "Base"], font: true },
      { renderer: "excalidraw", text: ["Changed", "Base"], font: true },
    ]);
  },
);

it("redraws a variant when its base changes", async () => {
  await open("note.md");
  await obsidian.run(`(async () => {
    const file = app.vault.getAbstractFileByPath("note.md");
    await app.vault.modify(file, (await app.vault.read(file)).replace("window: Base", "window: Edited"));
  })()`);
  expect((await redraw()).map((d) => d.text)).toEqual([
    ["Hello", "Edited"],
    ["Changed", "Edited"],
  ]);
});

it("filters screens in a dark note and not in a light one", async () => {
  await open("note.md");
  const filters = await obsidian.run<string[]>(`(async () => {
    const filters = [];
    for (const theme of ["obsidian", "moonstone"]) {
      app.changeTheme(theme);
      await new Promise((r) => setTimeout(r, 500));
      filters.push((${DRAWN})("preview")[0].filter);
    }
    return filters;
  })()`);
  expect(filters).toEqual(["invert(0.93) hue-rotate(180deg)", "none"]);
});

it("shows errors with the source and draws nothing", async () => {
  expect(await open("invalid.md")).toEqual([
    {
      text: [],
      errors: ['line 3: don\'t understand "bogus: y"'],
      warnings: [],
      code: "window: Broken\n  bogus: y",
      font: false,
    },
  ]);
});

it("shows warnings under the drawn screen", async () => {
  const [drawn] = await open("warning.md");
  expect(drawn).toMatchObject({
    renderer: "excalidraw",
    text: ["{warnin}"],
    errors: [],
    warnings: ["line 2: {warnin} is not an icon, so it is drawn as text; did you mean {warning}?"],
  });
});

it("shows the dependency error without Excalidraw, and draws once it is enabled", async () => {
  await obsidian.run(`app.plugins.disablePlugin("obsidian-excalidraw-plugin")`);
  expect(await open("dependency.md")).toEqual([
    {
      text: [],
      errors: [MISSING_PLUGIN],
      warnings: [],
      code: "text: Needs Excalidraw",
      font: false,
    },
  ]);
  await obsidian.run(`app.plugins.enablePlugin("obsidian-excalidraw-plugin")`);
  expect((await redraw()).map(({ renderer, text }) => ({ renderer, text }))).toEqual([
    { renderer: "excalidraw", text: ["Needs Excalidraw"] },
  ]);
});

it("logs no errors, including when the plugin unloads", async () => {
  await open("note.md");
  const errors = await obsidian.run<string[]>(`(async () => {
    await app.plugins.disablePlugin("wiredown");
    await new Promise((r) => setTimeout(r, 1000));
    return wiredownErrors;
  })()`);
  expect(errors).toEqual([]);
});
