import type { Fixture } from "./types.js";

/** Key order must not matter when comparing request bodies. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function header(headers: HeadersInit | undefined, name: string): string | undefined {
  return new Headers(headers).get(name) ?? undefined;
}

function matches(
  fixture: Fixture,
  method: string,
  url: string,
  headers: HeadersInit | undefined,
  body: unknown,
): boolean {
  const { request } = fixture;
  if (request.method.toUpperCase() !== method.toUpperCase() || request.url !== url) return false;
  if (canonical(request.body ?? null) !== canonical(body ?? null)) return false;
  // Idempotency-Key is part of what a ledger call means, so it takes part in matching when recorded.
  const key = header(request.headers, "idempotency-key");
  return key === undefined || key === header(headers, "idempotency-key");
}

export class NoFixtureMatchError extends Error {
  constructor(method: string, url: string) {
    super(`No fixture matches ${method} ${url} with this body`);
    this.name = "NoFixtureMatchError";
  }
}

/**
 * A `fetch` that answers from fixtures instead of the network. Only `outbound` fixtures take part.
 * Matching is on method, URL, JSON body (key order ignored) and, when the fixture has one, Idempotency-Key.
 * Anything else rejects with NoFixtureMatchError, so a test can never reach a real vendor by accident.
 * The returned function records its calls in `calls`.
 */
export function createReplayFetch(
  fixtures: Fixture[],
): typeof fetch & { calls: Array<{ method: string; url: string }> } {
  const outbound = fixtures.filter((f) => f.meta.direction === "outbound");
  const calls: Array<{ method: string; url: string }> = [];
  const replay = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    const rawBody =
      init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (rawBody !== undefined && rawBody !== null && typeof rawBody !== "string") {
      throw new TypeError("createReplayFetch only supports string (JSON) request bodies");
    }
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method, url });
    const hit = outbound.find((f) => matches(f, method, url, headers, body));
    if (!hit) throw new NoFixtureMatchError(method, url);
    const { status, headers: resHeaders, body: resBody } = hit.response;
    return new Response(resBody === undefined ? null : JSON.stringify(resBody), {
      status,
      headers: { "content-type": "application/json", ...resHeaders },
    });
  };
  return Object.assign(replay, { calls }) as typeof fetch & {
    calls: Array<{ method: string; url: string }>;
  };
}
