import { CATALOG, COMMON_FLAGS, ICON_NAMES } from "../packages/core/dist/index.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function skillSyntax() {
  const sections = CATALOG.map((entry) => {
    const options = [
      ...entry.flags.map((flag) => `\`${flag}\``),
      ...entry.numbers.map((number) => `\`${number}=number\``),
    ];
    return `## ${entry.keywords[0]}

Keywords: ${entry.keywords.map((word) => `\`${word}\``).join(", ")}.

${entry.description}

Content: ${entry.content ? "yes" : "no"}. Container: ${entry.container ? "yes" : "no"}.
Options: ${options.join(", ") || "none"}.${entry.directive ? " No common flags or id." : " Also takes the common flags and an id."}

\`\`\`text
${entry.example}
\`\`\`
`;
  });
  return `<!-- Generated from core's catalog by pnpm skill. Do not edit. -->

# Syntax

Write one component per line: keyword: content #id (options).
Indent children by two spaces. Continuation lines hold grid rows or more
content; a blank line ends continuation. Options go last, comma-separated.
Common flags: ${COMMON_FLAGS.map((flag) => `\`${flag}\``).join(", ")}.
Use #name for ids (lowercase letter, then lowercase letters, digits or hyphens).
The alternative (id=name) also works. Directives take neither ids nor options.
Grids fill their container by default; (fit) opts out.
A leading * means primary or selected; | separates items or grid cells.
Inline {icon}, [link] and -grey text- work in supported labels.

${sections.join("\n")}
## Icons

${ICON_NAMES.map((name) => `\`${name}\``).join(", ")}.

## Escapes

Write \\( to keep a trailing option-like parenthesis literal, and \\# to
keep a trailing id-like token literal. Other parentheses remain text unless
recognized as options; C# and Step #3 remain text.

## Variants

Start with extends: screen-id. Use replace: id with exactly one indented
component (it inherits the id), remove: id (comma-separated ids allowed),
after: id or before: id with indented additions, and rows: grid-id with
indented rows. In rows, = keeps a cell and remove <row-key> removes a row.
The first non-checkbox cell is the row key. Directive examples above use a
base screen with a component or grid named #target.
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = new URL("../skills/wiredown/reference/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL("syntax.md", directory), skillSyntax());
}
