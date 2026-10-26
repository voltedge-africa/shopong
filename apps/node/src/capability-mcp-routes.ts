// The HTTP face of the OCN Capability MCP server (story 11.2).
//
// `POST /mcp` speaks the MCP tools subset of JSON-RPC 2.0 (initialize, ping, tools/list, tools/call), so an agent runtime
// can use it as a remote MCP server. The session's UCAN comes as `Authorization: Bearer <token>` and the session as
// `Mcp-Session-Id`; both are checked on every call by the server. A money tool answers `needs_confirmation` and runs nothing.
//
// `POST /capability/confirm` is where the member answers. It is signed by the member's key (the same signed-request check
// as the other routes), and the signer must be the member the session acts for. It is NOT reachable through `/mcp`.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CapabilityAuth, CapabilityToken, EpochMs } from "@shopong/ports";
import type { CapabilityServer } from "./capability-mcp.ts";
import { nodeMessage, HTTP_STATUS } from "./authority.ts";
import { checkSignedRequest, DEFAULT_MAX_NONCES, headerOf, SeenNonces } from "./signed.ts";

export interface CapabilityRouteOptions {
  readonly server: CapabilityServer;
  readonly auth: CapabilityAuth;
  readonly now?: () => EpochMs;
}

const PROTOCOL_VERSION = "2025-06-18";

const rpc = z.looseObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
const callParams = z.looseObject({ name: z.string(), arguments: z.unknown().optional() });
const confirmBody = z.strictObject({
  id: z.string().min(1).max(100),
  decision: z.enum(["approve", "decline"]),
});

type Id = string | number | null;
const reply = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fault = (id: Id, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export function registerCapabilityRoutes(
  app: FastifyInstance,
  options: CapabilityRouteOptions,
): void {
  const { server } = options;
  const clock = options.now ?? Date.now;

  app.post("/mcp", async (request, reply_) => {
    let raw: unknown;
    try {
      raw = JSON.parse(request.rawBody) as unknown;
    } catch {
      return reply_.send(fault(null, -32700, "Parse error"));
    }
    const parsed = rpc.safeParse(raw);
    if (!parsed.success) return reply_.send(fault(null, -32600, "Invalid request"));
    const { id, method, params } = parsed.data;
    const rid: Id = id ?? null;
    if (id === undefined) return reply_.code(202).send(); // a notification

    switch (method) {
      case "initialize":
        return reply_.send(
          reply(rid, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "ocn-capability", version: "0.1.0" },
          }),
        );
      case "ping":
        return reply_.send(reply(rid, {}));
      case "tools/list":
        return reply_.send(
          reply(rid, {
            tools: server.catalogue().map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: {
                readOnlyHint: tool.kind === "read",
                destructiveHint: tool.kind === "money",
              },
              _meta: { ability: tool.ability, kind: tool.kind },
            })),
          }),
        );
      case "tools/call": {
        const call = callParams.safeParse(params);
        if (!call.success) return reply_.send(fault(rid, -32602, "Invalid params"));
        const authorization = headerOf(request, "authorization") ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        const sessionId = headerOf(request, "mcp-session-id") ?? "";
        if (sessionId === "") {
          return reply_.send(fault(rid, -32602, "Send the session in the Mcp-Session-Id header."));
        }
        const result = await server.call(call.data.name, (call.data.arguments ?? {}) as never, {
          sessionId,
          capability: token as CapabilityToken,
        });
        switch (result.status) {
          case "ok":
            return reply_.send(
              reply(rid, {
                content: [{ type: "text", text: JSON.stringify(result.output) }],
                isError: false,
              }),
            );
          case "needs_confirmation":
            return reply_.send(
              reply(rid, {
                content: [
                  {
                    type: "text",
                    text: "Waiting for the member to approve. Nothing has been done. Do not try again.",
                  },
                ],
                structuredContent: {
                  status: "needs_confirmation",
                  confirmationId: result.confirmation.id,
                  summary: result.confirmation.summary,
                },
                isError: false,
              }),
            );
          case "denied":
            return reply_.send(
              reply(rid, { content: [{ type: "text", text: result.reason }], isError: true }),
            );
          case "error":
            return reply_.send(
              reply(rid, { content: [{ type: "text", text: result.message }], isError: true }),
            );
        }
        break;
      }
      default:
        return reply_.send(fault(rid, -32601, "Method not found"));
    }
    return reply_.send(fault(rid, -32603, "Internal error"));
  });

  const gate = { auth: options.auth, nonces: new SeenNonces(DEFAULT_MAX_NONCES), clock };
  app.post("/capability/confirm", async (request, reply_) => {
    const checked = await checkSignedRequest(gate, request);
    if (!checked.ok) {
      const message = nodeMessage(checked.problem);
      request.log.warn(
        {
          audit: "capability.confirm",
          outcome: "refused",
          problem: checked.problem,
          requestId: request.id,
        },
        message,
      );
      return reply_
        .code(HTTP_STATUS[checked.problem] ?? 403)
        .send({ done: false, problem: checked.problem, reason: message });
    }
    let body: z.infer<typeof confirmBody>;
    try {
      body = confirmBody.parse(JSON.parse(request.rawBody));
    } catch {
      return reply_
        .code(400)
        .send({ done: false, problem: "invalid_request", reason: nodeMessage("invalid_request") });
    }
    const result = await server.confirm(body.id, checked.actor, body.decision);
    if (!result.ok) {
      const status = result.problem === "run_failed" ? 502 : 403;
      return reply_
        .code(status)
        .send({ done: false, problem: result.problem, reason: result.reason });
    }
    return reply_.send({ done: true, decision: result.decision });
  });
}
