// The scripted order, one step per press of "Next step". A step is a function of the world and
// of its own start time: every event it writes uses a label and a time derived from the step,
// so running it again builds the same events (same ids) and the ports recognise the keys.

import {
  commitAddress,
  encodeUtf8,
  routeFingerprint,
  sha512Hex,
  type HmacSha512,
  type JsonValue,
} from "@shopong/events";
import { asEventId } from "@shopong/ports";
import { formatDate, formatDateTime, formatZar, pluralise } from "./format.js";
import {
  ACCOUNT_POOL,
  memberAccount,
  paySupplier,
  requestPledgePayment,
  settlePledgePayment,
} from "./node.js";
import {
  CEILING_MINOR,
  CHOSEN_SUPPLIER,
  COLLECTION_POINT,
  CONTRIBUTION_MINOR,
  CURRENCY,
  DAY_MS,
  DECLINED_MEMBER,
  DRIVER,
  MEMBERS,
  MINUTE_MS,
  NODE,
  ORDER_ITEMS,
  PLEDGE_ROUNDING_MINOR,
  STOKVEL_NAME,
  SUPPLIERS,
  SUPPLIER_DEPOT,
  quoteTotalMinor,
} from "./plan.js";
import type { World } from "./world.js";

export interface StepDefinition {
  readonly id: string;
  /** What this step does, shown on the "Next step" button before it runs. */
  readonly title: string;
  readonly run: (world: World, startAt: number) => Promise<void>;
}

type Obj = { [key: string]: JsonValue };

async function viewObj(world: World, key: string): Promise<Obj | undefined> {
  await world.hub.update();
  const value = await world.hub.view.get(key);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

/** A fictional community secret for the scenario's address commitments. Not a real secret. */
const SCENARIO_SECRET = new Uint8Array(32).fill(0x2a);

/** HMAC-SHA512 from the Web Crypto API, the scenario's stand-in for the Node's HMAC. */
const webHmac: HmacSha512 = async (key, message) => {
  const subtle = globalThis.crypto.subtle;
  const material = new Uint8Array(key);
  const data = new Uint8Array(message);
  const cryptoKey = await subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return new Uint8Array(await subtle.sign("HMAC", cryptoKey, data));
};

/** The opaque place id the scenario gives a place: 64 hex characters, from the label (deterministic). */
async function placeIdOf(w: World, label: string): Promise<string> {
  return (await sha512Hex(encodeUtf8(`place/${label}`), w.sha512)).slice(0, 64);
}
const at = (start: number, n: number): number => start + n * MINUTE_MS;

/** Split a total over `count` members in whole cents: the first few pay a cent more if it does not divide. */
export function sharesOf(totalMinor: number, count: number): number[] {
  const base = Math.floor(totalMinor / count);
  const extra = totalMinor - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The pledge: the biggest share rounded up to a round amount, so the difference can be credited back. */
export function pledgeFor(totalMinor: number, count: number): number {
  const biggest = Math.max(...sharesOf(totalMinor, count));
  return Math.ceil(biggest / PLEDGE_ROUNDING_MINOR) * PLEDGE_ROUNDING_MINOR;
}

async function selectedTotal(world: World): Promise<number> {
  const selected = await viewObj(world, "selected");
  if (typeof selected?.totalMinor !== "number") throw new Error("no quote has been selected yet");
  return selected.totalMinor;
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

async function attemptOf(world: World, member: string, attempt: number) {
  const v = await viewObj(world, `attempts/${member}/${String(attempt)}`);
  if (v === undefined) throw new Error(`${member} has no attempt ${String(attempt)} yet`);
  return {
    pledgeId: asEventId(text(v.pledgeEvent)),
    paymentId: text(v.paymentId),
    amountMinor: Number(v.amountMinor),
  };
}

async function pledgeAndRequest(
  world: World,
  member: string,
  attempt: number,
  start: number,
  slot: number,
): Promise<void> {
  const person = world.person(member);
  const pledgeMinor = pledgeFor(await selectedTotal(world), MEMBERS.length);
  const first = attempt > 1 ? await attemptOf(world, member, 1) : undefined;
  const pledge = await world.emit(
    person,
    "pledge.created",
    {
      member,
      order: "o1",
      amountMinor: pledgeMinor,
      attempt,
      ...(first === undefined ? {} : { retryOf: first.pledgeId }),
    },
    {
      at: at(start, slot),
      label: `pledge:${member}:${String(attempt)}`,
      show: {
        milestone: "pledge-received",
        title:
          attempt === 1
            ? `${person.name} pledged ${formatZar(pledgeMinor)}`
            : `${person.name} pledged ${formatZar(pledgeMinor)} again, to try paying once more`,
      },
    },
  );
  if (!pledge.accepted) throw new Error(`the record did not accept ${person.name}'s pledge`);
  await requestPledgePayment(
    world,
    pledge.id,
    { member, amountMinor: pledgeMinor, attempt },
    at(start, slot),
  );
}

async function settle(
  world: World,
  member: string,
  attempt: number,
  outcome: "completed" | "failed",
  start: number,
  slot: number,
): Promise<void> {
  const a = await attemptOf(world, member, attempt);
  await settlePledgePayment(
    world,
    { paymentId: a.paymentId, pledgeId: a.pledgeId, member, amountMinor: a.amountMinor, attempt },
    outcome,
    at(start, slot),
  );
}

const others = MEMBERS.filter((m) => m.role !== "treasurer");

export const STEPS: readonly StepDefinition[] = [
  {
    id: "create-stokvel",
    title: "Nomsa starts the stokvel",
    async run(w, t) {
      const treasurer = w.person("m1");
      for (const account of [ACCOUNT_POOL, ...MEMBERS.map((m) => memberAccount(m.key))]) {
        // The pool and every member's claim on it can never go below zero.
        const configured = await w.ledger.configureAccount(account, { guarded: true });
        if (!configured.ok) throw new Error(configured.error.message);
      }
      await w.emit(
        treasurer,
        "member.joined",
        {
          invitation: "founder",
          member: "m1",
          founder: true,
          community: {
            name: STOKVEL_NAME,
            currency: CURRENCY,
            contributionMinor: CONTRIBUTION_MINOR,
            ceilingMinor: CEILING_MINOR,
          },
        },
        {
          at: at(t, 0),
          label: "founder",
          show: {
            milestone: "stokvel-created",
            title: `${treasurer.name} started the ${STOKVEL_NAME}`,
          },
        },
      );
      const node = w.person(NODE.key);
      await w.emit(
        treasurer,
        "role.granted",
        {
          grantee: node.actor,
          key: node.key,
          role: "node",
          expiresAt: at(t, 1) + 90 * 24 * 60 * 60 * 1000,
        },
        {
          at: at(t, 1),
          label: "grant:node",
          show: {
            milestone: "node-authorised",
            title: `${treasurer.name} let the OCN Node record payment results`,
          },
        },
      );
    },
  },
  {
    id: "invite-members",
    title: "Nomsa invites the other four members",
    async run(w, t) {
      const treasurer = w.person("m1");
      let slot = 0;
      for (const m of others) {
        const invitee = w.person(m.key);
        await w.emit(
          treasurer,
          "member.invited",
          {
            invitation: `invite-${m.key}`,
            invitee: invitee.actor,
            expiresAt: at(t, slot) + 90 * 24 * 60 * 60 * 1000,
            member: m.key,
            role: "member",
          },
          {
            at: at(t, slot++),
            label: `invite:${m.key}`,
            show: { milestone: "member-invited", title: `${treasurer.name} invited ${m.name}` },
          },
        );
      }
    },
  },
  {
    id: "members-join",
    title: "The four members join",
    async run(w, t) {
      let slot = 0;
      for (const m of others) {
        const person = w.person(m.key);
        await w.emit(
          person,
          "member.joined",
          { invitation: `invite-${m.key}`, member: m.key },
          {
            at: at(t, slot++),
            label: `join:${m.key}`,
            show: { milestone: "member-joined", title: `${m.name} joined the stokvel` },
          },
        );
      }
    },
  },
  {
    id: "propose-order",
    title: "Thabo proposes a bulk grocery order",
    async run(w, t) {
      const proposer = w.person("m2");
      const budget = CONTRIBUTION_MINOR;
      const deadline = t + 7 * DAY_MS;
      await w.emit(
        proposer,
        "order.proposed",
        {
          name: "o1",
          items: ORDER_ITEMS.map((i) => ({ item: i.name, quantity: i.quantity })),
          budgetPerMemberMinor: budget,
          deadline,
        },
        {
          at: at(t, 0),
          label: "order:proposed",
          show: {
            milestone: "order-proposed",
            title: `${proposer.name} proposed a bulk order of ${pluralise(ORDER_ITEMS.length, "item")}: budget ${formatZar(budget)} each, pledges by ${formatDate(deadline)}`,
          },
        },
      );
    },
  },
  {
    id: "approve-order",
    title: "Nomsa approves the order, so quotes and pledges can open",
    async run(w, t) {
      const treasurer = w.person("m1");
      // The approval names the proposal by its event id (the order's identity, story 8.2).
      const proposal = [...w.events].find(([, event]) => event.type === "order.proposed");
      if (proposal === undefined) throw new Error("no order has been proposed");
      await w.emit(
        treasurer,
        "order.approved",
        { order: proposal[0] },
        {
          at: at(t, 0),
          label: "order:approved",
          show: {
            milestone: "order-approved",
            title: `${treasurer.name} approved the order. Quotes and pledges are open`,
          },
        },
      );
    },
  },
  {
    id: "add-quotes",
    title: "Nomsa adds two supplier quotes",
    async run(w, t) {
      const treasurer = w.person("m1");
      let slot = 0;
      for (const s of SUPPLIERS) {
        const total = quoteTotalMinor(s);
        await w.emit(
          treasurer,
          "quote.added",
          {
            order: "o1",
            supplier: s.key,
            name: s.name,
            deliveryTerms: s.deliveryTerms,
            totalMinor: total,
            lines: ORDER_ITEMS.map((item, i) => ({
              name: item.name,
              quantity: item.quantity,
              unitPriceMinor: s.unitPricesMinor[i] ?? 0,
            })),
          },
          {
            at: at(t, slot++),
            label: `quote:${s.key}`,
            show: {
              milestone: "quote-added",
              title: `${treasurer.name} added a quote from ${s.name}: ${formatZar(total)} (${s.deliveryTerms.toLowerCase()})`,
            },
          },
        );
      }
    },
  },
  {
    id: "select-quote",
    title: "Nomsa chooses the cheaper supplier",
    async run(w, t) {
      const treasurer = w.person("m1");
      const total = quoteTotalMinor(CHOSEN_SUPPLIER);
      await w.emit(
        treasurer,
        "quote.selected",
        {
          order: "o1",
          supplier: CHOSEN_SUPPLIER.key,
          totalMinor: total,
          reason: "lowest total price",
        },
        {
          at: at(t, 0),
          label: "quote:selected",
          show: {
            milestone: "quote-selected",
            title: `${treasurer.name} chose ${CHOSEN_SUPPLIER.name} at ${formatZar(total)}, the lowest price`,
          },
        },
      );
    },
  },
  {
    id: "pledges",
    title: "Every member pledges their share",
    async run(w, t) {
      let slot = 0;
      for (const m of MEMBERS) await pledgeAndRequest(w, m.key, 1, t, slot++ * 2);
    },
  },
  {
    id: "payments",
    title: "Members pay in their banking apps",
    async run(w, t) {
      let slot = 0;
      for (const m of MEMBERS) {
        await settle(w, m.key, 1, m.key === DECLINED_MEMBER ? "failed" : "completed", t, slot++);
      }
    },
  },
  {
    id: "retry-payment",
    title: "Zanele tries again, and her payment goes through",
    async run(w, t) {
      await pledgeAndRequest(w, DECLINED_MEMBER, 2, t, 0);
      await settle(w, DECLINED_MEMBER, 2, "completed", t, 2);
    },
  },
  {
    id: "pool-funded",
    title: "The pool reaches the price of the order",
    async run(w, t) {
      const order = await viewObj(w, "order");
      // `funded`, or any later stage when a finished step is run again.
      const funded = ["funded", "supplier-paid", "delivery-planned", "delivered", "closed"];
      if (!funded.includes(text(order?.status))) throw new Error("the pool is not funded yet");
      const target = await selectedTotal(w);
      const collected = (await w.ledger.balance(ACCOUNT_POOL, CURRENCY)).balance.minor;
      w.addDerivedEntry("pool-funded", {
        milestone: "pool-funded",
        eventType: "(derived from the record)",
        title: `The pool is funded: ${formatZar(collected)} collected, ${formatZar(target)} needed`,
        actorName: "Shared record",
        actorRole: "Everyone's copy",
        at: at(t, 0),
      });
    },
  },
  {
    id: "pay-supplier",
    title: "Nomsa approves paying the supplier",
    async run(w, t) {
      const treasurer = w.person("m1");
      const total = await selectedTotal(w);
      const decision = await w.emit(
        treasurer,
        "payment.requested",
        {
          direction: "out",
          order: "o1",
          supplier: CHOSEN_SUPPLIER.key,
          amountMinor: total,
          approvers: [treasurer.actor],
        },
        {
          at: at(t, 0),
          label: "supplier:decision",
          show: {
            milestone: "supplier-approved",
            title: `${treasurer.name} approved paying ${CHOSEN_SUPPLIER.name} ${formatZar(total)}`,
            money: { state: "requested", amountMinor: total },
          },
        },
      );
      const shares = sharesOf(total, MEMBERS.length).map((shareMinor, i) => ({
        member: MEMBERS[i]?.key ?? "",
        shareMinor,
      }));
      const result = await paySupplier(w, decision.id, shares, at(t, 5));
      if (!result.done) throw new Error(`supplier was not paid: ${result.reason ?? "unknown"}`);
    },
  },
  {
    id: "plan-delivery",
    title: "Nomsa plans delivery to the collection point",
    async run(w, t) {
      const treasurer = w.person("m1");
      const driver = w.person(DRIVER.key);
      await w.emit(
        treasurer,
        "role.granted",
        {
          grantee: driver.actor,
          key: driver.key,
          role: "driver",
          expiresAt: at(t, 0) + 90 * 24 * 60 * 60 * 1000,
        },
        {
          at: at(t, 0),
          label: "grant:driver",
          show: {
            milestone: "driver-assigned",
            title: `${treasurer.name} assigned ${driver.name} as the driver`,
          },
        },
      );
      // The places go into the record by id, label, area and the commitment of the address (AGENTS rule 6). The
      // coordinates stay here, in the scenario's routing, and are not written anywhere.
      const depotId = await placeIdOf(w, SUPPLIER_DEPOT.label);
      const hallId = await placeIdOf(w, COLLECTION_POINT.label);
      await w.emit(
        treasurer,
        "place.registered",
        {
          place: depotId,
          label: SUPPLIER_DEPOT.label,
          area: "Mamelodi",
          addressCommitment: await commitAddress(
            SCENARIO_SECRET,
            `${SUPPLIER_DEPOT.label}, Mamelodi`,
            webHmac,
          ),
        },
        { at: at(t, 0), label: "place:depot" },
      );
      await w.emit(
        treasurer,
        "place.registered",
        {
          place: hallId,
          label: COLLECTION_POINT.label,
          area: "Soweto",
          addressCommitment: await commitAddress(
            SCENARIO_SECRET,
            `${COLLECTION_POINT.label}, Soweto`,
            webHmac,
          ),
        },
        { at: at(t, 0), label: "place:collection" },
      );
      const routed = await w.routing.route({
        origin: SUPPLIER_DEPOT,
        destination: COLLECTION_POINT,
        costing: "auto",
      });
      if (!routed.ok) throw new Error(`no route: ${routed.error.message}`);
      const route = routed.value;
      const fingerprint = await routeFingerprint(route.polyline6, route.tileRelease, w.sha512);
      // 09:00 South African time (07:00 UTC) the next day.
      const windowStart = t - (t % DAY_MS) + DAY_MS + 7 * 60 * MINUTE_MS;
      const windowEnd = windowStart + 2 * 60 * MINUTE_MS;
      const km = (route.distanceMeters / 1000).toFixed(1);
      const minutes = Math.round(route.durationSeconds / 60);
      await w.emit(
        treasurer,
        "delivery.planned",
        {
          order: "o1",
          driver: driver.actor,
          origin: depotId,
          destination: hallId,
          route: {
            costing: route.costing,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            tileRelease: route.tileRelease,
            fingerprint,
          },
          windowStart,
          windowEnd,
        },
        {
          at: at(t, 1),
          label: "delivery:planned",
          show: {
            milestone: "delivery-planned",
            title: `${treasurer.name} planned delivery to ${COLLECTION_POINT.label}: ${km} km, about ${String(minutes)} minutes, ${formatDateTime(windowStart)} to ${formatDateTime(windowEnd).slice(-5)}, driver ${driver.name}`,
          },
        },
      );
    },
  },
  {
    id: "confirm-delivery",
    title: "The driver confirms the goods arrived",
    async run(w, t) {
      const driver = w.person(DRIVER.key);
      // A canned photo: its SHA-512 is the proof that would be stored with the event.
      const photoSha512 = await sha512Hex(encodeUtf8("canned delivery photo, order o1"), w.sha512);
      await w.emit(
        driver,
        "delivery.confirmed",
        // No coordinate: the confirmation names the order and the photo only (AGENTS rule 6, patch of story 7.4).
        { order: "o1", photoSha512 },
        {
          at: at(t, 0),
          label: "delivery:confirmed",
          show: {
            milestone: "delivery-confirmed",
            title: `${driver.name} confirmed the goods arrived at ${COLLECTION_POINT.label}`,
          },
        },
      );
    },
  },
  {
    id: "collect",
    title: "Every member confirms they collected their share",
    async run(w, t) {
      let slot = 0;
      // The share names the delivery it collects from (the confirmation's event id) and the member's own did:key (story 7.6).
      const delivery = [...w.events].find(([, e]) => e.type === "delivery.confirmed")?.[0];
      if (delivery === undefined) throw new Error("nothing delivered yet");
      for (const m of MEMBERS) {
        await w.emit(
          w.person(m.key),
          "collection.confirmed",
          { order: "o1", delivery, member: w.person(m.key).actor },
          {
            at: at(t, slot++),
            label: `collect:${m.key}`,
            show: { milestone: "collection-confirmed", title: `${m.name} collected their share` },
          },
        );
      }
    },
  },
  {
    id: "close-order",
    title: "Nomsa closes the order with a summary",
    async run(w, t) {
      const treasurer = w.person("m1");
      const total = await selectedTotal(w);
      const shares = sharesOf(total, MEMBERS.length);
      const members: Obj[] = [];
      let credits = 0;
      for (const [i, m] of MEMBERS.entries()) {
        const pledge = await viewObj(w, `pledges/${m.key}`);
        const credit = (await w.ledger.balance(memberAccount(m.key), CURRENCY)).balance.minor;
        credits += credit;
        members.push({
          member: m.key,
          paidMinor: Number(pledge?.amountMinor ?? 0),
          shareMinor: shares[i] ?? 0,
          creditMinor: credit,
        });
      }
      await w.emit(
        treasurer,
        "order.closed",
        { order: "o1", totalCostMinor: total, creditedBackMinor: credits, members },
        {
          at: at(t, 0),
          label: "order:closed",
          show: {
            milestone: "order-closed",
            title: `${treasurer.name} closed the order. It cost ${formatZar(total)}; ${formatZar(credits)} stays in the pool as credit for the members`,
          },
        },
      );
    },
  },
];

export const STEP_COUNT = STEPS.length;
