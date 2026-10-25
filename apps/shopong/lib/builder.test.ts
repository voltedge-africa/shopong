import { describe, expect, it } from "vite-plus/test";

import type { UiNode } from "@shopong/ports";

import { validateScreen } from "./genui";
import { loadPinnedScreen, pinScreen } from "./pinnedScreen";
import {
  type BuildScreen,
  SEQUENCE_SRC,
  designBuild,
  nodePosition,
  refineBuild,
  revealWords,
  taskStatuses,
  titleFor,
  wordCount,
} from "./builder";

const PROMPTS = [
  "I need a way to track who owes me and have a way of reminding them",
  "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
  "My driver needs a list of stops for the day and a way to prove each delivery",
  "I need a dashboard of my daily sales",
];

describe("designBuild", () => {
  it("picks a build from what was described", () => {
    expect(PROMPTS.map((prompt) => designBuild(prompt).title)).toEqual([
      "Pledge tracker",
      "Reorder list",
      "Run sheet",
      "A dashboard of my daily sales",
    ]);
  });

  it("gives the same build for the same prompt", () => {
    expect(designBuild(PROMPTS[0]!)).toEqual(designBuild(PROMPTS[0]!));
  });

  it.each(PROMPTS)("is internally consistent: %s", (prompt) => {
    const build = designBuild(prompt);
    const ids = build.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const edge of build.edges) {
      expect(ids).toContain(edge.from);
      expect(ids).toContain(edge.to);
    }
    expect(new Set(build.nodes.map((node) => `${node.col},${node.row}`)).size).toBe(ids.length);
    expect(new Set(build.screens.map((screen) => screen.id)).size).toBe(build.screens.length);
    expect(build.screens.length).toBeGreaterThan(0);
    expect(build.changes).toEqual([]);
    expect(build.reply).toContain("Preview only");
  });

  it.each(PROMPTS)("makes screens the screen library accepts: %s", async (prompt) => {
    for (const screen of designBuild(prompt).screens) {
      const result = await validateScreen(screen.source);
      expect(result.ok, `${screen.title}: ${result.ok ? "" : result.error.message}`).toBe(true);
    }
  });

  it("keeps a quote in the request from breaking the generic screen", async () => {
    const build = designBuild('Build a "special" dashboard');
    expect((await validateScreen(build.screens[0]!.source)).ok).toBe(true);
    expect(build.screens[0]!.title).toContain('"special"');
  });
});

/** The text a screen shows: every title, label and line in it. Action names on buttons are not shown. */
function wordsOf(node: UiNode): string[] {
  const own = Object.entries(node.props)
    .filter(([name, value]) => typeof value === "string" && !["kind", "tone"].includes(name))
    .map(([, value]) => value as string);
  return [...own, ...node.children.flatMap(wordsOf)];
}

/** What a screen shows, read the way the app reads it: the pinned text, checked by the screen library. */
async function screenWords(screen: BuildScreen): Promise<string[]> {
  const result = await loadPinnedScreen(screen);
  if (!result.ok) throw new Error(`${screen.title}: ${result.error.message}`);
  return wordsOf(result.value.root);
}

/** Everything a person can read on a build: the answer, the steps, the screens and the diagram. */
async function visibleText(prompt: string): Promise<string> {
  const build = designBuild(prompt);
  const screens = await Promise.all(build.screens.map(screenWords));
  return [
    build.title,
    build.reply,
    ...build.nodes.map((node) => node.label),
    ...build.edges.flatMap((edge) => (edge.label ? [edge.label] : [])),
    ...build.screens.map((screen) => screen.title),
    ...build.screens.flatMap((screen, index) => [screen.title, ...screens[index]!]),
    ...build.sequence.participants,
    ...build.sequence.messages.map((message) => message.label),
  ].join("\n");
}

describe("the builder's answer is for people who are not technical", () => {
  it.each(PROMPTS)(
    "says what it builds, how it works, what it can do and what you will see: %s",
    (prompt) => {
      const { reply } = designBuild(prompt);
      for (const heading of ["### How it works", "### What it can do", "### What you will see"])
        expect(reply).toContain(heading);
    },
  );

  it.each(PROMPTS)(
    "starts from what the person needs and ends by offering a change: %s",
    (prompt) => {
      const lines = designBuild(prompt).reply.split("\n\n");
      // Title, then the need in their terms, then the plan; the offer comes just before the preview note.
      expect(lines[0]).toMatch(/^## /);
      expect(lines[1]).toMatch(/^(You want|Here is)/);
      expect(lines.at(-2)).toMatch(/^(Would you like|Tell me)/);
      expect(lines.at(-1)).toContain("Preview only");
    },
  );

  it.each(PROMPTS)("uses no technical words anywhere a person can read: %s", async (prompt) => {
    const text = await visibleText(prompt);
    // Tool names such as members.list, and the words behind them.
    expect(text).not.toMatch(/\b[a-z]+\.[a-z]+\b/);
    expect(text).not.toMatch(
      /\b(capabilit\w*|authority|session|sandbox\w*|token|api|mcp|runtime|deny|denied|ledger|query|json|schema|needs-confirmation|bind\w*|endpoint)\b/i,
    );
  });

  it("reads the words out of a screen, so a technical word on one would be caught", async () => {
    const screen = pinScreen({
      id: "x",
      title: "x",
      source: `root = Screen("Members", [note])\nnote = Text("Run members.list for the ledger")`,
    });
    const words = (await screenWords(screen)).join("\n");
    expect(words).toContain("members.list");
    expect(words).toMatch(/\b[a-z]+\.[a-z]+\b/);
    expect(words).toMatch(/\bledger\b/i);
  });

  it.each(PROMPTS)("never shows code, only a UML diagram: %s", (prompt) => {
    const { reply } = designBuild(prompt);
    expect(reply).not.toContain("```");
    expect(reply).not.toContain("`");
    expect(reply).toContain(`](${SEQUENCE_SRC})`);
  });

  it("does not show code or jargon in a follow-up either", () => {
    const { reply } = refineBuild(designBuild(PROMPTS[0]!), "also text them on Fridays");
    expect(reply).not.toContain("`");
    expect(reply).not.toMatch(/\b(authority|capabilit\w*|session)\b/i);
  });

  it.each(PROMPTS)("has a sequence diagram of how it works: %s", (prompt) => {
    const { sequence } = designBuild(prompt);
    expect(sequence.participants).toEqual(["You", "Builder", "Your records"]);
    expect(sequence.messages[0]).toMatchObject({ from: 0, to: 1, label: "You ask" });
    expect(sequence.messages.at(-1)).toMatchObject({ from: 1, to: 0, label: "Done" });
    for (const message of sequence.messages) {
      expect(message.from).toBeLessThan(sequence.participants.length);
      expect(message.to).toBeLessThan(sequence.participants.length);
    }
  });

  it("makes you approve anything that moves money, and only then", () => {
    const labels = (prompt: string) =>
      designBuild(prompt).sequence.messages.map((message) => message.label);
    expect(labels(PROMPTS[1]!)).toEqual(
      expect.arrayContaining(["Waits for your OK", "You approve"]),
    );
    expect(labels(PROMPTS[0]!)).not.toContain("You approve");
  });

  it("says plainly when money needs your OK, and when it never moves", () => {
    expect(designBuild(PROMPTS[1]!).reply).toContain(
      "Anything that moves money waits for your OK.",
    );
    expect(designBuild(PROMPTS[0]!).reply).toContain(
      "It never moves money, so nothing needs your OK.",
    );
  });

  it("says what the build may do in a phrase", () => {
    expect(designBuild(PROMPTS[0]!).permission).toBe(
      "look at your records and send messages for you",
    );
    expect(designBuild(PROMPTS[1]!).permission).toBe(
      "look at your records and prepare orders for you to approve",
    );
  });

  it("does not chat: no greeting and no filler", () => {
    for (const prompt of PROMPTS)
      expect(designBuild(prompt).reply).not.toMatch(/\b(hi|hello|sure|happy to|great question)\b/i);
  });
});

describe("refineBuild", () => {
  it("adds one change and leaves the rest alone", () => {
    const build = designBuild(PROMPTS[0]!);
    const refined = refineBuild(build, "also text them on Fridays");
    expect(refined.build.changes).toEqual(["Also text them on Fridays"]);
    expect(build.changes).toEqual([]);
    expect(refined.build.screens).toEqual(build.screens);
    expect(refined.reply).toContain("Also text them on Fridays");
    expect(refined.reply).toContain("nothing new needs your OK");
  });
});

describe("titleFor", () => {
  it.each([
    ["  show me who owes this month. ", "Show me who owes this month"],
    ["I need a way to track who owes me", "Track who owes me"],
    ["I want to know who has not paid", "Know who has not paid"],
    ["Can you help me plan my deliveries?", "Plan my deliveries"],
    ["please help me to reorder stock", "Reorder stock"],
    ["a b c d e f g h", "A b c d e f g"],
    ["   ", "Untitled"],
  ])("turns %j into %j", (prompt, title) => {
    expect(titleFor(prompt)).toBe(title);
  });
});

describe("nodePosition", () => {
  it("places grid cells apart", () => {
    const a = nodePosition({ col: 0, row: 0 });
    const b = nodePosition({ col: 1, row: 1 });
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe("revealWords", () => {
  const text = "one two  three\nfour";

  it.each([
    [0, ""],
    [1, "one"],
    [2, "one two"],
    [3, "one two  three"],
    [4, text],
    [99, text],
  ])("shows %d words", (count, expected) => {
    expect(revealWords(text, count)).toBe(expected);
  });

  it("never drops a word already shown when the count goes up", () => {
    const total = wordCount(text);
    for (let count = 1; count < total; count++) {
      expect(revealWords(text, count + 1).startsWith(revealWords(text, count))).toBe(true);
    }
  });
});

describe("taskStatuses", () => {
  it.each([
    [0, ["running", "pending", "pending"]],
    [1, ["complete", "running", "pending"]],
    [2, ["complete", "complete", "running"]],
    [3, ["complete", "complete", "complete"]],
    [9, ["complete", "complete", "complete"]],
  ])("at tick %d", (tick, expected) => {
    expect(taskStatuses(3, tick)).toEqual(expected);
  });
});
