// The simulated payment routes (story 4.4): the webhook the processor would call, and the simulated bank page a
// member would be sent to. Every answer carries `simulated: true`, and so does every audit line.
//
// The bank page's address is the capability: its payment id is 128 random bits (review item 1), and a guessed or
// unknown id gets the same 404 as any other. The webhook is verified by the adapter's `ingestWebhook`, the same path
// the real adapter will use. The bank page's buttons go through `actAsPayer`, which signs a delivery with the Node's
// key and checks it on the same path, refuses an expired request, and never flags a late completion.

import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { requestRef, stitchAmount, type SimulatedStitch } from "@shopong/adapter-stitch-sim";
import type { PaymentRequest, WebhookDelivery } from "@shopong/ports";
import {
  confirmDelivery,
  messageOf,
  WriteStopped,
  type Confirmation,
  type ConfirmationDeps,
  type WriteProblem,
} from "./payment-confirmation.ts";

const PROBLEM_STATUS: Readonly<Record<string, number>> = {
  invalid_signature: 401,
  malformed: 400,
  unknown_payment: 404,
  books_written: 503,
  record_written: 503,
  status_written: 503,
  state_unwritten: 503,
};

type Verdict =
  | {
      readonly ok: true;
      readonly kind: "pay_in" | "pay_out";
      /** Log reference only (`requestRef`), never the payment id. */
      readonly ref: string;
      readonly status: string | undefined;
      readonly applied: boolean;
      readonly lateCompletion: boolean;
      readonly flagged?: string;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * With confirmation wired (story 4.5, the Node's path), a pay-in is confirmed by `confirmDelivery`: the signature is
 * verified first, then the books, the record and the status are written in order. A body that is not a pay-in event
 * goes to the pay-out side. Without it, the pay-in side ingests the delivery as before (story 4.4).
 *
 * Each side verifies the signature itself, so a refused signature is refused on the first side and never reaches the second.
 */
async function deliver(
  simulated: SimulatedStitch,
  delivery: WebhookDelivery,
  confirmation: ConfirmationDeps | undefined,
): Promise<Verdict> {
  if (confirmation !== undefined) {
    const confirmed: Confirmation = await confirmDelivery(confirmation, delivery);
    if (confirmed.kind === "refused") {
      return {
        ok: false,
        code: confirmed.problem,
        message: "The webhook signature does not verify.",
      };
    }
    if (confirmed.kind === "not_acknowledged") {
      return { ok: false, code: confirmed.problem, message: confirmed.message };
    }
    if (confirmed.kind === "answered") {
      return {
        ok: true,
        kind: "pay_in",
        ref: confirmed.ref,
        status: confirmed.status,
        applied: confirmed.applied,
        lateCompletion: confirmed.lateCompletion,
        ...(confirmed.flagged === undefined ? {} : { flagged: confirmed.flagged }),
      };
    }
  } else {
    const asPayIn = await simulated.payIn.ingestWebhook(delivery);
    if (asPayIn.ok) {
      return {
        ok: true,
        kind: "pay_in",
        ref: requestRef(asPayIn.value.payment.id),
        status: asPayIn.value.payment.status,
        applied: asPayIn.value.applied,
        lateCompletion: asPayIn.value.lateCompletion,
      };
    }
    if (asPayIn.error.code !== "malformed") {
      return { ok: false, code: asPayIn.error.code, message: asPayIn.error.message };
    }
  }
  const asPayOut = await simulated.payOut.ingestWebhook(delivery);
  if (asPayOut.ok) {
    return {
      ok: true,
      kind: "pay_out",
      ref: requestRef(asPayOut.value.payment.id),
      status: asPayOut.value.payment.status,
      applied: asPayOut.value.applied,
      lateCompletion: false,
    };
  }
  return { ok: false, code: asPayOut.error.code, message: asPayOut.error.message };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (c) => {
    const entity: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entity[c] ?? c;
  });
}

/** The one simulation banner, at the top of every bank page and every answer the bank page gives. */
const BANNER =
  '<p role="alert" style="background:#fde68a;padding:12px;border:2px solid #b45309">' +
  "<strong>SIMULATED STITCH.</strong> No real money moves and no bank is contacted. " +
  "This is a test page run by the OCN Node. It is not Stitch.</p>";

const HTML = "text/html; charset=utf-8";

/** A whole page. `content` never includes the banner; the page adds it once. */
function page(title: string, content: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title></head>`,
    `<body>${BANNER}${content}</body></html>`,
  ].join("");
}

/** Safe for every time a JavaScript Date can hold; never throws (review item 10). */
function timeText(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString();
}

function bankContent(request: PaymentRequest, late: boolean): string {
  const amount = stitchAmount(request.amount.minor) ?? "0.00";
  const id = escapeHtml(request.id);
  let action: string;
  if (request.status === "pending") {
    action =
      `<form method="post" action="/simulated-bank/${id}/approve" style="display:inline">` +
      '<button type="submit">Approve test payment</button></form> ' +
      `<form method="post" action="/simulated-bank/${id}/cancel" style="display:inline">` +
      '<button type="submit">Cancel</button></form>';
  } else if (request.status === "expired") {
    action = "<p>This payment request has expired.</p>";
  } else {
    action = `<p>This request is ${escapeHtml(request.status)}. Nothing more can happen to it.</p>`;
  }
  const lateNote = late
    ? "<p>A payment arrived after this request expired. It was not applied and has been flagged for the operator (simulated).</p>"
    : "";
  return [
    `<h1>Pay R${escapeHtml(amount)} (simulated)</h1>`,
    `<p>Status: ${escapeHtml(request.status)}</p>`,
    `<p>Expires: ${escapeHtml(timeText(request.expireAt))}</p>`,
    lateNote,
    action,
  ].join("");
}

function notFound(reply: FastifyReply) {
  return reply
    .code(404)
    .type(HTML)
    .send(page("Not found", "<p>No simulated payment request has that id.</p>"));
}

function unavailable(reply: FastifyReply) {
  return reply
    .code(503)
    .type(HTML)
    .send(page("Unavailable", "<p>This page cannot be used right now. Nothing was changed.</p>"));
}

/**
 * The bank page's routes, in their own scope. A plain HTML form posts `application/x-www-form-urlencoded` (often
 * with an empty body) or no content type at all, so this scope accepts any body as text, and its answers carry
 * headers that stop framing and caching (review items 2 and 3).
 */
function bankPlugin(
  simulated: SimulatedStitch,
  confirmation: ConfirmationDeps | undefined,
): FastifyPluginAsync {
  return async (bank) => {
    bank.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
    bank.addHook("onSend", async (_request, reply, payload) => {
      reply.header("x-frame-options", "DENY");
      reply.header(
        "content-security-policy",
        "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      );
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      return payload;
    });

    bank.get<{ Params: { id: string } }>("/simulated-bank/:id", async (request, reply) => {
      try {
        const current = await simulated.payIn.getRequest(request.params.id);
        if (current === undefined) return notFound(reply);
        const late = simulated.lateCompletions().some((l) => l.paymentId === current.id);
        return reply
          .type(HTML)
          .send(page("Simulated Stitch payment page", bankContent(current, late)));
      } catch {
        return unavailable(reply);
      }
    });

    for (const [action, outcome] of [
      ["approve", "completed"],
      ["cancel", "cancelled"],
    ] as const) {
      bank.post<{ Params: { id: string } }>(
        `/simulated-bank/:id/${action}`,
        async (request, reply) => {
          const id = request.params.id;
          try {
            if (confirmation !== undefined) {
              // The page's buttons go through the same confirmation as a webhook: the books, the record, then the status.
              const current = await simulated.payIn.getRequest(id);
              if (current === undefined) return notFound(reply);
              if (current.status === "expired") {
                request.log.warn(
                  {
                    audit: "simulated_bank",
                    simulated: true,
                    action,
                    requestRef: requestRef(id),
                    outcome: "expired",
                    requestId: request.id,
                  },
                  `simulated bank ${action} refused (simulated)`,
                );
                return reply
                  .code(409)
                  .type(HTML)
                  .send(page("Expired", "<p>This payment request has expired.</p>"));
              }
              const delivery = await simulated.payIn.settle(id, outcome);
              const confirmed = await confirmDelivery(confirmation, delivery);
              if (confirmed.kind !== "answered") return unavailable(reply);
              request.log.info(
                {
                  audit: "simulated_bank",
                  simulated: true,
                  action,
                  requestRef: requestRef(id),
                  outcome: confirmed.applied ? "applied" : (confirmed.flagged ?? "not_applied"),
                  requestId: request.id,
                },
                `simulated bank ${action} (simulated)`,
              );
              return reply.code(303).header("location", `/simulated-bank/${id}`).send();
            }
            const result = await simulated.payIn.actAsPayer(id, outcome);
            const ref = requestRef(id);
            if (!result.ok) {
              if (result.error.code === "unknown_payment") return notFound(reply);
              request.log.warn(
                {
                  audit: "simulated_bank",
                  simulated: true,
                  action,
                  requestRef: ref,
                  outcome: result.error.code,
                  requestId: request.id,
                },
                `simulated bank ${action} refused (simulated)`,
              );
              if (result.error.code === "expired") {
                return reply
                  .code(409)
                  .type(HTML)
                  .send(page("Expired", "<p>This payment request has expired.</p>"));
              }
              return unavailable(reply);
            }
            const outcomeText = result.value.applied ? "applied" : "not_applied";
            request.log.info(
              {
                audit: "simulated_bank",
                simulated: true,
                action,
                requestRef: ref,
                outcome: outcomeText,
                requestId: request.id,
              },
              `simulated bank ${action} (simulated)`,
            );
            return reply.code(303).header("location", `/simulated-bank/${id}`).send();
          } catch (error) {
            if (error instanceof WriteStopped) {
              request.log.error(
                {
                  audit: "simulated_bank",
                  simulated: true,
                  action,
                  problem: error.problem,
                  requestId: request.id,
                },
                `simulated bank ${action} stopped part way (simulated)`,
              );
              return reply
                .code(503)
                .type(HTML)
                .send(page("Unavailable", `<p>${escapeHtml(messageOf(error.problem))}</p>`));
            }
            return unavailable(reply);
          }
        },
      );
    }
  };
}

/**
 * Registers the simulated payment routes. With `confirmation`, a verified completion is written to the books and the
 * record in order (story 4.5). Unknown requests are acknowledged and flagged, not refused.
 */
export function registerPaymentRoutes(
  app: FastifyInstance,
  simulated: SimulatedStitch,
  confirmation?: ConfirmationDeps,
): void {
  app.post("/webhooks/payments", async (request, reply) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers[name.toLowerCase()] = value;
    }
    let verdict: Verdict;
    try {
      verdict = await deliver(simulated, { headers, body: request.rawBody }, confirmation);
    } catch (error) {
      // A write stopped partway: the problem names what was written, so the message is true (review item 6).
      const problem: WriteProblem =
        error instanceof WriteStopped ? error.problem : "state_unwritten";
      request.log.error(
        {
          audit: "payment_webhook",
          simulated: true,
          outcome: "not_acknowledged",
          problem,
          requestId: request.id,
        },
        `simulated Stitch webhook stopped part way: ${problem} (simulated)`,
      );
      return reply.code(503).send({
        simulated: true,
        problem,
        message: messageOf(problem),
        requestId: request.id,
      });
    }
    if (!verdict.ok) {
      const unavailableNow = PROBLEM_STATUS[verdict.code] === 503;
      request.log.warn(
        {
          audit: "payment_webhook",
          simulated: true,
          outcome: unavailableNow ? "not_acknowledged" : "refused",
          problem: verdict.code,
          requestId: request.id,
        },
        unavailableNow
          ? "simulated Stitch webhook not acknowledged: the provider should send it again (simulated)"
          : "simulated Stitch webhook refused (simulated)",
      );
      return reply.code(PROBLEM_STATUS[verdict.code] ?? (unavailableNow ? 503 : 400)).send({
        simulated: true,
        problem: verdict.code,
        message: verdict.message,
        requestId: request.id,
      });
    }
    const outcome = verdict.applied
      ? "applied"
      : verdict.flagged !== undefined
        ? "flagged"
        : verdict.lateCompletion
          ? "late_completion"
          : "not_applied";
    request.log.info(
      {
        audit: "payment_webhook",
        simulated: true,
        outcome,
        kind: verdict.kind,
        requestRef: verdict.ref,
        status: verdict.status,
        ...(verdict.flagged === undefined ? {} : { flagged: verdict.flagged }),
        requestId: request.id,
      },
      "simulated Stitch webhook handled (simulated)",
    );
    return reply.code(200).send({
      simulated: true,
      applied: verdict.applied,
      status: verdict.status,
      lateCompletion: verdict.lateCompletion,
      ...(verdict.flagged === undefined ? {} : { flagged: verdict.flagged }),
      requestId: request.id,
    });
  });

  app.register(bankPlugin(simulated, confirmation));
}
