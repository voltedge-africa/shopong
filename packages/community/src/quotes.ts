// Typed supplier quotes (story 6.8). A quote is a supplier, the items on it (name, unit, pack size and
// price per pack in whole rand cents) and the delivery terms (a fee in cents and a number of days), for
// one order. The treasurer types it. `checkQuote` is pure: it refuses an incomplete or out-of-bounds quote
// with every plain sentence that says what to fix, and nothing is written. A complete quote is written as
// a `quote.added` event; `apply` checks it again and stores it under `quotes/<order>/<supplier>`, so a newer
// quote for the same supplier and order replaces the older one in the view. Both stay in the log.
//
// Names are tidied before they are keyed: runs of spaces become one space (case is kept, S-6.8-1/2).
// Phone numbers are refused in supplier and item names, because the log cannot be edited (AGENTS rule 6).
//
// Not here: OCR or photos (the `Ocr` port, later), ranking (story 6.9), editing or deleting a quote, and
// choosing a supplier (`quote.selected`).

import { hasIdNumberShape, hasPhoneNumberShape, type JsonObject } from "@shopong/events";
import type { EpochMs, ViewReader } from "@shopong/ports";
import { isCoTreasurer, type StandingContext } from "./roles.js";

/** The most any quote may hold. A quote over a limit is refused by `checkQuote`, so `apply` refuses it too. */
export const QUOTE_LIMITS = {
  /** Characters in any name (order, supplier, item, unit), after the spaces are tidied. */
  nameChars: 80,
  items: 50,
  /** R100,000.00 in cents. */
  priceCents: 10_000_000,
  packSize: 10_000,
  /** R100,000.00 in cents. */
  feeCents: 10_000_000,
  days: 90,
} as const;

/** The plain sentences a person sees. */
export const QUOTE_MESSAGES = {
  not_permitted: "Only the treasurer can add a quote.",
  no_supplier: "Name the supplier.",
  // A 13-digit ID number already has seven digits, so these sentences cover ID numbers too.
  supplier_phone: "Leave phone numbers out of the supplier name.",
  item_phone: "Leave phone numbers out of the item name.",
  order_phone: "Leave phone numbers out of the order name.",
  unit_phone: "Leave phone numbers out of the unit.",
  /** Says nothing of the key itself: a key can hold a number, and reasons are kept in the shared log. */
  unknown_field:
    "Remove the extra field: a quote holds only its supplier, order, items and delivery terms.",
  no_order: "Name the order this quote is for.",
  no_lines: "Add at least one item.",
  too_many_lines: `A quote can have at most ${QUOTE_LIMITS.items} items.`,
  delivery_fee: "Say the delivery fee in rand, or 0 if delivery is free.",
  delivery_fee_max: "The delivery fee must be R100,000.00 or less.",
  delivery_days: "Say how many days delivery takes, or 0 if it is the same day.",
  delivery_days_max: `Delivery must take ${QUOTE_LIMITS.days} days or fewer.`,
  not_writable: "Your phone is not set up to write to this community yet.",
  save_failed: "The quote could not be saved. Try again.",
} as const;

export interface QuoteLine {
  readonly item: string;
  /** How the item is counted, for example "bag" or "litre". */
  readonly unit: string;
  /** How many units are in one pack. */
  readonly packSize: number;
  /** The price of one pack, in whole rand cents. Above zero. */
  readonly pricePerPackCents: number;
}

export interface DeliveryTerms {
  /** The delivery fee in whole rand cents. 0 when free. */
  readonly feeCents: number;
  /** How many days delivery takes. 0 for the same day. */
  readonly days: number;
}

export interface Quote {
  readonly supplier: string;
  readonly order: string;
  readonly lines: readonly QuoteLine[];
  readonly delivery: DeliveryTerms;
}

export type QuoteCheck =
  | { readonly ok: true; readonly value: Quote }
  | { readonly ok: false; readonly problems: readonly string[] };

/** A control character: anything below a space, or DEL. */
const isControl = (text: string): boolean =>
  text.split("").some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWhole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

/** Runs of spaces become one space, and the ends are trimmed. Case is kept. */
export const tidy = (text: string): string => text.trim().replace(/\s+/g, " ");

const lowerFirst = (sentence: string) => sentence.charAt(0).toLowerCase() + sentence.slice(1);

interface Text {
  /** The tidied text. */
  readonly text: string;
  /** Whether the raw value holds a control character (a newline, a tab or a NUL). */
  readonly control: boolean;
}

function textOf(value: unknown): Text {
  const raw = typeof value === "string" ? value : "";
  return { text: tidy(raw), control: isControl(raw) };
}

/** The keys a quote may hold, at each level. Any other key is refused, whatever it holds (review H2). */
const QUOTE_KEYS = ["supplier", "order", "lines", "delivery"] as const;
const LINE_KEYS = ["item", "unit", "packSize", "pricePerPackCents"] as const;
const DELIVERY_KEYS = ["feeCents", "days"] as const;

/** A phone or ID number in a name, by the same shape rule the record's guard uses. */
const personalShape = (text: string): boolean =>
  hasPhoneNumberShape(text) || hasIdNumberShape(text);

const hasOnlyKeys = (o: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(o).every((key) => allowed.includes(key));

/**
 * Checks a typed quote. `input` may be anything the form or a stored event gives: every value is
 * looked at, and every problem is returned, in the order a person would fix them.
 */
export function checkQuote(input: unknown): QuoteCheck {
  const o = isObject(input) ? input : {};
  const problems: string[] = [];
  let unknownField = !hasOnlyKeys(o, QUOTE_KEYS);

  const supplier = textOf(o.supplier);
  if (supplier.control)
    problems.push(
      "The supplier name has a character that cannot be used. Type it again on one line.",
    );
  if (supplier.text === "") problems.push(QUOTE_MESSAGES.no_supplier);
  else if (personalShape(supplier.text)) problems.push(QUOTE_MESSAGES.supplier_phone);
  if (supplier.text.length > QUOTE_LIMITS.nameChars)
    problems.push(`Keep the supplier name to ${QUOTE_LIMITS.nameChars} characters or fewer.`);

  const order = textOf(o.order);
  if (order.control)
    problems.push("The order name has a character that cannot be used. Type it again on one line.");
  if (order.text === "") problems.push(QUOTE_MESSAGES.no_order);
  else if (personalShape(order.text)) problems.push(QUOTE_MESSAGES.order_phone);
  if (order.text.length > QUOTE_LIMITS.nameChars)
    problems.push(`Keep the order name to ${QUOTE_LIMITS.nameChars} characters or fewer.`);

  const rawLines = Array.isArray(o.lines) ? o.lines : [];
  if (rawLines.length === 0) problems.push(QUOTE_MESSAGES.no_lines);
  if (rawLines.length > QUOTE_LIMITS.items) problems.push(QUOTE_MESSAGES.too_many_lines);
  const lines: QuoteLine[] = [];
  rawLines.forEach((raw, index) => {
    const line = isObject(raw) ? raw : {};
    if (!hasOnlyKeys(line, LINE_KEYS)) unknownField = true;
    const item = textOf(line.item);
    const unit = textOf(line.unit);
    // The label names the item unless the name is missing, has a control character, or is a phone
    // number: a rejected reason is kept in the shared log, so it must not repeat a phone number.
    const label =
      item.text === "" || item.control || personalShape(item.text)
        ? `Line ${index + 1}`
        : `Line ${index + 1} (${item.text})`;

    if (item.control) problems.push(`${label}: the item name has a character that cannot be used.`);
    if (item.text === "") problems.push(`${label}: name the item.`);
    else if (personalShape(item.text)) problems.push(`${label}: ${QUOTE_MESSAGES.item_phone}`);
    if (item.text.length > QUOTE_LIMITS.nameChars)
      problems.push(
        `${label}: ${lowerFirst(`Keep the item name to ${QUOTE_LIMITS.nameChars} characters or fewer.`)}`,
      );

    if (unit.control) problems.push(`${label}: the unit has a character that cannot be used.`);
    if (unit.text === "") problems.push(`${label}: say the unit, for example bag or litre.`);
    else if (personalShape(unit.text)) problems.push(`${label}: ${QUOTE_MESSAGES.unit_phone}`);
    if (unit.text.length > QUOTE_LIMITS.nameChars)
      problems.push(
        `${label}: ${lowerFirst(`Keep the unit to ${QUOTE_LIMITS.nameChars} characters or fewer.`)}`,
      );

    const packSize = line.packSize;
    if (!isWhole(packSize) || packSize < 1)
      problems.push(`${label}: the pack size must be a whole number, 1 or more.`);
    else if (packSize > QUOTE_LIMITS.packSize)
      problems.push(`${label}: the pack size must be 10,000 or less.`);

    const price = line.pricePerPackCents;
    if (price === undefined || price === null || price === "") {
      problems.push(`${label}: price missing.`);
    } else if (!isWhole(price)) {
      problems.push(`${label}: write the price like 125.50.`);
    } else if (price <= 0) {
      problems.push(`${label}: the price must be more than R0.00.`);
    } else if (price > QUOTE_LIMITS.priceCents) {
      problems.push(`${label}: the price must be R100,000.00 or less.`);
    }
    lines.push({
      item: item.text,
      unit: unit.text,
      packSize: isWhole(packSize) ? packSize : 0,
      pricePerPackCents: isWhole(price) ? price : 0,
    });
  });

  const delivery = isObject(o.delivery) ? o.delivery : {};
  if (!hasOnlyKeys(delivery, DELIVERY_KEYS)) unknownField = true;
  if (!isWhole(delivery.feeCents) || delivery.feeCents < 0)
    problems.push(QUOTE_MESSAGES.delivery_fee);
  else if (delivery.feeCents > QUOTE_LIMITS.feeCents)
    problems.push(QUOTE_MESSAGES.delivery_fee_max);
  if (!isWhole(delivery.days) || delivery.days < 0) problems.push(QUOTE_MESSAGES.delivery_days);
  else if (delivery.days > QUOTE_LIMITS.days) problems.push(QUOTE_MESSAGES.delivery_days_max);

  if (unknownField) problems.unshift(QUOTE_MESSAGES.unknown_field);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      supplier: supplier.text,
      order: order.text,
      lines,
      delivery: {
        feeCents: delivery.feeCents as number,
        days: delivery.days as number,
      },
    },
  };
}

const quotesPrefix = (order: string) => `quotes/${encodeURIComponent(tidy(order))}/`;

/** The view key of one supplier's quote for one order. Both parts are encoded, so no name can clash. */
export const quoteKey = (order: string, supplier: string) =>
  `${quotesPrefix(order)}${encodeURIComponent(tidy(supplier))}`;

/** The view form of a checked quote. */
export function quoteJson(quote: Quote): JsonObject {
  return {
    supplier: quote.supplier,
    order: quote.order,
    lines: quote.lines.map((line) => ({
      item: line.item,
      unit: line.unit,
      packSize: line.packSize,
      pricePerPackCents: line.pricePerPackCents,
    })),
    delivery: { feeCents: quote.delivery.feeCents, days: quote.delivery.days },
  };
}

/** Every quote recorded for `order` in the view as it stands, in key order. */
export async function quotesOf(view: ViewReader, order: string): Promise<readonly Quote[]> {
  const out: Quote[] = [];
  for (const entry of await view.list(quotesPrefix(order))) {
    const checked = checkQuote(entry.value);
    if (checked.ok) out.push(checked.value);
  }
  return out;
}

/** The treasurer is the creator, or a co-treasurer whose role stands at `at` (see `coTreasurerProblem`). */
export async function isTreasurer(
  ctx: StandingContext,
  view: ViewReader,
  who: string,
  at: EpochMs,
): Promise<boolean> {
  return who === ctx.creator || (await isCoTreasurer(ctx, view, who, at));
}
