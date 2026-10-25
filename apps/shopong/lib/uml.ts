/**
 * A UML sequence diagram as SVG, drawn from data. The builder's answers show how a build talks to
 * the capabilities as a diagram, never as code.
 */

export type SequenceMessage = {
  from: number;
  to: number;
  label: string;
  /** A return is a dashed line with an open arrow head; a call is solid with a filled one. */
  kind: "call" | "return";
};

export type SequenceDiagram = {
  /** Lifelines, left to right. */
  participants: readonly string[];
  messages: readonly SequenceMessage[];
};

export type UmlTheme = "light" | "dark";

const COLORS = {
  light: { ink: "#262626", line: "#737373", fill: "#fafafa", background: "#ffffff" },
  dark: { ink: "#fafafa", line: "#a3a3a3", fill: "#262626", background: "#171717" },
} as const;

const COLUMN = 120;
const ROW = 46;
const HEAD = { height: 34, top: 8 } as const;
const MARGIN = 8;
const FONT = 12;

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Width of the canvas and the x of the middle of each lifeline. */
export function sequenceLayout(diagram: SequenceDiagram): {
  width: number;
  height: number;
  centres: number[];
} {
  const centres = diagram.participants.map((_, index) => MARGIN + COLUMN / 2 + index * COLUMN);
  return {
    width: MARGIN * 2 + COLUMN * diagram.participants.length,
    height: HEAD.top + HEAD.height + ROW * (diagram.messages.length + 1) + MARGIN,
    centres,
  };
}

/** `diagram` as an SVG string with explicit width and height, ready for `SvgXml`. */
export function sequenceSvg(diagram: SequenceDiagram, theme: UmlTheme = "light"): string {
  const color = COLORS[theme];
  const { width, height, centres } = sequenceLayout(diagram);
  const lifelineTop = HEAD.top + HEAD.height;
  const out: string[] = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="${FONT}">`,
    `<rect width="${width}" height="${height}" fill="${color.background}"/>`,
    `<defs>`,
    `<marker id="call" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${color.ink}"/></marker>`,
    `<marker id="return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke="${color.ink}" stroke-width="1.4"/></marker>`,
    `</defs>`,
  );

  diagram.participants.forEach((name, index) => {
    const centre = centres[index]!;
    const boxWidth = COLUMN - 28;
    out.push(
      `<line x1="${centre}" y1="${lifelineTop}" x2="${centre}" y2="${height - MARGIN / 2}" stroke="${color.line}" stroke-width="1" stroke-dasharray="4 4"/>`,
      `<rect x="${centre - boxWidth / 2}" y="${HEAD.top}" width="${boxWidth}" height="${HEAD.height}" rx="4" fill="${color.fill}" stroke="${color.ink}" stroke-width="1.2"/>`,
      `<text x="${centre}" y="${HEAD.top + HEAD.height / 2 + 4}" text-anchor="middle" fill="${color.ink}" font-weight="600">${escape(name)}</text>`,
    );
  });

  diagram.messages.forEach((message, index) => {
    const y = lifelineTop + ROW * (index + 1);
    const from = centres[message.from]!;
    const to = centres[message.to]!;
    const dashed = message.kind === "return" ? ' stroke-dasharray="6 4"' : "";
    // The line stops short of the lifeline so the arrow head sits on it.
    const direction = to >= from ? 1 : -1;
    out.push(
      `<line x1="${from}" y1="${y}" x2="${to - direction * 1}" y2="${y}" stroke="${color.ink}" stroke-width="1.4"${dashed} marker-end="url(#${message.kind})"/>`,
      `<text x="${(from + to) / 2}" y="${y - 7}" text-anchor="middle" fill="${color.ink}">${escape(message.label)}</text>`,
    );
  });

  out.push("</svg>");
  return out.join("");
}
