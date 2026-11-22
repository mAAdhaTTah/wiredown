import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flowFrames, parseFlow, serializeFlow } from "@wiredown/excalidraw";
import { expect, it } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, screensIn, VARIANT } from "./helpers";

it("renders each embed's screens, rejecting --screen and --screens and retaining invalid embeds", async () => {
  const dir = await fixture({ "screens.md": `${BASE}\n${VARIANT}` });
  const file = join(dir, "flows", "f.excalidraw.md");
  expect((await run(["flow", "new", file, "team", "team-after", ...screensIn(dir)])).exitCode).toBe(
    0,
  );
  const args = ["render", file, "--out", join(dir, "out"), "--json"];
  const result = await run(args);
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed).toMatchObject({
    file,
    errors: [],
    warnings: [],
    flow: { svg: join(dir, "out", "f.svg") },
  });
  const svg = await readFile(parsed.flow.svg, "utf8");
  expect(svg).toContain(`width="${parsed.flow.width}"`);
  expect(svg).toContain(`height="${parsed.flow.height}"`);
  expect((await run([...args, "--screen", "team"])).exitCode).toBe(2);
  expect((await run([...args, "--screens", join(dir, "screens.md")])).exitCode).toBe(2);
  await writeFile(
    join(dir, "screens.md"),
    `${BASE}\n${VARIANT.replace("replace: seats", "replace: nothing")}`,
  );
  const broken = await run(args.filter((a) => a !== "--json"));
  expect(broken.exitCode).toBe(1);
  expect(broken.stderr).toContain(
    `F2: error: embeds [[screens#^team-after]], but ^team-after in ${join(dir, "screens.md")} has errors`,
  );
  expect(await readFile(parsed.flow.svg, "utf8")).toContain("<svg");
}, 30000);

it("writes human output, theme/font variants, and preserves the flow bytes", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "flows", "f.excalidraw.md");
  expect((await run(["flow", "new", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
  const before = await readFile(file);
  const out = join(dir, "new", "out");
  const args = ["render", file, "--out", out];
  const human = await run(args);
  expect(human.exitCode).toBe(0);
  expect(human.stderr).toBe("");
  expect(human.stdout).toMatch(new RegExp("f\\.svg  \\d+x\\d+\\n$"));
  const path = join(out, "f.svg");
  expect(human.stdout.startsWith(path + "  ")).toBe(true);
  const light = await readFile(path, "utf8");
  expect((await run([...args, "--theme", "dark"])).exitCode).toBe(0);
  const dark = await readFile(path, "utf8");
  expect(dark).not.toBe(light);
  expect(dark).toContain('filter="invert(93%) hue-rotate(180deg)"');
  expect((await run([...args, "--no-fonts"])).exitCode).toBe(0);
  const plain = await readFile(path, "utf8");
  expect(plain).not.toBe(light);
  expect(plain).not.toContain("@font-face");
  expect(light).toContain("@font-face");
  expect(await readFile(file)).toEqual(before);
}, 30000);

it("reports a flow's size rounded, as screens report theirs", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "flows", "f.excalidraw.md");
  expect((await run(["flow", "new", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
  expect((await run(["flow", "note", file, "F1", "A note"])).exitCode).toBe(0);
  // a person dragged the note: the drawing's height has a fraction
  const flow = parseFlow(await readFile(file, "utf8"));
  const note = flow.elements.find((e) => e.type === "text" && e.text === "A note")!;
  note.y = Number(note.y) + 0.1932247560471;
  await writeFile(file, serializeFlow(flow));
  const args = ["render", file, "--out", dir];
  const { flow: output } = JSON.parse((await run([...args, "--json"])).stdout);
  expect(await readFile(join(dir, "f.svg"), "utf8")).toMatch(/^<svg [^>]*height="\d+\.\d+"/);
  expect(Number.isInteger(output.width) && Number.isInteger(output.height)).toBe(true);
  expect((await run(args)).stdout).toBe(
    `${join(dir, "f.svg")}  ${output.width}x${output.height}\n`,
  );
}, 30000);

it("reports each frame whose embed names no file, and still writes the SVG", async () => {
  const dir = await fixture({ "screens.md": BASE, "ui.md": BASE });
  const file = join(dir, "flows", "f.excalidraw.md");
  await run(["flow", "new", file, "team", "team", ...screensIn(dir)]);
  await run(["flow", "add-screen", file, "team", "--screens", join(dir, "ui.md")]);
  const args = ["render", file, "--out", dir];
  expect(await run(args)).toMatchObject({ exitCode: 0, stderr: "" });
  const { rm } = await import("node:fs/promises");
  await rm(join(dir, "screens.md"));
  const missing = await run(args);
  expect(missing.exitCode).toBe(1);
  const why = `embeds [[screens#^team]], but no screens.md was found in ${dir}`;
  expect(missing.stderr).toBe(`${file}: F1: error: ${why}\n${file}: F2: error: ${why}\n`);
  const svg = await readFile(join(dir, "f.svg"), "utf8");
  expect(svg.match(/data:image\/svg\+xml;base64/g)).toHaveLength(1); // F3, from ui.md
});

it("rejects incompatible screen selectors with usage errors", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "f.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const plain = await run(["render", join(dir, "screens.md"), "--screens", "other.md"]);
  expect(plain).toMatchObject({ exitCode: 2, stdout: "" });
  expect(plain.stderr).toContain("--screens");
  const flow = await run(["render", file, "--screen", "team"]);
  expect(flow).toMatchObject({ exitCode: 2, stdout: "" });
  expect(flow.stderr).toContain("--screen cannot be used with a flow");
});

it("names the frame and block for a removed screen while writing the SVG", async () => {
  const dir = await fixture({ "screens.md": BASE + "\n" + VARIANT });
  const file = join(dir, "flows", "f.excalidraw.md");
  await run(["flow", "new", file, "team", "team-after", ...screensIn(dir)]);
  await writeFile(join(dir, "screens.md"), BASE);
  const result = await run(["render", file, "--out", dir]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    `F2: error: embeds [[screens#^team-after]], but ${join(dir, "screens.md")} has no ^team-after`,
  );
  expect(result.stdout).toContain(join(dir, "f.svg") + "  ");
  expect(await readFile(join(dir, "f.svg"), "utf8")).toContain("<svg");
});

it("returns a write finding and valid JSON for an output under a file", async () => {
  const dir = await fixture({ "screens.md": BASE, blocker: "" });
  const file = join(dir, "f.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const args = ["render", file, "--out", join(dir, "blocker", "out")];
  const human = await run(args);
  expect(human).toMatchObject({ exitCode: 1, stdout: "" });
  expect(human.stderr).toContain("error: can't write " + join(dir, "blocker", "out", "f.svg"));
  const result = await run([...args, "--json"]);
  expect(result).toMatchObject({ exitCode: 1, stderr: "" });
  expect(JSON.parse(result.stdout)).toMatchObject({
    file,
    flow: null,
    warnings: [],
    errors: [{ message: expect.stringContaining("can't write") }],
  });
});

it("resolves embeds of a flow given relative to the current directory", async () => {
  const dir = await fixture({ "screens.md": BASE });
  await mkdir(join(dir, "flows"));
  const script = `import { embedRoot, resolveEmbed } from ${JSON.stringify(new URL("../dist/embeds.js", import.meta.url).href)};
    const root = await embedRoot("f.excalidraw.md");
    console.log((await resolveEmbed("f.excalidraw.md", "screens", root)).path);
    console.log((await resolveEmbed("f.excalidraw.md", "ui", root)).message);`;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: join(dir, "flows"),
    encoding: "utf8",
  });
  // a flow given relative finds paths it prints relative to the same directory
  expect(output).toBe("../screens.md\nno ui.md was found in ..\n");
});

it("reports a missing hand-made embed as lint does", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "f.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const flow = parseFlow(await readFile(file, "utf8"));
  const image = flowFrames(flow)[0].element;
  delete image.customData;
  await writeFile(file, serializeFlow(flow));
  await writeFile(join(dir, "screens.md"), "");
  const result = await run(["render", file, "--out", dir]);
  expect(result.exitCode).toBe(1);
  const lint = await run(["flow", "lint", file]);
  const { path } = flow.embeds.get(String(image.fileId))!;
  const message = `an image embeds [[${path}#^team]], but ${join(dir, "screens.md")} has no ^team`;
  expect(lint.stdout).toContain(`${file}: error: ${message}\n`);
  expect(result.stderr).toBe(`${file}: error: ${message}\n`);
  const json = JSON.parse((await run(["render", file, "--out", dir, "--json"])).stdout);
  expect(json.errors).toEqual([{ element: image.id, message }]);
  expect(await readFile(join(dir, "f.svg"), "utf8")).toContain("<svg");
});

it("reports an image that embeds a whole file or a heading, and still writes the flow", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "f.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const flow = parseFlow(await readFile(file, "utf8"));
  const image = flowFrames(flow)[0].element;
  const copy = (id: string) => ({ ...image, id, fileId: id, customData: undefined, groupIds: [] });
  flow.elements.push(copy("picture"), copy("heading"));
  flow.embeds.set("picture", { path: "pic.png" });
  flow.embeds.set("heading", { path: "notes", heading: "Intro" });
  await writeFile(file, serializeFlow(flow));
  const result = await run(["render", file, "--out", dir]);
  expect(result.exitCode).toBe(1);
  const only = "but only screen blocks (#^id) can be rendered";
  expect(result.stderr).toBe(
    `${file}: error: an image embeds [[pic.png]], ${only}\n` +
      `${file}: error: an image embeds [[notes#Intro]], ${only}\n`,
  );
  expect(await readFile(join(dir, "f.svg"), "utf8")).toContain("<svg");
});

it("reports rejected drawing images and still writes the flow", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "flows", "f.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.files.remote = { dataURL: "https://attacker.invalid/x" };
  await writeFile(file, serializeFlow(flow));
  const args = ["render", file, "--out", dir];
  const result = await run(args);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`${file}: error: image file remote:`);
  expect(await readFile(join(dir, "f.svg"), "utf8")).toContain("<svg");
  const json = await run([...args, "--json"]);
  expect(json.exitCode).toBe(1);
  expect(JSON.parse(json.stdout).errors[0].message).toContain("image file remote:");
});

it("refuses unsupported flows before creating output, with render JSON errors", async () => {
  const dir = await fixture({ "screens.md": BASE });
  const file = join(dir, "f.excalidraw.md");
  await run(["flow", "new", file, "team", ...screensIn(dir)]);
  const flow = parseFlow(await readFile(file, "utf8"));
  flow.elements[0].customData = { wiredown: { v: "2" } };
  await writeFile(file, serializeFlow(flow));
  const out = join(dir, "refused.svg");
  const result = await run(["render", file, "--out", out, "--json"]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({
    file,
    flow: null,
    warnings: [],
    errors: [
      {
        message:
          'this drawing was written by a newer wiredown (data version "2"); upgrade wiredown to use it',
      },
    ],
  });
  expect((await run(["render", file, "--out", out])).stderr).toMatch(
    /upgrade wiredown to use it\n$/,
  );
  await expect(readFile(out)).rejects.toMatchObject({ code: "ENOENT" });
});

it("reports a file that is not a drawing as an error, writing nothing", async () => {
  const dir = await fixture({ "notes.excalidraw.md": "# Notes\n" });
  const file = join(dir, "notes.excalidraw.md");
  const message = 'not an Excalidraw drawing: no "## Drawing" json block';
  const result = await run(["render", file, "--out", dir, "--json"]);
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ flow: null, errors: [{ message }] });
  expect(await run(["render", file, "--out", dir])).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: `${file}: error: ${message}\n`,
  });
  await expect(readFile(join(dir, "notes.svg"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.skipIf(process.getuid?.() === 0)(
  "reports a frame's screens file that cannot be read, as lint does, writing nothing",
  async () => {
    const dir = await fixture({ "screens.md": BASE });
    const file = join(dir, "flows", "f.excalidraw.md");
    expect((await run(["flow", "new", file, "team", ...screensIn(dir)])).exitCode).toBe(0);
    const screens = join(dir, "screens.md");
    await chmod(screens, 0o000);
    try {
      const message = `cannot read the screens file ${screens}: permission denied`;
      expect(await run(["render", file, "--out", dir])).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: `${file}: error: ${message}\n`,
      });
      expect((await run(["flow", "lint", file])).stdout).toContain(`${file}: error: ${message}\n`);
      const json = JSON.parse((await run(["render", file, "--out", dir, "--json"])).stdout);
      expect(json).toEqual({ file, flow: null, errors: [{ message }], warnings: [] });
      await expect(readFile(join(dir, "f.svg"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await chmod(screens, 0o644);
    }
  },
);
