import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/index";
import { BASE, fixture, VARIANT } from "./helpers";

/** Pixel size and top-left pixel of an RGBA PNG (no filter changes the first pixel). */
async function png(path: string) {
  const bytes = await readFile(path);
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length; at += bytes.readUInt32BE(at) + 12)
    if (bytes.toString("latin1", at + 4, at + 8) === "IDAT")
      idat.push(bytes.subarray(at + 8, at + 8 + bytes.readUInt32BE(at)));
  return {
    signature: bytes.subarray(1, 4).toString("latin1"),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    corner: [...inflateSync(Buffer.concat(idat)).subarray(1, 5)],
  };
}

let dir: string;
let screens: string;
let flow: string;

describe("render --format png", { timeout: 30000 }, () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "wiredown-png-"));
    screens = join(dir, "screens.md");
    await writeFile(screens, `${BASE}\n\n${VARIANT}\n`);
    flow = join(dir, "flows", "f.excalidraw.md");
    expect((await run(["flow", "new", flow, "team", "team-after"])).exitCode).toBe(0);
  }, 30000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("writes each screen as <id>.png at twice its size on the theme's canvas", async () => {
    const out = join(dir, "screens");
    const result = await run(["render", screens, "--format", "png", "--out", out, "--json"]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ format: "png", errors: [], warnings: [] });
    expect((await readdir(out)).sort()).toEqual(["team-after.png", "team.png"]);
    for (const screen of parsed.screens) {
      expect(Object.keys(screen)).toEqual([
        "id",
        "png",
        "width",
        "height",
        "pixelWidth",
        "pixelHeight",
        "boxes",
      ]);
      expect(screen.png).toBe(join(out, `${screen.id}.png`));
      expect(screen).toMatchObject({
        pixelWidth: screen.width * 2,
        pixelHeight: screen.height * 2,
      });
      expect(await png(screen.png)).toEqual({
        signature: "PNG",
        width: screen.pixelWidth,
        height: screen.pixelHeight,
        corner: [255, 255, 255, 255],
      });
    }
  });

  it("takes --scale, --transparent and the dark canvas, printing both sizes", async () => {
    const out = join(dir, "options");
    const args = ["render", screens, "--screen", "team", "--format", "png", "--out", out];
    const one = await run([...args, "--scale", "1", "--transparent"]);
    const { width, height, corner } = await png(join(out, "team.png"));
    expect(one).toEqual({
      exitCode: 0,
      stdout: `${join(out, "team.png")}  ${width}x${height}  (${width}x${height} px)\n`,
      stderr: "",
    });
    expect(corner[3]).toBe(0);
    expect((await run([...args, "--scale", "3", "--theme", "dark"])).exitCode).toBe(0);
    expect(await png(join(out, "team.png"))).toMatchObject({
      width: width * 3,
      height: height * 3,
      corner: [0x12, 0x12, 0x12, 255],
    });
  });

  it("renders a flow to <name>.png", async () => {
    const out = join(dir, "flow");
    const result = await run(["render", flow, "--format", "png", "--out", out, "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ format: "png", errors: [], warnings: [] });
    expect(parsed.flow).toEqual({
      png: join(out, "f.png"),
      width: expect.any(Number),
      height: expect.any(Number),
      pixelWidth: Math.round(parsed.flow.width * 2),
      pixelHeight: Math.round(parsed.flow.height * 2),
    });
    expect(await png(parsed.flow.png)).toMatchObject({
      width: parsed.flow.pixelWidth,
      height: parsed.flow.pixelHeight,
    });
  });

  it("rejects bad formats, scales and option mixes as usage errors", async () => {
    const bad = [
      ["--format", "jpeg"],
      ["--format", "svg,png"],
      ["--format", "png", "--scale", "0"],
      ["--format", "png", "--scale", "5"],
      ["--format", "png", "--scale", "1.5"],
      ["--format", "png", "--scale", "big"],
      ["--format", "png", "--no-fonts"],
      ["--scale", "2"],
      ["--transparent"],
    ];
    for (const args of bad) {
      const result = await run(["render", screens, "--out", join(dir, "bad"), ...args]);
      expect(result, args.join(" ")).toMatchObject({ exitCode: 2, stdout: "" });
    }
    await expect(readdir(join(dir, "bad"))).rejects.toThrow();
  });
});

describe("render --format png failures", { timeout: 30000 }, () => {
  it("reports a rasteriser error as a finding and exits 1", async () => {
    vi.resetModules();
    vi.doMock("@wiredown/excalidraw/node", async (original) => ({
      ...(await original<object>()),
      svgToPng: () => Promise.reject(new Error("bad SVG")),
    }));
    const { run: mocked } = await import("../src/index");
    const work = await fixture({ "screens.md": BASE });
    const out = join(work, "out");
    const result = await mocked([
      "render",
      join(work, "screens.md"),
      "--format",
      "png",
      "--out",
      out,
      "--json",
    ]);
    vi.doUnmock("@wiredown/excalidraw/node");
    expect(result).toMatchObject({ exitCode: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      screens: [],
      errors: [{ screen: "team", message: `can't render ${join(out, "team.png")}: bad SVG` }],
    });
    await expect(readdir(out)).rejects.toThrow();
  });
});
