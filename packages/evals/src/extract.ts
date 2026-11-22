export type Extracted = { ok: true; content: string } | { ok: false; reason: string };

/** What every prompt asks for; `extractFile` accepts nothing else. */
export const REPLY_FORMAT =
  "Reply with only the file content, inside one fenced block opened with four backticks " +
  "(````markdown) and closed with four backticks (````). Write nothing before or after the block.";

/**
 * The file in a reply that is exactly one fenced block of four or more
 * backticks or tildes (so the file's own ``` fences fit inside). Text around
 * the block, a missing closing fence or an empty block make the reply
 * malformed.
 */
export function extractFile(reply: string): Extracted {
  const text = reply.replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, reason: "the reply is empty" };
  const lines = text.split("\n");
  const open = /^(`{4,}|~{4,})[ \t]*[\w-]*[ \t]*$/.exec(lines[0]);
  if (!open) {
    return { ok: false, reason: "the reply does not start with a fence of four backticks" };
  }
  const fence = open[1];
  const close = new RegExp(`^${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
  const end = lines.findIndex((line, i) => i > 0 && close.test(line));
  if (end < 0) return { ok: false, reason: "the fenced block is not closed" };
  if (end !== lines.length - 1) {
    return { ok: false, reason: "there is text after the fenced block" };
  }
  const content = lines.slice(1, end).join("\n");
  if (!content.trim()) return { ok: false, reason: "the fenced block is empty" };
  return { ok: true, content: content + "\n" };
}
