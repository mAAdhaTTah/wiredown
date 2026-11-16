import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { ParseArgsOptionsConfig } from "node:util";
import { check } from "./check.js";
import { render } from "./render.js";
import { UsageError } from "./output.js";
import type { Result } from "./output.js";

export { check, render, UsageError };
export type { CheckOptions, CheckedFile } from "./check.js";
export type { RenderOptions, RenderedScreen } from "./render.js";
export type { Finding, Result } from "./output.js";

type Values = Record<string, string | boolean | string[] | undefined>;

interface Command {
  summary: string;
  help: string;
  options: ParseArgsOptionsConfig;
  run(values: Values, positionals: string[]): Promise<Result>;
}

// Each command parses its own options; add new commands (flow, lint) here.
const COMMANDS: Record<string, Command> = {
  check: {
    summary: "check screens files for errors and warnings",
    help: `usage: wiredown check <file.md>... [--json]

Checks every wiredown block in each file. Prints one line per finding and a
summary per file. Exits 1 if any file has errors; warnings don't fail.

options:
  --json      print one JSON document instead
  -h, --help  show this help
`,
    options: { json: { type: "boolean" } },
    run(values, files) {
      if (!files.length) throw new UsageError("check needs at least one file");
      return check(files, { json: values.json === true });
    },
  },
  render: {
    summary: "render screens to SVG",
    help: `usage: wiredown render <file.md> [--screen <id>]... [--out <dir>]
                       [--theme light|dark] [--no-fonts] [--json]

Renders every screen with an ^id (or only the given ids) to <dir>/<id>.svg.
Screens with errors are skipped and reported; the rest still render, and
the exit code is 1.

options:
  --screen <id>   render only this screen; repeatable
  --out <dir>     output directory, created if missing (default: .)
  --theme <name>  light or dark (default: light)
  --no-fonts      don't embed Excalifont in the SVG
  --json          print one JSON document instead
  -h, --help      show this help
`,
    options: {
      screen: { type: "string", multiple: true },
      out: { type: "string" },
      theme: { type: "string" },
      "no-fonts": { type: "boolean" },
      json: { type: "boolean" },
    },
    run(values, positionals) {
      if (positionals.length !== 1) throw new UsageError("render takes one file");
      const theme = values.theme ?? "light";
      if (theme !== "light" && theme !== "dark") {
        throw new UsageError(`--theme is light or dark, not "${theme}"`);
      }
      return render(positionals[0], {
        screens: values.screen as string[] | undefined,
        out: values.out as string | undefined,
        theme,
        fonts: values["no-fonts"] !== true,
        json: values.json === true,
      });
    },
  },
};

const USAGE = `usage: wiredown <command> [options]

commands:
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(8)} ${c.summary}`)
  .join("\n")}

options:
  -h, --help     show this help
  -v, --version  print the version

Run "wiredown <command> --help" for a command's options.
`;

function version(): string {
  const pkg = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

const ok = (stdout: string): Result => ({ exitCode: 0, stdout, stderr: "" });
const usage = (message: string, help: string): Result => ({
  exitCode: 2,
  stdout: "",
  stderr: `wiredown: ${message}\n\n${help}`,
});

/** Run the CLI on `argv` (without node and script); never writes or exits itself. */
export async function run(argv: string[]): Promise<Result> {
  const [name, ...rest] = argv;
  if (name === "-h" || name === "--help") return ok(USAGE);
  if (name === "-v" || name === "--version") return ok(version() + "\n");
  if (name === undefined) return usage("no command given", USAGE);
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) return usage(`unknown command "${name}"`, USAGE);
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...command.options, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
    if (values.help) return ok(command.help);
    return await command.run(values, positionals);
  } catch (error) {
    if (error instanceof UsageError) return usage(error.message, command.help);
    if ((error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      return usage((error as Error).message, command.help);
    }
    return { exitCode: 2, stdout: "", stderr: `wiredown: ${String(error)}\n` };
  }
}
