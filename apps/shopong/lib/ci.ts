import type { Build } from "./builder";

/**
 * The run that turns a build into something you can publish: put it together, test it, package it.
 * It is the same shape as a deployment pipeline, in plain words, but it stops at the package: the
 * app is never deployed, you publish the file it makes.
 */

export type CiStage = "Build" | "Test" | "Package";

export const CI_STAGES: readonly CiStage[] = ["Build", "Test", "Package"];

export type CiStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export type CiStep = {
  id: string;
  stage: CiStage;
  title: string;
  /** What it did, in plain words: shown under the step once it has run. */
  log: readonly string[];
  /** How long it took, in milliseconds. Fixed for a step, so a run always looks the same. */
  ms: number;
  /** How the step is scripted to end. */
  outcome: "pass" | "fail";
  /** Why it failed, in plain words. */
  problem?: string;
  /** This step is another go at the step before it. */
  retry?: boolean;
};

export type CiStepRun = CiStep & { status: CiStatus };

export type Artifact = { name: string; version: string; size: string; file: string };

/** A stable number from a text, so each step always takes the same time. */
function spread(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

const step = (
  id: string,
  stage: CiStage,
  title: string,
  log: string[],
  extra: Partial<CiStep> = {},
): CiStep => ({
  id,
  stage,
  title,
  log,
  ms: Math.round(300 + spread(id) * 1900),
  outcome: "pass",
  ...extra,
});

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Every step of the run for a build, in order. */
export function ciPlan(build: Build): CiStep[] {
  const screens = build.screens.map((screen) => screen.title);
  const buttons = build.screens.length;
  const issue = build.knownIssue;

  const steps: CiStep[] = [
    step("build-screens", "Build", "Put the screens together", [
      `${screens.length} ${screens.length === 1 ? "screen" : "screens"}: ${screens.join(", ")}`,
    ]),
    step("build-buttons", "Build", "Connect the buttons", [
      `The buttons on ${buttons === 1 ? "the screen" : "each screen"} are connected to what they do`,
    ]),
    ...build.changes.map((change, index) =>
      step(`build-change-${index + 1}`, "Build", `Add: ${change}`, ["Added to the build"]),
    ),
    step("build-access", "Build", "Check what it may do", [`It can only ${build.permission}`]),
  ];

  for (const screen of build.screens) {
    const failsOnce = issue !== undefined && issue.screen === screen.title;
    if (failsOnce) {
      steps.push(
        step(
          `test-${slug(screen.title)}`,
          "Test",
          `Try the ${screen.title} screen`,
          ["Opened the screen", "Pressed each button"],
          {
            outcome: "fail",
            problem: issue.problem,
          },
        ),
        step(
          `test-${slug(screen.title)}-again`,
          "Test",
          `Try the ${screen.title} screen again`,
          [issue.fix, "Opened the screen", "Pressed each button"],
          {
            retry: true,
          },
        ),
      );
    } else {
      steps.push(
        step(`test-${slug(screen.title)}`, "Test", `Try the ${screen.title} screen`, [
          "Opened the screen",
          "Pressed each button",
        ]),
      );
    }
  }

  steps.push(
    build.needsApproval
      ? step("test-money", "Test", "Check money waits for your OK", [
          "Nothing moves until you approve it",
        ])
      : step("test-money", "Test", "Check no money can move", ["It never moves money"]),
    ...build.changes.map((change, index) =>
      step(`test-change-${index + 1}`, "Test", `Try: ${change}`, ["Works as asked"]),
    ),
    step("package-bundle", "Package", "Pack the app", ["Everything is packed into one file"]),
    step("package-phone", "Package", "Check it opens on a phone", [
      "Opens quickly",
      "Fits the screen",
    ]),
    step("package-file", "Package", "Make the app file", [artifactOf(build).file]),
  );
  return steps;
}

/** The file a finished run makes. It is published, never deployed. */
export function artifactOf(build: Pick<Build, "title" | "screens" | "changes">): Artifact {
  const version = `1.${build.changes.length}`;
  const kilobytes = 900 + build.screens.length * 260 + build.changes.length * 40;
  return {
    name: build.title,
    version,
    size: `${(kilobytes / 1000).toFixed(1)} MB`,
    file: `${slug(build.title)}-${version}.shopong`,
  };
}

export type CiRun = {
  steps: CiStepRun[];
  state: "running" | "passed" | "failed";
  /** Steps that have finished. */
  finished: number;
  passed: number;
  failed: number;
  /** Failures that a later step put right. */
  fixed: number;
  /** Time taken by the steps that have run, in milliseconds. */
  ms: number;
};

/** A failed step is put right when the very next step is another go at it and that passes. */
const isFixed = (plan: readonly CiStep[], index: number): boolean =>
  plan[index + 1]?.retry === true && plan[index + 1]?.outcome === "pass";

/**
 * The run `done` steps in. Steps before it have their scripted outcome, the next one is running and
 * the rest wait. A failure nothing puts right stops the run: the steps after it are skipped.
 */
export function ciRun(plan: readonly CiStep[], done: number): CiRun {
  let stoppedAt = -1;
  const steps: CiStepRun[] = plan.map((entry, index) => {
    if (stoppedAt !== -1 && index > stoppedAt) return { ...entry, status: "skipped" };
    if (index < done) {
      const status: CiStatus = entry.outcome === "pass" ? "passed" : "failed";
      if (status === "failed" && !isFixed(plan, index)) stoppedAt = index;
      return { ...entry, status };
    }
    return { ...entry, status: index === done ? "running" : "pending" };
  });

  const finished = steps.filter(
    (entry) => entry.status === "passed" || entry.status === "failed",
  ).length;
  const failed = steps.filter((entry) => entry.status === "failed").length;
  const fixed = steps.filter(
    (entry, index) => entry.status === "failed" && isFixed(plan, index),
  ).length;
  const unfixed = failed - fixed;
  const over = done >= plan.length || stoppedAt !== -1;

  return {
    steps,
    state: unfixed > 0 ? "failed" : over ? "passed" : "running",
    finished,
    passed: steps.filter((entry) => entry.status === "passed").length,
    failed,
    fixed,
    ms: steps
      .filter((entry) => entry.status === "passed" || entry.status === "failed")
      .reduce((sum, entry) => sum + entry.ms, 0),
  };
}

/** "0.8 s", "12 s". */
export const duration = (ms: number): string =>
  ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

/** True once the run has passed and there is an app to publish. */
export const canPublish = (run: CiRun): boolean => run.state === "passed";
