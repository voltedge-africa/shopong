import { nodePosition, type LogicEdge, type LogicNode } from "./builder";

/** Size of a node card, in canvas pixels. Cards are this size exactly, so edges can meet them. */
export const NODE_SIZE = { width: 168, height: 84 } as const;

export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type Side = "left" | "right" | "top" | "bottom";

export const nodeRect = (node: Pick<LogicNode, "col" | "row">): Rect => ({
  ...nodePosition(node),
  ...NODE_SIZE,
});

/** Where an edge meets a card: the middle of one of its sides. */
export function anchor(rect: Rect, side: Side): Point {
  switch (side) {
    case "left":
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case "right":
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case "top":
      return { x: rect.x + rect.width / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  }
}

/** Which sides an edge leaves and enters by, judged from where the two cards sit. */
export function edgeSides(from: Rect, to: Rect): { from: Side; to: Side } {
  if (to.x >= from.x + from.width) return { from: "right", to: "left" };
  const vertical = to.y >= from.y ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
  // A loop back to a card on another row goes round by the top or bottom. Leaving by the left would
  // land on the right side of the target, which is where that card's own forward edges leave.
  if (to.x + to.width <= from.x && to.y === from.y) return { from: "left", to: "right" };
  return vertical as { from: Side; to: Side };
}

const horizontal = (side: Side) => side === "left" || side === "right";
const outward = (side: Side): Point =>
  side === "right"
    ? { x: 1, y: 0 }
    : side === "left"
      ? { x: -1, y: 0 }
      : side === "bottom"
        ? { x: 0, y: 1 }
        : { x: 0, y: -1 };

export type EdgeGeometry = {
  /** An SVG path: a cubic curve from the first card to the second. */
  d: string;
  /** The arrow head's three points, at the end of the curve. */
  arrow: string;
  /** The middle of the curve, where a label sits. */
  mid: Point;
};

const ARROW = { length: 9, half: 5 } as const;

/** The curve between two cards, its arrow head and its middle. */
export function edgeGeometry(from: Rect, to: Rect): EdgeGeometry {
  const sides = edgeSides(from, to);
  const start = anchor(from, sides.from);
  const end = anchor(to, sides.to);

  // Control points pull straight out of each card, so the curve leaves and arrives square on.
  const reach = Math.max(
    40,
    (horizontal(sides.from) ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) / 2,
  );
  const out = outward(sides.from);
  const into = outward(sides.to);
  const c1 = { x: start.x + out.x * reach, y: start.y + out.y * reach };
  const c2 = { x: end.x + into.x * reach, y: end.y + into.y * reach };

  // The arrow head sits on the end point and points into the card: against `into`.
  const back = { x: end.x + into.x * ARROW.length, y: end.y + into.y * ARROW.length };
  const across = { x: -into.y, y: into.x };
  const wing = (sign: 1 | -1) => ({
    x: back.x + across.x * ARROW.half * sign,
    y: back.y + across.y * ARROW.half * sign,
  });
  const a = wing(1);
  const b = wing(-1);

  const at = (t: number, p0: number, p1: number, p2: number, p3: number) =>
    (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

  const round = (n: number) => Math.round(n * 10) / 10;
  const pt = (p: Point) => `${round(p.x)},${round(p.y)}`;
  return {
    d: `M${pt(start)} C${pt(c1)} ${pt(c2)} ${pt(back)}`,
    arrow: `${pt(end)} ${pt(a)} ${pt(b)}`,
    mid: { x: at(0.5, start.x, c1.x, c2.x, end.x), y: at(0.5, start.y, c1.y, c2.y, end.y) },
  };
}

export const graphEdges = (
  nodes: readonly LogicNode[],
  edges: readonly LogicEdge[],
): (LogicEdge & EdgeGeometry)[] => {
  const rects = new Map(nodes.map((node) => [node.id, nodeRect(node)]));
  return edges.flatMap((edge) => {
    const from = rects.get(edge.from);
    const to = rects.get(edge.to);
    return from && to ? [{ ...edge, ...edgeGeometry(from, to) }] : [];
  });
};

/** The canvas the graph needs: the far corner of the farthest card, plus `padding`. */
export function graphBounds(
  nodes: readonly Pick<LogicNode, "col" | "row">[],
  padding = 24,
): { width: number; height: number } {
  const rects = nodes.map(nodeRect);
  return {
    width: Math.max(0, ...rects.map((rect) => rect.x + rect.width)) + padding,
    height: Math.max(0, ...rects.map((rect) => rect.y + rect.height)) + padding,
  };
}

/** The zoom that fits the graph in a canvas, never bigger than life and never below `min`. */
export function fitZoom(
  bounds: { width: number; height: number },
  size: { width: number; height: number },
  { min = 0.3, max = 1 } = {},
): number {
  if (bounds.width <= 0 || bounds.height <= 0 || size.width <= 0 || size.height <= 0) return 1;
  return Math.min(
    Math.max(Math.min(size.width / bounds.width, size.height / bounds.height), min),
    max,
  );
}

export const clampZoom = (zoom: number, min = 0.3, max = 2): number =>
  Math.min(Math.max(zoom, min), max);

/** How much of the canvas width one node takes at the default zoom, so its text can be read. */
export const NODE_SHARE = 0.42;

/**
 * The zoom the canvas opens at. It is set by the size of a node, not by the size of the graph: a
 * node takes about `NODE_SHARE` of the width, so a long graph is read by scrolling instead of being
 * shrunk until its text is too small. A graph small enough to fit at that size grows to fill the
 * canvas instead of sitting in the middle of it.
 */
export function defaultZoom(
  bounds: { width: number; height: number },
  size: { width: number; height: number },
  { min = 0.6, max = 1.5 } = {},
): number {
  if (size.width <= 0 || size.height <= 0) return 1;
  const forNode = (size.width * NODE_SHARE) / NODE_SIZE.width;
  const forWholeGraph = fitZoom(bounds, size, { min: 0, max });
  return Math.min(Math.max(forNode, forWholeGraph, min), max);
}

/** Canvas pixels between two dots of the background. */
export const DOT_GAP = 24;

/** The space between dots on screen: it scales with the graph but never gets crowded. */
export const dotGap = (scale: number, base = DOT_GAP, min = 10): number =>
  Math.max(base * scale, min);

/**
 * Where the first dot is along one axis, so the dots move with the graph when it scrolls. The graph
 * starts at `lead` from the edge: half the spare room when it is smaller than the canvas (it is
 * centred) and nothing once it is larger. Scrolling moves it back by `scroll`.
 */
export function gridOffset(
  container: number,
  content: number,
  scroll: number,
  gap: number,
): number {
  const lead = Math.max(0, (container - content) / 2) - scroll;
  return ((lead % gap) + gap) % gap;
}
