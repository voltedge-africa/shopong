import { expect } from "vite-plus/test";
import type { Commitments } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

export interface CommitmentsHarness {
  readonly commitments: Commitments;
  /** Communities the adapter holds a 32-byte secret for: `a` and `b` have different secrets. */
  readonly a: string;
  readonly b: string;
  /** A community whose secret is under 32 bytes. */
  readonly short: string;
  /** A community the adapter holds no secret for. */
  readonly unknown: string;
}

const HEX_128 = /^[0-9a-f]{128}$/;

export const commitmentsContract: readonly ContractCase<CommitmentsHarness>[] = [
  {
    name: "gives the same commitment for a phone number however it is spelled",
    run: async ({ commitments, a }) => {
      const spellings = ["082 123 4567", "+27 (0)82 123 4567", "0027821234567", "0821234567"];
      const values = (
        await Promise.all(spellings.map((s) => commitments.commit(a, "phone", s)))
      ).map((result) => expectOk(result));
      expect(values[0]).toMatch(HEX_128);
      for (const value of values) expect(value).toBe(values[0]);
    },
  },
  {
    name: "gives the same commitment for an ID number however it is spaced",
    run: async ({ commitments, a }) => {
      const first = expectOk(await commitments.commit(a, "id-number", "8001015009087"));
      expect(first).toMatch(HEX_128);
      expect(expectOk(await commitments.commit(a, "id-number", "800101 5009 087"))).toBe(first);
    },
  },
  {
    name: "gives a different commitment under another community's secret",
    run: async ({ commitments, a, b }) => {
      const inA = expectOk(await commitments.commit(a, "phone", "082 123 4567"));
      const inB = expectOk(await commitments.commit(b, "phone", "082 123 4567"));
      expect(inB).not.toBe(inA);
      const idA = expectOk(await commitments.commit(a, "id-number", "8001015009087"));
      const idB = expectOk(await commitments.commit(b, "id-number", "8001015009087"));
      expect(idB).not.toBe(idA);
    },
  },
  {
    name: "is stable: the same value and community give the same commitment on every call",
    run: async ({ commitments, a }) => {
      const first = expectOk(await commitments.commit(a, "phone", "+27 82 123 4567"));
      expect(expectOk(await commitments.commit(a, "phone", "+27 82 123 4567"))).toBe(first);
    },
  },
  {
    name: "refuses an ID number with a bad check digit, with the plain reason",
    run: async ({ commitments, a }) => {
      const error = expectErr(
        await commitments.commit(a, "id-number", "8001015009088"),
        "not_recognised",
      );
      expect(error.message).toBe("That doesn't look like an ID number.");
    },
  },
  {
    name: "refuses a phone number that is not one, with the plain reason",
    run: async ({ commitments, a }) => {
      const error = expectErr(
        await commitments.commit(a, "phone", "not a number"),
        "not_recognised",
      );
      expect(error.message).toBe("That doesn't look like a phone number.");
    },
  },
  {
    name: "refuses a community the adapter holds no secret for",
    run: async ({ commitments, unknown }) => {
      expectErr(await commitments.commit(unknown, "phone", "082 123 4567"), "unknown_community");
    },
  },
  {
    name: "refuses a community whose secret is under 32 bytes, with the plain reason",
    run: async ({ commitments, short }) => {
      const error = expectErr(
        await commitments.commit(short, "phone", "082 123 4567"),
        "secret_too_short",
      );
      expect(error.message).toBe("This community's secret is too short.");
    },
  },
];

/** Register the `Commitments` contract against an adapter. */
export function runCommitmentsContract(
  factory: Factory<CommitmentsHarness>,
  options?: ContractOptions,
): void {
  registerContract("Commitments contract", commitmentsContract, factory, options);
}
