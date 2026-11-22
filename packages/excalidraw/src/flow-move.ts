import { FlowError } from "./flow";
import type { Flow } from "./flow";
import type { Place } from "./flow-edit";
import {
  claimedNames,
  findNode,
  flowNodes,
  identity,
  nodeParts,
  placeNode,
  touch,
} from "./flow-edit";
import {
  arrowRoutes,
  bentArrow,
  footprint,
  intersects,
  rect,
  reroute,
  unmet,
} from "./flow-refresh";
import type { FlowChange, Route } from "./flow-refresh";

/** Where `moveNode` puts a node: next to another node, as add-screen places, or at a top-left. */
export type MoveTo = Place | { x: number; y: number };
type ArrowChange = Extract<FlowChange, { kind: "arrow" }>;
/** What `moveNode` did. */
export interface Moved {
  /** Set when the node was already there and no arrow needed re-routing. */
  unchanged?: true;
  node: string;
  kind: "frame" | "decision";
  /** The node's element, its new top-left and its size. */
  element: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Every element moved, the node's first; empty when it did not move. */
  elements: string[];
  /** Its notes and overlays, moved with it, and our straight arrows re-routed. */
  notes: number;
  overlays: number;
  arrows: number;
  /** Our straight arrows re-routed, as `refreshFlow` reports them. */
  changes: ArrowChange[];
  /** Arrows of ours a person bent that no longer meet a node, left as they are. */
  unresolved: ArrowChange[];
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
  if (claim) throw new FlowError(claim.message);
  const n = findNode(flow, name);
  const e = n.element;
  const box = rect(e);
  const ref = "rightOf" in to ? to.rightOf : "below" in to ? to.below : undefined;
  if (ref === name) throw new FlowError(`cannot place ${name} relative to itself`);
  const at = "x" in to ? to : placeNode(flow, to, box.width, box.height, n.kind === "decision");
  const where = `${at.x},${at.y}`;
  // its footprint where it would be, against every other node's footprint
  const [dx, dy] = [at.x - box.x, at.y - box.y];
  const mine = footprint(flow, n).map((p) => ({
    ...rect(p),
    x: rect(p).x + dx,
    y: rect(p).y + dy,
  }));
  const hit = flowNodes(flow).filter(
    (o) =>
      o.element !== e && footprint(flow, o).some((p) => mine.some((m) => intersects(rect(p), m))),
  );
  if (hit.length && (dx || dy))
    throw new FlowError(
      `${name} at ${where} would overlap ${hit.map((o) => o.node).join(" and ")}; pick another place`,
    );
  const moving = dx || dy ? [e, ...nodeParts(flow, n)] : [];
  const parts = moving.slice(1);
  for (const p of moving) {
    Object.assign(p, { x: Number(p.x) + dx, y: Number(p.y) + dy });
    touch(p);
  }
  const routes = arrowRoutes(flow).filter(
    (r) => r.missed.length && (r.start.element === e || r.end.element === e),
  );
  const straight = routes.filter((r) => !r.shaped);
  for (const r of straight) reroute(flow, r);
  const arrowChange = ({ arrow, start, end }: Route, frame: string) => ({
    frame,
    kind: "arrow" as const,
    element: arrow.id,
    from: start.node,
    to: end.node,
  });
  const count = (...roles: string[]) =>
    parts.filter((p) => !p.containerId && roles.includes(identity(p)!.role)).length;
  return {
    ...(!dx && !dy && !straight.length ? { unchanged: true as const } : {}),
    node: n.node,
    kind: n.kind,
    element: e.id,
    ...rect(e),
    elements: moving.map((p) => p.id),
    notes: count("note"),
    overlays: count("highlight", "mark"),
    arrows: straight.length,
    changes: straight.map((r) => ({ ...arrowChange(r, r.missed[0]), ...rect(r.arrow) })),
    unresolved: routes
      .filter((r) => r.shaped)
      .flatMap((r) => {
        const [off] = unmet(r);
        if (!off) return [];
        return [{ ...arrowChange(r, off), unresolved: bentArrow(off), ...rect(r.arrow) }];
      }),
  };
}
