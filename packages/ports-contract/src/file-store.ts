import { expect } from "vite-plus/test";
import type { FileStore, Sha512Hex } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

export interface FileStoreHarness {
  readonly files: FileStore;
  /** A hash the store has never been given. */
  readonly absent: Sha512Hex;
}

const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const HASH_A = "a".repeat(128) as Sha512Hex;
const HASH_B = "b".repeat(128) as Sha512Hex;

export const fileStoreContract: readonly ContractCase<FileStoreHarness>[] = [
  {
    name: "returns the bytes it was given under their hash",
    run: async ({ files }) => {
      expectOk(await files.put(HASH_A, BYTES));
      expect(await files.has(HASH_A)).toBe(true);
      expect(Array.from(expectOk(await files.get(HASH_A)))).toEqual(Array.from(BYTES));
    },
  },
  {
    name: "answers a range inclusively",
    run: async ({ files }) => {
      expectOk(await files.put(HASH_B, BYTES));
      expect(Array.from(expectOk(await files.get(HASH_B, { start: 2, end: 4 })))).toEqual([
        2, 3, 4,
      ]);
      expect(Array.from(expectOk(await files.get(HASH_B, { start: 9, end: 9 })))).toEqual([9]);
    },
  },
  {
    name: "says when the same hash is stored again, and keeps one copy",
    run: async ({ files }) => {
      expect(expectOk(await files.put(HASH_A, BYTES)).duplicate).toBe(false);
      expect(expectOk(await files.put(HASH_A, BYTES)).duplicate).toBe(true);
      expect(Array.from(expectOk(await files.get(HASH_A)))).toEqual(Array.from(BYTES));
    },
  },
  {
    name: "reports the size of a held file and the bytes held in total",
    run: async ({ files, absent }) => {
      expect(await files.bytesHeld()).toBeGreaterThanOrEqual(0);
      const before = await files.bytesHeld();
      expectOk(await files.put(HASH_A, BYTES));
      expect(await files.sizeOf(HASH_A)).toBe(BYTES.length);
      expect(await files.sizeOf(absent)).toBeUndefined();
      expect((await files.bytesHeld()) - before).toBeGreaterThanOrEqual(BYTES.length);
    },
  },
  {
    name: "refuses a hash it does not hold",
    run: async ({ files, absent }) => {
      expect(await files.has(absent)).toBe(false);
      expectErr(await files.get(absent), "not_found");
    },
  },
  {
    name: "refuses a range outside the file",
    run: async ({ files }) => {
      expectOk(await files.put(HASH_B, BYTES));
      expectErr(await files.get(HASH_B, { start: 5, end: 50 }), "bad_range");
      expectErr(await files.get(HASH_B, { start: 7, end: 3 }), "bad_range");
    },
  },
];

/** Register the `FileStore` contract against an adapter. */
export function runFileStoreContract(
  factory: Factory<FileStoreHarness>,
  options?: ContractOptions,
): void {
  registerContract("FileStore contract", fileStoreContract, factory, options);
}
