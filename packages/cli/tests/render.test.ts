import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, run } from "../src/index.js";
import { BASE, VARIANT, fixture } from "./helpers.js";

const sizeOf = (svg: string) => ({
  width: Number(/<svg[^>]* width="(\d+)"/.exec(svg)?.[1]),
  height: Number(/<svg[^>]* height="(\d+)"/.exec(svg)?.[1]),
});

describe("render", { timeout: 30000 }, () => {
  it("writes each screen as <id>.svg at the reported size, with JSON", async () => {
    const dir = await fixture({ "screens.md": `${BASE}\n\n${VARIANT}\n` });
    const out = join(dir, "out", "nested");
    const result = await render(join(dir, "screens.md"), { out, json: true });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ file: join(dir, "screens.md"), errors: [], warnings: [] });
    expect(parsed.screens.map((s: { id: string }) => s.id)).toEqual(["team", "team-after"]);
    for (const screen of parsed.screens) {
      expect(screen.svg).toBe(join(out, `${screen.id}.svg`));
      const svg = await readFile(screen.svg, "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
      expect(sizeOf(svg)).toEqual({ width: screen.width, height: screen.height });
      expect(Object.keys(screen.boxes)).toEqual(["seats", "invite"]);
    }
    // the variant renders resolved: the base's window with the replaced text
    const variant = await readFile(join(out, "team-after.svg"), "utf8");
    expect(variant).toContain("Team settings");
    expect(variant).toContain("2 of 5 seats used");
    expect(variant).not.toContain("3 of 5 seats used");
  });

  it("prints path  WxH per file", async () => {
    const dir = await fixture({ "screens.md": BASE });
    const result = await render(join(dir, "screens.md"), { out: dir });
    const svg = await readFile(join(dir, "team.svg"), "utf8");
    const { width, height } = sizeOf(svg);
    expect(result).toEqual({
      exitCode: 0,
      stdout: `${join(dir, "team.svg")}  ${width}x${height}\n`,
      stderr: "",
    });
  });

  it("renders only the --screen ids", async () => {
    const dir = await fixture({ "screens.md": `${BASE}\n\n${VARIANT}\n` });
    const out = join(dir, "out");
    const argv = ["render", join(dir, "screens.md"), "--screen", "team-after", "--out", out];
    expect((await run(argv)).exitCode).toBe(0);
    expect(await readdir(out)).toEqual(["team-after.svg"]);
  });

  it("reports an unknown --screen id with a suggestion and the ids there are", async () => {
    const dir = await fixture({ "screens.md": `${BASE}\n\n${VARIANT}\n` });
    const file = join(dir, "screens.md");
    const result = await render(file, { screens: ["tem", "team"], out: dir, json: true });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.screens.map((s: { id: string }) => s.id)).toEqual(["team"]);
    expect(parsed.errors).toEqual([
      {
        message: `no screen "^tem" (it has ^team, ^team-after); did you mean "^team"?`,
        screen: "tem",
      },
    ]);
  });

  it("skips a screen with errors, renders the rest and exits 1", async () => {
    const broken = VARIANT.replace("replace: seats", "replace: nothing");
    const dir = await fixture({ "screens.md": `${BASE}\n\n${broken}\n` });
    const file = join(dir, "screens.md");
    const result = await render(file, { out: dir });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`${join(dir, "team.svg")}  ${result.stdout.split("  ")[1]}`);
    expect(result.stderr).toMatch(new RegExp(`^${file}:\\d+: \\^team-after: error: `));
    expect(await readdir(dir)).toEqual(["screens.md", "team.svg"]);
  });

  it("skips screens without an id, with a warning", async () => {
    const dir = await fixture({ "screens.md": `${BASE}\n\n\`\`\`wiredown\ntext: Hi\n\`\`\`\n` });
    const result = await render(join(dir, "screens.md"), { out: dir, json: true });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.screens).toHaveLength(1);
    expect(parsed.warnings).toEqual([
      { line: 11, message: "screen has no ^id; it can't be embedded in a flow" },
    ]);
  });

  it("exits 2 on a missing file, with nothing on stdout", async () => {
    const result = await run(["render", "/nonexistent/screens.md", "--json"]);
    expect(result).toMatchObject({ exitCode: 2, stdout: "" });
    expect(result.stderr).toContain("cannot read /nonexistent/screens.md");
  });
});
