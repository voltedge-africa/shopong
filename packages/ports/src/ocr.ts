import type { PortError, Result, Sha512Hex } from "./common.js";

/** A stored document: its content hash, type and where the adapter can fetch the bytes. */
export interface DocumentRef {
  readonly sha512: Sha512Hex;
  /** `image/png`, `image/jpeg` or `application/pdf`. */
  readonly mime: string;
  /** Where the bytes live, for example `hyperdrive://<driveKey>/<path>`. */
  readonly uri: string;
}

export const OCR_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "application/pdf"];

/** Page-relative box, each coordinate in [0, 1], origin top-left, x0 <= x1 and y0 <= y1. */
export interface BoundingBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Block types as the model labels them (`text`, `title`, `table`, `figure`, ...). Open set. */
export type OcrBlockType = string;

export interface OcrBlock {
  readonly type: OcrBlockType;
  readonly text: string;
  readonly box: BoundingBox;
  /** In [0, 1]. Below the caller's threshold the row goes to human review (AD-7). */
  readonly confidence: number;
}

export interface OcrPage {
  /** Zero-based page number. */
  readonly index: number;
  /** In reading order. */
  readonly blocks: readonly OcrBlock[];
}

export interface OcrResult {
  /** Echoes `DocumentRef.sha512` so results can be stored next to their source. */
  readonly document: Sha512Hex;
  /** Model name and version, for audit. */
  readonly model: string;
  /** Pages in ascending order. */
  readonly pages: readonly OcrPage[];
}

export type OcrErrorCode =
  | "unsupported_mime"
  /** The adapter could not fetch the bytes at `uri`. */
  | "not_found"
  /** The fetched bytes do not hash to `sha512`. */
  | "hash_mismatch"
  | "unreadable";

/**
 * Turn a document image or PDF into typed text blocks with boxes and confidence
 * (Unlimited-OCR via vLLM on a GPU host). Advisory output: people review it. Owning epic: 6.
 */
export interface Ocr {
  recognise(document: DocumentRef): Promise<Result<OcrResult, PortError<OcrErrorCode>>>;
}
