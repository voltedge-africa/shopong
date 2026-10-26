// The Node's signed sync routes (story 3.5). Every route passes the request-proof gate (`signed.ts`, the same
// check as `/authority/check`) before it reads the body or the record.
//
//   POST /spaces/:key/events   append one event as the signer, through the signer's own replica. Acknowledged
//                              once the append is durable in that replica (Q4). The Node does not check
//                              capabilities here: `apply` decides (Q6, story 3.6 adds log-time checks).
//   GET  /spaces/:key/events   pull the entries after a cursor, from the indexer. Members only. The cursor is
//                              opaque to phones; they store `next` and send it back as `after`.
//   GET  /spaces/:key/changes  a "something changed" notice as Server-Sent Events, for members. Phones must work
//                              by polling the pull route alone; the notice only saves them polling.
//
// Refusals are audit-logged with the reason and the request id. The actor is logged as verified only after the
// signature passes (see `signed.ts`). Event bodies and signatures are never logged.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isCommunityKey, NOT_THE_WRITER, REQUEST_SKEW_MS } from "@shopong/community";
import {
  PERSONAL_DATA_MESSAGE,
  PersonalDataError,
  assertNoPersonalData,
  parseEvent,
  type EventEnvelope,
} from "@shopong/events";
import type { CapabilityAuth, Did, Space, Unsubscribe, ViewChange } from "@shopong/ports";
import type { JournalEntry } from "@shopong/record-autobase";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import {
  claimNonce,
  SeenNonces,
  verifySignedRequest,
  type SignedGate,
  type SignedProblem,
} from "./signed.ts";

/** What a pull can answer. `behind` is true when the indexer had not yet caught up with the caller's own appends. */
export type ReadResult =
  | {
      readonly ok: true;
      readonly entries: readonly JournalEntry<EventEnvelope>[];
      readonly head: number;
      readonly behind: boolean;
    }
  | { readonly ok: false; readonly problem: "not_held" | "not_member" };

/**
 * The part of the replica hub the routes use. The hub (`hub.ts`) implements it; tests may supply a fake.
 * `isMember` reads only the Node's admission list, so a stranger costs no I/O.
 */
/** Event types only the Node writes (stories 4.5 and 4.6). A phone that sends one is refused as `node_only`. */
/**
 * Types only the Node writes: money postings, the payment request the Node makes (story 4.3, `payment.requested`), and
 * the payment outcomes the verified webhook confirms (story 4.5). A phone's copy of any of them is refused.
 */
const NODE_ONLY_TYPES: readonly string[] = [
  "ledger.posted",
  "payment.requested",
  "payment.completed",
  "payment.failed",
];

export interface SyncHub {
  /** Whether `did` is admitted to the community; undefined when the Node holds no such community. */
  isMember(did: Did, communityKey: string): Promise<boolean | undefined>;
  /** The signer's own replica of an admitted member's community, or undefined. */
  replicaOf(did: Did, communityKey: string): Promise<Space<EventEnvelope> | undefined>;
  /** Records that the Node acknowledged this append, so a pull by the same member waits for it. */
  acknowledge(did: Did, communityKey: string, id: string): void;
  /** Entries after `after` from the indexer, for a member. */
  readSince(did: Did, communityKey: string, after: number, limit: number): Promise<ReadResult>;
  /** Called after the indexer's view changes. Returns how to stop listening. */
  onChange(
    communityKey: string,
    listener: (change: ViewChange) => void,
  ): Promise<Unsubscribe | undefined>;
}

export interface SyncOptions {
  /** Absent when the record is off: the routes then answer 503. */
  readonly hub?: SyncHub;
  /** The Node's own clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** How many one-time numbers are held at once. */
  readonly maxNonces?: number;
}

/** Largest body the events route reads: 64 KiB. Larger is refused with 413 before it is parsed. */
export const MAX_EVENT_BODY_BYTES = 64 * 1024;
/** Largest pull response in bytes of JSON (at least one event is always sent). */
export const MAX_PULL_BYTES = 1024 * 1024;
/** Most change-notice connections a member may hold open; the oldest is closed when one more arrives. */
export const MAX_CHANGE_CONNECTIONS = 3;

/** Why a sync request was refused, besides the signed-request problems. */
type SyncProblem =
  | "not_held"
  | "not_member"
  | "invalid_event"
  | "wrong_space"
  | "not_yours"
  | "not_writable"
  | "invalid_cursor"
  | "personal_data"
  | "node_only";

const SYNC_STATUS: { readonly [P in SyncProblem]: number } = {
  not_held: 404,
  not_member: 403,
  invalid_event: 400,
  wrong_space: 400,
  not_yours: 403,
  not_writable: 403,
  invalid_cursor: 400,
  personal_data: 400,
  node_only: 403,
};

const SYNC_MESSAGES: { readonly [P in SyncProblem]: string } = {
  not_held: "This Node does not hold that community.",
  not_member: "Only a member of the community can read it.",
  invalid_event: "The event is not in the record's format.",
  wrong_space: "The event is for another community than the one in the address.",
  not_yours: NOT_THE_WRITER,
  not_writable: "This person cannot write to that community.",
  invalid_cursor: "That place in the record is not one this Node gave out.",
  personal_data: PERSONAL_DATA_MESSAGE,
  node_only: "Only the OCN Node writes money postings to the record.",
};

const CURSOR_PREFIX = "ocn-pull/v1:";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** The cursor a phone sends back. Phones do not read it; only the Node does. */
export function encodeCursor(position: number): string {
  return Buffer.from(`${CURSOR_PREFIX}${position}`, "utf8").toString("base64url");
}

/** The position in a cursor, or undefined when the text is not one this Node gave out. An absent cursor is 0. */
export function decodeCursor(text: string | undefined): number | undefined {
  if (text === undefined || text === "") return 0;
  const decoded = Buffer.from(text, "base64url").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64url") !== text) return undefined;
  if (!decoded.startsWith(CURSOR_PREFIX)) return undefined;
  const digits = decoded.slice(CURSOR_PREFIX.length);
  return /^\d+$/u.test(digits) ? Number(digits) : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Registers the sync routes on the app. They are always registered; with no hub they answer 503. */
export function registerSyncRoutes(
  app: FastifyInstance,
  auth: CapabilityAuth,
  options: SyncOptions,
): void {
  const { hub } = options;
  const gate: Pick<SignedGate, "auth" | "clock"> = {
    auth,
    clock: options.now ?? Date.now,
  };
  const nonces = new SeenNonces(options.maxNonces);
  const connections = new Map<Did, Set<{ end(): void }>>();

  const recordOff = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      problem: "record_off",
      reason: "The Node record is not running.",
      requestId: request.id,
    });

  // Every route below verifies the signature, then checks membership (a registry read), then records the one-time
  // number, and only then touches the record. The body is buffered by Fastify before the handler runs, but nothing
  // in it is parsed or used until the signature has passed.

  app.post<{ Params: { key: string } }>(
    "/spaces/:key/events",
    { bodyLimit: MAX_EVENT_BODY_BYTES },
    async (request, reply) => {
      if (hub === undefined) return recordOff(request, reply);
      const refuse = (problem: SignedProblem | SyncProblem, actor?: Did) =>
        refuseSync(request, reply, problem, actor);

      const verdict = await verifySignedRequest(gate, request);
      if (!verdict.ok) return refuse(verdict.problem, verdict.actor);
      const { actor } = verdict;

      const { key } = request.params;
      const member = isCommunityKey(key) ? await hub.isMember(actor, key) : undefined;
      if (member === undefined) return refuse("not_held", actor);
      if (!member) return refuse("not_member", actor);
      const used = claimNonce(nonces, verdict);
      if (used !== undefined) return refuse(used, actor);

      const space = await hub.replicaOf(actor, key);
      if (space === undefined) return refuse("not_held", actor);

      const parsed = parseEvent(parseJson(request.rawBody));
      if (!parsed.ok) return refuse("invalid_event", actor);
      const event = parsed.event as EventEnvelope;
      if (event.space !== key) return refuse("wrong_space", actor);
      // Money postings and payment outcomes are written by the Node alone (stories 4.5 and 4.6): a phone's copy would
      // count as money or as a confirmed payment.
      if (NODE_ONLY_TYPES.includes(event.type)) return refuse("node_only", actor);

      // Only the signer's own events, written through the signer's own replica. `apply` still decides their meaning.
      if (event.actor !== actor || space.local !== actor) return refuse("not_yours", actor);

      // A raw phone or ID number is refused before the append, so the log never holds it (AGENTS rule 6, story 2.7).
      try {
        assertNoPersonalData(event.payload);
      } catch (error) {
        if (error instanceof PersonalDataError) return refuse("personal_data", actor);
        throw error;
      }

      // Acknowledged only once the append has returned, which is after it is durable in the signer's replica. A replica
      // the Node closes during a request is a removed member (story 3.3), so that is refused as not_member, not a 500.
      const receipt = await space.append(event).catch(async (error: unknown) => {
        if (await hub.isMember(actor, key)) throw error;
        return undefined;
      });
      if (receipt === undefined) return refuse("not_member", actor);
      if (!receipt.ok) {
        return refuse(receipt.error.code === "closed" ? "not_member" : "not_writable", actor);
      }
      hub.acknowledge(actor, key, receipt.value.id);

      request.log.info(
        {
          audit: "sync",
          outcome: "accepted",
          action: "append",
          actor,
          requestId: request.id,
          duplicate: receipt.value.duplicate,
        },
        "sync append accepted",
      );
      return reply
        .code(200)
        .send({ id: receipt.value.id, duplicate: receipt.value.duplicate, requestId: request.id });
    },
  );

  app.get<{ Params: { key: string }; Querystring: { after?: string; limit?: string } }>(
    "/spaces/:key/events",
    async (request, reply) => {
      if (hub === undefined) return recordOff(request, reply);
      const refuse = (problem: SignedProblem | SyncProblem, actor?: Did) =>
        refuseSync(request, reply, problem, actor);

      const verdict = await verifySignedRequest(gate, request);
      if (!verdict.ok) return refuse(verdict.problem, verdict.actor);
      const { actor } = verdict;

      const { key } = request.params;
      const member = isCommunityKey(key) ? await hub.isMember(actor, key) : undefined;
      if (member === undefined) return refuse("not_held", actor);
      if (!member) return refuse("not_member", actor);
      const used = claimNonce(nonces, verdict);
      if (used !== undefined) return refuse(used, actor);

      const after = decodeCursor(request.query.after);
      if (after === undefined) return refuse("invalid_cursor", actor);
      const requested = Number(request.query.limit ?? DEFAULT_LIMIT);
      const limit =
        Number.isSafeInteger(requested) && requested > 0
          ? Math.min(requested, MAX_LIMIT)
          : DEFAULT_LIMIT;

      const read = await hub.readSince(actor, key, after, limit);
      if (!read.ok) return refuse(read.problem, actor);

      // Capped by bytes as well as count. The first event is always sent, so a pull always makes progress.
      const events: { id: string; writer: string; event: unknown }[] = [];
      let bytes = 0;
      let position = after;
      for (const entry of read.entries) {
        const item = { id: entry.id, writer: entry.writer, event: entry.event };
        const size = Buffer.byteLength(JSON.stringify(item), "utf8");
        if (events.length > 0 && bytes + size > MAX_PULL_BYTES) break;
        events.push(item);
        bytes += size;
        position = entry.position;
      }
      const more = events.length < read.entries.length || read.entries.length === limit;

      request.log.info(
        {
          audit: "sync",
          outcome: "accepted",
          action: "pull",
          actor,
          requestId: request.id,
          count: events.length,
        },
        "sync pull answered",
      );
      return reply.code(200).send({
        events,
        next: encodeCursor(position),
        more,
        behind: read.behind,
        requestId: request.id,
      });
    },
  );

  app.get<{ Params: { key: string } }>("/spaces/:key/changes", async (request, reply) => {
    if (hub === undefined) return recordOff(request, reply);
    const refuse = (problem: SignedProblem | SyncProblem, actor?: Did) =>
      refuseSync(request, reply, problem, actor);

    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) return refuse(verdict.problem, verdict.actor);
    const { actor } = verdict;

    const { key } = request.params;
    const member = isCommunityKey(key) ? await hub.isMember(actor, key) : undefined;
    if (member === undefined) return refuse("not_held", actor);
    if (!member) return refuse("not_member", actor);
    const used = claimNonce(nonces, verdict);
    if (used !== undefined) return refuse(used, actor);

    // Everything that can end the connection is set up before the stream starts, so a failure ends the response.
    reply.hijack();
    let started = false;
    let ended = false;
    let stop: Unsubscribe | undefined;
    const live = {
      end: () => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        stop?.();
        connections.get(actor)?.delete(live);
        reply.raw.end();
      },
    };
    const timer = setTimeout(live.end, REQUEST_SKEW_MS);
    request.raw.on("close", live.end);

    const open = connections.get(actor) ?? new Set<{ end(): void }>();
    connections.set(actor, open);
    while (open.size >= MAX_CHANGE_CONNECTIONS) {
      const oldest = open.values().next().value;
      oldest?.end();
      if (oldest === undefined) break;
    }
    open.add(live);

    try {
      stop = await hub.onChange(key, () => {
        // A slow reader is cut off rather than buffered for ever.
        if (started && !ended && !reply.raw.write("event: changed\ndata: {}\n\n")) live.end();
      });
    } catch {
      live.end();
      return;
    }
    if (ended) {
      stop?.();
      return;
    }
    started = true;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write("retry: 2000\n\n");
  });
}

/** One place for refusals: the audit line (no secrets, no bodies) and the status and plain sentence. */
function refuseSync(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: SignedProblem | SyncProblem,
  actor?: Did,
) {
  const sync = isSyncProblem(problem);
  const message = sync ? SYNC_MESSAGES[problem] : nodeMessage(problem);
  const status = sync ? SYNC_STATUS[problem] : (HTTP_STATUS[problem] ?? 403);
  request.log.warn(
    {
      audit: "sync",
      outcome: "refused",
      problem,
      ...(actor === undefined ? {} : { actor }),
      requestId: request.id,
    },
    message,
  );
  return reply.code(status).send({ problem, reason: message, requestId: request.id });
}

function isSyncProblem(problem: SignedProblem | SyncProblem): problem is SyncProblem {
  return problem in SYNC_STATUS;
}
