// The event types of the first release (architecture.md section 6).
// Payload schemas are loose placeholders until the story that first writes a type
// replaces its entry in PayloadMap and PAYLOAD_VALIDATORS with a strict schema
// (member.invited and member.joined: story 2.3; role.granted: story 2.4; member.removed: story 3.3). The envelope
// itself is strict (envelope.ts).

import { fileAttachedIssues } from "./attachment.js";
import type { JsonObject } from "./json.js";
import { looksLikeAddress } from "./personal.js";

export const EVENT_TYPES = [
  "member.invited",
  "member.joined",
  "member.removed",
  "role.granted",
  "role.revoked",
  "order.proposed",
  "order.approved",
  "order.closed",
  "quote.added",
  "quote.selected",
  "pledge.created",
  "payment.requested",
  "payment.payout",
  "payment.approved",
  "payment.completed",
  "payment.failed",
  "payment.refunded",
  "ledger.posted",
  "place.registered",
  "delivery.planned",
  "delivery.started",
  "delivery.confirmed",
  "collection.confirmed",
  "delivery.disputed",
  "funding.requested",
  "funding.offered",
  "funding.accepted",
  "obligation.created",
  "obligation.settled",
  "solution.saved",
  "solution.shared",
  "agent.action",
  "file.attached",
  "community.named",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const KNOWN: ReadonlySet<string> = new Set(EVENT_TYPES);

/** True only for types this reader knows. Unknown types are still valid envelopes (see parseEvent). */
export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && KNOWN.has(value);
}

/** `member.invited`: the creator invited `invitee` with the `member/join` token whose id is `invitation`. */
export interface MemberInvitedPayload extends JsonObject {
  /** Token id of the invitation (`CapabilityAuth.tokenId`). */
  readonly invitation: string;
  /** `did:key` of the person invited. */
  readonly invitee: string;
  /** When the invitation ends, milliseconds since the Unix epoch. */
  readonly expiresAt: number;
}

/** `member.joined`: the actor joined with the invitation whose token id is `invitation`. */
export interface MemberJoinedPayload extends JsonObject {
  readonly invitation: string;
}

/**
 * `member.removed`: the actor removed `member` from the community (story 3.3). The actor is the creator, a
 * co-treasurer, or the member themself. An optional `reason` (text, in the actor's words) may follow; the validator
 * checks it, but the type does not name it, because an optional field cannot sit under `JsonObject`.
 */
export interface MemberRemovedPayload extends JsonObject {
  /** `did:key` of the member removed. */
  readonly member: string;
}

/**
 * `role.granted`: the actor gave `grantee` the named role until `expiresAt`. The proof is one delegation
 * token per ability of the role, each checked by `CapabilityAuth.verify` in `apply`.
 */
export interface RoleGrantedPayload extends JsonObject {
  /** A role name from the community's fixed list (`co-treasurer`, `driver`, `supplier`). */
  readonly role: string;
  /** `did:key` of the person given the role. */
  readonly grantee: string;
  /** When the role ends, milliseconds since the Unix epoch. */
  readonly expiresAt: number;
}

/**
 * `community.named` (story 8.1): the community's name and a short rules note, both plain text. The creator writes it on
 * creation; every member sees the same words. Neither field may hold an identity or an address (AGENTS rule 6).
 */
export interface CommunityNamedPayload extends JsonObject {
  readonly name: string;
  readonly rules: string;
}

/**
 * `place.registered` (story 7.4): a place the community routes to. `place` is an opaque id the Node made; the
 * coordinates stay on the Node. `addressCommitment` is the keyed commitment of the exact address (AGENTS rule 6).
 */
export interface PlaceRegisteredPayload extends JsonObject {
  readonly place: string;
  readonly label: string;
  readonly area: string;
  readonly addressCommitment: string;
}

/** The route a `delivery.planned` names: its costing, numbers and fingerprint. The line itself stays on the Node. */
export interface DeliveryRoute extends JsonObject {
  readonly costing: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly tileRelease: string;
  /** SHA-512 hex of the polyline and the tile release (`routeFingerprint`). */
  readonly fingerprint: string;
}

/**
 * `delivery.planned` (story 7.4): the order's route from one registered place to another, planned by the treasurer
 * or a current driver. Place ids and a route fingerprint only: no coordinate, polyline or address (AGENTS rule 6).
 */
export interface DeliveryPlannedPayload extends JsonObject {
  readonly order: string;
  /** `did:key` of the driver the route is for. */
  readonly driver: string;
  /** Place ids (opaque, 64 hex) of the start and the end. */
  readonly origin: string;
  readonly destination: string;
  readonly route: DeliveryRoute;
  // The optional window (`windowStart`, `windowEnd`: milliseconds since the epoch) is checked by the validator but not
  // named here, because an optional field cannot sit under `JsonObject` (as `member.removed`'s reason is).
}

/**
 * `collection.confirmed` (story 7.6): a member confirms their own share of a delivery. `member` is the signer (the
 * actor), named so that a confirmation for anyone else is refused as such. `delivery` is the event id of the confirmed
 * delivery the share came from.
 */
export interface CollectionConfirmedPayload extends JsonObject {
  readonly order: string;
  readonly delivery: string;
  /** `did:key` of the member whose share this is. */
  readonly member: string;
}

/**
 * `delivery.disputed` (story 7.6): a member (the treasurer included) says a share did not arrive. The confirmation stays;
 * this is a later event beside it. `note` is the person's own short words, optional.
 */
export interface DeliveryDisputedPayload extends JsonObject {
  readonly order: string;
  /** The event id of the `delivery.confirmed` being disputed. */
  readonly delivery: string;
  // The optional note is checked by the validator but not named here (an optional field cannot sit under JsonObject).
}

/** Payload shape per type. Placeholders until each type's owning story defines it. */
export type PayloadMap = { [T in EventType]: JsonObject } & {
  "member.invited": MemberInvitedPayload;
  "member.joined": MemberJoinedPayload;
  "role.granted": RoleGrantedPayload;
  "member.removed": MemberRemovedPayload;
  "collection.confirmed": CollectionConfirmedPayload;
  "delivery.disputed": DeliveryDisputedPayload;
  "community.named": CommunityNamedPayload;
};

export interface Issue {
  /** JSONPath-like location, for example `$.payload.items[0]`. */
  readonly path: string;
  readonly message: string;
}

/** Validates a payload that is already known to be a canonicalisable plain object. */
export type PayloadValidator = (payload: JsonObject) => readonly Issue[];

const anyObject: PayloadValidator = () => [];

const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/;

function requireString(
  payload: JsonObject,
  field: string,
  ok: (value: string) => boolean,
  message: string,
): Issue[] {
  const value = payload[field];
  if (value === undefined)
    return [{ path: `$.payload.${field}`, message: "required field is missing" }];
  return typeof value === "string" && ok(value) ? [] : [{ path: `$.payload.${field}`, message }];
}

const nonEmpty = (value: string): boolean => value.length > 0;

const memberInvited: PayloadValidator = (payload) => {
  const issues = [
    ...requireString(payload, "invitation", nonEmpty, "must be a non-empty token id"),
    ...requireString(payload, "invitee", (v) => DID_KEY.test(v), "must be a did:key"),
  ];
  const expiresAt = payload.expiresAt;
  if (expiresAt === undefined)
    issues.push({ path: "$.payload.expiresAt", message: "required field is missing" });
  else if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0)
    issues.push({
      path: "$.payload.expiresAt",
      message: "must be a non-negative integer of milliseconds",
    });
  return issues;
};

const memberJoined: PayloadValidator = (payload) =>
  requireString(payload, "invitation", nonEmpty, "must be a non-empty token id");

const memberRemoved: PayloadValidator = (payload) => {
  const issues = requireString(payload, "member", (v) => DID_KEY.test(v), "must be a did:key");
  if (payload.reason !== undefined && typeof payload.reason !== "string")
    issues.push({ path: "$.payload.reason", message: "must be text when given" });
  return issues;
};

const roleGranted: PayloadValidator = (payload) => {
  const issues = [
    ...requireString(payload, "role", nonEmpty, "must be a non-empty role name"),
    ...requireString(payload, "grantee", (v) => DID_KEY.test(v), "must be a did:key"),
  ];
  const expiresAt = payload.expiresAt;
  if (expiresAt === undefined)
    issues.push({ path: "$.payload.expiresAt", message: "required field is missing" });
  else if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0)
    issues.push({
      path: "$.payload.expiresAt",
      message: "must be a non-negative integer of milliseconds",
    });
  return issues;
};

/**
 * `file.attached` (story 3.7): a file is kept on the Node under its SHA-512, and this event names it. Strict: the
 * fields, the types and the purpose's size and type rules are checked here (`attachment.ts`).
 */
const fileAttached: PayloadValidator = (payload) => fileAttachedIssues(payload);
/** Exactly these keys, no others: an unknown field (a coordinate, say) makes the payload invalid. */
function onlyKeys(payload: JsonObject, allowed: readonly string[]): Issue[] {
  return Object.keys(payload)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ path: `$.payload.${key}`, message: "is not a field of this event" }));
}

const OPAQUE_PLACE = /^[0-9a-f]{64}$/;
const SHA512_HEX = /^[0-9a-f]{128}$/;
const COSTINGS = ["auto", "truck", "bicycle", "pedestrian"] as const;
const COMMITMENT_HEX = /^[0-9a-f]{128}$/;

/** Text of `min` to `max` characters (after trimming) with no control character (code points below 0x20). */
/** A place name: bounded text that does not read as an address (place labels are names, never addresses). */
const placeName = (max: number) => (value: string) =>
  boundedText(1, max)(value) && !looksLikeAddress(value);

/** An integer in `[min, max]`. */
function boundedInt(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Epoch milliseconds for a window: 2020 to 2100, so a stray small or huge number is refused. */
const WINDOW_MIN = 1_577_836_800_000;
const WINDOW_MAX = 4_102_444_800_000;

/** A tile release id: a short lower-case name such as `memory-tiles-2026.01`, never free text. */
const RELEASE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

const boundedText = (min: number, max: number) => (value: string) => {
  const trimmed = value.trim();
  let control = false;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 0x20) control = true;
  return trimmed.length >= min && trimmed.length <= max && !control;
};

const placeRegistered: PayloadValidator = (payload) => {
  const issues = [
    ...onlyKeys(payload, ["place", "label", "area", "addressCommitment"]),
    ...requireString(payload, "place", (v) => OPAQUE_PLACE.test(v), "must be an opaque place id"),
    ...requireString(
      payload,
      "label",
      placeName(80),
      "must be a place name of 1 to 80 characters, not an address",
    ),
    ...requireString(
      payload,
      "area",
      placeName(60),
      "must be an area name of 1 to 60 characters, not an address",
    ),
    ...requireString(
      payload,
      "addressCommitment",
      (v) => COMMITMENT_HEX.test(v),
      "must be a commitment to the address",
    ),
  ];
  return issues;
};

const deliveryPlanned: PayloadValidator = (payload) => {
  const issues: Issue[] = [
    ...onlyKeys(payload, [
      "order",
      "driver",
      "origin",
      "destination",
      "route",
      "windowStart",
      "windowEnd",
    ]),
    ...requireString(payload, "order", nonEmpty, "must be a non-empty order id"),
    ...requireString(payload, "driver", (v) => DID_KEY.test(v), "must be a did:key"),
    ...requireString(payload, "origin", (v) => OPAQUE_PLACE.test(v), "must be an opaque place id"),
    ...requireString(
      payload,
      "destination",
      (v) => OPAQUE_PLACE.test(v),
      "must be an opaque place id",
    ),
  ];
  if (payload.origin !== undefined && payload.origin === payload.destination) {
    issues.push({ path: "$.payload.destination", message: "must be a different place" });
  }
  const route = payload.route;
  if (typeof route !== "object" || route === null || Array.isArray(route)) {
    issues.push({ path: "$.payload.route", message: "must be the route's summary" });
  } else {
    const r = route as JsonObject;
    issues.push(
      ...onlyKeys(r, [
        "costing",
        "distanceMeters",
        "durationSeconds",
        "tileRelease",
        "fingerprint",
      ]),
      ...requireString(
        r,
        "costing",
        (v) => (COSTINGS as readonly string[]).includes(v),
        "must be a known costing",
      ),
      ...requireString(
        r,
        "tileRelease",
        (v) => RELEASE_ID.test(v),
        "must be a tile release id, such as memory-tiles-2026.01",
      ),
      ...requireString(
        r,
        "fingerprint",
        (v) => SHA512_HEX.test(v),
        "must be a SHA-512 fingerprint",
      ),
    );
    if (!boundedInt(r.distanceMeters, 1, 2_000_000))
      issues.push({
        path: "$.payload.route.distanceMeters",
        message: "must be 1 to 2,000,000 metres",
      });
    if (!boundedInt(r.durationSeconds, 1, 172_800))
      issues.push({ path: "$.payload.route.durationSeconds", message: "must be whole seconds" });
  }
  for (const field of ["windowStart", "windowEnd"] as const) {
    const value = payload[field];
    if (value !== undefined && !boundedInt(value, WINDOW_MIN, WINDOW_MAX))
      issues.push({ path: `$.payload.${field}`, message: "must be a time between 2020 and 2100" });
  }
  return issues;
};

/** The longest name and rules note a community can carry (story 8.1). */
export const COMMUNITY_NAME_MAX = 80;
export const COMMUNITY_RULES_MAX = 500;

/** `community.named` (story 8.1): a name of 1 to 80 characters and rules of up to 500, one line each, no address. */
const communityNamed: PayloadValidator = (payload) => [
  ...onlyKeys(payload, ["name", "rules"]),
  ...requireString(
    payload,
    "name",
    placeName(COMMUNITY_NAME_MAX),
    "must be a community name of 1 to 80 characters, not an address",
  ),
  ...requireString(
    payload,
    "rules",
    boundedText(0, COMMUNITY_RULES_MAX),
    "must be a rules note of up to 500 characters, on one line",
  ),
];

/**
 * A coarse coordinate (story 7.6): a latitude or longitude in degrees, as a decimal string with at most two decimal
 * places (about 1 km). The canonical JSON takes no floats (canonical.ts), so the degrees travel as text. Anything finer is
 * refused, so the record can never hold an exact position (AGENTS rule 6).
 */
const coarseDegrees = (value: unknown, max: number): boolean =>
  typeof value === "string" &&
  /^-?\d{1,3}(\.\d{1,2})?$/.test(value) &&
  Math.abs(Number(value)) <= max;

/**
 * `delivery.confirmed` (story 7.4, with the coarse place of story 7.6): the order, the SHA-512 of the delivery photo, and
 * optionally the place it was confirmed at: an opaque place id, or a coarse latitude and longitude (both or neither,
 * two decimal places at most). No other coordinate is accepted (AGENTS rule 6).
 */
const deliveryConfirmed: PayloadValidator = (payload) => {
  const issues: Issue[] = [
    ...onlyKeys(payload, ["order", "photoSha512", "place", "lat", "lng"]),
    ...requireString(payload, "order", nonEmpty, "must be a non-empty order id"),
    ...requireString(
      payload,
      "photoSha512",
      (v) => SHA512_HEX.test(v),
      "must be a SHA-512 of the photo",
    ),
    ...(payload.place === undefined
      ? []
      : requireString(payload, "place", (v) => OPAQUE_PLACE.test(v), "must be an opaque place id")),
  ];
  const hasLat = payload.lat !== undefined;
  const hasLng = payload.lng !== undefined;
  if (hasLat !== hasLng) {
    issues.push({ path: "$.payload", message: "a place needs both a latitude and a longitude" });
  } else if (hasLat) {
    if (!coarseDegrees(payload.lat, 90))
      issues.push({
        path: "$.payload.lat",
        message: "must be a latitude with at most two decimal places",
      });
    if (!coarseDegrees(payload.lng, 180))
      issues.push({
        path: "$.payload.lng",
        message: "must be a longitude with at most two decimal places",
      });
  }
  return issues;
};

/** `collection.confirmed` (story 7.6): the order, the delivery it collects from, and the member whose share it is. */
const collectionConfirmed: PayloadValidator = (payload) => [
  ...onlyKeys(payload, ["order", "delivery", "member"]),
  ...requireString(payload, "order", nonEmpty, "must be a non-empty order id"),
  ...requireString(
    payload,
    "delivery",
    (v) => SHA512_HEX.test(v),
    "must be the event id of the delivery",
  ),
  ...requireString(payload, "member", (v) => DID_KEY.test(v), "must be a did:key"),
];

/** Words a dispute may carry: a short note, in the person's own words, optional. */
const DISPUTE_NOTE_MAX = 280;

/** `delivery.disputed` (story 7.6): the order, the confirmation disputed, and an optional short note. */
const deliveryDisputed: PayloadValidator = (payload) => {
  const issues: Issue[] = [
    ...onlyKeys(payload, ["order", "delivery", "note"]),
    ...requireString(payload, "order", nonEmpty, "must be a non-empty order id"),
    ...requireString(
      payload,
      "delivery",
      (v) => SHA512_HEX.test(v),
      "must be the event id of the delivery",
    ),
  ];
  if (payload.note !== undefined)
    issues.push(
      ...requireString(
        payload,
        "note",
        boundedText(1, DISPUTE_NOTE_MAX),
        `must be 1 to ${DISPUTE_NOTE_MAX} characters of text`,
      ),
    );
  return issues;
};

const PAYOUT_RECOMMENDATIONS: readonly string[] = ["clear", "too_close", "only_one", "none"];
const PAYOUT_ID = /^[0-9a-f]{128}$/;

/** A whole amount of rand cents, above zero, in ZAR: the only currency a supplier is paid in (story 4.7). */
function checkPayoutAmount(payload: JsonObject): Issue[] {
  const amount = payload.amount;
  if (amount === undefined)
    return [{ path: "$.payload.amount", message: "required field is missing" }];
  if (typeof amount !== "object" || amount === null || Array.isArray(amount))
    return [
      { path: "$.payload.amount", message: "must be an amount with a currency and minor units" },
    ];
  const { currency, minor } = amount as { currency?: unknown; minor?: unknown };
  const issues: Issue[] = [];
  if (currency !== "ZAR")
    issues.push({ path: "$.payload.amount.currency", message: "must be ZAR" });
  if (typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 1)
    issues.push({
      path: "$.payload.amount.minor",
      message: "must be a whole number of cents, 1 or more",
    });
  return issues;
}

const BANK_COMMITMENT_HEX = /^[0-9a-f]{128}$/;

const paymentPayout: PayloadValidator = (payload) => [
  ...requireString(
    payload,
    "bank",
    (v) => BANK_COMMITMENT_HEX.test(v),
    "must be a bank commitment (128 hex)",
  ),
  ...requireString(payload, "order", nonEmpty, "must be a non-empty order name"),
  ...requireString(payload, "supplier", nonEmpty, "must be a non-empty supplier name"),
  ...checkPayoutAmount(payload),
  ...requireString(
    payload,
    "recommendation",
    (v) => PAYOUT_RECOMMENDATIONS.includes(v),
    "must be clear, too_close, only_one or none",
  ),
];

const paymentApproved: PayloadValidator = (payload) => [
  ...requireString(
    payload,
    "bank",
    (v) => BANK_COMMITMENT_HEX.test(v),
    "must be a bank commitment (128 hex)",
  ),
  ...requireString(
    payload,
    "payout",
    (v) => PAYOUT_ID.test(v),
    "must be a payment id (128 lowercase hex)",
  ),
  ...requireString(payload, "order", nonEmpty, "must be a non-empty order name"),
  ...requireString(payload, "supplier", nonEmpty, "must be a non-empty supplier name"),
  ...checkPayoutAmount(payload),
  ...requireString(payload, "signature", nonEmpty, "must be a non-empty signature"),
];

/** The limits of a proposed order's shape (story 8.2). The community's `checkOrder` judges the rest in plain words. */
export const ORDER_LIMITS = {
  nameChars: 80,
  items: 50,
  quantity: 10_000,
  /** R100,000.00 in cents. */
  budgetPerMemberMinor: 10_000_000,
} as const;

/**
 * `order.proposed` (story 8.2): the name, the items it needs (each with a quantity), the budget per member in whole rand
 * cents, and the deadline as epoch milliseconds. The shape only; the record judges the rest at log time.
 */
const orderProposed: PayloadValidator = (payload) => {
  const issues: Issue[] = [
    ...onlyKeys(payload, ["name", "items", "budgetPerMemberMinor", "deadline"]),
    ...requireString(
      payload,
      "name",
      boundedText(1, ORDER_LIMITS.nameChars),
      `must be an order name of 1 to ${ORDER_LIMITS.nameChars} characters, on one line`,
    ),
    ...(boundedInt(payload.budgetPerMemberMinor, 1, ORDER_LIMITS.budgetPerMemberMinor)
      ? []
      : [
          {
            path: "$.payload.budgetPerMemberMinor",
            message: "must be a whole number of cents, 1 or more",
          },
        ]),
    ...(boundedInt(payload.deadline, WINDOW_MIN, WINDOW_MAX)
      ? []
      : [{ path: "$.payload.deadline", message: "must be a time between 2020 and 2100" }]),
  ];
  const items = payload.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > ORDER_LIMITS.items) {
    issues.push({
      path: "$.payload.items",
      message: `must be a list of 1 to ${ORDER_LIMITS.items} items`,
    });
  } else {
    items.forEach((raw) => {
      const line =
        typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as JsonObject) : {};
      issues.push(
        ...onlyKeys(line, ["item", "quantity"]),
        ...requireString(
          line,
          "item",
          boundedText(1, ORDER_LIMITS.nameChars),
          `must be an item name of 1 to ${ORDER_LIMITS.nameChars} characters`,
        ),
      );
      if (!boundedInt(line.quantity, 1, ORDER_LIMITS.quantity))
        issues.push({
          path: "$.payload.items[].quantity",
          message: `must be a whole number, 1 to ${ORDER_LIMITS.quantity}`,
        });
    });
  }
  return issues;
};

/** `order.approved` (story 8.2): the treasurer's approval, naming the proposal by its event id. */
const orderApproved: PayloadValidator = (payload) => [
  ...onlyKeys(payload, ["order"]),
  ...requireString(
    payload,
    "order",
    (v) => SHA512_HEX.test(v),
    "must be the event id of the proposed order",
  ),
];

export const PAYLOAD_VALIDATORS: { readonly [T in EventType]: PayloadValidator } = {
  ...(Object.fromEntries(EVENT_TYPES.map((t) => [t, anyObject])) as {
    [T in EventType]: PayloadValidator;
  }),
  "member.invited": memberInvited,
  "member.joined": memberJoined,
  "role.granted": roleGranted,
  "member.removed": memberRemoved,
  "payment.payout": paymentPayout,
  "payment.approved": paymentApproved,
  "file.attached": fileAttached,
  "place.registered": placeRegistered,
  "delivery.planned": deliveryPlanned,
  "delivery.confirmed": deliveryConfirmed,
  "collection.confirmed": collectionConfirmed,
  "delivery.disputed": deliveryDisputed,
  "community.named": communityNamed,
  "order.proposed": orderProposed,
  "order.approved": orderApproved,
};
