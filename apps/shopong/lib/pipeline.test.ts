import { describe, expect, it } from "vite-plus/test";

import { designBuild } from "./builder";
import { STAGES, pipelineDone, pipelineStages, stageItems } from "./pipeline";

const build = designBuild("I need a way to track who owes me and have a way of reminding them");

describe("the pipeline", () => {
  it("runs classifying, initializing, starting agent in that order", () => {
    expect(STAGES.map((stage) => stage.title)).toEqual([
      "Classifying request",
      "Initializing session",
      "Starting agent",
    ]);
  });

  it.each([
    [0, ["running", "pending", "pending"]],
    [1, ["complete", "running", "pending"]],
    [2, ["complete", "complete", "running"]],
    [3, ["complete", "complete", "complete"]],
  ])("is %d steps in", (done, statuses) => {
    expect(pipelineStages(build, done).map((stage) => stage.status)).toEqual(statuses);
  });

  it("is done only after the last stage", () => {
    expect([0, 1, 2, 3, 4].map(pipelineDone)).toEqual([false, false, false, true, true]);
  });

  it("describes each stage in plain words", () => {
    const items = stageItems(build);
    expect(items.classify.join("\n")).toContain("Pledge tracker");
    expect(items.initialize.join("\n")).toContain(
      "It can only look at your records and send messages for you",
    );
    expect(items.agent.join("\n")).toContain("check with you before anything involves money");
    const text = Object.values(items).flat().join("\n");
    expect(text).not.toMatch(/\b[a-z]+\.[a-z]+\b/);
    expect(text).not.toMatch(
      /\b(capabilit\w*|authority|sandbox\w*|deny\w*|runtime|tools?|bash|opencode)\b/i,
    );
  });
});
