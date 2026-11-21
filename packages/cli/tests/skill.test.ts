import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@wiredown/cli";
import { checkScreens, parseScreens } from "@wiredown/core";
import { expect, it } from "vitest";
// @ts-expect-error Plain ESM generator shared with the root script.
import { skillSyntax } from "../../../scripts/skill.mjs";

const read = (name: string) =>
  readFileSync(new URL(`../../../skills/wiredown/${name}`, import.meta.url), "utf8");
const skill = read("SKILL.md");
const examples = read("reference/examples.md");
const shellLines = (text: string) =>
  [...text.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap((match) =>
    match[1]
      .trim()
      .split("\n")
      .map((line) => line.trim()),
  );
// These examples use single quotes for shell arguments and no shell expansion.
const argv = (line: string) =>
  [...line.matchAll(/'([^']*)'|([^\s']+)/g)].map((match) => match[1] ?? match[2]).slice(1);

it("keeps the generated catalog reference current (run pnpm build then pnpm skill)", () => {
  expect(read("reference/syntax.md"), "run `pnpm build` then `pnpm skill`").toBe(skillSyntax());
});
it("declares the skill and excludes obsolete syntax and tooling", () => {
  expect(skill).toMatch(/^---\nname: wiredown\ndescription: .+\n---/);
  expect(skill + examples + read("reference/syntax.md")).not.toMatch(
    /\(hi\)|\(mark=|sketchdown|wireframe-x/i,
  );
});
it.each(["examples", "skill", "syntax"])("checks every %s block without warnings", (name) => {
  // The skill's variant intentionally uses the base from the reference.
  const base = parseScreens(examples)[0];
  const text =
    name === "examples"
      ? examples
      : name === "syntax"
        ? read("reference/syntax.md")
        : `\`\`\`wiredown\n${base.source}\n\`\`\`\n^${base.id}\n\n${skill}`;
  const result = checkScreens(text);
  expect(result.errors).toEqual([]);
  expect(result.warnings).toEqual([]);
});
it("uses existing commands and options in shell examples", async () => {
  const help = await run(["--help"]);
  for (const line of [...shellLines(skill), ...shellLines(examples)]) {
    expect(line).toMatch(/^wiredown /);
    const args = argv(line);
    expect(help.stdout).toMatch(new RegExp(`^  ${args[0]} +`, "m"));
    const commandHelp = await run([args[0], "--help"]);
    expect(commandHelp.exitCode).toBe(0);
    if (args[0] === "flow") expect(commandHelp.stdout).toContain(`wiredown flow ${args[1]} `);
    for (const option of args.filter((arg) => arg.startsWith("--"))) {
      expect(commandHelp.stdout).toMatch(new RegExp(`${option}(?=[\\s\\]])`));
    }
  }
});
it("executes the documented flow sequence and checks trimmed JSON results", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wiredown-skill-"));
  try {
    writeFileSync(join(directory, "screens.md"), examples);
    const pairs = [...examples.matchAll(/```sh\n([^`]+)```\s*```json\n([^`]+)```/g)];
    expect(pairs.length).toBeGreaterThan(0);
    const commands = shellLines(skill).filter((line) => line.startsWith("wiredown flow "));
    expect(commands).toEqual(pairs.map((pair) => pair[1].trim()));
    for (const [index, command] of commands.entries()) {
      const args = argv(command).map((arg) =>
        arg.startsWith("flows/") || arg === "screens.md" ? join(directory, arg) : arg,
      );
      const result = await run(args);
      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject(JSON.parse(pairs[index][2]));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
