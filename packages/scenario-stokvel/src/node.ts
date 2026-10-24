// What the OCN Node does for the scenario (architecture 3.3): it watches the record, performs
// each external effect with the event id as the idempotency key, then appends a result event.
// Every function here is safe to call again: the ports recognise the key and create nothing new.

import { type Did, type EventId, money } from "@shopong/ports";
import { CURRENCY, DAY_MS, SUPPLIER_BANK } from "./plan.js";
import { formatZar } from "./format.js";
import type { World } from "./world.js";

export interface NodeResult {
  readonly done: boolean;
  /** Why the Node did nothing, in words. */
  readonly reason?: string;
}

const ACCOUNT_POOL = "assets:bank/pool";
export const memberAccount = (memberKey: string): string => `liabilities:member/${memberKey}`;
export { ACCOUNT_POOL };

/** Create the pay-in request for a pledge, keyed by the pledge's event id, and record it. */
export async function requestPledgePayment(
  world: World,
  pledgeId: EventId,
  pledge: { member: string; amountMinor: number; attempt: number },
  at: number,
): Promise<{ result: NodeResult; paymentId?: string }> {
  if (!(await world.isAccepted(pledgeId))) {
    return { result: { done: false, reason: "the record did not accept the pledge" } };
  }
  const node = world.person("node");
  world.clock.set(at);
  const created = await world.payIn.createRequest({
    amount: money(CURRENCY, pledge.amountMinor),
    externalReference: pledgeId,
    payerReference: `UBUNTU ${pledge.member.toUpperCase()}`,
    beneficiaryReference: "UBUNTU ORDER 1",
    expireAt: at + 3 * DAY_MS,
    payerId: pledge.member,
  });
  if (!created.ok) throw new Error(`pay-in request refused: ${created.error.message}`);
  const request = created.value;
  // The memory PayIn returns the same request for the same key; seeing the id again means replay.
  const replayed = world.effects.some((e) => e.kind === "payin.request" && e.key === pledgeId);
  world.effects.push({ kind: "payin.request", key: pledgeId, replayed });

  const person = world.person(pledge.member);
  await world.emit(
    node,
    "payment.requested",
    {
      direction: "in",
      member: pledge.member,
      pledgeEvent: pledgeId,
      paymentId: request.id,
      amountMinor: pledge.amountMinor,
      attempt: pledge.attempt,
    },
    {
      at: at + 1_000,
      label: `payment-requested:${pledge.member}:${String(pledge.attempt)}`,
      show: {
        milestone: "payment-requested",
        title: `A payment request for ${formatZar(pledge.amountMinor)} was sent to ${person.name}`,
        money: { state: "requested", amountMinor: pledge.amountMinor },
      },
    },
  );
  return { result: { done: true }, paymentId: request.id };
}

/**
 * The member's bank reports an outcome and the Node settles: it ingests the signed webhook,
 * records `payment.completed` or `payment.failed`, and for a payment that completed posts the
 * contribution to the books under the result event's id.
 */
export async function settlePledgePayment(
  world: World,
  payment: {
    paymentId: string;
    pledgeId: EventId;
    member: string;
    amountMinor: number;
    attempt: number;
  },
  outcome: "completed" | "failed",
  at: number,
): Promise<void> {
  const node = world.person("node");
  const person = world.person(payment.member);
  const delivery = world.payIn.simulateWebhook(payment.paymentId, outcome);
  const ingested = await world.payIn.ingestWebhook(delivery);
  if (!ingested.ok) throw new Error(`webhook refused: ${ingested.error.message}`);
  // The first webhook decides; a repeat is acknowledged with applied: false and the status stands.
  const status = ingested.value.payment.status;
  const fields = {
    direction: "in",
    member: payment.member,
    pledgeEvent: payment.pledgeId,
    paymentId: payment.paymentId,
    amountMinor: payment.amountMinor,
    attempt: payment.attempt,
  };
  const label = `payment-${status}:${payment.member}:${String(payment.attempt)}`;
  if (status === "failed") {
    await world.emit(
      node,
      "payment.failed",
      { ...fields, reason: "bank declined the payment" },
      {
        at,
        label,
        show: {
          milestone: "payment-failed",
          title: `${person.name}'s payment of ${formatZar(payment.amountMinor)} failed (the bank declined it)`,
          money: { state: "failed", amountMinor: payment.amountMinor },
        },
      },
    );
    return;
  }
  if (status !== "completed") throw new Error(`unexpected payment status ${status}`);
  const completed = await world.emit(node, "payment.completed", fields, {
    at,
    label,
    show: {
      milestone: "payment-received",
      title: `${person.name} paid ${formatZar(payment.amountMinor)} into the pool`,
      money: { state: "paid", amountMinor: payment.amountMinor },
    },
  });
  if (!completed.accepted) return;
  world.clock.set(at);
  const posted = await world.ledger.post({
    idempotencyKey: completed.id,
    description: `Contribution to the pool from ${payment.member}`,
    metadata: { eventSha512: completed.id, spaceKey: world.spaceKey },
    entries: [
      { account: ACCOUNT_POOL, direction: "debit", amount: money(CURRENCY, payment.amountMinor) },
      {
        account: memberAccount(payment.member),
        direction: "credit",
        amount: money(CURRENCY, payment.amountMinor),
      },
    ],
  });
  if (!posted.ok) throw new Error(`ledger refused the contribution: ${posted.error.message}`);
  world.effects.push({ kind: "ledger.post", key: completed.id, replayed: posted.value.replayed });
}

/**
 * Pay the supplier for a treasurer's decision, once the record has accepted it. Refuses
 * (does nothing) when `apply` rejected the decision, for example over the ceiling or before
 * the pool is funded.
 */
export async function paySupplier(
  world: World,
  decisionId: EventId,
  shares: ReadonlyArray<{ member: string; shareMinor: number }>,
  at: number,
): Promise<NodeResult> {
  if (!(await world.isAccepted(decisionId))) {
    return { done: false, reason: "the record did not accept the payout decision" };
  }
  const supplierView = (await world.hub.view.get("supplier")) as
    | { decisionEvent?: string; amountMinor?: number; supplier?: string }
    | undefined;
  if (supplierView?.decisionEvent !== decisionId || supplierView.amountMinor === undefined) {
    return { done: false, reason: "no accepted payout decision with this id" };
  }
  const totalMinor = supplierView.amountMinor;
  const treasurer = world.people.find((p) => p.role === "treasurer");
  if (treasurer === undefined) throw new Error("no treasurer");
  const node = world.person("node");

  const created = await world.payOut.createPayout({
    amount: money(CURRENCY, totalMinor),
    externalReference: decisionId,
    beneficiary: SUPPLIER_BANK,
    beneficiaryReference: "UBUNTU ORDER 1",
    approval: { eventId: decisionId, approvers: [treasurer.actor as Did] },
  });
  if (!created.ok) throw new Error(`payout refused: ${created.error.message}`);
  const replayed = world.effects.some((e) => e.kind === "payout.create" && e.key === decisionId);
  world.effects.push({ kind: "payout.create", key: decisionId, replayed });

  const delivery = world.payOut.simulateWebhook(created.value.id, "completed");
  const ingested = await world.payOut.ingestWebhook(delivery);
  if (!ingested.ok) throw new Error(`webhook refused: ${ingested.error.message}`);
  if (ingested.value.payment.status !== "completed") {
    return { done: false, reason: `payout is ${ingested.value.payment.status}` };
  }

  const completed = await world.emit(
    node,
    "payment.completed",
    {
      direction: "out",
      decisionEvent: decisionId,
      payoutId: created.value.id,
      supplier: supplierView.supplier ?? "",
      amountMinor: totalMinor,
    },
    {
      at,
      label: "payment-completed:supplier",
      show: {
        milestone: "supplier-paid",
        title: `Supplier paid: ${SUPPLIER_BANK.name.replace(" (Pty) Ltd", "")} received ${formatZar(totalMinor)}`,
        money: { state: "paid", amountMinor: totalMinor },
      },
    },
  );
  if (!completed.accepted)
    return { done: false, reason: "the record did not accept the payout result" };
  world.clock.set(at);
  const posted = await world.ledger.post({
    idempotencyKey: completed.id,
    description: "Supplier paid out of the pool",
    metadata: { eventSha512: completed.id, spaceKey: world.spaceKey },
    entries: [
      ...shares.map((s) => ({
        account: memberAccount(s.member),
        direction: "debit" as const,
        amount: money(CURRENCY, s.shareMinor),
      })),
      { account: ACCOUNT_POOL, direction: "credit", amount: money(CURRENCY, totalMinor) },
    ],
  });
  if (!posted.ok) throw new Error(`ledger refused the supplier payment: ${posted.error.message}`);
  world.effects.push({ kind: "ledger.post", key: completed.id, replayed: posted.value.replayed });
  return { done: true };
}
