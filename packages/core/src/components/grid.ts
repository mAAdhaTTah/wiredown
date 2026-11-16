import type { Component, DrawContext, Size } from "../types.js";
import { drawLabel, measureLabel, minLabelWidth, wrapLabel } from "./label.js";
import type { Label } from "./label.js";
import { BOX, checkMark, contentLines, parseCheck } from "./shared.js";

const NUMERIC = /^[-+]?[$€£]?\s?\d[\d\s.,:]*\s?(%|kr|sek|€|\$|£)?$/i;

interface Cell {
  label: string;
  check?: boolean;
  checked?: boolean;
  numeric?: boolean;
  m: Size;
  /** Text cells, which may hold icons such as {dot}. */
  lab?: Label;
  /** The label's lines once the column widths are known. */
  lines: Label[];
}

const PAD_X = 10,
  PAD_Y = 7,
  GAP = 6;

/** Width of a cell's content when it is on one line. */
const contentW = (cell: Cell) => (cell.check ? BOX + (cell.label ? GAP + cell.m.w : 0) : cell.m.w);

/**
 * Column widths that add up to at most `limit`: the widest columns give
 * way first, and none goes below what its longest word needs.
 */
function shrink(natural: number[], min: number[], limit: number): number[] {
  const at = (level: number) => natural.map((w, i) => Math.max(min[i], Math.min(w, level)));
  const sum = (ws: number[]) => ws.reduce((a, b) => a + b, 0);
  let lo = 0,
    hi = Math.max(...natural);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sum(at(mid)) <= limit) lo = mid;
    else hi = mid;
  }
  return at(lo).map(Math.floor);
}

function wrapCell(ctx: DrawContext, cell: Cell, inner: number): Label[] {
  if (!cell.label) return [];
  const room = cell.check ? inner - BOX - GAP : inner;
  return wrapLabel(ctx, cell.label, Math.max(room, 1));
}

export const grid: Component = (ctx, node, x, y, slot) => {
  let rows = contentLines(node);
  if (!rows.length) rows = ["Column A, Column B", "Value, Value"];
  rows = rows.filter((r) => !/^\|?\s*:?-{2,}/.test(r)); // drop markdown |---| lines
  const usePipe = rows.some((r) => r.includes("|"));
  const parsed = rows.map((r) => {
    let s = r.trim();
    let selected = false,
      hi = false;
    // ">" marks the row the user is acting on; "*" marks a selected row
    if (s.startsWith(">") && !s.startsWith(">|") && !s.startsWith(">,")) {
      hi = true;
      s = s.slice(1).trim();
    }
    if (s.startsWith("*") && !s.startsWith("*|") && !s.startsWith("*,")) {
      selected = true;
      s = s.slice(1).trim();
    }
    if (usePipe) s = s.replace(/^\|/, "").replace(/\|$/, "");
    const cells = (usePipe ? s.split("|") : s.split(","))
      .map((t) => t.trim())
      .map((t): Cell => {
        const cb = parseCheck(t);
        if (cb) return { check: true, ...cb, m: ctx.measure(cb.label), lines: [] };
        const lab = measureLabel(ctx, t);
        return {
          label: t,
          numeric: NUMERIC.test(t),
          m: { w: lab.w, h: lab.h },
          lab,
          lines: [],
        };
      });
    return { selected, hi, cells };
  });
  const ncols = Math.max(...parsed.map((r) => r.cells.length));
  parsed.forEach((r) => {
    while (r.cells.length < ncols) {
      r.cells.push({ label: "", m: ctx.measure(""), lines: [] });
    }
  });

  let textH = 0;
  let colW = new Array<number>(ncols).fill(0);
  parsed.forEach((r) =>
    r.cells.forEach((cell, i) => {
      textH = Math.max(textH, cell.m.h);
      colW[i] = Math.max(colW[i], contentW(cell) + 2 * PAD_X);
    }),
  );
  const lineH = Math.max(textH, BOX);
  const natural = colW.reduce((a, b) => a + b, 0);
  const target = Math.max(0, node.opts.w || 0, slot?.w || 0);
  // too wide for the room there is: columns narrow and their cells wrap
  const limit = target || ctx.maxW;
  const wraps = limit !== undefined && natural > limit;
  if (wraps) {
    // no column goes below what its longest word (or its checkbox) needs
    const minW = new Array<number>(ncols).fill(0);
    parsed.forEach((r) =>
      r.cells.forEach((cell, i) => {
        const word = cell.label ? minLabelWidth(ctx, cell.label) : 0;
        const min = cell.check ? BOX + (cell.label ? GAP + word : 0) : word;
        minW[i] = Math.max(minW[i], min + 2 * PAD_X);
      }),
    );
    colW = shrink(colW, minW, limit);
  }
  // stretched: the extra width is shared evenly by the columns
  const extra = target - colW.reduce((a, b) => a + b, 0);
  if (extra > 0) colW.forEach((_, i) => (colW[i] += extra / ncols));
  const W = colW.reduce((a, b) => a + b, 0);

  // one line per cell unless the grid wraps, so an unwrapped grid is laid out as before
  const rowH = parsed.map((r) => {
    let h = lineH;
    r.cells.forEach((cell, ci) => {
      if (wraps) cell.lines = wrapCell(ctx, cell, colW[ci] - 2 * PAD_X);
      else if (cell.lab && cell.label) cell.lines = [cell.lab];
      else if (cell.check && cell.label) cell.lines = [measureLabel(ctx, cell.label)];
      h = Math.max(
        h,
        cell.lines.reduce((sum, l) => sum + l.h, 0),
      );
    });
    return h + 2 * PAD_Y;
  });
  const H = rowH.reduce((a, b) => a + b, 0);
  if (ctx.dry) return { w: W, h: H };
  const colX = [x];
  colW.forEach((w, i) => colX.push(colX[i] + w));
  const rowY = [y];
  rowH.forEach((h, i) => rowY.push(rowY[i] + h));

  const { colors } = ctx.theme;
  // (plain): no frame, no column lines, no header fill
  const plain = !!node.opts.plain;
  if (!plain) ctx.rect(x, y, W, rowH[0], { fill: colors.fill, noStroke: true });
  parsed.forEach((r, ri) => {
    if (ri === 0) return;
    const fill = r.selected
      ? colors.selected
      : node.opts.striped && ri % 2 === 0
        ? colors.stripe
        : null;
    if (fill) ctx.rect(x, rowY[ri], W, rowH[ri], { fill, noStroke: true });
  });
  if (!plain) ctx.rect(x, y, W, H, { width: 2 });
  for (let ri = 1; ri < parsed.length; ri++) {
    ctx.line(
      [
        [x, rowY[ri]],
        [x + W, rowY[ri]],
      ],
      ri === 1 ? 2 : 1,
    );
  }
  for (let ci = 1; ci < ncols && !plain; ci++) {
    ctx.line(
      [
        [colX[ci], y],
        [colX[ci], y + H],
      ],
      1,
    );
  }
  parsed.forEach((r, ri) =>
    r.cells.forEach((cell, ci) => {
      const cy = rowY[ri];
      const inner = colW[ci] - 2 * PAD_X;
      const blockH = cell.lines.reduce((sum, l) => sum + l.h, 0);
      const blockW = Math.max(0, ...cell.lines.map((l) => l.w));
      let ly = cy + (rowH[ri] - blockH) / 2;
      if (cell.check) {
        const w = BOX + (cell.label ? GAP + blockW : 0);
        const bx = cell.label ? colX[ci] + PAD_X : colX[ci] + PAD_X + (inner - w) / 2;
        const first = cell.lines[0]?.h ?? BOX;
        // the box sits on the label's first line, or in the middle of an empty cell
        const by = cell.lines.length ? ly + (first - BOX) / 2 : cy + (rowH[ri] - BOX) / 2;
        checkMark(ctx, bx, by, !!cell.checked);
        for (const line of cell.lines) {
          drawLabel(ctx, bx + BOX + GAP, ly, line);
          ly += line.h;
        }
      } else {
        for (const line of cell.lines) {
          const right = cell.numeric && ri > 0;
          drawLabel(ctx, right ? colX[ci] + colW[ci] - PAD_X - line.w : colX[ci] + PAD_X, ly, line);
          ly += line.h;
        }
      }
    }),
  );
  parsed.forEach((r, ri) => {
    if (!r.hi) return;
    ctx.rect(x - 4, rowY[ri] - 2, W + 8, rowH[ri] + 4, {
      width: 2,
      color: colors.highlight,
      rounded: true,
    });
  });
  return { w: W, h: H };
};
