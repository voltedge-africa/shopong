import { describe, expect, it } from "vite-plus/test";

import { designBuild, refineBuild } from "./builder";
import { CI_STAGES, artifactOf, canPublish, ciPlan, ciRun, duration, type CiStep } from "./ci";

const PROMPTS = [
  "I need a way to track who owes me and have a way of reminding them",
  "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
  "My driver needs a list of stops for the day and a way to prove each delivery",
  "I need a dashboard of my daily sales",
];
const [pledges, reorder, run] = PROMPTS.map(designBuild) as [
  ReturnType<typeof designBuild>,
  ReturnType<typeof designBuild>,
  ReturnType<typeof designBuild>,
];

const sample = (
  id: string,
  outcome: "pass" | "fail" = "pass",
  extra: Partial<CiStep> = {},
): CiStep => ({
  id,
  stage: "Test",
  title: id,
  log: [],
  ms: 1000,
  outcome,
  ...extra,
});

describe("ciPlan", () => {
  it.each(PROMPTS)("builds, tests and packages, in that order: %s", (prompt) => {
    const plan = ciPlan(designBuild(prompt));
    const stages = plan.map((entry) => entry.stage);
    for (const stage of CI_STAGES) expect(stages).toContain(stage);
    const order = [...new Set(stages)];
    expect(order).toEqual(CI_STAGES.filter((stage) => order.includes(stage)));
    expect(new Set(plan.map((entry) => entry.id)).size).toBe(plan.length);
    expect(plan.at(-1)?.title).toBe("Make the app file");
  });

  it("tries every screen of the build", () => {
    const titles = ciPlan(pledges).map((entry) => entry.title);
    for (const screen of pledges.screens)
      expect(titles).toContain(`Try the ${screen.title} screen`);
  });

  it("says plainly whether money can move", () => {
    expect(ciPlan(pledges).some((entry) => entry.title === "Check no money can move")).toBe(true);
    expect(ciPlan(reorder).some((entry) => entry.title === "Check money waits for your OK")).toBe(
      true,
    );
  });

  it("builds and tests each change a person asked for", () => {
    const changed = refineBuild(
      refineBuild(pledges, "also text them on Fridays").build,
      "add a column for the date paid",
    ).build;
    const titles = ciPlan(changed).map((entry) => entry.title);
    expect(titles).toContain("Add: Also text them on Fridays");
    expect(titles).toContain("Try: Add a column for the date paid");
    expect(ciPlan(changed).length).toBe(ciPlan(pledges).length + 4);
  });

  it("is the same every time", () => {
    expect(ciPlan(run)).toEqual(ciPlan(run));
    for (const entry of ciPlan(run)) expect(entry.ms).toBeGreaterThanOrEqual(300);
  });

  it("uses no technical words", () => {
    const text = PROMPTS.flatMap((prompt) =>
      ciPlan(designBuild(prompt)).flatMap((entry) => [
        entry.title,
        ...entry.log,
        entry.problem ?? "",
      ]),
    ).join("\n");
    expect(text).not.toMatch(/\b[a-z]+\.[a-z]+\b(?!\.shopong)/);
    expect(text).not.toMatch(
      /\b(compile|webpack|metro|bundler|lint|unit test|ci|cd|pipeline|deploy\w*|npm|sandbox|api|json)\b/i,
    );
  });
});

describe("a failure the run puts right", () => {
  const plan = ciPlan(run);

  it("shows the failure, then the fix, then carries on", () => {
    const failing = plan.findIndex((entry) => entry.outcome === "fail");
    expect(plan[failing]?.problem).toBe(
      "The Confirm button let a delivery through without a photo.",
    );
    expect(plan[failing + 1]).toMatchObject({
      retry: true,
      outcome: "pass",
      title: "Try the Confirm screen again",
    });
    expect(plan[failing + 1]?.log[0]).toBe("Confirming now asks for the photo first.");
  });

  it("flags it while the run goes on, and still passes at the end", () => {
    const failing = plan.findIndex((entry) => entry.outcome === "fail");
    const midway = ciRun(plan, failing + 1);
    expect(midway.steps[failing]?.status).toBe("failed");
    expect(midway.state).toBe("running");
    expect(midway.failed).toBe(1);

    const end = ciRun(plan, plan.length);
    expect(end.state).toBe("passed");
    expect(end.failed).toBe(1);
    expect(end.fixed).toBe(1);
    expect(end.steps.at(-1)?.status).toBe("passed");
    expect(canPublish(end)).toBe(true);
  });
});

describe("a failure nothing puts right", () => {
  const plan = [sample("a"), sample("b", "fail", { problem: "Broke." }), sample("c"), sample("d")];

  it("stops the run, skips the rest and cannot be installed", () => {
    const end = ciRun(plan, plan.length);
    expect(end.steps.map((entry) => entry.status)).toEqual([
      "passed",
      "failed",
      "skipped",
      "skipped",
    ]);
    expect(end.state).toBe("failed");
    expect(end.fixed).toBe(0);
    expect(canPublish(end)).toBe(false);
  });

  it("is already failed the moment the step fails, not at the end", () => {
    const now = ciRun(plan, 2);
    expect(now.state).toBe("failed");
    expect(now.steps.map((entry) => entry.status)).toEqual([
      "passed",
      "failed",
      "skipped",
      "skipped",
    ]);
  });

  it("does not count a retry that fails as fixed", () => {
    const again = [
      sample("a", "fail", { problem: "x" }),
      sample("a2", "fail", { retry: true, problem: "still x" }),
    ];
    expect(ciRun(again, 2).state).toBe("failed");
  });
});

describe("ciRun", () => {
  const plan = ciPlan(pledges);

  it("starts with the first step running and the rest waiting", () => {
    const start = ciRun(plan, 0);
    expect(start.state).toBe("running");
    expect(start.steps.map((entry) => entry.status)).toEqual([
      "running",
      ...plan.slice(1).map(() => "pending"),
    ]);
    expect(start.finished).toBe(0);
    expect(canPublish(start)).toBe(false);
  });

  it("moves one step at a time and counts time only for what has run", () => {
    const three = ciRun(plan, 3);
    expect(three.finished).toBe(3);
    expect(three.steps[3]?.status).toBe("running");
    expect(three.ms).toBe(plan.slice(0, 3).reduce((sum, entry) => sum + entry.ms, 0));
  });

  it("passes only after every step has", () => {
    expect(ciRun(plan, plan.length - 1).state).toBe("running");
    const end = ciRun(plan, plan.length);
    expect(end).toMatchObject({ state: "passed", passed: plan.length, failed: 0, fixed: 0 });
    expect(canPublish(end)).toBe(true);
  });
});

describe("the app file", () => {
  it("is named for the build, with its version and size", () => {
    expect(artifactOf(pledges)).toEqual({
      name: "Pledge tracker",
      version: "1.0",
      size: "1.4 MB",
      file: "pledge-tracker-1.0.shopong",
    });
  });

  it("gets a new version for each change", () => {
    const changed = refineBuild(pledges, "also text them on Fridays").build;
    expect(artifactOf(changed).version).toBe("1.1");
    expect(artifactOf(changed).file).toBe("pledge-tracker-1.1.shopong");
  });
});

describe("duration", () => {
  it.each([
    [300, "0.3 s"],
    [1234, "1.2 s"],
    [9999, "10.0 s"],
    [12_400, "12 s"],
  ])("writes %d ms as %s", (ms, text) => {
    expect(duration(ms)).toBe(text);
  });
});
