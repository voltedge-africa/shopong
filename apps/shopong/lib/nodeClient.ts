// The phone's signed client for the OCN Node (story 3.4). Each call is a fresh signed request: a new one-time
// number and the phone's clock, over the exact body text it sends. The client holds the phone's identity signer,
// never a Node secret. An answer is one of: ok, `offline` (no answer, a timeout, or a server error: keep and retry),
// `waiting` (the Node may take it later: too many requests, or the writer is not yet admitted), or `refused`
// (a plain refusal: park it and show the reason).

import { signRequest, type PoolView, type RequestParts } from "@shopong/community";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import type { CapabilityAuth, Did } from "@shopong/ports";

export type NodeFailure =
  | { readonly kind: "offline"; readonly reason: string }
  /** The phone's clock is too far from the Node's: retried, never parked (review P7). */
  | {
      readonly kind: "clock";
      readonly status: number;
      readonly problem: string;
      readonly reason: string;
    }
  | {
      readonly kind: "waiting";
      readonly status: number;
      readonly problem: string;
      readonly reason: string;
    }
  | {
      readonly kind: "refused";
      readonly status: number;
      readonly problem: string;
      readonly reason: string;
    };

export type NodeReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: NodeFailure };

/** The part of `fetch` the client uses, so tests can stand in for the network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface NodeClientOptions {
  /** The Node's origin, from `nodeAddress.ts`. */
  readonly baseUrl: string;
  readonly auth: CapabilityAuth;
  readonly did: Did;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  /** Random bytes for one-time numbers. The app passes `expo-crypto`'s `getRandomBytes`. */
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly timeoutMs?: number;
}

export interface CommunityCreated {
  readonly key: string;
  readonly spaceKey: string;
  readonly duplicate: boolean;
}

export interface PulledPage {
  readonly events: readonly {
    readonly id: string;
    readonly writer: Did;
    readonly event: EventEnvelope;
  }[];
  readonly next: string;
  readonly more: boolean;
  readonly behind: boolean;
}

/** A planned route as the Node answers it (story 7.4): the summary, the line and the three sentences it wrote. */
export interface RouteAnswer {
  readonly fingerprint: string;
  readonly origin: { readonly id: string; readonly label: string; readonly area: string };
  readonly destination: { readonly id: string; readonly label: string; readonly area: string };
  readonly costing: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly tileRelease: string;
  /** True when the route is a straight line, not a road route (the fallback until the tiles are released). */
  readonly straightLine: boolean;
  readonly polyline6: string;
  readonly sentences: readonly string[];
}

export interface NodeClient {
  createCommunity(key: string): Promise<NodeReply<CommunityCreated>>;
  admitMember(key: string, invitation: string): Promise<NodeReply<{ admitted: boolean }>>;
  postEvent(
    key: string,
    event: EventEnvelope,
  ): Promise<NodeReply<{ id: string; duplicate: boolean }>>;
  pull(key: string, after: string, limit?: number): Promise<NodeReply<PulledPage>>;
  /** The pool as the Node reads the books and the record (story 4.6). Members only. */
  pool(key: string): Promise<NodeReply<PoolView>>;
  /** Plans a route between two places the community registered (story 7.4). The treasurer or a current driver. */
  planRoute(
    key: string,
    plan: { readonly order: string; readonly origin: string; readonly destination: string },
  ): Promise<NodeReply<RouteAnswer>>;
  /** A planned route, read by its fingerprint. Members only (story 7.4). */
  route(key: string, order: string, fingerprint: string): Promise<NodeReply<RouteAnswer>>;
  /** Asks the Node to make the bank request for the member's own pledge (story 4.3). The phone sends only the id. */
  payPledge(key: string, pledge: string): Promise<NodeReply<PledgeRequested>>;
  /** The status of the request for the member's own pledge, as the Node's record and payments hold it. */
  paymentStatus(key: string, pledge: string): Promise<NodeReply<PaymentStatusReply>>;
}

/** What the Node answers for a request: its bank page on the Node (a path), and whether the record took its event. */
export interface PledgeRequested {
  readonly bankPath: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly recorded: boolean;
}

export type NodePaymentStatus =
  | "none"
  | "pending"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed";

export interface PaymentStatusReply {
  readonly status: NodePaymentStatus;
  readonly amountMinor: number;
  readonly bankPath?: string;
  /** Whether this pledge can still be paid on the Node's clock (false: make a new pledge to pay). */
  readonly windowOpen: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Reads a route answer; the Node has already checked it, so the phone only takes the fields it shows. */
function readRoute(j: Record<string, unknown>): RouteAnswer {
  return {
    fingerprint: String(j.fingerprint),
    origin: j.origin as RouteAnswer["origin"],
    destination: j.destination as RouteAnswer["destination"],
    costing: String(j.costing),
    distanceMeters: Number(j.distanceMeters),
    durationSeconds: Number(j.durationSeconds),
    tileRelease: String(j.tileRelease),
    straightLine: j.straightLine === true,
    polyline6: String(j.polyline6),
    sentences: Array.isArray(j.sentences) ? j.sentences.map(String) : [],
  };
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Sorts a Node answer by its status and problem into the three kinds the app acts on. */
export function failureOf(status: number, body: unknown): NodeFailure {
  const json = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const problem = typeof json.problem === "string" ? json.problem : "unknown";
  const reason =
    typeof json.reason === "string" && json.reason !== ""
      ? json.reason
      : "The OCN Node did not accept it.";
  // The books being unreadable is a plain sentence from the Node, not a sign that the Node cannot be reached (story 4.6).
  if (status === 503 && (problem === "books_unavailable" || problem === "record_off")) {
    return { kind: "refused", status, problem, reason };
  }
  if (status >= 500) return { kind: "offline", reason: "The OCN Node is not answering." };
  if (status === 401 && problem === "clock_skew") {
    return { kind: "clock", status, problem, reason };
  }
  if (status === 429 || (status === 403 && problem === "not_writable")) {
    return { kind: "waiting", status, problem, reason };
  }
  return { kind: "refused", status, problem, reason };
}

export function createNodeClient(options: NodeClientOptions): NodeClient {
  const send = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? ((n) => crypto.getRandomValues(new Uint8Array(n)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    read: (json: Record<string, unknown>) => T,
  ): Promise<NodeReply<T>> {
    const text = body === undefined ? "" : JSON.stringify(body);
    // A fresh one-time number and time for every call: a retry is a new signed request over the same body.
    const parts: RequestParts = {
      method,
      path,
      body: text,
      nonce: hex(randomBytes(16)),
      time: now(),
      actor: options.did,
    };
    const signed = await signRequest(options.auth, parts, webCryptoSha512);
    if (!signed.ok) {
      return {
        ok: false,
        failure: {
          kind: "refused",
          status: 0,
          problem: "unsigned",
          reason: "Make your identity first.",
        },
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let json: unknown;
    try {
      const res = await send(`${options.baseUrl}${path}`, {
        method,
        headers: {
          ...signed.value,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: text }),
        signal: controller.signal,
      });
      status = res.status;
      json = await res.json().catch(() => undefined);
    } catch {
      return { ok: false, failure: { kind: "offline", reason: "No answer from the OCN Node." } };
    } finally {
      clearTimeout(timer);
    }
    if (status === 200 && typeof json === "object" && json !== null) {
      return { ok: true, value: read(json as Record<string, unknown>) };
    }
    if (status === 200)
      return {
        ok: false,
        failure: { kind: "offline", reason: "The OCN Node's answer could not be read." },
      };
    return { ok: false, failure: failureOf(status, json) };
  }

  return {
    createCommunity: (key) =>
      request("POST", "/communities", { key }, (j) => ({
        key: String(j.key),
        spaceKey: String(j.spaceKey),
        duplicate: j.duplicate === true,
      })),
    admitMember: (key, invitation) =>
      request("POST", `/communities/${key}/members`, { invitation }, (j) => ({
        admitted: j.admitted === true,
      })),
    postEvent: (key, event) =>
      request("POST", `/spaces/${key}/events`, event, (j) => ({
        id: String(j.id),
        duplicate: j.duplicate === true,
      })),
    planRoute: (key, plan) =>
      request("POST", `/communities/${key}/routes`, plan, (j) => readRoute(j)),
    route: (key, order, fingerprint) =>
      request(
        "GET",
        `/communities/${key}/route?order=${encodeURIComponent(order)}&fingerprint=${encodeURIComponent(fingerprint)}`,
        undefined,
        (j) => readRoute(j),
      ),
    pool: (key) =>
      request("GET", `/communities/${key}/pool`, undefined, (j) => j as unknown as PoolView),
    payPledge: (key, pledge) =>
      request("POST", "/payments/requests", { community: key, pledge }, (j) => ({
        bankPath: String(j.bankPath),
        status: String(j.status),
        amountMinor: Number(j.amountMinor),
        recorded: j.recorded === true,
      })),
    paymentStatus: (key, pledge) =>
      request(
        "GET",
        `/payments/status?community=${encodeURIComponent(key)}&pledge=${encodeURIComponent(pledge)}`,
        undefined,
        (j) => ({
          status: String(j.status) as NodePaymentStatus,
          amountMinor: Number(j.amountMinor),
          windowOpen: j.windowOpen !== false,
          ...(typeof j.bankPath === "string" ? { bankPath: j.bankPath } : {}),
        }),
      ),
    pull: (key, after, limit = 100) =>
      request(
        "GET",
        `/spaces/${key}/events?after=${encodeURIComponent(after)}&limit=${limit}`,
        undefined,
        (j) => ({
          events: (Array.isArray(j.events) ? j.events : []) as PulledPage["events"],
          next: typeof j.next === "string" ? j.next : "",
          more: j.more === true,
          behind: j.behind === true,
        }),
      ),
  };
}
