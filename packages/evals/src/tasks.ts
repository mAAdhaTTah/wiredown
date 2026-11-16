import { parseScreens } from "@wiredown/core";
import type { Arm, Report } from "./arms.ts";
import { REPLY_FORMAT } from "./extract.ts";
import type { Material } from "./material.ts";

export type TaskId = "screens" | "variant" | "review";

export interface Task {
  id: TaskId;
  number: 1 | 2 | 3;
  title: string;
  /** The file the task starts from, in the arm's syntax; none for task 1. */
  input(material: Material, arm: Arm): string | null;
  prompt(material: Material, arm: Arm): string;
  /** The screens file to check: the reply's file, or the input with the reply appended. */
  assemble(input: string | null, output: string): string;
  /** Whether the output does what was asked, beyond a clean check. */
  complete(material: Material, input: string | null, output: string, report: Report): Completion;
  /** Said with check findings, so the model can place line numbers. */
  lineNote?(input: string | null): string;
}

export interface Completion {
  complete: boolean;
  reason?: string;
}

const fence = (body: string) => ["````markdown", body.trimEnd(), "````"].join("\n");

function preamble(arm: Arm): string {
  return [
    "You write low-fidelity wireframe screens for product specs in the wiredown screen syntax.",
    "The complete syntax reference follows; use only what it describes.",
    "",
    "<syntax-reference>",
    arm.reference.trimEnd(),
    "</syntax-reference>",
    "",
    "## The screens file",
    "",
    "A screens file (screens.md) is Markdown. Each screen is a `##` heading, then a fenced code",
    "block whose info string is `wiredown`, then, after exactly one blank line, the screen's block",
    "id on its own line as `^screen-id`. A variant screen refers to another screen by that id.",
    "Prose notes about a screen go after its id line. For example:",
    "",
    fence(["## Greeting", "", "```wiredown", "text: Hello", "```", "", "^greeting"].join("\n")),
  ].join("\n");
}

const prompt = (arm: Arm, ...task: string[]) =>
  [preamble(arm), "", "## Task", "", ...task, "", "## Reply format", "", REPLY_FORMAT].join("\n");

const join = (input: string, output: string) => input.trimEnd() + "\n\n" + output;

/** Block ids in a file, or none when its fences are broken. */
function ids(markdown: string): (string | undefined)[] {
  try {
    return parseScreens(markdown).map((s) => s.id);
  } catch {
    return [];
  }
}

export const TASKS: Task[] = [
  {
    id: "screens",
    number: 1,
    title: "screens from prose",
    input: () => null,
    prompt: (m, arm) =>
      prompt(
        arm,
        "Here is the PRD:",
        "",
        "<prd>",
        m.prd.trimEnd(),
        "</prd>",
        "",
        "Write screens.md for this PRD with these screens, in this order, using exactly these block ids:",
        "",
        ...m.screens.map((s) => `- ^${s.id}: ${s.title}`),
        "",
        "Show the content the PRD describes. Where a screen is a state of another screen, you may",
        "write it as a variant of that screen.",
      ),
    assemble: (_input, output) => output,
    complete: (m, _input, _output, report) => {
      const missing = m.screens.map((s) => s.id).filter((id) => !report.ids.includes(id));
      return missing.length
        ? {
            complete: false,
            reason: `missing screens: ${missing.map((id) => `^${id}`).join(", ")}`,
          }
        : { complete: true };
    },
  },
  {
    id: "variant",
    number: 2,
    title: "variant from a one-line change",
    input: (m, arm) => m.inputs[arm.name].variantBase,
    prompt: (m, arm) =>
      prompt(
        arm,
        "Here is screens.md:",
        "",
        fence(m.inputs[arm.name].variantBase),
        "",
        `Add a variant of ^${m.variant.base} with the block id ^${m.variant.id}. The change: ` +
          m.variant.change,
        "",
        "Reply with only the new screen (its heading, its wiredown block and its id line); it will",
        "be appended to the end of screens.md.",
      ),
    assemble: (input, output) => join(input ?? "", output),
    complete: (m, input, output) => {
      const file = join(input ?? "", output);
      let screens;
      try {
        screens = parseScreens(file);
      } catch {
        return { complete: false, reason: "the file's fences are broken" };
      }
      const screen = screens.find((s) => s.id === m.variant.id);
      if (!screen) return { complete: false, reason: `no screen ^${m.variant.id}` };
      const first = screen.source.split("\n").find((l) => l.trim() && !l.trim().startsWith("//"));
      return new RegExp(`^\\s*extends\\s*:\\s*\\^?${m.variant.base}\\s*$`).test(first ?? "")
        ? { complete: true }
        : { complete: false, reason: `^${m.variant.id} does not extend ^${m.variant.base}` };
    },
    lineNote: (input) =>
      `Line numbers count lines of screens.md with your screen appended from line ` +
      `${(input ?? "").trimEnd().split("\n").length + 2}.`,
  },
  {
    id: "review",
    number: 3,
    title: "reviewer comment",
    input: (m, arm) => m.inputs[arm.name].review,
    prompt: (m, arm) =>
      prompt(
        arm,
        "Here is screens.md:",
        "",
        fence(m.inputs[arm.name].review),
        "",
        `A reviewer left this comment on ^${m.review.screen}: "${m.review.comment}".`,
        "Revise screens.md to address it. Reply with the complete revised file.",
      ),
    assemble: (_input, output) => output,
    complete: (_m, input, output) => {
      const before = ids(input ?? "");
      const after = ids(output);
      const lost = before.filter((id) => id !== undefined && !after.includes(id));
      if (lost.length) return { complete: false, reason: `lost screens: ^${lost.join(", ^")}` };
      if (output.trim() === (input ?? "").trim()) {
        return { complete: false, reason: "the file is unchanged" };
      }
      return { complete: true };
    },
  },
];
