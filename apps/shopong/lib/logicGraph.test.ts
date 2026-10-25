import { describe, expect, it } from "vite-plus/test";

import { designBuild } from "./builder";
import {
  NODE_SIZE,
  anchor,
  DOT_GAP,
  NODE_SHARE,
  clampZoom,
  defaultZoom,
  dotGap,
  edgeGeometry,
  edgeSides,
  fitZoom,
  graphBounds,
  graphEdges,
  gridOffset,
  nodeRect,
} from "./logicGraph";

const PROMPTS = [
  "I need a way to track who owes me and have a way of reminding them",
  "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
  "My driver needs a list of stops for the day and a way to prove each delivery",
  "I need a dashboard of my daily sales",
];

const at = (col: number, row: number) => nodeRect({ col, row });

describe("edgeSides", () => {
  it.each([
    ["to the right", at(0, 0), at(1, 0), "right", "left"],
    ["up and to the right", at(0, 1), at(2, 0), "right", "left"],
    ["to the left on the same row", at(3, 0), at(1, 0), "left", "right"],
    ["back to a card on a lower row", at(3, 0), at(1, 2), "bottom", "top"],
    ["back to a card on a higher row", at(2, 3), at(1, 1), "top", "bottom"],
    ["straight below", at(1, 0), at(1, 2), "bottom", "top"],
    ["straight above", at(1, 2), at(1, 0), "top", "bottom"],
  ])("leaves and enters %s", (_name, from, to, fromSide, toSide) => {
    expect(edgeSides(from, to)).toEqual({ from: fromSide, to: toSide });
  });
});

describe("anchor", () => {
  it("is the middle of each side", () => {
    const rect = { x: 10, y: 20, width: 100, height: 40 };
    expect(anchor(rect, "left")).toEqual({ x: 10, y: 40 });
    expect(anchor(rect, "right")).toEqual({ x: 110, y: 40 });
    expect(anchor(rect, "top")).toEqual({ x: 60, y: 20 });
    expect(anchor(rect, "bottom")).toEqual({ x: 60, y: 60 });
  });
});

describe("edgeGeometry", () => {
  it("starts on the first card and ends at the second", () => {
    const from = at(0, 0);
    const to = at(1, 0);
    const geometry = edgeGeometry(from, to);
    const start = anchor(from, "right");
    const end = anchor(to, "left");
    expect(geometry.d.startsWith(`M${start.x},${start.y} C`)).toBe(true);
    // The curve stops one arrow length short; the arrow head's tip is the card's edge.
    expect(geometry.arrow.split(" ")[0]).toBe(`${end.x},${end.y}`);
  });

  it("puts the middle of a level edge halfway between the cards", () => {
    const from = at(0, 0);
    const to = at(2, 0);
    const { mid } = edgeGeometry(from, to);
    expect(mid.x).toBeCloseTo((anchor(from, "right").x + anchor(to, "left").x) / 2);
    expect(mid.y).toBeCloseTo(from.y + NODE_SIZE.height / 2);
  });

  it("points a downward edge's arrow down into the card", () => {
    const [tip, a, b] = edgeGeometry(at(1, 0), at(1, 2))
      .arrow.split(" ")
      .map((p) => p.split(",").map(Number));
    expect(a![1]).toBeLessThan(tip![1]!);
    expect(b![1]).toBeLessThan(tip![1]!);
  });
});

describe("graphEdges", () => {
  it.each(PROMPTS)("draws every edge of the build: %s", (prompt) => {
    const build = designBuild(prompt);
    const edges = graphEdges(build.nodes, build.edges);
    expect(edges).toHaveLength(build.edges.length);
    for (const edge of edges) {
      expect(edge.d).toMatch(/^M[\d.,-]+ C[\d.,\- ]+$/);
      expect(Number.isFinite(edge.mid.x) && Number.isFinite(edge.mid.y)).toBe(true);
    }
  });

  it("skips an edge to a card that is not there", () => {
    const build = designBuild(PROMPTS[0]!);
    expect(graphEdges(build.nodes, [{ from: "check", to: "nowhere" }])).toEqual([]);
  });
});

describe("graphBounds", () => {
  it.each(PROMPTS)("holds every card with room around it: %s", (prompt) => {
    const { nodes } = designBuild(prompt);
    const bounds = graphBounds(nodes);
    for (const node of nodes) {
      const rect = nodeRect(node);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height);
    }
  });

  it("is small enough to draw as one SVG on a phone", () => {
    // Android refuses a bitmap over 100 MB. At 3x density the whole canvas must stay far below it.
    const density = 3;
    for (const prompt of PROMPTS) {
      const { width, height } = graphBounds(designBuild(prompt).nodes);
      expect(width * density * height * density * 4).toBeLessThan(40_000_000);
    }
  });
});

describe("zoom", () => {
  const bounds = { width: 1000, height: 400 };

  it("fits the graph to the canvas without going past life size", () => {
    expect(fitZoom(bounds, { width: 400, height: 800 })).toBeCloseTo(0.4);
    expect(fitZoom(bounds, { width: 4000, height: 4000 })).toBe(1);
  });

  it("never goes below the minimum, and falls back to 1 before it is measured", () => {
    expect(fitZoom(bounds, { width: 100, height: 100 })).toBe(0.3);
    expect(fitZoom(bounds, { width: 0, height: 0 })).toBe(1);
  });

  it("keeps a zoom between its limits", () => {
    expect(clampZoom(0.1)).toBe(0.3);
    expect(clampZoom(5)).toBe(2);
    expect(clampZoom(1.25)).toBe(1.25);
  });
});

describe("defaultZoom", () => {
  const phone = { width: 412, height: 660 };
  const [pledges, , , custom] = PROMPTS.map((prompt) => designBuild(prompt));

  it("sets a node to its share of the width, so a long graph is read by scrolling", () => {
    const zoom = defaultZoom(graphBounds(pledges!.nodes), phone);
    expect(zoom).toBeCloseTo((phone.width * NODE_SHARE) / NODE_SIZE.width);
    expect(NODE_SIZE.width * zoom).toBeGreaterThan(phone.width * 0.4);
    // It does not shrink the graph to fit: that would be smaller than the node-sized zoom.
    expect(zoom).toBeGreaterThan(fitZoom(graphBounds(pledges!.nodes), phone));
  });

  it("keeps the text readable on every build, not only the widest", () => {
    for (const prompt of PROMPTS) {
      const { nodes } = designBuild(prompt);
      expect(defaultZoom(graphBounds(nodes), phone)).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("grows a small graph to fill a large canvas, up to the limit", () => {
    const wide = { width: 1400, height: 900 };
    const zoom = defaultZoom(graphBounds(custom!.nodes), wide);
    expect(zoom).toBe(1.5);
    expect(zoom).toBeGreaterThan(defaultZoom(graphBounds(custom!.nodes), phone) - 1e-9);
  });

  it("uses the whole graph's fit when that is bigger than the node-sized zoom", () => {
    const tiny = { width: 80, height: 60 };
    const bounds = { width: 100, height: 60 };
    // Node-sized zoom would be 0.2, the fit is 0.8: the larger wins.
    expect(defaultZoom(bounds, tiny, { min: 0 })).toBeCloseTo(0.8);
  });

  it("falls back to life size before the canvas is measured", () => {
    expect(defaultZoom({ width: 800, height: 400 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe("the dotted background", () => {
  it("spaces dots with the graph, but never crowds them", () => {
    expect(dotGap(1)).toBe(DOT_GAP);
    expect(dotGap(1.5)).toBe(DOT_GAP * 1.5);
    expect(dotGap(0.3)).toBe(10);
  });

  it("moves with the graph: scrolling by one gap lands the dots where they were", () => {
    const gap = 24;
    expect(gridOffset(400, 1000, 0, gap)).toBe(0);
    expect(gridOffset(400, 1000, 10, gap)).toBe(14);
    expect(gridOffset(400, 1000, 10 + gap, gap)).toBe(gridOffset(400, 1000, 10, gap));
  });

  it("starts the dots where a centred graph starts", () => {
    // 100 spare pixels: the graph starts 50 in, which is 2 dots (48) and 2 pixels.
    expect(gridOffset(500, 400, 0, 24)).toBe(2);
  });

  it("never gives an offset outside one gap, including when scrolled past", () => {
    for (const scroll of [0, 1, 23, 24, 25, 500, 1234.5]) {
      const offset = gridOffset(412, 846, scroll, 24);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(24);
    }
  });
});
