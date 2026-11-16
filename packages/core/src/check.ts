import { ICON_NAMES, isIcon } from "./icons.js";
import { fontMeasurer } from "./metrics.js";
import { EXCALIFONT } from "./metrics-excalifont.js";
import { distance } from "./parse.js";
import type { ParseError, ParseResult } from "./types.js";
import { resolve } from "./variants.js";
import type { ResolveOptions } from "./variants.js";

export interface CheckResult extends ParseResult {
  /** Things that draw, but probably not as meant. */
  warnings: ParseError[];
}

const excalifont = fontMeasurer(EXCALIFONT);

/** Warnings for one source line. */
function lineWarnings(text: string): string[] {
  const out: string[] = [];
  // "{warnin}" is drawn as text; only a near miss of an icon name is likely a typo
  for (const [token, name] of text.matchAll(/\{([a-zA-Z-]+)\}/g)) {
    if (isIcon(name)) continue;
    const icon = ICON_NAMES.find((n) => distance(name.toLowerCase(), n) === 1);
    if (icon) out.push(`${token} is not an icon, so it is drawn as text; did you mean {${icon}}?`);
  }
  const chars = excalifont.unmeasured(text);
  if (chars.length) {
    const list = chars.map((c) => `"${c}"`).join(", ");
    const [is, it] = chars.length > 1 ? ["are", "them"] : ["is", "it"];
    out.push(
      `${list} ${is} not in Excalifont, so a fallback font draws ${it} at an estimated width`,
    );
  }
  return out;
}

/**
 * Resolves a block as resolve() does, and also warns about what draws but
 * is probably a mistake: a misspelt {icon}, and characters Excalifont lacks.
 */
export function check(source: string, options: ResolveOptions = {}): CheckResult {
  const { tree, errors } = resolve(source, options);
  const warnings = source
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((text, i) =>
      text.trim().startsWith("//")
        ? []
        : lineWarnings(text).map((message) => ({ line: i + 1, message })),
    );
  return { tree, errors, warnings };
}
