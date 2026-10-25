import { describe, expect, it } from "vite-plus/test";

import { designBuild } from "./builder";
import { classifyRequest } from "./classify";
import { PROMPT_IDEAS, nextIdea } from "./promptIdeas";

describe("PROMPT_IDEAS", () => {
  it("are all things the app will build, not refuse", () => {
    for (const idea of PROMPT_IDEAS) expect(classifyRequest(idea)).toEqual({ ok: true });
  });

  it("are written the way a person would say it, in their own words", () => {
    for (const idea of PROMPT_IDEAS) {
      expect(idea).toMatch(/\b(I|my|me|our|help me)\b/i);
      expect(idea).not.toMatch(/^(for example|e\.g\.)/i);
    }
  });

  it("are all different, and each one leads to a build", () => {
    expect(new Set(PROMPT_IDEAS).size).toBe(PROMPT_IDEAS.length);
    const titles = PROMPT_IDEAS.map((idea) => designBuild(idea).title);
    expect(titles).toEqual([
      "Pledge tracker",
      "Reorder list",
      "Run sheet",
      "Pledge tracker",
      "Reorder list",
      "A simple dashboard of my daily sales",
    ]);
  });

  it("show a range of what can be built, not one thing", () => {
    expect(
      new Set(PROMPT_IDEAS.map((idea) => designBuild(idea).title)).size,
    ).toBeGreaterThanOrEqual(4);
  });
});

describe("nextIdea", () => {
  it("steps on and wraps round to the first", () => {
    expect(nextIdea(0)).toBe(1);
    expect(nextIdea(PROMPT_IDEAS.length - 1)).toBe(0);
  });
});
