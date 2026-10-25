import { describe, expect, it } from "vite-plus/test";

import { sequenceLayout, sequenceSvg, type SequenceDiagram } from "./uml";

const diagram: SequenceDiagram = {
  participants: ["You", "Agent", "Capabilities"],
  messages: [
    { from: 0, to: 1, label: "Request", kind: "call" },
    { from: 1, to: 2, label: "pledges.query: space & month", kind: "call" },
    { from: 2, to: 1, label: "pledges", kind: "return" },
    { from: 1, to: 0, label: "Result", kind: "return" },
  ],
};

describe("sequenceSvg", () => {
  it("is an SVG with explicit dimensions", () => {
    const { width, height } = sequenceLayout(diagram);
    const svg = sequenceSvg(diagram);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("draws every participant and every message label", () => {
    const svg = sequenceSvg(diagram);
    for (const name of diagram.participants) expect(svg).toContain(`>${name}</text>`);
    for (const message of diagram.messages)
      expect(svg).toContain(message.label.replace("&", "&amp;"));
  });

  it("escapes text so a label cannot break the markup", () => {
    const svg = sequenceSvg({
      participants: ["A", "B"],
      messages: [{ from: 0, to: 1, label: '<b>"x"</b> & y', kind: "call" }],
    });
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y");
  });

  it("draws calls solid and returns dashed", () => {
    const svg = sequenceSvg(diagram);
    expect(svg.match(/marker-end="url\(#call\)"/g)).toHaveLength(2);
    expect(svg.match(/marker-end="url\(#return\)"/g)).toHaveLength(2);
    const returns = svg.split("<line").filter((line) => line.includes("#return"));
    for (const line of returns) expect(line).toContain("stroke-dasharray");
    const calls = svg.split("<line").filter((line) => line.includes("#call"));
    for (const line of calls) expect(line).not.toContain("stroke-dasharray");
  });

  it("themes the colours", () => {
    expect(sequenceSvg(diagram, "light")).toContain("#ffffff");
    expect(sequenceSvg(diagram, "dark")).toContain("#171717");
    expect(sequenceSvg(diagram, "dark")).not.toContain("#ffffff");
  });
});

describe("sequenceLayout", () => {
  it("puts lifelines in order, spaced by column", () => {
    const { centres } = sequenceLayout(diagram);
    expect(centres).toHaveLength(3);
    expect(centres[1]! - centres[0]!).toBe(centres[2]! - centres[1]!);
  });

  it("stays small enough to draw as one SVG on a phone", () => {
    // Android refuses a bitmap over 100 MB; this must stay far below it at 3x density.
    const { width, height } = sequenceLayout({
      participants: ["a", "b", "c"],
      messages: Array.from({ length: 12 }, () => ({
        from: 0,
        to: 2,
        label: "x",
        kind: "call" as const,
      })),
    });
    expect(width * 3 * height * 3 * 4).toBeLessThan(40_000_000);
  });
});
