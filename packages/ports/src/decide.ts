import type { JsonValue, PortError, Result } from "./common.js";

/** Most options a `choice` question may have; the model is weak beyond about 20 (architecture 4.2). */
export const MAX_CHOICE_OPTIONS = 20;

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
}

/** Pick one of 2 to `MAX_CHOICE_OPTIONS` options. */
export interface ChoiceQuestion {
  readonly kind: "choice";
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly ChoiceOption[];
}

/** An integer on a small ordinal scale from `min` to `max` inclusive. */
export interface ScoreQuestion {
  readonly kind: "score";
  readonly id: string;
  readonly prompt: string;
  readonly min: number;
  readonly max: number;
}

/** A yes/no question (Laya `noul`). */
export interface YesNoQuestion {
  readonly kind: "noul";
  readonly id: string;
  readonly prompt: string;
}

export type Question = ChoiceQuestion | ScoreQuestion | YesNoQuestion;

export interface ChoiceAnswer {
  readonly kind: "choice";
  readonly questionId: string;
  /** Id of the most probable option. */
  readonly choice: string;
  /** One probability per option id; they sum to 1. */
  readonly probabilities: { readonly [optionId: string]: number };
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly kind: "score";
  readonly questionId: string;
  readonly value: number;
  readonly confidence: number;
}

export interface YesNoAnswer {
  readonly kind: "noul";
  readonly questionId: string;
  readonly value: boolean;
  /** Probability of yes. */
  readonly probability: number;
  readonly confidence: number;
}

/** `confidence` is calibrated, in [0, 1]; gate on it, not on raw probabilities. */
export type Answer = ChoiceAnswer | ScoreAnswer | YesNoAnswer;

export interface DecisionRequest {
  /** The state to decide on: text, or JSON the adapter serialises. Never raw PII. */
  readonly state: string | JsonValue;
  /** One or more questions with unique ids. */
  readonly questions: readonly Question[];
}

export interface Decision {
  /** Model name and version, for audit and the override log. */
  readonly model: string;
  /** One answer per question, in the same order. */
  readonly answers: readonly Answer[];
}

/**
 * Fast, non-generative typed decisions with calibrated confidence (Laya via laya-serve).
 * Advisory only: it prepares a choice, people make it, and it never moves money (AD-7).
 * Owning epic: 6.
 */
export interface Decide {
  decide(request: DecisionRequest): Promise<Result<Decision, PortError<"invalid_request">>>;
}
