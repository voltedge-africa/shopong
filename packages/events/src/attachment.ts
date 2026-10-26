// Files in the record (story 3.7): what a file may be, how big, and the metadata that is taken out of it before its
// hash is taken. The event carries only the hash, size, type and a name; the bytes live in the Node's file store.
//
// Only the bytes' own magic numbers decide the type (a declared type must agree with them). Limits are in bytes:
// 5 MB is 5 * 1024 * 1024. Metadata is removed from JPEG (every APPn and COM segment, so EXIF, XMP, ICC and any
// embedded thumbnail go), PNG (every chunk except the ones that draw the image: IHDR, PLTE, IDAT, IEND, tRNS) and WebP
// (EXIF, XMP and ICC chunks, with their flags cleared). A PDF is passed through unchanged: its metadata is NOT stripped
// (shortcut S-3.7-5). The same code runs on the phone and on the Node, so both get the same bytes and the same hash.

import type { Issue } from "./registry.js";

export const ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** What a file is for. Each purpose names the event that carries it, and the role that event needs (see community files.ts). */
export const ATTACHMENT_PURPOSES = ["price-list", "delivery-photo"] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

const MB = 1024 * 1024;

/** The largest file each purpose takes, in bytes, and the types it takes. */
export const ATTACHMENT_RULES: {
  readonly [P in AttachmentPurpose]: {
    readonly maxBytes: number;
    readonly types: readonly AttachmentType[];
    readonly label: string;
  };
} = {
  "price-list": {
    maxBytes: 10 * MB,
    types: ["application/pdf", "image/jpeg", "image/png"],
    label: "10 MB",
  },
  "delivery-photo": {
    maxBytes: 5 * MB,
    types: ["image/jpeg", "image/png", "image/webp"],
    label: "5 MB",
  },
};

/**
 * The name a file carries in the record: a generated label for its purpose and the first eight hex characters of its hash.
 * The person's own file name never goes into the record (it can hold an address), so it is kept on the phone only.
 */
export const RECORD_LABEL: { readonly [P in AttachmentPurpose]: string } = {
  "price-list": "Price list",
  "delivery-photo": "Delivery photo",
};
export const recordNameOf = (purpose: AttachmentPurpose, hash: string): string =>
  `${RECORD_LABEL[purpose]} ${hash.slice(0, 8)}`;

/** The plain sentences a person sees. */
export const FILE_MESSAGES = {
  too_big_price_list: "That file is too big (limit 10 MB).",
  too_big_photo: "That file is too big (limit 5 MB).",
  wrong_type: "That kind of file isn't accepted.",
  unreadable: "This file can't be read. Try another one.",
  did_not_arrive: "The file didn't arrive intact.",
  store_failed: "Couldn't save the file. We'll try again.",
} as const;

/** The type the file's own first bytes give, or undefined when they match none of the accepted types. */
export function detectType(bytes: Uint8Array): AttachmentType | undefined {
  const at = (offset: number, text: string) =>
    text.split("").every((ch, k) => bytes[offset + k] === ch.charCodeAt(0));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, k) => bytes[k] === b)
  ) {
    return "image/png";
  }
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(0, "%PDF-")) return "application/pdf";
  return undefined;
}

export type FileCheck =
  | { readonly ok: true; readonly type: AttachmentType; readonly stored: Uint8Array }
  | {
      readonly ok: false;
      readonly problem: "too_big" | "wrong_type" | "unreadable";
      readonly message: string;
    };

/**
 * Checks bytes for a purpose before anything is sent: size first, then the type (the declared one must agree with the
 * bytes), then the metadata strip. `stored` is what the Node keeps, and its hash is the one the event carries.
 */
export function checkFileBytes(
  bytes: Uint8Array,
  purpose: AttachmentPurpose,
  declaredType?: string,
): FileCheck {
  const rule = ATTACHMENT_RULES[purpose];
  if (bytes.length > rule.maxBytes) {
    return {
      ok: false,
      problem: "too_big",
      message:
        purpose === "price-list" ? FILE_MESSAGES.too_big_price_list : FILE_MESSAGES.too_big_photo,
    };
  }
  const type = detectType(bytes);
  if (
    type === undefined ||
    !(rule.types as readonly string[]).includes(type) ||
    (declaredType !== undefined && declaredType !== type)
  ) {
    return { ok: false, problem: "wrong_type", message: FILE_MESSAGES.wrong_type };
  }
  const stored = stripMetadata(bytes, type);
  if (stored === undefined) {
    return { ok: false, problem: "unreadable", message: FILE_MESSAGES.unreadable };
  }
  return { ok: true, type, stored };
}

const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
const u32le = (b: Uint8Array, i: number) =>
  ((b[i + 3]! << 24) >>> 0) + ((b[i + 2]! << 16) | (b[i + 1]! << 8) | b[i]!);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * JPEG: every APPn (EXIF, XMP, ICC, JFIF, thumbnails) and COM segment is dropped. The entropy-coded scan is walked to its
 * real end marker, honouring stuffed 0xFF00 and restart markers, so the image data is kept byte for byte and everything
 * after the end marker is dropped (a motion photo's video, or a secondary image, with its own GPS, is not kept).
 */
function stripJpeg(b: Uint8Array): Uint8Array | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  for (;;) {
    while (i + 1 < b.length && b[i] === 0xff && b[i + 1] === 0xff) i += 1; // fill bytes
    if (i + 1 >= b.length || b[i] !== 0xff) return undefined;
    const marker = b[i + 1]!;
    if (marker === 0xd9) {
      parts.push(b.subarray(i, i + 2));
      return concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return undefined;
    const length = (b[i + 2]! << 8) | b[i + 3]!;
    if (length < 2 || i + 2 + length > b.length) return undefined;
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(b.subarray(i, i + 2 + length));
    i += 2 + length;
    if (marker === 0xda) {
      // The entropy-coded data: a 0xFF followed by 0x00 or a restart marker is data; any other 0xFF xx is the next marker.
      let j = i;
      while (j < b.length) {
        if (b[j] !== 0xff) {
          j += 1;
          continue;
        }
        const next = b[j + 1];
        if (next === undefined) return undefined;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          j += 2;
          continue;
        }
        if (next === 0xff) {
          j += 1;
          continue;
        }
        break;
      }
      if (j >= b.length) return undefined;
      parts.push(b.subarray(i, j));
      i = j;
    }
  }
}

/** PNG: only the chunks that draw the picture are kept. Text, EXIF, time, colour profile and physical size go. */
const PNG_KEPT = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);
function stripPng(b: Uint8Array): Uint8Array | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, k) => b[k] === byte)) return undefined;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i < b.length) {
    if (i + 8 > b.length) return undefined;
    const length = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + length;
    if (end > b.length) return undefined;
    if (PNG_KEPT.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return undefined;
}

/**
 * WebP: an allow-list. Only the picture and animation chunks are kept (VP8, VP8L, VP8X, ALPH, ANIM, ANMF); every other
 * chunk, including EXIF, XMP, ICC and any private vendor chunk, is dropped, and the VP8X metadata flags are cleared. The
 * walk stops at the RIFF size, so bytes after the end of the RIFF container are dropped too.
 */
const WEBP_KEPT = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
function stripWebp(b: Uint8Array): Uint8Array | undefined {
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return undefined;
  const riffEnd = Math.min(b.length, 8 + u32le(b, 4));
  if (riffEnd < 12) return undefined;
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) return undefined;
    const fourcc = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const end = i + 8 + size + (size & 1);
    if (end > riffEnd) return undefined;
    if (WEBP_KEPT.has(fourcc)) {
      const chunk = b.slice(i, end);
      if (fourcc === "VP8X" && chunk.length > 8) chunk[8] = chunk[8]! & ~(0x20 | 0x08 | 0x04);
      chunks.push(chunk);
    }
    i = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  const riffSize = 4 + body.length;
  header.set(
    [riffSize & 255, (riffSize >> 8) & 255, (riffSize >> 16) & 255, (riffSize >>> 24) & 255],
    4,
  );
  header.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return concat([header, body]);
}

/**
 * The bytes the Node keeps for a file of this type, with its metadata removed. Returns undefined when the file is not
 * readable as that type. Deterministic: the same bytes always give the same result (AGENTS rule 3 spirit, for hashing).
 */
export function stripMetadata(bytes: Uint8Array, type: AttachmentType): Uint8Array | undefined {
  switch (type) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
    case "application/pdf":
      return bytes.slice();
  }
}

export interface FileAttachedPayload {
  readonly hash: string;
  readonly size: number;
  readonly type: AttachmentType;
  readonly name: string;
  readonly purpose: AttachmentPurpose;
  readonly order: string;
  readonly supplier?: string;
}

const HEX_128 = /^[0-9a-f]{128}$/;
const KEYS = ["hash", "size", "type", "name", "purpose", "order", "supplier"] as const;
/**
 * The strict shape of a `file.attached` payload: exactly these fields, with these types, and a purpose's own type and
 * size rules. The personal-data guard runs separately (the community service and `apply`). Never throws.
 */
export function fileAttachedIssues(payload: Record<string, unknown>): readonly Issue[] {
  const issues: Issue[] = [];
  const at = (field: string, message: string) =>
    issues.push({ path: `$.payload.${field}`, message });
  for (const key of Object.keys(payload)) {
    if (!(KEYS as readonly string[]).includes(key)) at(key, "unknown field in a file");
  }
  const { hash, size, type, name, purpose, order, supplier } = payload;
  if (typeof hash !== "string" || !HEX_128.test(hash))
    at("hash", "must be a SHA-512 in 128 lowercase hex characters");
  if (
    typeof purpose !== "string" ||
    !(ATTACHMENT_PURPOSES as readonly string[]).includes(purpose)
  ) {
    at("purpose", "must be price-list or delivery-photo");
    return issues;
  }
  const rule = ATTACHMENT_RULES[purpose as AttachmentPurpose];
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > rule.maxBytes) {
    at("size", `must be a whole number of bytes from 1 to ${rule.maxBytes}`);
  }
  if (typeof type !== "string" || !(rule.types as readonly string[]).includes(type)) {
    at("type", "must be a type this purpose accepts");
  }
  // The name is the generated label for this purpose and hash: a person's own file name is never in the record.
  const labelOk =
    typeof name === "string" &&
    typeof hash === "string" &&
    HEX_128.test(hash) &&
    name === recordNameOf(purpose as AttachmentPurpose, hash);
  if (!labelOk)
    at("name", "must be the generated label for this file, for example Price list 1a2b3c4d");
  if (typeof order !== "string" || order.trim() === "" || order.length > 80) {
    at("order", "must name the order, 80 characters or fewer");
  }
  if (purpose === "price-list") {
    if (typeof supplier !== "string" || supplier.trim() === "" || supplier.length > 80) {
      at("supplier", "a price list names its supplier, 80 characters or fewer");
    }
  } else if (supplier !== undefined) {
    at("supplier", "only a price list names a supplier");
  }
  return issues;
}
