// The deterministic `apply` of the stokvel space (AGENTS.md rule 3): it reads only the entry
// and the view, never the wall clock, the network or randomness. Authority is checked with
// `CapabilityAuth.verify` against the event's own `claimedAt` as log time.
//
// An event that fails a check is not dropped: it stays in the log (logs cannot be edited) and
// the view records `rejected/<event id>` with the reason, so every device sees the same thing.

import { decodeUtf8, encodeUtf8 } from "@shopong/events";
import type { EventEnvelope, JsonObject, JsonValue } from "@shopong/events";
import {
  money,
  type Apply,
  type CapabilityAuth,
  type CapabilityToken,
  type Did,
  type RecordEntry,
  type ViewWriter,
} from "@shopong/ports";
import { CURRENCY } from "./plan.js";

export interface ApplyEnvironment {
  readonly auth: CapabilityAuth;
  /** The `CapabilityAuth` identity every chain must start from: the treasurer who created the space. */
  readonly rootIssuer: Did;
  /** The signing identity behind an envelope `actor`. */
  readonly authorityOf: (actor: string) => Did | undefined;
}

/** Proofs travel in the envelope as hex of the token's UTF-8 bytes (the envelope allows `[A-Za-z0-9_.-]`). */
export function encodeProof(token: string): string {
  let hex = "";
  for (const b of encodeUtf8(token)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function decodeProof(proof: string): CapabilityToken {
  const bytes = new Uint8Array(proof.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(proof.slice(i * 2, i * 2 + 2), 16);
  return decodeUtf8(bytes) as CapabilityToken;
}

type Obj = { [key: string]: JsonValue };

function str(o: JsonObject | Obj | undefined, key: string): string | undefined {
  const v = o?.[key];
  return typeof v === "string" ? v : undefined;
}

function num(o: JsonObject | Obj | undefined, key: string): number | undefined {
  const v = o?.[key];
  return typeof v === "number" ? v : undefined;
}

function asObj(v: JsonValue | undefined): Obj | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : undefined;
}

interface Requirement {
  readonly can: string;
  /** Money ceiling the action must fit under. */
  readonly amountMinor?: number;
}

/** The ability each event type needs. `undefined`: this space does not act on the type. */
function requirementOf(event: EventEnvelope): Requirement | undefined {
  const p = event.payload;
  switch (event.type) {
    case "member.invited":
      return { can: "member/invite" };
    case "member.joined":
      return { can: "member/join" };
    case "role.granted":
      return { can: "role/grant" };
    case "order.proposed":
      return { can: "order/propose" };
    case "order.approved":
      return { can: "order/approve" };
    case "order.closed":
      return { can: "order/close" };
    case "quote.added":
      return { can: "quote/add" };
    case "quote.selected":
      return { can: "quote/select" };
    case "pledge.created":
      return { can: "pledge/create" };
    case "payment.requested":
      // The treasurer's decision to pay the supplier is bounded by the ceiling; the OCN Node's
      // request for a member's pay-in is a result event it records.
      return str(p, "direction") === "out"
        ? { can: "payment/approve", amountMinor: num(p, "amountMinor") ?? Number.MAX_SAFE_INTEGER }
        : { can: "payment/record" };
    case "payment.completed":
    case "payment.failed":
      return { can: "payment/record" };
    case "delivery.planned":
      return { can: "delivery/plan" };
    case "delivery.confirmed":
      return { can: "delivery/confirm" };
    case "collection.confirmed":
      return { can: "collection/confirm" };
    default:
      return undefined;
  }
}

export function createApply(env: ApplyEnvironment): Apply<EventEnvelope> {
  async function authorised(event: EventEnvelope, need: Requirement): Promise<string | undefined> {
    const token = event.proof[0];
    if (token === undefined) return "no capability proof";
    const holder = env.authorityOf(event.actor);
    if (holder === undefined) return "unknown actor";
    const verified = await env.auth.verify(decodeProof(token), {
      required: {
        with: `ocn:space/${event.space}`,
        can: need.can,
        ...(need.amountMinor === undefined ? {} : { ceiling: money(CURRENCY, need.amountMinor) }),
      },
      rootIssuer: env.rootIssuer,
      logTime: event.claimedAt,
      audience: holder,
    });
    return verified.ok ? undefined : `${verified.error.code}: ${verified.error.message}`;
  }

  async function getObj(view: ViewWriter, key: string): Promise<Obj | undefined> {
    return asObj(await view.get(key));
  }

  /** Per-attempt bookkeeping: `attempts/<member>/<n>`, so a retry never overwrites the first try. */
  async function updateAttempt(
    view: ViewWriter,
    member: string,
    attempt: number,
    patch: Obj,
  ): Promise<void> {
    const key = `attempts/${member}/${String(attempt)}`;
    await view.put(key, { ...(await getObj(view, key)), ...patch });
  }

  async function setOrderStatus(view: ViewWriter, status: string): Promise<void> {
    const order = await getObj(view, "order");
    if (order !== undefined) await view.put("order", { ...order, status });
  }

  /** Returns the reason an event is refused after authority passed, or undefined to accept. */
  async function applyOne(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    host: Parameters<Apply<EventEnvelope>>[2],
  ): Promise<string | undefined> {
    const event = entry.event;
    const p = event.payload;
    const actor = await getObj(view, `actors/${event.actor}`);
    const actorKey = str(actor, "key");
    const order = await getObj(view, "order");
    const status = str(order, "status");

    switch (event.type) {
      case "member.joined": {
        if (p.founder === true) {
          if ((await view.get("community")) !== undefined) return "the stokvel already exists";
          await view.put("community", { ...asObj(p.community), treasurer: event.actor });
          await view.put(`actors/${event.actor}`, {
            key: str(p, "member") ?? "",
            role: "treasurer",
            state: "joined",
          });
          return undefined;
        }
        if (actor === undefined || actor.state !== "invited") return "not invited";
        await view.put(`actors/${event.actor}`, { ...actor, state: "joined" });
        return undefined;
      }
      case "member.invited": {
        const invitee = str(p, "invitee");
        if (invitee === undefined) return "no invitee";
        await view.put(`actors/${invitee}`, {
          key: str(p, "member") ?? "",
          role: "member",
          state: "invited",
        });
        await host.addWriter(invitee as Did);
        return undefined;
      }
      case "role.granted": {
        const grantee = str(p, "grantee");
        if (grantee === undefined) return "no grantee";
        await view.put(`actors/${grantee}`, {
          key: str(p, "key") ?? "",
          role: str(p, "role") ?? "",
          state: "joined",
        });
        await host.addWriter(grantee as Did);
        return undefined;
      }
      case "order.proposed": {
        if (actor?.state !== "joined") return "only joined members propose orders";
        if (order !== undefined) return "an order is already open";
        await view.put("order", { ...p, status: "proposed", proposedBy: actorKey ?? "" });
        return undefined;
      }
      case "order.approved": {
        if (status !== "proposed") return "nothing to approve";
        await setOrderStatus(view, "open");
        return undefined;
      }
      case "quote.added": {
        if (status !== "open") return "quotes open once the order is approved";
        await view.put(`quotes/${str(p, "supplier") ?? "?"}`, p);
        return undefined;
      }
      case "quote.selected": {
        const quote = await getObj(view, `quotes/${str(p, "supplier") ?? "?"}`);
        if (status !== "open" || quote === undefined) return "no such quote to select";
        await view.put("selected", {
          supplier: str(quote, "supplier") ?? "",
          name: str(quote, "name") ?? "",
          totalMinor: num(quote, "totalMinor") ?? 0,
        });
        await setOrderStatus(view, "quote-selected");
        return undefined;
      }
      case "pledge.created": {
        const member = str(p, "member");
        if (actor?.state !== "joined" || actorKey !== member)
          return "members pledge only for themselves";
        if (status !== "quote-selected" && status !== "funded")
          return "pledges open once a quote is selected";
        const existing = await getObj(view, `pledges/${member ?? "?"}`);
        if (existing !== undefined && existing.state === "paid") return "already paid";
        const attempt = num(p, "attempt") ?? 1;
        await view.put(`pledges/${member ?? "?"}`, {
          amountMinor: num(p, "amountMinor") ?? 0,
          state: "pledged",
          attempt,
          pledgeEvent: entry.id,
        });
        await updateAttempt(view, member ?? "?", attempt, {
          pledgeEvent: entry.id,
          amountMinor: num(p, "amountMinor") ?? 0,
          state: "pledged",
        });
        return undefined;
      }
      case "payment.requested": {
        if (str(p, "direction") === "out") {
          const selected = await getObj(view, "selected");
          if (status !== "funded") return "the pool is not funded yet";
          if (num(p, "amountMinor") !== num(selected, "totalMinor"))
            return "amount differs from the selected quote";
          await view.put("supplier", {
            state: "requested",
            amountMinor: num(p, "amountMinor") ?? 0,
            supplier: str(p, "supplier") ?? "",
            decisionEvent: entry.id,
          });
          return undefined;
        }
        const member = str(p, "member") ?? "?";
        const pledge = await getObj(view, `pledges/${member}`);
        if (pledge === undefined || pledge.pledgeEvent !== str(p, "pledgeEvent"))
          return "no matching pledge";
        await view.put(`pledges/${member}`, { ...pledge, state: "requested" });
        await updateAttempt(view, member, num(p, "attempt") ?? 1, {
          state: "requested",
          paymentId: str(p, "paymentId") ?? "",
        });
        return undefined;
      }
      case "payment.completed": {
        if (str(p, "direction") === "out") {
          const supplier = await getObj(view, "supplier");
          if (supplier?.decisionEvent !== str(p, "decisionEvent"))
            return "no matching payout decision";
          await view.put("supplier", { ...supplier, state: "paid" });
          await setOrderStatus(view, "supplier-paid");
          return undefined;
        }
        const member = str(p, "member") ?? "?";
        const pledge = await getObj(view, `pledges/${member}`);
        if (pledge === undefined || pledge.pledgeEvent !== str(p, "pledgeEvent"))
          return "no matching pledge";
        await view.put(`pledges/${member}`, { ...pledge, state: "paid" });
        await updateAttempt(view, member, num(p, "attempt") ?? 1, { state: "paid" });
        const target = num(await getObj(view, "selected"), "totalMinor");
        let paid = 0;
        for (const e of await view.list("pledges/")) {
          const v = asObj(e.value);
          if (v?.state === "paid") paid += num(v, "amountMinor") ?? 0;
        }
        if (status === "quote-selected" && target !== undefined && paid >= target) {
          await setOrderStatus(view, "funded");
        }
        return undefined;
      }
      case "payment.failed": {
        const member = str(p, "member") ?? "?";
        const pledge = await getObj(view, `pledges/${member}`);
        if (pledge === undefined || pledge.pledgeEvent !== str(p, "pledgeEvent"))
          return "no matching pledge";
        await view.put(`pledges/${member}`, { ...pledge, state: "failed" });
        await updateAttempt(view, member, num(p, "attempt") ?? 1, { state: "failed" });
        return undefined;
      }
      case "delivery.planned": {
        if (status !== "supplier-paid") return "delivery is planned once the supplier is paid";
        await view.put("delivery", { ...p, state: "planned" });
        await setOrderStatus(view, "delivery-planned");
        return undefined;
      }
      case "delivery.confirmed": {
        const delivery = await getObj(view, "delivery");
        if (status !== "delivery-planned" || delivery === undefined)
          return "no delivery to confirm";
        await view.put("delivery", {
          ...delivery,
          state: "delivered",
          proof: str(p, "photoSha512") ?? "",
        });
        await setOrderStatus(view, "delivered");
        return undefined;
      }
      case "collection.confirmed": {
        const member = str(p, "member");
        if (status !== "delivered") return "nothing delivered yet";
        if (event.actor !== member) return "members confirm only their own collection";
        await view.put(`collections/${member ?? "?"}`, { event: entry.id });
        return undefined;
      }
      case "order.closed": {
        if (status !== "delivered") return "the order is not delivered";
        if ((await view.list("collections/")).length < (await view.list("pledges/")).length) {
          return "not every member has collected";
        }
        await view.put("closed", p);
        await setOrderStatus(view, "closed");
        return undefined;
      }
      default:
        return undefined;
    }
  }

  return async (entries, view, host) => {
    for (const entry of entries) {
      const need = requirementOf(entry.event);
      if (need === undefined) continue;
      const reason = (await authorised(entry.event, need)) ?? (await applyOne(entry, view, host));
      if (reason !== undefined) {
        await view.put(`rejected/${entry.id}`, { type: entry.event.type, reason });
      }
    }
  };
}
