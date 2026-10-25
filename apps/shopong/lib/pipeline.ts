import { taskStatuses, type Build, type TaskStatus } from "./builder";

/** What happens between sending a request and the agent answering, one entry per Task shown. */
export const STAGES = [
  { id: "classify", title: "Classifying request" },
  { id: "initialize", title: "Initializing session" },
  { id: "agent", title: "Starting agent" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

/** How long each stage takes to show. */
export const STAGE_MS = 1000;

export type Stage = { id: StageId; title: string; status: TaskStatus; items: readonly string[] };

/** The lines under each stage, in plain words, from what the request turned out to need. */
export function stageItems(build: Pick<Build, "title" | "permission">): Record<StageId, string[]> {
  return {
    classify: [`You asked for: ${build.title}`, "This is something I can build"],
    initialize: ["Setting up a private workspace for it", `It can only ${build.permission}`],
    agent: ["The builder is ready", "It will check with you before anything involves money"],
  };
}

/** The stages `done` steps into the pipeline: finished ones, the running one, then the pending. */
export function pipelineStages(build: Pick<Build, "title" | "permission">, done: number): Stage[] {
  const items = stageItems(build);
  const statuses = taskStatuses(STAGES.length, done);
  return STAGES.map((stage, index) => ({
    ...stage,
    status: statuses[index]!,
    items: items[stage.id],
  }));
}

/** True once every stage has finished, so the agent can answer. */
export const pipelineDone = (done: number): boolean => done >= STAGES.length;
