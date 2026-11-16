export interface DiffLine {
  op: " " | "-" | "+";
  text: string;
}

const lines = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** A line diff from an LCS table; inputs are small screens files. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: " ", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ op: "-", text: a[i++] });
    } else {
      out.push({ op: "+", text: b[j++] });
    }
  }
  return out;
}

/** Added plus removed lines, not counting blank ones. */
export function diffSize(before: string, after: string): number {
  return diffLines(before, after).filter((l) => l.op !== " " && l.text.trim()).length;
}

/** A unified diff with `context` lines around each change; empty when equal. */
export function unifiedDiff(
  before: string,
  after: string,
  { from = "a", to = "b", context = 3 } = {},
): string {
  const diff = diffLines(before, after);
  const changed = diff.map((l, i) => (l.op === " " ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return "";
  // group changes whose context overlaps into one hunk
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const start = Math.max(0, i - context);
    const end = Math.min(diff.length, i + context + 1);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else hunks.push([start, end]);
  }
  const out = [`--- ${from}`, `+++ ${to}`];
  for (const [start, end] of hunks) {
    const before = diff.slice(0, start);
    const body = diff.slice(start, end);
    const count = (ls: DiffLine[], skip: DiffLine["op"]) => ls.filter((l) => l.op !== skip).length;
    const aStart = count(before, "+") + 1;
    const bStart = count(before, "-") + 1;
    const aLen = count(body, "+");
    const bLen = count(body, "-");
    out.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`);
    out.push(...body.map((l) => l.op + l.text));
  }
  return out.join("\n") + "\n";
}

/** Non-blank lines. */
export const lineCount = (text: string) => lines(text).filter((l) => l.trim()).length;
