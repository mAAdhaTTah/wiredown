import type { Place } from "./flow-edit.js";
import {
  claimedNames,
  findNode,
  flowNodes,
  identity,
  nodeParts,
  placeNode,
  touch,
} from "./flow-edit.js";
import { arrowRoutes, bentArrow, intersects, rect, reroute, unmet } from "./flow-refresh.js";
import type { FlowChange } from "./flow-refresh.js";
import type { Flow } from "./flow.js";

/** Where `moveNode` puts a node: next to another node, as add-screen places, or at a top-left. */
export type MoveTo = Place | { x: number; y: number };
/** What `moveNode` did. */
export interface Moved {
  unchanged?: boolean;
  node: string;
  kind: "frame" | "decision";
  /** The node's new top-left. */
  x: number;
  y: number;
  /** Its notes and overlays, moved with it, and our straight arrows re-routed. */
  notes: number;
  overlays: number;
  arrows: number;
  /** Arrows of ours a person bent that no longer meet a node, left as they are. */
  unresolved: Extract<FlowChange, { kind: "arrow" }>[];
}

/**
 * Moves node `name` and what of ours belongs to it (`nodeParts`: its label,
 * notes, overlays and their bound text) by one delta, then re-routes our
 * straight arrows bound to it as refresh does. A person's arrows, copies
 * and hand-drawn elements stay, even in the node's group. Refuses, with
 * nothing changed, a name two nodes claim and a place that overlaps
 * another node.
 */
export function moveNode(flow: Flow, name: string, to: MoveTo): Moved {
  const [claim] = claimedNames(flow);
  if (claim) throw new Error(claim.message);
  const n = findNode(flow, name);
  const e = n.element;
  const box = rect(e);
  const ref = "rightOf" in to ? to.rightOf : "below" in to ? to.below : undefined;
  if (ref === name) throw new Error(`cannot place ${name} relative to itself`);
  const at = "x" in to ? to : placeNode(flow, to, box.width, box.height, n.kind === "decision");
  const where = `${at.x},${at.y}`;
  const now = { ...box, x: at.x, y: at.y };
  const hit = flowNodes(flow).filter((o) => o.element !== e && intersects(rect(o.element), now));
  if (hit.length && (at.x !== box.x || at.y !== box.y))
    throw new Error(
      `${name} at ${where} would overlap ${hit.map((o) => o.node).join(" and ")}; pick another place`,
    );
  const [dx, dy] = [at.x - box.x, at.y - box.y];
  const parts = nodeParts(flow, n);
  if (dx || dy)
    for (const p of [e, ...parts]) {
      Object.assign(p, { x: Number(p.x) + dx, y: Number(p.y) + dy });
      touch(p);
    }
  const routes = arrowRoutes(flow).filter(
    (r) => r.missed.length && (r.start.element === e || r.end.element === e),
  );
  const straight = routes.filter((r) => !r.shaped);
  for (const r of straight) reroute(flow, r);
  const count = (...roles: string[]) =>
    parts.filter((p) => !p.containerId && roles.includes(identity(p)!.role)).length;
  return {
    ...(!dx && !dy && !straight.length ? { unchanged: true } : {}),
    node: n.node,
    kind: n.kind,
    x: at.x,
    y: at.y,
    notes: count("note"),
    overlays: count("highlight", "mark"),
    arrows: straight.length,
    unresolved: routes
      .filter((r) => r.shaped)
      .flatMap((r) => {
        const [off] = unmet(r);
        if (!off) return [];
        const { arrow, start, end } = r;
        const change = { frame: off, kind: "arrow" as const, element: arrow.id };
        return [{ ...change, from: start.node, to: end.node, unresolved: bentArrow(off) }];
      }),
  };
}
