import { EXCALIFONT, fontMeasurer } from "@wiredown/core";
import { generateNKeysBetween } from "fractional-indexing";
import type { ExcalidrawElementJson } from "./elements";
import { FlowError } from "./flow";
import type { Flow } from "./flow";

// Confirmed gen-flow.mjs / Excalidraw plugin DEFAULT_MD_EMBED_CSS:
// host has 10px horizontal padding; footer has 5px height.
// The link height is a maximum, with 40px headroom as in the prototype.
const MD_HOST_PAD = 10,
  MD_FOOTER = 5,
  MAX_HEIGHT_HEADROOM = 40;
// gen-flow.mjs: gap between nodes, where an arrow leaves a frame, the
// decision diamond's size, the spacing of parallel arrows, and how far an
// arrow end stays off its node's edge.
const GAP = 340,
  PORT_Y = 180,
  DEC_W = 260,
  DEC_H = 170,
  PAR = 70,
  END_GAP = 6;
// gen-flow.mjs captions: 16px, grey, 20px under the frame.
const NOTE_GAP = 20,
  NOTE_COLOR = "#495057",
  FONT_SIZE = 16,
  LABEL_WIDTH = 200;
const measurer = fontMeasurer(EXCALIFONT);

export function embedSize(screenWidth: number, screenHeight: number) {
  const width = screenWidth + 2 * MD_HOST_PAD,
    height = screenHeight + MD_FOOTER;
  return { link: { width, height: height + MAX_HEIGHT_HEADROOM }, image: { width, height } };
}
/** Where a new node goes, relative to an existing node (F2, D1). */
export type Place = { rightOf: string } | { below: string };
export interface AddScreenOptions {
  screenId: string;
  title: string;
  path: string;
  size: { width: number; height: number };
  place?: Place;
}
/** A frame's label sits this far above its image. */
const LABEL_OFFSET = 48;

/** The version of `customData.wiredown` this code writes; objects without `v` are version 1. */
export const DATA_VERSION = 1;
export interface AddDecisionOptions {
  text: string;
  place?: Place;
}
export interface ConnectOptions {
  label?: string;
}
/** Something arrows attach to: a frame's image (F1) or a decision's diamond (D1). */
export interface FlowNode {
  node: string;
  kind: "frame" | "decision";
  element: ExcalidrawElementJson;
}
/**
 * `customData.wiredown`. Frames keep `frame` (with `screen`); every other
 * node uses `node`. Arrows and their labels carry `from` and `to`. A
 * frame's image (and a decision's diamond, once it has notes) also records
 * `group`, the Excalidraw group that holds the node's parts.
 */
interface Identity {
  v?: number;
  id?: string;
  role: string;
  frame?: string;
  screen?: string;
  node?: string;
  from?: string;
  to?: string;
  group?: string;
  /** An arrow's place among the arrows between its pair when it was made; absent for 0. */
  slot?: number;
  /** A note's node: the id of its image or diamond element. */
  anchor?: string;
}
function dataOf(e: ExcalidrawElementJson): Identity | undefined {
  return (e.customData as { wiredown?: Identity } | undefined)?.wiredown;
}
function supportedVersion(data: Identity): boolean {
  return (data.v ?? 1) <= DATA_VERSION;
}
/** An element's wiredown data; undefined for a hand-drawn element or one from a newer wiredown. */
function identity(e: ExcalidrawElementJson): Identity | undefined {
  const data = dataOf(e);
  return data && supportedVersion(data) && (data.id === undefined || data.id === e.id)
    ? data
    : undefined;
}
/**
 * The data version of live elements from a newer wiredown: the highest
 * number, else the first value; undefined when there are none.
 */
export function newerDataVersion(flow: Flow): unknown {
  const ignored = flow.elements
    .filter((e) => !e.isDeleted)
    .map(dataOf)
    .filter((data) => data && !supportedVersion(data))
    .map((data) => data!.v);
  const numbers = ignored.filter((v) => typeof v === "number");
  return numbers.length ? Math.max(...numbers) : ignored[0];
}
export function flowFrames(flow: Flow) {
  return flow.elements
    .filter((e) => e.type === "image" && !e.isDeleted && identity(e)?.role === "screen")
    .map((e) => ({ frame: identity(e)!.frame!, element: e }));
}
/** Live frames and decisions, in drawing order. */
export function flowNodes(flow: Flow): FlowNode[] {
  return flow.elements.flatMap((e): FlowNode[] => {
    const data = identity(e);
    if (e.isDeleted || !data) return [];
    if (e.type === "image" && data.role === "screen" && data.frame)
      return [{ node: data.frame, kind: "frame", element: e }];
    if (e.type === "diamond" && data.role === "decision" && data.node)
      return [{ node: data.node, kind: "decision", element: e }];
    return [];
  });
}
/** The live node named `name`; two nodes claiming one name are an error, not a guess. */
function findNode(flow: Flow, name: string): FlowNode {
  const nodes = flowNodes(flow);
  const found = nodes.filter((n) => n.node === name);
  if (found.length > 1)
    throw new Error(
      `${name} is claimed by elements ${found.map((n) => n.element.id).join(" and ")}; delete the copy`,
    );
  if (!found.length)
    throw new Error(
      `unknown node "${name}" (nodes: ${nodes.map((n) => n.node).join(", ") || "none"})`,
    );
  return found[0];
}

const alphabet = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function random(n: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}
function id() {
  return Array.from({ length: 8 }, () => alphabet[random(62)]).join("");
}
/** `n` fractional indices after every existing one, so new elements draw on top. */
function nextIndices(flow: Flow, n: number): string[] {
  const last =
    flow.elements
      .map((e) => e.index)
      .filter((v): v is string => typeof v === "string")
      .sort()
      .at(-1) ?? null;
  return generateNKeysBetween(last, null, n);
}
function element(
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  index: string,
  data: Identity,
  groupIds: string[] = [],
): ExcalidrawElementJson {
  const elementId = id();
  return {
    id: elementId,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds,
    frameId: null,
    index,
    roundness: null,
    seed: random(2147483646) + 1,
    version: 1,
    versionNonce: random(2147483646) + 1,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: { wiredown: { v: DATA_VERSION, ...data, id: elementId } },
  };
}
/** Tell Excalidraw an existing element changed. */
export function touch(e: ExcalidrawElementJson) {
  e.version = Number(e.version ?? 0) + 1;
  e.versionNonce = random(2147483646) + 1;
  e.updated = Date.now();
}
/**
 * The `groupIds` a node's notes take, so they move with it: our group and
 * every group around it, innermost first, so a part stays inside any group a
 * person put the node in. A frame's group is made with the frame; a
 * decision's on first need, inserted innermost on the diamond and its text.
 */
function nodeGroups(flow: Flow, node: ExcalidrawElementJson): string[] {
  const data = identity(node)!;
  const groups = (e: ExcalidrawElementJson) =>
    Array.isArray(e.groupIds) ? (e.groupIds as string[]) : [];
  const at = data.group ? groups(node).indexOf(data.group) : -1;
  if (at >= 0) return groups(node).slice(at);
  data.group = id();
  for (const e of [node, ...flow.elements.filter((e) => e.containerId === node.id)]) {
    e.groupIds = [data.group, ...groups(e)];
    touch(e);
  }
  return groups(node);
}
/** An Excalifont text element sized by core's measurer. */
function textElement(
  x: number,
  y: number,
  text: string,
  fontSize: number,
  index: string,
  data: Identity,
  over: Record<string, unknown> = {},
): ExcalidrawElementJson {
  const measured = measurer.measure(text, { fontSize, fontFamily: 5 });
  return {
    ...element("text", x, y, measured.w, measured.h, index, data),
    text,
    rawText: text,
    originalText: text,
    fontSize,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: EXCALIFONT.lineHeight,
    ...over,
  };
}
/** Breaks lines between words so each fits `width` (a longer word stays whole). */
function wrap(text: string, width: number, fontSize = FONT_SIZE): string {
  const fits = (s: string) => measurer.measure(s, { fontSize, fontFamily: 5 }).w <= width;
  return text
    .split("\n")
    .map((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (line && !fits(next)) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      return [...lines, line].join("\n");
    })
    .join("\n");
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  decision: boolean;
}
function boxOf(n: FlowNode): Box {
  const e = n.element;
  const [x, y, w, h] = [e.x, e.y, e.width, e.height].map(Number);
  return { x, y, w, h, decision: n.kind === "decision" };
}
/** How far down its left or right edge an arrow meets a node (gen-flow.mjs PORT_Y). */
function portY(b: Box) {
  return b.decision ? b.h / 2 : Math.min(PORT_Y, b.h / 2);
}
/**
 * Top-left for a new node of size `w`×`h` next to `place`'s node, or right of
 * the rightmost node, or right of everything in a drawing without nodes.
 * Frames line up by their tops and left edges; a decision lines up its centre
 * with the other node's arrow port, so the arrow between them is straight.
 */
function placeNode(flow: Flow, place: Place | undefined, w: number, h: number, decision: boolean) {
  const refName = place && ("rightOf" in place ? place.rightOf : place.below);
  const ref = refName
    ? boxOf(findNode(flow, refName))
    : flowNodes(flow)
        .map(boxOf)
        .reduce<Box | undefined>((a, b) => (!a || b.x + b.w > a.x + a.w ? b : a), undefined);
  if (!ref) {
    const live = flow.elements.filter((e) => !e.isDeleted);
    if (!live.length) return { x: 0, y: 0 };
    return {
      x: Math.max(...live.map((e) => Number(e.x) + Number(e.width))) + GAP,
      y: Math.min(...live.map((e) => Number(e.y))),
    };
  }
  const align = ref.decision || decision;
  const self = { x: 0, y: 0, w, h, decision };
  if (place && "below" in place)
    return { x: align ? ref.x + ref.w / 2 - w / 2 : ref.x, y: ref.y + ref.h + GAP };
  return { x: ref.x + ref.w + GAP, y: align ? ref.y + portY(ref) - portY(self) : ref.y };
}

/** Appends one frame; existing elements are never modified. Returns its F-number. */
export function addScreen(flow: Flow, options: AddScreenOptions): string {
  const size = embedSize(options.size.width, options.size.height);
  const { x, y } = placeNode(flow, options.place, size.image.width, size.image.height, false);
  // a person's copy keeps its name taken, so a new frame never shares it
  const numbers = flow.elements.flatMap((e) => {
    const a = /^F(\d+)$/.exec(dataOf(e)?.frame ?? "");
    const b = e.type === "text" ? /^F(\d+) ·/.exec(String(e.rawText ?? e.text)) : null;
    return [Number(a?.[1] ?? 0), Number(b?.[1] ?? 0)];
  });
  const frame = `F${Math.max(0, ...numbers) + 1}`;
  const keys = nextIndices(flow, 2);
  const data = { frame, screen: options.screenId };
  // One Excalidraw group holds a frame's parts (image, label, and later its
  // notes and overlays): clicking any part selects the whole frame, so it
  // moves together; double-clicking enters the group to select one element.
  const group = id();
  const label = textElement(
    x,
    y - LABEL_OFFSET,
    `${frame} · ${options.title}`,
    24,
    keys[0],
    { ...data, role: "label" },
    { groupIds: [group] },
  );
  // Plugin file ids are 40 hex characters; random bytes avoid Node-only hashing.
  const fileId = Array.from(crypto.getRandomValues(new Uint8Array(20)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const image = {
    ...element(
      "image",
      x,
      y,
      size.image.width,
      size.image.height,
      keys[1],
      {
        ...data,
        role: "screen",
        group,
      },
      [group],
    ),
    fileId,
    status: "saved",
    scale: [1, 1],
    crop: null,
  };
  identity(label)!.anchor = image.id;
  flow.elements.push(label, image);
  flow.embeds.set(fileId, { path: options.path, ...size.link, blockId: options.screenId });
  return frame;
}

/**
 * Appends a decision diamond with its text centred inside (gen-flow.mjs).
 * The diamond grows if the wrapped text does not fit. Returns its D-number.
 */
export function addDecision(flow: Flow, options: AddDecisionOptions): string {
  const numbers = flow.elements.map((e) =>
    Number(/^D(\d+)$/.exec(dataOf(e)?.node ?? "")?.[1] ?? 0),
  );
  const node = `D${Math.max(0, ...numbers) + 1}`;
  const keys = nextIndices(flow, 2);
  // A diamond's inscribed rectangle is half its width and half its height.
  const text = wrap(options.text, DEC_W / 2);
  const measured = measurer.measure(text, { fontSize: FONT_SIZE, fontFamily: 5 });
  const w = Math.max(DEC_W, Math.ceil(2 * measured.w)),
    h = Math.max(DEC_H, Math.ceil(2 * measured.h));
  const { x, y } = placeNode(flow, options.place, w, h, true);
  const diamond: ExcalidrawElementJson = {
    ...element("diamond", x, y, w, h, keys[0], { node, role: "decision" }),
    backgroundColor: "#fff3bf",
    roundness: { type: 2 },
  };
  const label = textElement(
    x + (w - measured.w) / 2,
    y + (h - measured.h) / 2,
    text,
    FONT_SIZE,
    keys[1],
    { node, role: "label" },
    { textAlign: "center", verticalAlign: "middle", containerId: diamond.id },
  );
  diamond.boundElements = [{ type: "text", id: label.id }];
  flow.elements.push(diamond, label);
  return node;
}

/**
 * Appends an arrow from node `from` to node `to`, bound at both ends, with an
 * optional label as bound text. Returns the arrow's element id.
 *
 * The arrow is straight, between the facing edges of the nodes where they are
 * now: right to left when the target is further away sideways than up or
 * down, bottom to top otherwise (gen-flow.mjs edgeGeometry, made symmetric).
 * Each further arrow between the same pair, in either direction, is offset so
 * they do not overlap: 0, +70, -70, +140, ...
 */
export function connect(flow: Flow, from: string, to: string, options: ConnectOptions = {}) {
  if (from === to) throw new Error(`cannot connect "${from}" to itself`);
  const start = findNode(flow, from),
    end = findNode(flow, to);
  const parallel = arrowsBetween(flow, start.element.id, end.element.id);
  // the first free slot, so a deleted arrow's place is reused before a taken one
  const taken = new Set(parallel.map((e) => identity(e)?.slot ?? 0));
  let k = 0;
  while (taken.has(k)) k++;
  const g = arrowGeometry(start, end, k);
  const keys = nextIndices(flow, options.label ? 2 : 1);
  const arrow: ExcalidrawElementJson = {
    ...element("arrow", g.x, g.y, g.width, g.height, keys[0], {
      role: "arrow",
      from,
      to,
      ...(k ? { slot: k } : {}),
    }),
    roundness: { type: 2 },
    points: g.points,
    lastCommittedPoint: null,
    startBinding: { elementId: start.element.id, mode: "orbit", fixedPoint: g.startFixedPoint },
    endBinding: { elementId: end.element.id, mode: "orbit", fixedPoint: g.endFixedPoint },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
  for (const n of [start, end]) {
    const bound = Array.isArray(n.element.boundElements) ? n.element.boundElements : [];
    n.element.boundElements = [...bound, { id: arrow.id, type: "arrow" }];
    touch(n.element);
  }
  flow.elements.push(arrow);
  if (options.label) {
    const text = wrap(options.label, LABEL_WIDTH);
    const size = measurer.measure(text, { fontSize: FONT_SIZE, fontFamily: 5 });
    const label = textElement(
      g.x + g.points[1][0] / 2 - size.w / 2,
      g.y + g.points[1][1] / 2 - size.h / 2,
      text,
      FONT_SIZE,
      keys[1],
      { role: "label", from, to },
      { textAlign: "center", verticalAlign: "middle", containerId: arrow.id },
    );
    arrow.boundElements = [{ type: "text", id: label.id }];
    flow.elements.push(label);
  }
  if (k) for (const a of [...parallel, arrow]) positionArrowLabel(flow, a, 1 / 3);
  return arrow.id;
}

/** Place the bound text of an arrow of ours along it, measured from the start. */
export function positionArrowLabel(flow: Flow, arrow: ExcalidrawElementJson, fraction: number) {
  if (!identity(arrow)) return; // a person's arrow keeps its label where they put it
  const end = (arrow.points as number[][])[1];
  for (const label of flow.elements.filter((e) => !e.isDeleted && e.containerId === arrow.id)) {
    const x = Number(arrow.x) + end[0] * fraction - Number(label.width) / 2;
    const y = Number(arrow.y) + end[1] * fraction - Number(label.height) / 2;
    if (label.x !== x || label.y !== y) {
      Object.assign(label, { x, y });
      touch(label);
    }
  }
}
/** Live arrows bound between two node elements, in either direction, in drawing order. */
export function arrowsBetween(flow: Flow, a: string, b: string) {
  return flow.elements.filter((e) => {
    const s = (e.startBinding as { elementId?: string } | null | undefined)?.elementId,
      t = (e.endBinding as { elementId?: string } | null | undefined)?.elementId;
    return (
      e.type === "arrow" && !e.isDeleted && s !== t && [a, b].includes(s!) && [a, b].includes(t!)
    );
  });
}
/**
 * The geometry `connect` gives the arrow in `slot` (its place among the
 * arrows between one pair, offset 0, +70, -70, +140, ...) between two nodes
 * as they are now: the arrow's `x`, `y`, `width`, `height`, `points` and its
 * bindings' fixed points.
 */
export function arrowGeometry(start: FlowNode, end: FlowNode, slot: number) {
  const offset = slot === 0 ? 0 : (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * PAR;
  const g = edgeGeometry(boxOf(start), boxOf(end), offset);
  return {
    x: g.sx,
    y: g.sy,
    width: Math.abs(g.ex - g.sx),
    height: Math.abs(g.ey - g.sy),
    points: [
      [0, 0],
      [g.ex - g.sx, g.ey - g.sy],
    ],
    startFixedPoint: g.sfp,
    endFixedPoint: g.efp,
  };
}
function edgeGeometry(a: Box, b: Box, offset: number) {
  const gap = (lo1: number, len1: number, lo2: number, len2: number) =>
    Math.max(lo2 - (lo1 + len1), lo1 - (lo2 + len2));
  const sideways = gap(a.x, a.w, b.x, b.w) >= gap(a.y, a.h, b.y, b.h);
  const centre = (box: Box) => (sideways ? box.x + box.w / 2 : box.y + box.h / 2);
  const dir = centre(b) >= centre(a) ? 1 : -1;
  // keep the offset inside both nodes
  const room = (box: Box) =>
    sideways
      ? box.decision
        ? box.h / 2 - END_GAP
        : Math.min(portY(box), box.h - portY(box))
      : box.decision
        ? box.w / 2 - END_GAP
        : box.w / 2;
  const off = Math.max(-Math.min(room(a), room(b)), Math.min(offset, room(a), room(b)));
  // along the edge: the port; across: the edge, or the diamond's side at that offset
  const along = (box: Box) => (sideways ? box.y + portY(box) : box.x + box.w / 2) + off;
  const across = (box: Box, far: boolean) => {
    const [lo, len, other] = sideways ? [box.x, box.w, box.h] : [box.y, box.h, box.w];
    if (!box.decision) return far ? lo + len : lo;
    const half = len / 2;
    return lo + half + (far ? 1 : -1) * half * (1 - Math.abs(off) / (other / 2));
  };
  const s = [across(a, dir > 0) + dir * END_GAP, along(a)],
    e = [across(b, dir < 0) - dir * END_GAP, along(b)];
  const [sx, sy] = sideways ? s : [s[1], s[0]],
    [ex, ey] = sideways ? e : [e[1], e[0]];
  const fp = (box: Box, x: number, y: number) => [
    Math.min(1, Math.max(0, (x - box.x) / box.w)),
    Math.min(1, Math.max(0, (y - box.y) / box.h)),
  ];
  return { sx, sy, ex, ey, sfp: fp(a, sx, sy), efp: fp(b, ex, ey) };
}

/**
 * Appends a free text note under a frame or to the right of a decision,
 * below its lowest earlier note,
 * wrapped to the node's width. A note is not bound, but it joins the node's
 * group, so it moves with the node; double-click enters the group to move
 * the note alone. Returns the note's element id.
 */
export function addNote(flow: Flow, node: string, text: string): string {
  const n = findNode(flow, node);
  const box = boxOf(n);
  const notes = nodeAttachments(flow, n).filter(
    (p) => identity(p.element)?.role === "note" && !p.far,
  );
  const wrapped = wrap(text, box.w);
  const top = n.kind === "decision" ? box.y + box.h / 2 + NOTE_GAP : box.y + box.h + NOTE_GAP;
  const y = Math.max(
    top,
    ...notes.map(({ element: e }) => Number(e.y) + Number(e.height) + NOTE_GAP),
  );
  const note = textElement(
    n.kind === "decision" ? box.x + box.w + NOTE_GAP : box.x,
    y,
    wrapped,
    FONT_SIZE,
    nextIndices(flow, 1)[0],
    { role: "note", node, anchor: n.element.id },
    { strokeColor: NOTE_COLOR, groupIds: nodeGroups(flow, n.element) },
  );
  flow.elements.push(note);
  return note.id;
}

// Allow hand nudges of 60px, and 200px gaps left by a deleted note.
const HAND_NUDGE = 60,
  NOTE_STACK_GAP = 200;

/** Command positions for our own unambiguous attachments. */
export function nodeAttachments(flow: Flow, n: FlowNode) {
  const b = boxOf(n);
  let y = n.kind === "decision" ? b.y + b.h / 2 + NOTE_GAP : b.y + b.h + NOTE_GAP;
  const x = n.kind === "decision" ? b.x + b.w + NOTE_GAP : b.x;
  const legacy = flow.elements.filter((e) => {
    const d = identity(e);
    return (
      !e.isDeleted &&
      d?.role === "label" &&
      !d.anchor &&
      !d.id &&
      !e.containerId &&
      (d.frame ?? d.node) === n.node
    );
  });
  const plans = [...flow.elements]
    .sort((a, b) => Number(a.y) - Number(b.y))
    .flatMap((e) => {
      const d = identity(e);
      if (e.isDeleted || !d || !["label", "note"].includes(d.role) || e.containerId) return [];
      if (
        d.anchor ? d.anchor !== n.element.id : d.role !== "label" || (d.frame ?? d.node) !== n.node
      )
        return [];
      if (!d.anchor && !d.id && legacy.length > 1) return [];
      const label = d.role === "label";
      const want = label ? { x: b.x, y: b.y - LABEL_OFFSET } : { x, y };
      const distance = Math.hypot(Number(e.x) - want.x, Number(e.y) - want.y);
      const gap = Number(e.y) - (y - NOTE_GAP);
      const far = label
        ? distance > HAND_NUDGE
        : Math.abs(Number(e.x) - x) > HAND_NUDGE || gap > NOTE_STACK_GAP || gap < -HAND_NUDGE;
      if (!label && !far) y = Number(e.y) + Number(e.height) + NOTE_GAP;
      return [{ element: e, ...want, distance, far }];
    });
  return plans.map((p) => {
    if (!p.far || identity(p.element)?.role !== "note") return p;
    const want = {
      ...p,
      y,
      distance: Math.hypot(Number(p.element.x) - x, Number(p.element.y) - y),
    };
    y += Number(p.element.height) + NOTE_GAP;
    return want;
  });
}
