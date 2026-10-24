import {
  MAX_CHOICE_OPTIONS,
  err,
  ok,
  type Answer,
  type Decide,
  type Decision,
  type DecisionRequest,
  type PortError,
  type Question,
  type Result,
} from "@shopong/ports";

/** Script an answer for a question; return undefined to fall back to the built-in heuristic. */
export type ScriptedAnswer = (question: Question, state: string) => Answer | undefined;

export interface MemoryDecideOptions {
  answer?: ScriptedAnswer;
  model?: string;
}

/**
 * In-memory `Decide`. Deterministic heuristic: a `choice` favours options whose label
 * appears in the state text; `score` answers the midpoint; `noul` answers no at 0.5.
 * Use `answer` to script specific decisions in scenarios.
 */
export class MemoryDecide implements Decide {
  readonly #answer: ScriptedAnswer | undefined;
  readonly #model: string;

  constructor(options: MemoryDecideOptions = {}) {
    this.#answer = options.answer;
    this.#model = options.model ?? "memory-decide/1";
  }

  async decide(request: DecisionRequest): Promise<Result<Decision, PortError<"invalid_request">>> {
    const invalid = validate(request.questions);
    if (invalid !== undefined) return err("invalid_request", invalid);
    const state = typeof request.state === "string" ? request.state : JSON.stringify(request.state);
    const answers = request.questions.map(
      (question) => this.#answer?.(question, state) ?? heuristic(question, state),
    );
    return ok({ model: this.#model, answers });
  }
}

function heuristic(question: Question, state: string): Answer {
  switch (question.kind) {
    case "choice": {
      const text = state.toLowerCase();
      const weights = question.options.map((option) =>
        text.includes(option.label.toLowerCase()) ? 4 : 1,
      );
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const probabilities = Object.fromEntries(
        question.options.map((option, i) => [option.id, (weights[i] ?? 1) / total]),
      );
      let best = 0;
      weights.forEach((weight, i) => {
        if (weight > (weights[best] ?? 0)) best = i;
      });
      const choice = question.options[best]?.id ?? "";
      return {
        kind: "choice",
        questionId: question.id,
        choice,
        probabilities,
        confidence: probabilities[choice] ?? 0,
      };
    }
    case "score":
      return {
        kind: "score",
        questionId: question.id,
        value: Math.floor((question.min + question.max) / 2),
        confidence: 0.5,
      };
    case "noul":
      return {
        kind: "noul",
        questionId: question.id,
        value: false,
        probability: 0.5,
        confidence: 0.5,
      };
  }
}

function validate(questions: readonly Question[]): string | undefined {
  if (questions.length === 0) return "at least one question";
  const ids = new Set<string>();
  for (const question of questions) {
    if (question.id === "" || ids.has(question.id))
      return `question ids must be unique and non-empty: ${question.id}`;
    ids.add(question.id);
    if (question.kind === "choice") {
      const count = question.options.length;
      if (count < 2 || count > MAX_CHOICE_OPTIONS)
        return `choice needs 2..${String(MAX_CHOICE_OPTIONS)} options`;
      if (new Set(question.options.map((option) => option.id)).size !== count)
        return "option ids must be unique";
    } else if (question.kind === "score") {
      if (
        !Number.isInteger(question.min) ||
        !Number.isInteger(question.max) ||
        question.min >= question.max
      ) {
        return "score needs integer min < max";
      }
    } else if (question.kind !== "noul") {
      return `unknown question kind ${String((question as { kind: unknown }).kind)}`;
    }
  }
  return undefined;
}
