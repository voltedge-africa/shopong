import { expect } from "vite-plus/test";
import type { ChoiceOption, Decide, Question } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

const inUnit = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 1;

const quotes: ChoiceOption[] = [
  { id: "q1", label: "Bulk Foods: R4,500, delivers Thursday" },
  { id: "q2", label: "Metro Cash: R4,650, delivers Tuesday" },
  { id: "q3", label: "Spar Wholesale: R4,400, collect only" },
];

const questions: Question[] = [
  {
    kind: "choice",
    id: "supplier",
    prompt: "Which quote best fits a stokvel that needs delivery?",
    options: quotes,
  },
  { kind: "score", id: "urgency", prompt: "How urgent is this order?", min: 1, max: 5 },
  { kind: "noul", id: "unusual", prompt: "Is this payment unusual for this community?" },
];

const options = (n: number): ChoiceOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `o${String(i)}`, label: `Option ${String(i)}` }));

export const decideContract: readonly ContractCase<Decide>[] = [
  {
    name: "answers every question in order with calibrated, well-formed values",
    run: async (decide) => {
      const decision = expectOk(
        await decide.decide({
          state: "Order of 40 bags of maize meal for 12 members, delivery needed by Friday.",
          questions,
        }),
      );
      expect(decision.model).not.toBe("");
      expect(decision.answers.map((a) => [a.kind, a.questionId])).toEqual([
        ["choice", "supplier"],
        ["score", "urgency"],
        ["noul", "unusual"],
      ]);
      for (const answer of decision.answers) {
        expect(inUnit(answer.confidence)).toBe(true);
        if (answer.kind === "choice") {
          expect(Object.keys(answer.probabilities).sort()).toEqual(["q1", "q2", "q3"]);
          const probabilities = Object.values(answer.probabilities);
          expect(probabilities.every(inUnit)).toBe(true);
          expect(probabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 6);
          expect(answer.probabilities[answer.choice]).toBe(Math.max(...probabilities));
        } else if (answer.kind === "score") {
          expect(Number.isInteger(answer.value) && answer.value >= 1 && answer.value <= 5).toBe(
            true,
          );
        } else {
          expect(inUnit(answer.probability)).toBe(true);
          expect(answer.value ? answer.probability >= 0.5 : answer.probability <= 0.5).toBe(true);
        }
      }
    },
  },
  {
    name: "accepts JSON state",
    run: async (decide) => {
      const decision = expectOk(
        await decide.decide({
          state: { amountZar: 150, usualAmountZar: 150, member: "m-7f3a" },
          questions: [questions[2] as Question],
        }),
      );
      expect(decision.answers).toHaveLength(1);
    },
  },
  {
    name: "refuses malformed question sets",
    run: async (decide) => {
      const state = "anything";
      const bad: Question[][] = [
        [],
        [questions[2] as Question, questions[2] as Question],
        [{ kind: "choice", id: "one", prompt: "Only one?", options: options(1) }],
        [{ kind: "choice", id: "many", prompt: "Too many?", options: options(21) }],
        [
          {
            kind: "choice",
            id: "dupe",
            prompt: "Dupes?",
            options: [...options(2), { id: "o0", label: "again" }],
          },
        ],
        [{ kind: "score", id: "flat", prompt: "Flat?", min: 3, max: 3 }],
      ];
      for (const set of bad)
        expectErr(await decide.decide({ state, questions: set }), "invalid_request");
    },
  },
  {
    name: "accepts the maximum number of options",
    run: async (decide) => {
      expectOk(
        await decide.decide({
          state: "x",
          questions: [{ kind: "choice", id: "max", prompt: "Which?", options: options(20) }],
        }),
      );
    },
  },
];

/** Register the `Decide` contract against an adapter. */
export function runDecideContract(factory: Factory<Decide>, options?: ContractOptions): void {
  registerContract("Decide contract", decideContract, factory, options);
}
