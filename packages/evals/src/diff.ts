interface DiffLine {
  op: " " | "-" | "+";
  text: string;
}

const lines = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** A line diff from an LCS table; inputs are small screens files. */
function diffLines(before: string, after: string): DiffLine[] {
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

/** Non-blank lines. */
export const lineCount = (text: string) => lines(text).filter((l) => l.trim()).length;
