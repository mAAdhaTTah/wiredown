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
const GAP = 340;
export function embedSize(screenWidth: number, screenHeight: number) {
  const width = screenWidth + 2 * MD_HOST_PAD,
    height = screenHeight + MD_FOOTER;
  return { link: { width, height: height + MAX_HEIGHT_HEADROOM }, image: { width, height } };
}
export interface AddScreenOptions {
  screenId: string;
  title: string;
  path: string;
  size: { width: number; height: number };
  place?: { rightOf: string } | { below: string };
}
/** A frame's label sits this far above its image. */
const LABEL_OFFSET = 48;

/** The version of `customData.wiredown` this code writes; objects without `v` are version 1. */
export const DATA_VERSION = 1;
/**
 * `customData.wiredown`. A frame's image also records `group`, the Excalidraw
 * group that holds the frame's parts.
 */
interface Identity {
  v?: number;
  id?: string;
  frame: string;
  role: string;
  screen: string;
  group?: string;
  /** The image element this label belongs to. */
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
    .map((e) => ({ frame: identity(e)!.frame, element: e }));
}
/** The live frame named `name`; two frames claiming one name are an error, not a guess. */
function findFrame(flow: Flow, name: string) {
  const frames = flowFrames(flow);
  const found = frames.filter((f) => f.frame === name);
  if (found.length > 1)
    throw new FlowError(
      `${name} is claimed by elements ${found.map((f) => f.element.id).join(" and ")}; delete the copy`,
    );
  if (!found.length)
    throw new FlowError(
      `unknown frame "${name}" (frames: ${frames.map((f) => f.frame).join(", ") || "none"})`,
    );
  return found[0].element;
}
const alphabet = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function random(n: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}
function id() {
  return Array.from({ length: 8 }, () => alphabet[random(62)]).join("");
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
/** Appends one frame; existing elements are never modified. Returns its F-number. */
export function addScreen(flow: Flow, options: AddScreenOptions): string {
  const size = embedSize(options.size.width, options.size.height);
  const frames = flowFrames(flow);
  const refId =
    options.place && ("rightOf" in options.place ? options.place.rightOf : options.place.below);
  const ref = refId
    ? findFrame(flow, refId)
    : frames.reduce<ExcalidrawElementJson | undefined>(
        (a, f) =>
          !a || Number(f.element.x) + Number(f.element.width) > Number(a.x) + Number(a.width)
            ? f.element
            : a,
        undefined,
      );
  const below = options.place && "below" in options.place;
  const live = flow.elements.filter((e) => !e.isDeleted);
  const bounds =
    !ref && live.length
      ? {
          right: Math.max(...live.map((e) => Number(e.x) + Number(e.width))),
          top: Math.min(...live.map((e) => Number(e.y))),
        }
      : undefined;
  const x = ref
    ? Number(ref.x) + (below ? 0 : Number(ref.width) + GAP)
    : bounds
      ? bounds.right + GAP
      : 0;
  const y = ref ? Number(ref.y) + (below ? Number(ref.height) + GAP : 0) : (bounds?.top ?? 0);
  // a person's copy keeps its name taken, so a new frame never shares it
  const numbers = flow.elements.flatMap((e) => {
    const a = /^F(\d+)$/.exec(dataOf(e)?.frame ?? "");
    const b = e.type === "text" ? /^F(\d+) ·/.exec(String(e.rawText ?? e.text)) : null;
    return [Number(a?.[1] ?? 0), Number(b?.[1] ?? 0)];
  });
  const frame = `F${Math.max(0, ...numbers) + 1}`;
  const last =
    flow.elements
      .map((e) => e.index)
      .filter((v): v is string => typeof v === "string")
      .sort()
      .at(-1) ?? null;
  const keys = generateNKeysBetween(last, null, 2);
  const data = { frame, screen: options.screenId };
  // One Excalidraw group holds a frame's parts (image, label, and later its
  // notes and overlays): clicking any part selects the whole frame, so it
  // moves together; double-clicking enters the group to select one element.
  const group = id();
  const text = `${frame} · ${options.title}`;
  const measured = fontMeasurer(EXCALIFONT).measure(text, {
    fontSize: 24,
    fontFamily: 5,
  });
  const label = {
    ...element(
      "text",
      x,
      y - LABEL_OFFSET,
      measured.w,
      measured.h,
      keys[0],
      { ...data, role: "label" },
      [group],
    ),
    text,
    rawText: text,
    originalText: text,
    fontSize: 24,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  };
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
