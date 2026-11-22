import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { ParseArgsOptionsConfig } from "node:util";
import { check } from "./check";
import { flowCommand } from "./flow";
import { lint } from "./lint";
import { UsageError } from "./output";
import type { Result } from "./output";
import { render } from "./render";
import { skill } from "./skill";

export { check, lint, render, skill, UsageError };
export type { CheckOptions, CheckedFile } from "./check";
export type { LintedFlow } from "./flow";
export type { LintOptions } from "./lint";
export type { Output, RenderOptions, RenderedScreen } from "./render";
export type { SkillOptions } from "./skill";
export type { Finding, Result } from "./output";

type Values = Record<string, string | boolean | string[] | undefined>;

interface Command {
  summary: string;
  help: string;
  /** Each subcommand's own help, by name. */
  subcommands?: Map<string, string>;
  options: ParseArgsOptionsConfig;
  run(values: Values, positionals: string[]): Promise<Result>;
}

/** Each flow command's usage, then what it does, its options and an example. */
const FLOW: [string, string][] = [
  [
    "new <flow.excalidraw.md> [<screen-id>... --screens <screens.md>] [--json]",
    `Creates a drawing, empty or with a row of frames, one per screen, each
connected to the next (F1 -> F2 -> F3).

options:
  --screens <file>   the screens file to embed from; required with screen ids
  --json             print one JSON document instead

example:
  wiredown flow new flows/invite.excalidraw.md team-members team-members-after --screens screens.md`,
  ],
  [
    "add-screen <flow.excalidraw.md> <screen-id> --screens <screens.md> [--right-of F2 | --below F2] [--title <text>] [--json]",
    `Adds a frame for the screen, right of the rightmost node unless placed.

options:
  --right-of <node>  place it right of this node
  --below <node>     place it below this node
  --title <text>     the frame's title (default: the screen's heading, then
                     its id)
  --screens <file>   the screens file to embed from (required)
  --json             print one JSON document instead

example:
  wiredown flow add-screen flows/invite.excalidraw.md team-members-after --screens screens.md --below F1`,
  ],
  [
    "decision <flow.excalidraw.md> <text> [--right-of F2 | --below F2] [--json]",
    `Adds a decision diamond, right of the rightmost node unless placed.

options:
  --right-of <node>  place it right of this node
  --below <node>     place it below this node
  --json             print one JSON document instead

example:
  wiredown flow decision flows/invite.excalidraw.md 'Seats left?' --right-of F1`,
  ],
  [
    "connect <flow.excalidraw.md> <from> <to> [<label>] [--json]",
    `Adds a straight arrow between the facing edges of two nodes, with an
optional label.

options:
  --json             print one JSON document instead

example:
  wiredown flow connect flows/invite.excalidraw.md D1 F2 'Yes'`,
  ],
  [
    "highlight <flow.excalidraw.md> <frame> <#id> [--json]",
    `Outlines a component of the frame's screen in the focus colour.

options:
  --json             print one JSON document instead

example:
  wiredown flow highlight flows/invite.excalidraw.md F1 '#invite'`,
  ],
  [
    "mark <flow.excalidraw.md> <frame> <#id> <label> [--json]",
    `Places a numbered badge just outside a component's top-left corner.

options:
  --json             print one JSON document instead

example:
  wiredown flow mark flows/invite.excalidraw.md F1 '#members' 3`,
  ],
  [
    "note <flow.excalidraw.md> <node> <text> [--json]",
    `Adds a text note under the node, below its earlier notes.

options:
  --json             print one JSON document instead

example:
  wiredown flow note flows/invite.excalidraw.md F2 'Maja accepts the invitation.'`,
  ],
  [
    "refresh <flow.excalidraw.md> [--json]",
    `Brings the drawing up to date after its screens change: embed sizes,
overlays, notes and our straight arrows. Writes only if something changed.

options:
  --json             print one JSON document instead

example:
  wiredown flow refresh flows/invite.excalidraw.md`,
  ],
  [
    "lint <flow.excalidraw.md>... [--json]",
    `Reports what refresh would fix, and what a person must: missing screens,
stale sizes and overlays, dangling arrows. Never writes; exits 1 on any
finding.

options:
  --json             print one JSON document instead

example:
  wiredown flow lint flows/*.excalidraw.md`,
  ],
];

// Each command parses its own options.
const COMMANDS: Record<string, Command> = {
  flow: {
    summary: "create and edit flow drawings",
    help: `${FLOW.map(([usage], i) => `${i ? "      " : "usage:"} wiredown flow ${usage}`).join("\n")}

Nodes are frames (F1, F2, ...) and decisions (D1, D2, ...). new connects
its screens in a row; placement is relative to a node, never coordinates.
refresh updates embed sizes and overlays after screens change; lint reports
missing screens, stale sizes and overlays, and dangling arrows.
--screens picks the screens file new and add-screen embed from; every other
command follows each frame's embed to its screens file.

Run "wiredown flow <command> --help" for its options and an example.
`,
    subcommands: new Map(
      FLOW.map(([usage, help]) => [
        usage.split(" ")[0],
        `usage: wiredown flow ${usage}\n\n${help}\n`,
      ]),
    ),
    options: {
      screens: { type: "string" },
      "right-of": { type: "string" },
      below: { type: "string" },
      title: { type: "string" },
      json: { type: "boolean" },
    },
    run: flowCommand,
  },
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
  lint: {
    summary: "check screens and lint flows, for CI",
    help: `usage: wiredown lint [<path>...] [--exclude <glob>]... [--json]

Walks each path (default: .), skipping node_modules and dot-directories.
Runs check on every other Markdown file (one with no wiredown block gets
check's warning) and flow lint on every *.excalidraw.md, in one report. Exits 1 on any screen error or flow
finding; warnings don't fail.

options:
  --exclude <glob>  skip files and folders whose path from the working
                    directory matches, such as 'docs/**/prd.md'; repeatable
  --json            print one JSON document instead
  -h, --help        show this help
`,
    options: { exclude: { type: "string", multiple: true }, json: { type: "boolean" } },
    run(values, paths) {
      return lint(paths, {
        json: values.json === true,
        exclude: values.exclude as string[] | undefined,
      });
    },
  },
  render: {
    summary: "render screens or a flow to SVG or PNG",
    help: `usage: wiredown render <file.md> [--screen <id>]... [--out <dir>]
                       [--format svg|png] [--scale <n>] [--transparent]
                       [--theme light|dark] [--no-fonts] [--json]

Renders every screen with an ^id (or only the given ids) to <dir>/<id>.svg
(or .png). Screens with errors are skipped and reported; the rest still
render, and the exit code is 1.

A *.excalidraw.md file renders the whole flow to <dir>/<name>.svg (or .png);
each frame's screen comes from the screens file its embed names. --screen is
only for screens files.

options:
  --screen <id>   render only this screen; repeatable
  --out <dir>     output directory, created if missing (default: .)
  --format <f>    svg or png (default: svg)
  --scale <n>     PNG pixels per SVG pixel, 1 to 4 (default: 2)
  --transparent   keep the PNG background transparent (default: the
                  theme's canvas colour)
  --theme <name>  light or dark (default: light)
  --no-fonts      don't embed Excalifont in the SVG (SVG only)
  --json          print one JSON document instead
  -h, --help      show this help
`,
    options: {
      screen: { type: "string", multiple: true },
      out: { type: "string" },
      theme: { type: "string" },
      format: { type: "string" },
      scale: { type: "string" },
      transparent: { type: "boolean" },
      "no-fonts": { type: "boolean" },
      json: { type: "boolean" },
    },
    run(values, positionals) {
      if (positionals.length !== 1) throw new UsageError("render takes one file");
      const theme = values.theme ?? "light";
      if (theme !== "light" && theme !== "dark") {
        throw new UsageError(`--theme is light or dark, not "${theme}"`);
      }
      const format = values.format ?? "svg";
      if (format !== "svg" && format !== "png") {
        throw new UsageError(`--format is svg or png, not "${format}"`);
      }
      if (format === "svg" && (values.scale !== undefined || values.transparent)) {
        throw new UsageError("--scale and --transparent need --format png");
      }
      if (format === "png" && values["no-fonts"]) {
        throw new UsageError("--no-fonts is for SVG; PNGs always draw Excalifont");
      }
      const scale = Number(values.scale ?? 2);
      if (!Number.isInteger(scale) || scale < 1 || scale > 4) {
        throw new UsageError(`--scale is a whole number from 1 to 4, not "${values.scale}"`);
      }
      return render(positionals[0], {
        screens: values.screen as string[] | undefined,
        out: values.out as string | undefined,
        theme,
        format,
        scale,
        transparent: values.transparent === true,
        fonts: values["no-fonts"] !== true,
        json: values.json === true,
      });
    },
  },
  skill: {
    summary: "install the agent skill in a project",
    help: `usage: wiredown skill [<dir>] [--json]

Copies the agent skill that ships with this wiredown to
<dir>/.agents/skills/wiredown (default dir: .), replacing an earlier copy.
Links it from <dir>/.claude/skills and from every other dot-folder of <dir>
that has a skills folder, such as .windsurf/skills. Run it again after
upgrading wiredown.

options:
  --json      print one JSON document instead
  -h, --help  show this help
`,
    options: { json: { type: "boolean" } },
    run(values, positionals) {
      if (positionals.length > 1) throw new UsageError("skill takes at most one folder");
      return skill(positionals[0] ?? ".", { json: values.json === true });
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
  // a subcommand's help is its own: wiredown flow add-screen --help
  let help = command.subcommands?.get(rest[0] ?? "") ?? command.help;
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...command.options, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    });
    help = command.subcommands?.get(positionals[0] ?? "") ?? command.help;
    if (values.help) return ok(help);
    return await command.run(values, positionals);
  } catch (error) {
    if (error instanceof UsageError) return usage(error.message, help);
    if ((error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      return usage((error as Error).message, help);
    }
    throw error;
  }
}
