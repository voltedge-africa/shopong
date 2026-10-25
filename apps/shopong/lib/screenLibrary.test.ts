import { Renderer, useTriggerAction, type ActionEvent } from "@openuidev/react-lang";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { designBuild } from "./builder";
import { DEFINITIONS } from "./genui";
import { NOTHING_HAPPENED, previewNotice } from "./preview";
import { createScreenLibrary, type ScreenParts } from "./screenLibrary";

/** A press the page could make: the button's label and the way to press it. */
const buttons: { label: string; press: () => void | Promise<void> }[] = [];

/** The screen's parts as plain HTML, so the real OpenUI renderer can run under Node. */
const HTML_PARTS: ScreenParts = {
  Screen: ({ props, renderNode }) =>
    h("section", null, h("h1", null, props.title), renderNode(props.children)),
  Stack: ({ props, renderNode }) => h("div", null, renderNode(props.children)),
  Heading: ({ props }) => h("h2", null, props.text),
  Text: ({ props }) => h("p", { "data-muted": props.muted === true }, props.text),
  Metric: ({ props }) => h("p", null, `${props.label}: ${props.value}`),
  Progress: ({ props }) => h("progress", { value: props.value, "aria-label": props.label }),
  Pair: ({ props }) => h("p", null, `${props.label} = ${props.value}`),
  List: ({ props, renderNode }) => h("ul", null, renderNode(props.children)),
  ListItem: ({ props }) =>
    h(
      "li",
      { "data-tone": props.tone ?? "neutral" },
      [props.title, props.detail, props.tag].filter(Boolean).join(" | "),
    ),
  Field: ({ props }) =>
    h("input", { placeholder: props.placeholder, "aria-label": props.label ?? undefined }),
  Photo: ({ props }) => h("figure", null, props.label),
  Button: function Button({ props }) {
    const trigger = useTriggerAction();
    buttons.push({
      label: props.label,
      press: () => trigger(props.label, undefined, props.action ?? undefined),
    });
    return h("button", { "data-kind": props.kind ?? "primary" }, props.label);
  },
};

const LIBRARY = createScreenLibrary(HTML_PARTS);

const PROMPTS = [
  "I need a way to track who owes me and have a way of reminding them",
  "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
  "My driver needs a list of stops for the day and a way to prove each delivery",
  "I need a dashboard of my daily sales",
];

function draw(source: string, onAction?: (event: ActionEvent) => void): string {
  buttons.length = 0;
  return renderToStaticMarkup(
    h(Renderer, { response: source, library: LIBRARY, onAction }) as ReactNode as never,
  );
}

describe("the OpenUI renderer draws the pinned screens", () => {
  it("has a library with every part and every action", () => {
    expect(Object.keys(LIBRARY.components)).toEqual(
      DEFINITIONS.components.map((part) => part.name),
    );
    expect(Object.keys(LIBRARY.actions ?? {})).toEqual([...DEFINITIONS.toolOfAction.keys()]);
    expect(LIBRARY.root).toBe("Screen");
  });

  it("refuses a library that is missing the drawing for a part", () => {
    const { Photo: _left, ...rest } = HTML_PARTS;
    expect(() => createScreenLibrary(rest as ScreenParts)).toThrow("no component draws Photo");
  });

  it.each(PROMPTS)("draws every screen from its pinned text: %s", (prompt) => {
    for (const screen of designBuild(prompt).screens) {
      const markup = draw(screen.source);
      expect(markup, screen.title).toContain("<section>");
      expect(markup).toMatch(/<h1>[^<]+<\/h1>/);
    }
  });

  it("draws the text that was pinned, part by part", () => {
    const [pledges] = designBuild(PROMPTS[0]!).screens;
    const markup = draw(pledges!.source);
    expect(markup).toContain("Paid so far: R 3 360 of R 5 600");
    expect(markup).toContain('<progress value="60"');
    expect(markup).toContain('<li data-tone="attention">Lindiwe | R 840 | Owes</li>');
    expect(markup).toContain('<button data-kind="primary">Remind everyone who owes</button>');
  });

  it("is the same every time", () => {
    const [pledges] = designBuild(PROMPTS[0]!).screens;
    expect(draw(pledges!.source)).toBe(draw(pledges!.source));
  });
});

describe("buttons only preview", () => {
  it("turns a pressed action into a plain notice, never a name", async () => {
    const [pledges, remind] = designBuild(PROMPTS[0]!).screens;
    const events: ActionEvent[] = [];
    draw(pledges!.source, (event) => events.push(event));
    await buttons.find((button) => button.label === "Remind everyone who owes")!.press();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "MessageSend" });
    expect(previewNotice(events[0]!)).toBe(
      "In the finished app this sends the message. Nothing was sent.",
    );

    // A button with no action says nothing happened.
    draw(remind!.source, (event) => events.push(event));
    await buttons.find((button) => button.label === "Cancel")!.press();
    expect(previewNotice(events[1]!)).toBe(NOTHING_HAPPENED);
  });

  it("has a notice for each of the five actions, and none shows a name", () => {
    for (const name of DEFINITIONS.toolOfAction.keys()) {
      const notice = previewNotice({ type: name });
      expect(notice).not.toBe(NOTHING_HAPPENED);
      expect(notice).toMatch(/^In the finished app/);
      expect(notice).not.toMatch(/\b[A-Za-z]+\.[a-z]+\b|[a-z][A-Z]/);
    }
    expect(previewNotice({ type: "OpenUrl" })).toBe(NOTHING_HAPPENED);
  });
});

describe("drawing a screen never goes to the network", () => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
    .process.env;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete env["OPENUI_RUNTIME_TELEMETRY_ENABLED"];
  });

  it("makes no request of any kind, even with OpenUI's own telemetry opt-in switched on", async () => {
    const network = {
      fetch: vi.fn(() => Promise.reject(new Error("no network"))),
      XMLHttpRequest: vi.fn(),
      WebSocket: vi.fn(),
      EventSource: vi.fn(),
    };
    for (const [name, spy] of Object.entries(network)) vi.stubGlobal(name, spy);
    const sendBeacon = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon });
    env["OPENUI_RUNTIME_TELEMETRY_ENABLED"] = "1";
    vi.spyOn(Math, "random").mockReturnValue(0); // OpenUI samples one run in ten; count every one

    for (const prompt of PROMPTS) {
      for (const screen of designBuild(prompt).screens) {
        const events: ActionEvent[] = [];
        draw(screen.source, (event) => events.push(event));
        for (const button of buttons) await button.press();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    for (const [name, spy] of Object.entries(network)) expect(spy, name).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
