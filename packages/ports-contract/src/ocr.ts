import { expect } from "vite-plus/test";
import type { DocumentRef, Ocr, Sha512Hex } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

export interface OcrHarness {
  readonly ocr: Ocr;
  /** A readable fixture document the adapter can fetch. */
  readonly document: DocumentRef;
  /** Text that must appear in some block of `document`, for example a product name. */
  readonly expectedText: string;
  /** A well-formed reference to bytes that do not exist. */
  readonly missing: DocumentRef;
}

const inUnit = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 1;

export const ocrContract: readonly ContractCase<OcrHarness>[] = [
  {
    name: "returns pages of typed blocks with boxes and confidence",
    run: async ({ ocr, document, expectedText }) => {
      const result = expectOk(await ocr.recognise(document));
      expect(result.document).toBe(document.sha512);
      expect(result.model).not.toBe("");
      expect(result.pages.length).toBeGreaterThan(0);
      result.pages.forEach((page, i) => {
        expect(page.index).toBe(i);
        for (const block of page.blocks) {
          expect(block.type).not.toBe("");
          expect(typeof block.text).toBe("string");
          expect(inUnit(block.confidence)).toBe(true);
          const { x0, y0, x1, y1 } = block.box;
          expect([x0, y0, x1, y1].every(inUnit)).toBe(true);
          expect(x0 <= x1 && y0 <= y1).toBe(true);
        }
      });
      const text = result.pages
        .flatMap((page) => page.blocks.map((block) => block.text))
        .join("\n");
      expect(text).toContain(expectedText);
    },
  },
  {
    name: "refuses unsupported types",
    run: async ({ ocr, document }) => {
      expectErr(await ocr.recognise({ ...document, mime: "text/html" }), "unsupported_mime");
    },
  },
  {
    name: "reports a document that cannot be fetched",
    run: async ({ ocr, missing }) => {
      expectErr(await ocr.recognise(missing), "not_found");
    },
  },
  {
    name: "refuses bytes that do not match the expected hash",
    run: async ({ ocr, document }) => {
      const wrong = (document.sha512.startsWith("0") ? "1" : "0") + document.sha512.slice(1);
      expectErr(await ocr.recognise({ ...document, sha512: wrong as Sha512Hex }), "hash_mismatch");
    },
  },
];

/** Register the `Ocr` contract against an adapter. */
export function runOcrContract(factory: Factory<OcrHarness>, options?: ContractOptions): void {
  registerContract("Ocr contract", ocrContract, factory, options);
}
