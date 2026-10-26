// The Node's signed file routes (story 3.7). Every route checks the request-proof (`signed.ts`) before it parses or uses
// the body: Fastify buffers the body first (up to the limit), since the signature covers its text. Each route then checks
// membership before it claims the one-time number, as the sync routes do.
//
//   POST /spaces/:key/files        keep one file for a community. The body is JSON: { sha512, purpose, type, bytes }
//                                  where `bytes` is the file in standard base64. The sender must hold the role the
//                                  purpose needs (`fileUploadProblem`). The Node checks the size and the type from
//                                  the bytes, strips the metadata again (always), hashes what it keeps and refuses it
//                                  unless the hash equals the one the sender declared. Nothing is written before all
//                                  of that passes. The record gets its reference later, from `file.attached`.
//   GET  /spaces/:key/files/:hash  the file, or part of it with `Range: bytes=<first>-<last>` (inclusive). Members only.
//
// Limits (review patch): a member may send 20 uploads in 10 minutes; a community holds at most `quotaBytes` (default
// 200 MB) and an upload that would pass it is refused; at most 4 uploads are in flight at once; and a declared
// Content-Length over the limit is refused before the body is read. Fastify buffers the body before the handler runs,
// because the signature covers the body text; the gate does not parse or use the body before the signature passes.
//
// Refusals are audit-logged with the reason and the request id: never the bytes, the name or the file's content.
// The file's name is never a path (files are stored under the hash only), and a hash is checked before it is used.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fileUploadProblem, isCommunityKey, logTimeOf } from "@shopong/community";
import {
  ATTACHMENT_PURPOSES,
  ATTACHMENT_RULES,
  ATTACHMENT_TYPES,
  checkFileBytes,
  FILE_MESSAGES,
  fromBase64,
  toBase64,
  verifyAttachment,
  webCryptoSha512,
  type AttachmentPurpose,
} from "@shopong/events";
import {
  asSha512Hex,
  type CapabilityAuth,
  type Did,
  type FileStore,
  type ViewReader,
} from "@shopong/ports";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import {
  claimNonce,
  FixedWindows,
  SeenNonces,
  verifySignedRequest,
  type SignedGate,
  type SignedProblem,
} from "./signed.ts";

/** Uploads one member may send in each window, and the window's length. */
export const UPLOADS_PER_WINDOW = 20;
export const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
/** Uploads the Node reads at once. A further upload is refused as busy until one finishes. */
export const MAX_UPLOADS_IN_FLIGHT = 4;
/** The bytes one community may hold, by default (200 MB). Configured as `fileQuotaBytes`. */
export const DEFAULT_QUOTA_BYTES = 200 * 1024 * 1024;

/** Counts uploads in flight. `take` refuses past the cap; `give` is called when a counted upload has answered. */
export class InFlightGate {
  #count = 0;
  readonly #max: number;

  constructor(max: number) {
    this.#max = max;
  }

  take(): boolean {
    if (this.#count >= this.#max) return false;
    this.#count += 1;
    return true;
  }

  give(): void {
    if (this.#count > 0) this.#count -= 1;
  }

  get inFlight(): number {
    return this.#count;
  }
}

/** Largest upload body the route reads: a 10 MB file in base64 with its JSON wrapper. Larger is refused with 413. */
export const MAX_FILE_BODY_BYTES = Math.ceil((10 * 1024 * 1024) / 3) * 4 + 1024;

/** The part of the Node's hub these routes use. `ReplicaHub` implements it. */
export interface FileHub {
  isMember(did: Did, communityKey: string): Promise<boolean | undefined>;
  creatorOf(communityKey: string): Did | undefined;
  indexedView(communityKey: string): Promise<ViewReader | undefined>;
}

/** The file stores, one per community. `HyperdriveFileStores` implements it. */
export interface FileStores {
  of(communityKey: string): Promise<FileStore>;
}

export interface FileRouteOptions {
  readonly hub: FileHub;
  readonly stores: FileStores;
  readonly auth: CapabilityAuth;
  /** The Node's own clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly maxNonces?: number;
  /** The bytes one community may hold. Default 200 MB. */
  readonly quotaBytes?: number;
}

/** Why a file request was refused, besides the signed-request problems. */
type FileProblem =
  | "not_held"
  | "not_member"
  | "invalid_file"
  | "too_big"
  | "wrong_type"
  | "unreadable"
  | "did_not_arrive"
  | "not_permitted"
  | "store_failed"
  | "not_found"
  | "bad_range"
  | "rate_limited"
  | "over_quota"
  | "busy"
  | "request_too_large";

const FILE_STATUS: { readonly [P in FileProblem]: number } = {
  not_held: 404,
  not_member: 403,
  invalid_file: 400,
  too_big: 413,
  wrong_type: 415,
  unreadable: 415,
  did_not_arrive: 400,
  not_permitted: 403,
  store_failed: 503,
  not_found: 404,
  bad_range: 416,
  rate_limited: 429,
  over_quota: 413,
  busy: 503,
  request_too_large: 413,
};

const FILE_REASONS: { readonly [P in FileProblem]: string } = {
  not_held: "This Node does not hold that community.",
  not_member: "Only a member of the community can use its files.",
  invalid_file: "The file is not in the form the Node expects.",
  too_big: FILE_MESSAGES.too_big_photo,
  wrong_type: FILE_MESSAGES.wrong_type,
  unreadable: FILE_MESSAGES.unreadable,
  did_not_arrive: FILE_MESSAGES.did_not_arrive,
  not_permitted: "This person cannot attach that kind of file.",
  store_failed: FILE_MESSAGES.store_failed,
  not_found: "This file is not held.",
  bad_range: "That part of the file is not there.",
  rate_limited: "You have sent a lot of files in a few minutes. Try again shortly.",
  over_quota: "This community has no room for another file. Ask the treasurer.",
  busy: "The Node is busy with other uploads. Try again in a moment.",
  request_too_large: "That upload is too large for the Node to take in one go.",
};

const HEX_128 = /^[0-9a-f]{128}$/;
const UPLOAD_KEYS = ["sha512", "purpose", "type", "bytes"] as const;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

interface Upload {
  readonly sha512: string;
  readonly purpose: AttachmentPurpose;
  readonly type: string;
  readonly bytes: string;
}

/** The upload body, or undefined when it is not exactly the fields the route takes, in the forms it takes them. */
function uploadOf(body: unknown): Upload | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const o = body as Record<string, unknown>;
  if (!Object.keys(o).every((k) => (UPLOAD_KEYS as readonly string[]).includes(k)))
    return undefined;
  const { sha512, purpose, type, bytes } = o;
  if (typeof sha512 !== "string" || !HEX_128.test(sha512)) return undefined;
  if (
    typeof purpose !== "string" ||
    !(ATTACHMENT_PURPOSES as readonly string[]).includes(purpose)
  ) {
    return undefined;
  }
  if (typeof type !== "string" || !(ATTACHMENT_TYPES as readonly string[]).includes(type))
    return undefined;
  if (typeof bytes !== "string") return undefined;
  return { sha512, purpose: purpose as AttachmentPurpose, type, bytes };
}

/** `bytes=<first>-<last>` as an inclusive range, or undefined when the header is absent. Null when it is not one. */
function rangeOf(header: string | undefined): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined;
  const m = /^bytes=(\d+)-(\d+)$/u.exec(header.trim());
  if (m === null) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) ? { start, end } : null;
}

export function registerFileRoutes(app: FastifyInstance, options: FileRouteOptions): void {
  const { hub, stores, auth } = options;
  const gate: Pick<SignedGate, "auth" | "clock"> = { auth, clock: options.now ?? Date.now };
  const nonces = new SeenNonces(options.maxNonces);
  const windows = new FixedWindows(gate.clock);
  const quota = options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
  const inFlight = new InFlightGate(MAX_UPLOADS_IN_FLIGHT);
  const counted = new WeakSet<object>();

  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    problem: SignedProblem | FileProblem,
    actor?: Did,
    reasonText?: string,
  ) => {
    const isFile = problem in FILE_STATUS;
    const reason =
      reasonText ??
      (isFile ? FILE_REASONS[problem as FileProblem] : nodeMessage(problem as SignedProblem));
    const status = isFile
      ? FILE_STATUS[problem as FileProblem]
      : (HTTP_STATUS[problem as SignedProblem] ?? 403);
    request.log.warn(
      {
        audit: "files",
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      reason,
    );
    return reply.code(status).send({ problem, reason, requestId: request.id });
  };

  /** Signature, then the community, then membership, then the one-time number. Returns the refusal or the caller. */
  async function admitted(request: FastifyRequest, reply: FastifyReply, key: string) {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) return { refused: refuse(request, reply, verdict.problem, verdict.actor) };
    const { actor } = verdict;
    const member = isCommunityKey(key) ? await hub.isMember(actor, key) : undefined;
    if (member === undefined) return { refused: refuse(request, reply, "not_held", actor) };
    if (!member) return { refused: refuse(request, reply, "not_member", actor) };
    const used = claimNonce(nonces, verdict);
    if (used !== undefined) return { refused: refuse(request, reply, used, actor) };
    return { actor };
  }

  // Early refusals, before the body is read: a declared length over the limit, and too many uploads in flight.
  const uploadHooks = {
    onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
      const declared = Number(request.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > MAX_FILE_BODY_BYTES) {
        return refuse(
          request,
          reply,
          "request_too_large",
          undefined,
          FILE_REASONS.request_too_large,
        );
      }
      if (!inFlight.take()) return refuse(request, reply, "busy");
      counted.add(request);
    },
    onResponse: async (request: FastifyRequest) => {
      if (counted.has(request)) {
        counted.delete(request);
        inFlight.give();
      }
    },
  };

  app.post<{ Params: { key: string } }>(
    "/spaces/:key/files",
    { bodyLimit: MAX_FILE_BODY_BYTES, ...uploadHooks },
    async (request, reply) => {
      const { key } = request.params;
      const check = await admitted(request, reply, key);
      if ("refused" in check) return check.refused;
      const { actor } = check;

      const upload = uploadOf(parseJson(request.rawBody));
      if (upload === undefined) return refuse(request, reply, "invalid_file", actor);

      // Who may keep this file: the role its purpose's event needs, judged on the record as it stands now.
      const view = await hub.indexedView(key);
      const creator = hub.creatorOf(key);
      if (view === undefined || creator === undefined)
        return refuse(request, reply, "not_held", actor);
      const at = (await logTimeOf(view)) ?? 0;
      const problem = await fileUploadProblem(
        { auth, creator, spaceKey: key },
        view,
        actor,
        upload.purpose,
        at,
      );
      if (problem !== undefined) {
        request.log.warn(
          {
            audit: "files",
            outcome: "refused",
            problem: "not_permitted",
            actor,
            requestId: request.id,
          },
          problem,
        );
        return reply
          .code(403)
          .send({ problem: "not_permitted", reason: problem, requestId: request.id });
      }

      // At most 20 uploads in 10 minutes from one member, counted once the member and the role are known.
      if (!windows.spend("files-upload", actor, UPLOADS_PER_WINDOW, UPLOAD_WINDOW_MS)) {
        return refuse(request, reply, "rate_limited", actor);
      }

      // Refused before decoding when the text is longer than any file of this purpose could be.
      const rule = ATTACHMENT_RULES[upload.purpose];
      if (upload.bytes.length > Math.ceil(rule.maxBytes / 3) * 4) {
        return refuse(
          request,
          reply,
          "too_big",
          actor,
          rule.label === "10 MB" ? FILE_MESSAGES.too_big_price_list : FILE_MESSAGES.too_big_photo,
        );
      }
      const decoded = fromBase64(upload.bytes);
      if (decoded === undefined) return refuse(request, reply, "invalid_file", actor);

      const checked = checkFileBytes(decoded, upload.purpose, upload.type);
      if (!checked.ok) return refuse(request, reply, checked.problem, actor, checked.message);

      // The hash is taken over the bytes the Node keeps (stripped again here, so a phone's copy cannot differ).
      const verified = await verifyAttachment(checked.stored, upload.sha512, webCryptoSha512);
      if (verified.status !== "verified") return refuse(request, reply, "did_not_arrive", actor);

      const files = await stores.of(key).catch(() => undefined);
      if (files === undefined) return refuse(request, reply, "store_failed", actor);
      // A file the community already holds is kept once and costs nothing more; any other must fit the quota.
      const hash = asSha512Hex(upload.sha512);
      if (!(await files.has(hash))) {
        const held = await files.bytesHeld().catch(() => Number.POSITIVE_INFINITY);
        if (held + checked.stored.length > quota)
          return refuse(request, reply, "over_quota", actor);
      }
      const written = await files.put(hash, checked.stored);
      if (!written.ok) return refuse(request, reply, "store_failed", actor);

      request.log.info(
        {
          audit: "files",
          outcome: "accepted",
          action: "upload",
          actor,
          requestId: request.id,
          duplicate: written.value.duplicate,
        },
        "file kept",
      );
      return reply.code(200).send({
        sha512: upload.sha512,
        size: checked.stored.length,
        type: checked.type,
        duplicate: written.value.duplicate,
        requestId: request.id,
      });
    },
  );

  app.get<{ Params: { key: string; hash: string } }>(
    "/spaces/:key/files/:hash",
    async (request, reply) => {
      const { key, hash } = request.params;
      const check = await admitted(request, reply, key);
      if ("refused" in check) return check.refused;
      const { actor } = check;
      if (!HEX_128.test(hash)) return refuse(request, reply, "invalid_file", actor);

      const range = rangeOf(request.headers.range);
      if (range === null) return refuse(request, reply, "bad_range", actor);
      const files = await stores.of(key).catch(() => undefined);
      if (files === undefined) return refuse(request, reply, "store_failed", actor);
      const got = await files.get(asSha512Hex(hash), range);
      if (!got.ok) {
        const problem: FileProblem =
          got.error.code === "not_found"
            ? "not_found"
            : got.error.code === "bad_range"
              ? "bad_range"
              : "store_failed";
        return refuse(request, reply, problem, actor);
      }
      const start = range?.start ?? 0;
      const total = await files.sizeOf(asSha512Hex(hash));

      request.log.info(
        { audit: "files", outcome: "accepted", action: "read", actor, requestId: request.id },
        "file read",
      );
      if (range !== undefined) {
        reply.header(
          "content-range",
          `bytes ${start}-${start + got.value.length - 1}/${total ?? "*"}`,
        );
      }
      return reply.code(range === undefined ? 200 : 206).send({
        sha512: hash,
        offset: start,
        length: got.value.length,
        bytes: toBase64(got.value),
        requestId: request.id,
      });
    },
  );
}
