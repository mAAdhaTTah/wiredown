import { chmod, lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { run } from "../src/index";
import { fixture } from "./helpers";

// Installs the skill the build copies into dist/, so it needs `pnpm build` first.
const skillFile = new URL("../../../skills/wiredown/SKILL.md", import.meta.url);

test("skill installs the bundled skill and links it from agent folders", async () => {
  const dir = await fixture({});
  for (const folder of [".claude", ".windsurf/skills", ".git/hooks"])
    await mkdir(join(dir, folder), { recursive: true });
  const installed = join(dir, ".agents/skills/wiredown");
  const links = [join(dir, ".claude/skills/wiredown"), join(dir, ".windsurf/skills/wiredown")];
  const result = await run(["skill", dir, "--json"]);
  expect(result).toEqual({
    exitCode: 0,
    stdout: JSON.stringify({ skill: installed, links }, null, 2) + "\n",
    stderr: "",
  });
  const skill = await readFile(skillFile, "utf8");
  expect(await readFile(join(installed, "SKILL.md"), "utf8")).toBe(skill);
  for (const link of links) {
    expect(await readlink(link)).toBe("../../.agents/skills/wiredown");
    expect(await readFile(join(link, "SKILL.md"), "utf8")).toBe(skill);
  }
  await expect(lstat(join(dir, ".git/skills"))).rejects.toThrow();

  // Again: replaces the copy and the links.
  await writeFile(join(installed, "stale.md"), "old\n");
  expect((await run(["skill", dir])).stdout).toBe(
    `${installed}\n${links.map((link) => `${link} -> ${installed}`).join("\n")}\n`,
  );
  await expect(lstat(join(installed, "stale.md"))).rejects.toThrow();
});

test("skill reports a folder it cannot use", async () => {
  const missing = await run(["skill", join(await fixture({}), "nope")]);
  expect(missing).toMatchObject({ exitCode: 2, stdout: "" });
  expect(missing.stderr).toContain("cannot read");
  expect((await run(["skill", "a", "b"])).stderr).toContain("skill takes at most one folder");
});

test.skipIf(process.getuid?.() === 0)("skill exits 1 when it cannot write", async () => {
  const dir = await fixture({});
  await chmod(dir, 0o555);
  try {
    const result = await run(["skill", dir, "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      skill: null,
      links: [],
      errors: [
        { message: `cannot write ${join(dir, ".agents/skills/wiredown")}: permission denied` },
      ],
    });
  } finally {
    await chmod(dir, 0o755);
  }
});
