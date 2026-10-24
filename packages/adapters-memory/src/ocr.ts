import {
  OCR_MIME_TYPES,
  err,
  ok,
  type DocumentRef,
  type Ocr,
  type OcrErrorCode,
  type OcrPage,
  type OcrResult,
  type PortError,
  type Result,
  type Sha512Hex,
} from "@shopong/ports";

/** A document the in-memory OCR can "read": its true hash and the blocks it contains. */
export interface MemoryOcrDocument {
  readonly uri: string;
  readonly sha512: Sha512Hex;
  readonly pages: readonly OcrPage[];
}

export interface MemoryOcrOptions {
  documents?: readonly MemoryOcrDocument[];
  model?: string;
}

/** In-memory `Ocr` that returns fixture pages for known URIs. */
export class MemoryOcr implements Ocr {
  readonly #documents = new Map<string, MemoryOcrDocument>();
  readonly #model: string;

  constructor(options: MemoryOcrOptions = {}) {
    this.#model = options.model ?? "memory-ocr/1";
    for (const document of options.documents ?? []) this.addDocument(document);
  }

  /** Test control: make a document available at its URI. */
  addDocument(document: MemoryOcrDocument): void {
    this.#documents.set(document.uri, document);
  }

  async recognise(document: DocumentRef): Promise<Result<OcrResult, PortError<OcrErrorCode>>> {
    if (!OCR_MIME_TYPES.includes(document.mime))
      return err("unsupported_mime", `cannot read ${document.mime}`);
    const stored = this.#documents.get(document.uri);
    if (stored === undefined) return err("not_found", `nothing at ${document.uri}`);
    if (stored.sha512 !== document.sha512)
      return err("hash_mismatch", "bytes do not match the expected hash");
    if (stored.pages.length === 0) return err("unreadable", "document has no readable pages");
    return ok({
      document: document.sha512,
      model: this.#model,
      pages: stored.pages.map((page) => ({
        index: page.index,
        blocks: page.blocks.map((block) => ({ ...block })),
      })),
    });
  }
}
