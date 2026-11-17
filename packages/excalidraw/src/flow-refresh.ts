// flow lint and flow refresh: compare a flow with the current layout of the
// screens it embeds. Both are pure; the caller supplies the screens, looked
// up by the embed (its path and block id), so two screens files with the
// same block id are never confused.
import type { Box } from "@wiredown/core";
import type { ExcalidrawElementJson } from "./elements.js";
import type { EmbedLink, Flow } from "./flow.js";
import {
  arrowGeometry,
  arrowsBetween,
  centredOn,
  claimedNames,
  copyOf,
  embedSize,
  flowFrames,
  flowNodes,
  highlightBounds,
  identity,
  markCentre,
  newerDataVersion,
  NOTE_GAP,
  nodeAttachments,
  overlayBox,
  pastedCopies,
  positionArrowLabel,
  touch,
} from "./flow-edit.js";
import type { FlowNode } from "./flow-edit.js";

/** A screen as it renders now: its export size and the box of each `#id`. */
export interface ScreenState {
  width: number;
  height: number;
  boxes: Record<string, Box>;
}
/** A screen embed: the path written in its link, and its block id. */
export interface ScreenRef {
  path: string;
  blockId: string;
}
/**
 * The current state of the screen an embed names, or why it has none, as
 * the sentence `embeds [[path#^id]], …` goes on: `but no ui.md was found
 * from … upward`, `which points outside …`, `but ui.md has no ^id`.
 */
export type ScreenLookup = (embed: ScreenRef) => ScreenState | string;

/** Something broken in a flow; `element` is the element id it is about. */
export interface FlowFinding {
  message: string;
  frame?: string;
  element?: string;
}
export interface Size {
  width: number;
  height: number;
}
/** What `refreshFlow` changed, or (with `unresolved`) could not place. */
export type FlowChange =
  | {
      frame: string;
      kind: "embed";
      /** The frame's image element. */
      element: string;
      /** The `## Embedded Files` link size; `from` lacks what the link lacked. */
      link: { from: Partial<Size>; to: Size };
      image: { from: Size; to: Size };
    }
  | {
      frame: string;
      kind: "highlight" | "mark";
      element: string;
      target: string;
      label?: string;
      /** Why the overlay was left in place; absent when it was moved. */
      unresolved?: string;
    }
  | {
      /** The node the arrow no longer met. */
      frame: string;
      kind: "arrow";
      element: string;
      from: string;
      to: string;
      /** Why the arrow was left as it is; absent when it was re-routed. */
      unresolved?: string;
    }
  | { frame: string; kind: "note"; element: string }
  | { frame: string; kind: "label"; element: string }
  | { frame: string; kind: "group"; element: string };

/** Overlays, frames, arrow ends and notes within this many drawing px of their place are current. */
const TOLERANCE = 1;
/** Image width:height ratios within this fraction of the screen's are the same aspect. */
const ASPECT_TOLERANCE = 0.01;

const num = (v: unknown) => Number(v);
const size = (e: ExcalidrawElementJson): Size => ({ width: num(e.width), height: num(e.height) });

interface FrameState {
  frame: string;
  image: ExcalidrawElementJson;
  embed: EmbedLink;
  blockId: string;
  screen?: ScreenState;
  /** Why `screen` is missing. */
  missing?: string;
  /** Set when the embed link or image aspect no longer matches the screen. */
  stale?: { link: Size; image: Size };
}

/** Each live frame with an embed entry, and how it compares with its screen now. */
function frameStates(flow: Flow, screens: ScreenLookup): FrameState[] {
  return flowFrames(flow).flatMap(({ frame, element: image }) => {
    const embed = flow.embeds.get(String(image.fileId));
    if (!embed) return []; // reported as an image without an entry
    const blockId = embed.blockId ?? identity(image)!.screen ?? "";
    const found = blockId
      ? screens({ path: embed.path, blockId })
      : "but it embeds no screen block";
    if (typeof found === "string") return [{ frame, image, embed, blockId, missing: found }];
    const screen = found;
    const state: FrameState = { frame, image, embed, blockId, screen };
    const want = embedSize(screen.width, screen.height);
    const ratio = want.image.width / want.image.height;
    const now = size(image);
    const linkStale = embed.width !== want.link.width || embed.height !== want.link.height;
    const aspectStale = Math.abs(now.width / now.height - ratio) > ASPECT_TOLERANCE * ratio;
    if (linkStale || aspectStale) {
      // The image keeps the scale a person gave it, measured on its width:
      // scale = current width / old image width, where the old image width is
      // the old link width (embedSize gives link and image the same width);
      // new width = scale × new image width, new height = scale × new image height.
      const scale = now.width / (embed.width ?? want.image.width);
      state.stale = {
        link: want.link,
        image: { width: scale * want.image.width, height: scale * want.image.height },
      };
    }
    return [state];
  });
}

interface Overlay {
  element: ExcalidrawElementJson;
  role: "highlight" | "mark";
  frame: string;
  target: string;
  label?: string;
  /** The block id it was drawn for. */
  screen?: string;
  /** Its frame's image element id. */
  anchor?: string;
}
function liveOverlays(flow: Flow): Overlay[] {
  return flow.elements.flatMap((element) => {
    const d = identity(element);
    if (element.isDeleted || !d?.frame || !d.target) return [];
    if (!(d.role === "highlight" || d.role === "mark")) return [];
    const { frame, target, label, screen, anchor } = d;
    return [{ element, role: d.role, frame, target, label, screen, anchor }];
  });
}
interface Placement {
  element: ExcalidrawElementJson;
  x: number;
  y: number;
  width: number;
  height: number;
}
/**
 * Where an overlay belongs on a frame whose image has `image`'s geometry, as
 * addHighlight and addMark place it; a string says why it has no place.
 */
function placeOverlay(
  flow: Flow,
  o: Overlay,
  state: FrameState & { screen: ScreenState },
  image: ExcalidrawElementJson,
): Placement[] | string {
  const box = state.screen.boxes[o.target];
  if (!box) return `^${state.blockId} has no #${o.target} any more`;
  const b = overlayBox(image, state.screen, box);
  if (o.role === "highlight") return [{ element: o.element, ...highlightBounds(b) }];
  // a mark keeps its size; it and its bound text centre where addMark puts them
  const c = markCentre(b.x, b.y, num(o.element.width));
  const texts = flow.elements.filter((e) => !e.isDeleted && e.containerId === o.element.id);
  return [o.element, ...texts].map((e) => ({
    element: e,
    ...centredOn(c.x, c.y, num(e.width), num(e.height)),
    ...size(e),
  }));
}
const placed = (p: Placement) =>
  (["x", "y", "width", "height"] as const).every(
    (k) => Math.abs(num(p.element[k]) - p[k]) <= TOLERANCE,
  );
/** The image as refresh leaves it: same top-left, the stale size replaced. */
const refreshedImage = (s: FrameState) => (s.stale ? { ...s.image, ...s.stale.image } : s.image);
const overlayChange = (o: Overlay) => ({
  frame: o.frame,
  kind: o.role,
  element: o.element.id,
  target: o.target,
  ...(o.label === undefined ? {} : { label: o.label }),
});
const link = (path: string, blockId: string) => `[[${path}#^${blockId}]]`;
const overlayName = (o: Overlay) =>
  o.role === "mark" ? `mark ${o.label} #${o.target}` : `highlight #${o.target}`;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const rect = (e: ExcalidrawElementJson): Rect => ({ x: num(e.x), y: num(e.y), ...size(e) });
const bottom = (r: Rect) => r.y + r.height;
/**
 * Our live notes under the frame image `anchor` whose box was `old`: those
 * that overlap it sideways with their top below its top. `overlapping` are
 * the ones whose top is inside it. `shift` is how far they all move, in
 * order, when the frame's box is now `now`: by the change in its bottom
 * edge, or, when the top note overlaps the frame, to NOTE_GAP under it.
 */
function notesUnder(flow: Flow, anchor: string, old: Rect, now: Rect) {
  const n = flowNodes(flow).find((n) => n.element.id === anchor);
  const far = new Set(
    n
      ? nodeAttachments(flow, {
          ...n,
          element: { ...n.element, x: old.x, y: old.y, width: old.width, height: old.height },
        })
          .filter((p) => p.far)
          .map((p) => p.element.id)
      : [],
  );
  const notes = flow.elements.filter((e) => {
    const d = identity(e);
    if (e.isDeleted || d?.role !== "note" || d.anchor !== anchor || far.has(e.id)) return false;
    const r = rect(e);
    return r.x < old.x + old.width && r.x + r.width > old.x && r.y > old.y;
  });
  const overlapping = notes.filter((e) => num(e.y) < bottom(old) - TOLERANCE);
  const top = Math.min(...notes.map((e) => num(e.y)));
  const shift = overlapping.length ? bottom(now) + NOTE_GAP - top : bottom(now) - bottom(old);
  return { notes, overlapping, shift };
}
/** A note's first words, for messages. */
function noteStart(e: ExcalidrawElementJson) {
  const words = String(e.text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 4).join(" ") + (words.length > 4 ? "…" : "");
}

interface Route {
  arrow: ExcalidrawElementJson;
  start: FlowNode;
  end: FlowNode;
  geometry: ReturnType<typeof arrowGeometry>;
  /** Not a two-point line: a person bent it, so we leave it. */
  shaped: boolean;
  /** The nodes whose end of the arrow is not where `connect` puts it now. */
  missed: string[];
}
/**
 * Each live arrow of ours bound at both ends to two live nodes, with the
 * geometry `connect` gives its slot between the nodes as they are now.
 */
function arrowRoutes(flow: Flow): Route[] {
  const nodes = new Map(flowNodes(flow).map((n) => [n.element.id, n]));
  const bound = (b: unknown) => nodes.get(String((b as { elementId?: string } | null)?.elementId));
  return flow.elements.flatMap((arrow) => {
    const d = identity(arrow);
    if (arrow.isDeleted || arrow.type !== "arrow" || d?.role !== "arrow") return [];
    if (!Array.isArray(arrow.points) || !arrow.points.length) return [];
    const start = bound(arrow.startBinding),
      end = bound(arrow.endBinding);
    if (!start || !end || start === end) return [];
    const geometry = arrowGeometry(start, end, d.slot ?? 0);
    const points = arrow.points as number[][];
    const [gx, gy] = geometry.points[1];
    const ends: [FlowNode, number[], number[]][] = [
      [start, points[0], [0, 0]],
      [end, points.at(-1)!, [gx, gy]],
    ];
    const missed = ends
      .filter(([, [px, py], [wx, wy]]) => {
        const dx = num(arrow.x) + px - (geometry.x + wx),
          dy = num(arrow.y) + py - (geometry.y + wy);
        return Math.abs(dx) > TOLERANCE || Math.abs(dy) > TOLERANCE;
      })
      .map(([n]) => n.node);
    return [{ arrow, start, end, geometry, shaped: points.length !== 2, missed }];
  });
}

/**
 * Bound arrows and bound text whose other end is missing, deleted, or does
 * not list them in `boundElements`, as Excalidraw's binding requires.
 */
export function bindingFailures(elements: ExcalidrawElementJson[]): FlowFinding[] {
  const out: FlowFinding[] = [];
  const all = new Map(elements.map((e) => [e.id, e]));
  const live = elements.filter((e) => !e.isDeleted);
  const check = (e: ExcalidrawElementJson, what: string, targetId: unknown) => {
    const target = all.get(String(targetId));
    const problem = !target
      ? `${String(targetId)}, which does not exist`
      : target.isDeleted
        ? `${target.type} ${target.id}, which is deleted`
        : (target.boundElements as { id: string }[] | null | undefined)?.some((b) => b.id === e.id)
          ? undefined
          : `${target.type} ${target.id}, which does not list it in boundElements`;
    if (problem) out.push({ message: `${what} is bound to ${problem}`, element: e.id });
  };
  for (const a of live.filter((e) => e.type === "arrow")) {
    const d = identity(a);
    const name = d?.from && d.to ? `arrow ${d.from} -> ${d.to}` : `arrow ${a.id}`;
    for (const [end, word] of [
      ["startBinding", "start"],
      ["endBinding", "end"],
    ] as const) {
      const id = (a[end] as { elementId?: string } | null | undefined)?.elementId;
      if (id !== undefined) check(a, `${name}: its ${word}`, id);
    }
  }
  for (const t of live.filter((e) => e.type === "text" && e.containerId))
    check(t, `text ${t.id}`, t.containerId);
  return out;
}

/**
 * What is broken in a flow given its screens now: frames whose screen is
 * missing or whose embed size or aspect is stale, two nodes claiming one
 * name, overlays that are stale, lost their target or frame, or were drawn
 * for another screen, dangling arrows, images without an `## Embedded Files`
 * entry, and data from a newer wiredown. Never reports style or hand-drawn
 * elements that work.
 */
export function lintFlow(flow: Flow, screens: ScreenLookup): FlowFinding[] {
  const out: FlowFinding[] = [];
  const newer = newerDataVersion(flow);
  if (newer !== undefined)
    out.push({
      message: `this drawing was written by a newer wiredown (data version ${JSON.stringify(newer)})`,
    });
  if (flow.compressed)
    out.push({
      message:
        'drawing is saved as compressed-json, so it does not diff; run any flow command (e.g. "wiredown flow refresh") to rewrite it as JSON, and turn off "Compress Excalidraw JSON in Markdown" in the Excalidraw plugin\'s Saving settings',
    });
  for (const e of flow.elements) {
    if (!e.isDeleted && e.type === "text" && e.id.length !== 8)
      out.push({
        element: e.id,
        message: `text element "${e.id}" has an id that is not 8 characters; the Excalidraw plugin cannot track it, and flow commands cannot save this drawing until it is renamed`,
      });
  }
  for (const { node, ids, message } of claimedNames(flow))
    out.push({ frame: node, element: ids.at(-1)!, message });
  for (const [copy] of pastedCopies(flow)) {
    const { node, what } = copyOf(copy)!;
    out.push({
      ...(node ? { frame: node } : {}),
      element: copy.id,
      message: `element ${copy.id} is a copy of ${what}; flow commands leave copies alone: delete it in the drawing`,
    });
  }
  const states = frameStates(flow, screens);
  for (const s of states) {
    const at = { frame: s.frame, element: s.image.id };
    if (!s.screen)
      out.push({ ...at, message: `embeds ${link(s.embed.path, s.blockId)}, ${s.missing}` });
    else if (s.stale) {
      const { width, height } = s.embed;
      const want = `^${s.blockId} now needs ${s.stale.link.width}x${s.stale.link.height}`;
      out.push({
        ...at,
        message:
          width === s.stale.link.width && height === s.stale.link.height
            ? `stale image: ${num(s.image.width)}x${num(s.image.height)} no longer has the aspect of ^${s.blockId}`
            : `stale embed size: ${width ?? "?"}x${height ?? "?"}, but ${want}`,
      });
    }
  }
  const far = new Set<string>();
  for (const n of flowNodes(flow))
    for (const p of nodeAttachments(flow, n).filter((p) => p.far)) {
      far.add(p.element.id);
      const what = identity(p.element)!.role === "label" ? "label" : `note ${p.element.id}`;
      out.push({
        frame: n.node,
        element: p.element.id,
        message: `${what} is ${Math.round(p.distance)} px from its ${n.kind}; move it back, or run "wiredown flow refresh <flow>"`,
      });
    }
  // a screen embedded by hand has no frame, but its reference can still break
  const framed = new Set(flowFrames(flow).map((f) => f.element.id));
  for (const image of flow.elements) {
    if (image.isDeleted || image.type !== "image" || framed.has(image.id)) continue;
    const embed = flow.embeds.get(String(image.fileId));
    const found = embed?.blockId && screens({ path: embed.path, blockId: embed.blockId });
    if (typeof found === "string")
      out.push({
        element: image.id,
        message: `an image embeds ${link(embed!.path, embed!.blockId!)}, ${found}`,
      });
  }
  const nodeIds = new Set(flowNodes(flow).map((n) => n.element.id));
  for (const e of flow.elements) {
    const d = identity(e);
    if (e.isDeleted || d?.role !== "note" || nodeIds.has(d.anchor ?? "")) continue;
    out.push({
      ...(d.node ? { frame: d.node } : {}),
      element: e.id,
      message: `note "${noteStart(e)}" is on a node that no longer exists`,
    });
  }
  // as refresh, which moves them, only on frames whose screen exists
  for (const { frame, image, screen } of states)
    for (const e of screen ? notesUnder(flow, image.id, rect(image), rect(image)).overlapping : [])
      if (!far.has(e.id))
        out.push({
          frame,
          element: e.id,
          message: `note "${noteStart(e)}" overlaps ${frame}; run "wiredown flow refresh" or move it`,
        });
  for (const o of liveOverlays(flow)) {
    const at = { frame: o.frame, element: o.element.id };
    const s = states.find((s) => s.image.id === o.anchor);
    if (!framed.has(o.anchor ?? ""))
      out.push({ ...at, message: `${overlayName(o)} is on a frame that no longer exists` });
    if (!s?.screen) continue;
    if (o.screen !== undefined && o.screen !== s.blockId)
      out.push({
        ...at,
        message: `${overlayName(o)} was drawn on ^${o.screen}, but ${s.frame} embeds ^${s.blockId}`,
      });
    const plan = placeOverlay(flow, o, s as typeof s & { screen: ScreenState }, refreshedImage(s));
    if (typeof plan === "string") out.push({ ...at, message: `${overlayName(o)}: ${plan}` });
    else if (!plan.every(placed))
      out.push({ ...at, message: `stale overlay: ${overlayName(o)} is not on #${o.target}` });
  }
  const bindings = bindingFailures(flow.elements);
  out.push(...bindings);
  const nodes = new Set(flowNodes(flow).map((n) => n.node));
  for (const a of flow.elements) {
    const d = identity(a);
    if (a.isDeleted || a.type !== "arrow" || d?.role !== "arrow" || !d.from || !d.to) continue;
    if (bindings.some((f) => f.element === a.id)) continue; // already reported as dangling
    for (const n of [d.from, d.to])
      if (!nodes.has(n))
        out.push({ element: a.id, message: `arrow ${d.from} -> ${d.to}: ${n} no longer exists` });
  }
  for (const r of arrowRoutes(flow)) {
    if (r.shaped || !r.missed.length || bindings.some((f) => f.element === r.arrow.id)) continue;
    out.push({
      frame: r.missed[0],
      element: r.arrow.id,
      message: `arrow ${r.start.node} -> ${r.end.node} no longer meets ${r.missed[0]}; run "wiredown flow refresh"`,
    });
  }
  const entries = new Set(flow.source.fileEntries.map((e) => e.fileId));
  for (const e of flow.elements) {
    const fileId = String(e.fileId);
    if (e.isDeleted || e.type !== "image") continue;
    if (flow.embeds.has(fileId) || entries.has(fileId) || fileId in flow.files) continue;
    out.push({
      ...(identity(e)?.frame ? { frame: identity(e)!.frame } : {}),
      element: e.id,
      message: `image ${e.id} has no ## Embedded Files entry for ${fileId}`,
    });
  }
  return out;
}

/**
 * Brings each frame whose screen exists up to date: its embed link size,
 * its image size (same top-left and width-based scale), the notes under it
 * (moved by the change in its bottom edge, or out from under it), and its
 * overlays. Then re-routes each two-point arrow of ours whose ends are not
 * where `connect` would put them now, in its slot, label included. An
 * overlay whose target or frame is gone, or a bent arrow on a frame that
 * was resized, is left in place and returned with `unresolved`. Nothing
 * else moves. Returns the changes; none means the flow is untouched.
 */
export function refreshFlow(flow: Flow, screens: ScreenLookup): FlowChange[] {
  // which node's overlays and notes to move would be a guess
  const [claim] = claimedNames(flow);
  if (claim) throw new Error(claim.message);
  const out: FlowChange[] = [];
  const overlays = liveOverlays(flow);
  const states = frameStates(flow, screens);
  const resized = new Set<string>();
  for (const s of states) {
    if (!s.screen) continue;
    const old = rect(s.image);
    if (s.stale) {
      const from = size(s.image);
      const link: Partial<Size> = {};
      if (s.embed.width !== undefined) link.width = s.embed.width;
      if (s.embed.height !== undefined) link.height = s.embed.height;
      flow.embeds.set(String(s.image.fileId), { ...s.embed, ...s.stale.link });
      Object.assign(s.image, s.stale.image);
      touch(s.image);
      resized.add(s.image.id);
      out.push({
        frame: s.frame,
        kind: "embed",
        element: s.image.id,
        link: { from: link, to: s.stale.link },
        image: { from, to: s.stale.image },
      });
    }
    const { notes, shift } = notesUnder(flow, s.image.id, old, rect(s.image));
    if (shift)
      for (const e of notes) {
        e.y = num(e.y) + shift;
        touch(e);
        out.push({ frame: s.frame, kind: "note", element: e.id });
      }
    for (const o of overlays.filter((o) => o.anchor === s.image.id)) {
      const change = overlayChange(o);
      const plan = placeOverlay(flow, o, s as typeof s & { screen: ScreenState }, s.image);
      if (typeof plan === "string") out.push({ ...change, unresolved: plan });
      else if (!plan.every(placed)) {
        for (const p of plan.filter((p) => !placed(p))) {
          Object.assign(p.element, { x: p.x, y: p.y, width: p.width, height: p.height });
          touch(p.element);
        }
        out.push(change);
      }
    }
  }
  for (const n of flowNodes(flow)) {
    // Keep the existing stack first, then append displaced notes in drawing order.
    const far = new Set(
      nodeAttachments(flow, n)
        .filter((p) => p.far)
        .map((p) => p.element.id),
    );
    const ordered = {
      ...flow,
      elements: [
        ...flow.elements.filter((e) => !far.has(e.id)),
        ...flow.elements.filter((e) => far.has(e.id)),
      ],
    };
    for (const e of ordered.elements.filter((e) => far.has(e.id))) {
      const p = nodeAttachments(ordered, n).find((p) => p.element === e && p.far);
      if (!p) continue;
      Object.assign(e, { x: p.x, y: p.y });
      touch(e);
      out.push({ frame: n.node, kind: identity(e)!.role as "label" | "note", element: e.id });
    }
    if (n.kind !== "frame") continue;
    const group = identity(n.element)!.group;
    if (!group) continue;
    const parts = flow.elements.filter((e) => {
      const d = identity(e);
      return (
        !e.isDeleted &&
        d &&
        (e === n.element ||
          d.anchor === n.element.id ||
          (!d.anchor && d.frame === n.node && d.role === "label" && !e.containerId))
      );
    });
    for (const e of parts) {
      const groups = (e.groupIds ?? []) as string[];
      if (groups.includes(group)) continue;
      e.groupIds = [group, ...groups];
      touch(e);
      out.push({ frame: n.node, kind: "group", element: e.id });
    }
  }
  for (const { arrow, start, end, geometry: g, shaped, missed } of arrowRoutes(flow)) {
    if (!missed.length) continue;
    const change = {
      frame: missed[0],
      kind: "arrow" as const,
      element: arrow.id,
      from: start.node,
      to: end.node,
    };
    if (shaped) {
      if (resized.has(start.element.id) || resized.has(end.element.id))
        out.push({ ...change, unresolved: "it was bent by hand; reconnect it by hand" });
      continue;
    }
    Object.assign(arrow, { x: g.x, y: g.y, width: g.width, height: g.height, points: g.points });
    arrow.startBinding = { ...(arrow.startBinding as object), fixedPoint: g.startFixedPoint };
    arrow.endBinding = { ...(arrow.endBinding as object), fixedPoint: g.endFixedPoint };
    touch(arrow);
    const pair = arrowsBetween(flow, start.element.id, end.element.id);
    positionArrowLabel(flow, arrow, pair.length > 1 ? 1 / 3 : 1 / 2);
    out.push(change);
  }
  const images = new Set(flowFrames(flow).map((f) => f.element.id));
  for (const o of overlays.filter((o) => !images.has(o.anchor ?? "")))
    out.push({ ...overlayChange(o), unresolved: `${o.frame} no longer exists` });
  return out;
}
