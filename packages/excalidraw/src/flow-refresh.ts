// flow lint and flow refresh: compare a flow with the current layout of the
// screens it embeds. Both are pure; the caller supplies the screens.
import type { Box } from "@wiredown/core";
import type { ExcalidrawElementJson } from "./elements.js";
import type { EmbedLink, Flow } from "./flow.js";
import {
  centredOn,
  embedSize,
  flowFrames,
  flowNodes,
  highlightBounds,
  identity,
  overlayBox,
  touch,
} from "./flow-edit.js";

/** A screen as it renders now: its export size and the box of each `#id`. */
export interface ScreenState {
  width: number;
  height: number;
  boxes: Record<string, Box>;
}
/** The current state of a screen by block id; undefined if missing or invalid. */
export type ScreenLookup = (blockId: string) => ScreenState | undefined;

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
    };

/** Overlays and frames within this many drawing px of their place are current. */
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
  /** Set when the embed link or image aspect no longer matches the screen. */
  stale?: { link: Size; image: Size };
}

/** Each live frame with an embed entry, and how it compares with its screen now. */
function frameStates(flow: Flow, screens: ScreenLookup): FrameState[] {
  return flowFrames(flow).flatMap(({ frame, element: image }) => {
    const embed = flow.embeds.get(String(image.fileId));
    if (!embed) return []; // reported as an image without an entry
    const blockId = embed.blockId ?? identity(image)!.screen ?? "";
    const screen = blockId ? screens(blockId) : undefined;
    const state: FrameState = { frame, image, embed, blockId, screen };
    if (!screen) return [state];
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
}
function liveOverlays(flow: Flow): Overlay[] {
  return flow.elements.flatMap((element) => {
    const d = identity(element);
    if (element.isDeleted || !d?.frame || !d.target) return [];
    if (!(d.role === "highlight" || d.role === "mark")) return [];
    return [{ element, role: d.role, frame: d.frame, target: d.target, label: d.label }];
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
  // a mark keeps its size; it and its bound text centre on the anchor
  const texts = flow.elements.filter((e) => !e.isDeleted && e.containerId === o.element.id);
  return [o.element, ...texts].map((e) => ({
    element: e,
    ...centredOn(b.x, b.y, num(e.width), num(e.height)),
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
const overlayName = (o: Overlay) =>
  o.role === "mark" ? `mark ${o.label} #${o.target}` : `highlight #${o.target}`;

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
 * missing or whose embed size or aspect is stale, overlays that are stale or
 * lost their target or frame, dangling arrows, and images without an
 * `## Embedded Files` entry. Never reports style or hand-drawn elements that work.
 */
export function lintFlow(flow: Flow, screens: ScreenLookup): FlowFinding[] {
  const out: FlowFinding[] = [];
  const states = frameStates(flow, screens);
  const frames = new Set(flowFrames(flow).map((f) => f.frame));
  for (const s of states) {
    const at = { frame: s.frame, element: s.image.id };
    if (!s.screen)
      out.push({
        ...at,
        message: `embeds ^${s.blockId}, which is not in the screens file or has errors`,
      });
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
  for (const o of liveOverlays(flow)) {
    const at = { frame: o.frame, element: o.element.id };
    const s = states.find((s) => s.frame === o.frame);
    if (!frames.has(o.frame))
      out.push({ ...at, message: `${overlayName(o)} is on a frame that no longer exists` });
    if (!s?.screen) continue;
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
 * its image size (same top-left and width-based scale), and its overlays.
 * An overlay whose target or frame is gone is left in place and returned
 * with `unresolved`. Nothing else moves. Returns the changes; none means the
 * flow is untouched.
 */
export function refreshFlow(flow: Flow, screens: ScreenLookup): FlowChange[] {
  const out: FlowChange[] = [];
  const overlays = liveOverlays(flow);
  const states = frameStates(flow, screens);
  for (const s of states) {
    if (!s.screen) continue;
    if (s.stale) {
      const from = size(s.image);
      const link: Partial<Size> = {};
      if (s.embed.width !== undefined) link.width = s.embed.width;
      if (s.embed.height !== undefined) link.height = s.embed.height;
      flow.embeds.set(String(s.image.fileId), { ...s.embed, ...s.stale.link });
      Object.assign(s.image, s.stale.image);
      touch(s.image);
      out.push({
        frame: s.frame,
        kind: "embed",
        element: s.image.id,
        link: { from: link, to: s.stale.link },
        image: { from, to: s.stale.image },
      });
    }
    // a pasted copy of a frame keeps its name; overlays follow the first, as in lint
    if (states.find((t) => t.frame === s.frame) !== s) continue;
    for (const o of overlays.filter((o) => o.frame === s.frame)) {
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
  const frames = new Set(flowFrames(flow).map((f) => f.frame));
  for (const o of overlays.filter((o) => !frames.has(o.frame)))
    out.push({ ...overlayChange(o), unresolved: `${o.frame} no longer exists` });
  return out;
}
