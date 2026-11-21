import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, run } from "../src/index";
import { BASE, fixture } from "./helpers";

describe("check", () => {
  it("passes a clean file with a summary", async () => {
    const dir = await fixture({ "screens.md": BASE });
    const file = join(dir, "screens.md");
    expect(await check([file])).toEqual({
      exitCode: 0,
      stdout: `${file}: 1 screen, 0 errors, 0 warnings\n`,
      stderr: "",
    });
  });

  it("fails on an error, printing path:line and the screen id", async () => {
    const dir = await fixture({ "screens.md": BASE.replace("button:", "buton:") });
    const file = join(dir, "screens.md");
    const result = await check([file]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(new RegExp(`^${file}:6: \\^team: error: .*buton`, "m"));
    expect(result.stdout).toContain(`${file}: 1 screen, 1 error, 0 warnings`);
  });

  it("passes with warnings only", async () => {
    const dir = await fixture({ "screens.md": "```wiredown\ntext: {warnng}\n```\n" });
    const file = join(dir, "screens.md");
    const result = await check([file]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${file}:2: warning: screen has no ^id`);
    expect(result.stdout).toContain(`${file}:2: warning: {warnng} is not an icon`);
    expect(result.stdout).toContain("1 screen, 0 errors, 2 warnings");
  });

  it("warns about a file with no wiredown blocks, without failing", async () => {
    const dir = await fixture({ "notes.md": "# Notes\n" });
    const file = join(dir, "notes.md");
    expect(await check([file])).toEqual({
      exitCode: 0,
      stdout: `${file}: warning: no wiredown blocks\n${file}: 0 screens, 0 errors, 1 warning\n`,
      stderr: "",
    });
    const parsed = JSON.parse((await check([file], { json: true })).stdout);
    expect(parsed.files[0].warnings).toEqual([{ message: "no wiredown blocks" }]);
  });

  it("prints one JSON document for several files", async () => {
    const dir = await fixture({ "a.md": BASE, "b.md": BASE.replace("button:", "buton:") });
    const [a, b] = [join(dir, "a.md"), join(dir, "b.md")];
    const result = await check([a, b], { json: true });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.files.map((f: { file: string }) => f.file)).toEqual([a, b]);
    expect(parsed.files[0]).toEqual({
      file: a,
      screens: [{ id: "team", heading: "Team members", line: 4 }],
      errors: [],
      warnings: [],
    });
    expect(parsed.files[1].errors).toEqual([
      { line: 6, message: expect.stringContaining("buton"), screen: "team" },
    ]);
  });

  it("exits 2 on a missing file, with nothing on stdout even in JSON mode", async () => {
    const dir = await fixture({ "a.md": BASE });
    const result = await run(["check", "--json", join(dir, "a.md"), join(dir, "missing.md")]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "cannot read " + join(dir, "missing.md") + ": it does not exist",
    );
  });
});

describe("run", () => {
  it("prints help and the version", async () => {
    expect((await run(["--help"])).stdout).toContain("render ");
    expect((await run(["check", "--help"])).stdout).toContain("usage: wiredown check");
    expect(await run(["--version"])).toEqual({ exitCode: 0, stdout: "0.0.0\n", stderr: "" });
  });

  it("prints a flow command's own help, and every flow command's usage for flow", async () => {
    const flow = (await run(["flow", "--help"])).stdout;
    const own = (await run(["flow", "add-screen", "--help"])).stdout;
    expect(flow).toMatch(/wiredown flow new .*\n.*wiredown flow add-screen /);
    expect(own).toMatch(/^usage: wiredown flow add-screen /);
    expect(own).toContain("--right-of <node>");
    expect(own).toContain("example:\n  wiredown flow add-screen ");
    expect(own).not.toContain("wiredown flow new");
  });

  it("exits 2 with usage on stderr for bad usage", async () => {
    for (const argv of [[], ["nope"], ["check"], ["check", "--bogus", "a.md"]]) {
      const result = await run(argv);
      expect(result).toMatchObject({ exitCode: 2, stdout: "" });
      expect(result.stderr).toContain("usage: wiredown");
    }
    expect((await run(["render", "a.md", "--theme", "blue"])).stderr).toContain("light or dark");
  });
});
