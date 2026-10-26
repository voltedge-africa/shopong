// The Node's route routes (story 7.4). Signed, like the other Node routes (`signed.ts`):
//
//   POST /communities/:key/places              the treasurer registers a place. The Node keeps its coordinates under an
//                                              opaque id and answers the id, the label, the area and the keyed commitment
//                                              of the exact address (the record's copy). The address is committed here
//                                              and never written anywhere else. The id comes from the phone's registration
//                                              key (`request`, story 7.3), so a retry after a lost answer is the same place.
//   GET  /communities/:key/places              a member reads the places with their coordinates (story 7.3). No address.
//   POST /communities/:key/routes              the treasurer or a current driver plans a route between two registered
//                                              places. The Node computes it behind the `Routing` port, keeps the line, and
//                                              answers the summary, the line and three plain sentences. The caller then
//                                              records `delivery.planned` (ids and the fingerprint only) through the sync route.
//   GET  /communities/:key/route?fingerprint=  a member reads a planned route: the same answer, for every member.
//
// Order of checks, as the other signed routes: the signature and the time, the community, the caller's standing at log
// time (or membership), and only then the one-time number is recorded. Nothing here logs a coordinate or an address.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isCommunityKey, isTreasurer, logTimeOf, plannerProblem } from "@shopong/community";
import {
  looksLikeAddress,
  NormalisationError,
  encodeUtf8,
  commitAddress,
  routeFingerprint,
  toHex,
  webCryptoSha512,
} from "@shopong/events";
import type { CapabilityAuth, Did, Routing, ViewReader } from "@shopong/ports";
import { z } from "zod";
import { HTTP_STATUS, nodeMessage, type NodeProblem } from "./authority.ts";
import { nodeHmacSha512 } from "./commitments.ts";
import { STRAIGHT_LINE } from "./routing.ts";
import type { PlaceEntry, PlaceRegistry, RouteEntry, RouteStore } from "./places.ts";
import {
  claimNonce,
  DEFAULT_MAX_NONCES,
  FixedWindows,
  SeenNonces,
  verifySignedRequest,
  type SignedGate,
} from "./signed.ts";

export const ROUTE_MESSAGES = {
  not_held: "This Node does not hold that community.",
  record_off: "Your community's Node is not ready. Try again in a moment.",
  not_member: "You are not a member of this community any more.",
  busy: "The Node is busy. Try again in a moment.",
  limited: "Too many requests. Try again later.",
  not_treasurer: "Only the treasurer can add a place.",
  invalid_place: "Send a label, an area, a place on the map and its address.",
  invalid_route: "Send the start and the end as places registered with this community.",
  same_place: "A route needs two different places.",
  unknown_place: "That place is not registered with this community.",
  costing: "Only car routes can be planned for now.",
  out_of_coverage: "That place is outside the area this Node can route.",
  no_route: "No road route was found between these places.",
  no_secret: "Your community's Node is not ready to record addresses yet. Try again in a moment.",
  address: "Send an address of up to 200 characters.",
  not_found: "No route is held for that.",
  not_member_read: "Only a member of the community can read it.",
  replayed: "That request was already used.",
} as const;

/** The plain sentence for a request whose one-time number was not accepted: a full table is not a replay. */
export function nonceRefusalMessage(problem: string): string {
  return problem === "busy" ? ROUTE_MESSAGES.busy : ROUTE_MESSAGES.replayed;
}

/** The limits on the planning routes: per person, per ten minutes (patch of story 7.4). */
export const ROUTE_RATE = { max: 30, windowMs: 10 * 60 * 1000 } as const;

/** The largest body the two planning POSTs read: 16 KiB. */
export const ROUTE_BODY_LIMIT = 16 * 1024;

/**
 * The key a community's addresses are committed with: derived from the Node's secret and the community's key, with a
 * domain label, so the same address commits differently in two communities and never as a phone number (patch).
 */
export async function addressKeyOf(secret: Uint8Array, communityKey: string): Promise<Uint8Array> {
  return nodeHmacSha512(secret, encodeUtf8(`ocn/address/v1\n${communityKey}`));
}

/** The three sentences a route card shows, written here so every phone says the same thing. */
export function routeSentences(
  route: {
    readonly distanceMeters: number;
    readonly durationSeconds: number;
    readonly tileRelease: string;
  },
  origin: { readonly label: string },
  destination: { readonly label: string },
): string[] {
  const km = (route.distanceMeters / 1000).toFixed(1);
  const minutes = Math.max(1, Math.round(route.durationSeconds / 60));
  return [
    `Route from ${origin.label} to ${destination.label}.`,
    `About ${km} km, about ${String(minutes)} minutes by car.`,
    route.tileRelease === STRAIGHT_LINE
      ? "This is a straight-line estimate, not a road route."
      : "This is a road route.",
  ];
}

// A place is named, never addressed: a label or area that reads as an address is refused (patch of story 7.4).
const placeBody = z.strictObject({
  /** The phone's registration key: 16 random bytes, hex. A retry sends the same one (S-7.4-15). */
  request: z.string().regex(/^[0-9a-f]{32}$/),
  label: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((v) => !looksLikeAddress(v), "reads as an address"),
  area: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((v) => !looksLikeAddress(v), "reads as an address"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().min(1).max(200),
});

/**
 * The id of a place, from the community and the registration key, under the Node's secret: the same registration gives
 * the same id, and nobody else can compute it (story 7.3, S-7.4-15).
 */
export async function placeIdOf(
  secret: Uint8Array,
  communityKey: string,
  request: string,
): Promise<string> {
  const digest = await nodeHmacSha512(
    secret,
    encodeUtf8(`ocn/place/v1\n${communityKey}\n${request}`),
  );
  return toHex(digest).slice(0, 64);
}

const planBody = z.strictObject({
  order: z.string().trim().min(1).max(80),
  origin: z.string().regex(/^[0-9a-f]{64}$/),
  destination: z.string().regex(/^[0-9a-f]{64}$/),
  costing: z.string().optional(),
});

/** What the Node needs from its hub: the community's creator, its record view and its members. */
export interface RouteHub {
  registrationOf(communityKey: string): { spaceKey: string; creator: Did } | undefined;
  indexedView(communityKey: string): Promise<ViewReader | undefined>;
  isMember(did: Did, communityKey: string): Promise<boolean | undefined>;
}

export interface RouteRouteOptions {
  readonly hub: RouteHub;
  readonly routing: Routing;
  readonly places: PlaceRegistry;
  readonly routes: RouteStore;
  /** The community secret for a community, or undefined when this Node holds none. */
  readonly secretOf: (communityKey: string) => Uint8Array | undefined;
  /** The Node's clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly maxNonces?: number;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function registerRouteRoutes(
  app: FastifyInstance,
  auth: CapabilityAuth,
  options: RouteRouteOptions,
): void {
  const clock = options.now ?? Date.now;
  const gate: Pick<SignedGate, "auth" | "clock"> = { auth, clock };
  const nonces = new SeenNonces(options.maxNonces ?? DEFAULT_MAX_NONCES);
  const limits = new FixedWindows(clock);
  const { hub, places, routes } = options;

  /** A removed person (`removed/<did>`, or no longer a member) plans nothing: checked before the one-time number. */
  async function stillMember(actor: Did, key: string, view: ViewReader): Promise<boolean> {
    if ((await view.get(`removed/${actor}`)) !== undefined) return false;
    return (await hub.isMember(actor, key)) === true;
  }

  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    status: number,
    problem: string,
    reason: string,
    actor?: Did,
  ) => {
    request.log.warn(
      {
        audit: "route",
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      reason,
    );
    return reply.code(status).send({ problem, reason, requestId: request.id });
  };

  /** The signature and time, the community, then the caller's standing. Returns the refusal when one applies. */
  async function gateFor(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
  ): Promise<
    | { readonly refused: true }
    | {
        readonly refused: false;
        readonly actor: Did;
        readonly now: number;
        readonly nonce: string;
        readonly view: ViewReader;
        readonly creator: Did;
      }
  > {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      await refuse(
        request,
        reply,
        HTTP_STATUS[verdict.problem] ?? 401,
        verdict.problem,
        nodeMessage(verdict.problem as NodeProblem),
        verdict.actor,
      );
      return { refused: true };
    }
    const registered = isCommunityKey(key) ? hub.registrationOf(key) : undefined;
    if (registered === undefined) {
      await refuse(request, reply, 404, "not_held", ROUTE_MESSAGES.not_held, verdict.actor);
      return { refused: true };
    }
    const view = await hub.indexedView(key);
    if (view === undefined) {
      await refuse(request, reply, 503, "record_off", ROUTE_MESSAGES.record_off, verdict.actor);
      return { refused: true };
    }
    return {
      refused: false,
      actor: verdict.actor,
      now: verdict.now,
      nonce: verdict.nonce,
      view,
      creator: registered.creator,
    };
  }

  /** The sentence for a planned route, with the places it joins. */
  function answer(
    key: string,
    fingerprint: string,
    route: RouteEntry,
    origin: PlaceEntry,
    destination: PlaceEntry,
    requestId: string,
  ) {
    return {
      fingerprint,
      origin: { id: route.origin, label: origin.label, area: origin.area },
      destination: { id: route.destination, label: destination.label, area: destination.area },
      costing: route.costing,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      tileRelease: route.tileRelease,
      straightLine: route.tileRelease === STRAIGHT_LINE,
      polyline6: route.polyline6,
      sentences: routeSentences(route, origin, destination),
      community: key,
      requestId,
    };
  }

  app.post<{ Params: { key: string } }>(
    "/communities/:key/places",
    { bodyLimit: ROUTE_BODY_LIMIT },
    async (request, reply) => {
      const { key } = request.params;
      const gated = await gateFor(request, reply, key);
      if (gated.refused) return reply;
      const { actor, now, nonce, view, creator } = gated;
      if (!(await stillMember(actor, key, view))) {
        return refuse(request, reply, 403, "not_member", ROUTE_MESSAGES.not_member, actor);
      }
      const at = Math.max(now, (await logTimeOf(view)) ?? 0);
      if (!(await isTreasurer({ auth, creator, spaceKey: key }, view, actor, at))) {
        return refuse(request, reply, 403, "not_treasurer", ROUTE_MESSAGES.not_treasurer, actor);
      }
      if (!limits.spend("places", actor, ROUTE_RATE.max, ROUTE_RATE.windowMs)) {
        return refuse(request, reply, 429, "limited", ROUTE_MESSAGES.limited, actor);
      }
      const used = claimNonce(nonces, { actor, nonce, now });
      if (used !== undefined) {
        return refuse(
          request,
          reply,
          used === "busy" ? 429 : 409,
          used,
          nonceRefusalMessage(used),
          actor,
        );
      }

      const parsed = placeBody.safeParse(parseJson(request.rawBody));
      if (!parsed.success) {
        return refuse(request, reply, 400, "invalid_place", ROUTE_MESSAGES.invalid_place, actor);
      }
      const secret = options.secretOf(key);
      if (secret === undefined) {
        return refuse(request, reply, 503, "no_secret", ROUTE_MESSAGES.no_secret, actor);
      }
      let addressCommitment: string;
      try {
        const addressKey = await addressKeyOf(secret, key);
        addressCommitment = await commitAddress(addressKey, parsed.data.address, nodeHmacSha512);
      } catch (error) {
        if (error instanceof NormalisationError) {
          return refuse(request, reply, 400, "address", ROUTE_MESSAGES.address, actor);
        }
        throw error;
      }
      const id = await placeIdOf(secret, key, parsed.data.request);
      const kept = places.get(key, id);
      if (kept !== undefined) {
        // A retry of a registration already kept: the same place, with what was kept first.
        return reply.code(200).send({
          id,
          label: kept.label,
          area: kept.area,
          addressCommitment: kept.addressCommitment,
          requestId: request.id,
        });
      }
      places.put(key, id, {
        label: parsed.data.label,
        area: parsed.data.area,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        addressCommitment,
      });
      // The log names the place by its id only: no coordinate and no address.
      request.log.info(
        {
          audit: "route",
          outcome: "accepted",
          action: "place",
          actor,
          place: id,
          requestId: request.id,
        },
        "place registered",
      );
      return reply.code(200).send({
        id,
        label: parsed.data.label,
        area: parsed.data.area,
        addressCommitment,
        requestId: request.id,
      });
    },
  );

  app.post<{ Params: { key: string } }>(
    "/communities/:key/routes",
    { bodyLimit: ROUTE_BODY_LIMIT },
    async (request, reply) => {
      const { key } = request.params;
      const gated = await gateFor(request, reply, key);
      if (gated.refused) return reply;
      const { actor, now, nonce, view, creator } = gated;
      if (!(await stillMember(actor, key, view))) {
        return refuse(request, reply, 403, "not_member", ROUTE_MESSAGES.not_member, actor);
      }
      const at = Math.max(now, (await logTimeOf(view)) ?? 0);
      const problem = await plannerProblem({ auth, creator, spaceKey: key }, view, actor, at);
      if (problem !== undefined)
        return refuse(request, reply, 403, "not_permitted", problem, actor);
      if (!limits.spend("routes", actor, ROUTE_RATE.max, ROUTE_RATE.windowMs)) {
        return refuse(request, reply, 429, "limited", ROUTE_MESSAGES.limited, actor);
      }
      const used = claimNonce(nonces, { actor, nonce, now });
      if (used !== undefined) {
        return refuse(
          request,
          reply,
          used === "busy" ? 429 : 409,
          used,
          nonceRefusalMessage(used),
          actor,
        );
      }

      const parsed = planBody.safeParse(parseJson(request.rawBody));
      if (!parsed.success) {
        return refuse(request, reply, 400, "invalid_route", ROUTE_MESSAGES.invalid_route, actor);
      }
      if (parsed.data.origin === parsed.data.destination) {
        return refuse(request, reply, 400, "same_place", ROUTE_MESSAGES.same_place, actor);
      }
      if (parsed.data.costing !== undefined && parsed.data.costing !== "auto") {
        return refuse(request, reply, 422, "costing", ROUTE_MESSAGES.costing, actor);
      }
      const origin = places.get(key, parsed.data.origin);
      const destination = places.get(key, parsed.data.destination);
      if (origin === undefined || destination === undefined) {
        return refuse(request, reply, 422, "unknown_place", ROUTE_MESSAGES.unknown_place, actor);
      }

      const routed = await options.routing.route({
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        costing: "auto",
      });
      if (!routed.ok) {
        const reason =
          routed.error.code === "out_of_coverage"
            ? ROUTE_MESSAGES.out_of_coverage
            : routed.error.code === "no_route"
              ? ROUTE_MESSAGES.no_route
              : ROUTE_MESSAGES.invalid_route;
        const status = routed.error.code === "invalid_request" ? 400 : 422;
        return refuse(request, reply, status, routed.error.code, reason, actor);
      }
      const route = routed.value;
      const fingerprint = await routeFingerprint(
        route.polyline6,
        route.tileRelease,
        webCryptoSha512,
      );
      const entry: RouteEntry = {
        origin: parsed.data.origin,
        destination: parsed.data.destination,
        polyline6: route.polyline6,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        costing: route.costing,
        tileRelease: route.tileRelease,
        plannedBy: actor,
      };
      routes.put(key, parsed.data.order, fingerprint, entry);
      request.log.info(
        {
          audit: "route",
          outcome: "accepted",
          action: "plan",
          actor,
          fingerprint,
          requestId: request.id,
        },
        "route planned",
      );
      return reply.code(200).send(answer(key, fingerprint, entry, origin, destination, request.id));
    },
  );

  /** The community's places for its members (story 7.3): the Node's own coordinates, and never an address. */
  app.get<{ Params: { key: string } }>("/communities/:key/places", async (request, reply) => {
    const { key } = request.params;
    const gated = await gateFor(request, reply, key);
    if (gated.refused) return reply;
    const { actor, view } = gated;
    if (!(await stillMember(actor, key, view))) {
      return refuse(request, reply, 403, "not_member", ROUTE_MESSAGES.not_member_read, actor);
    }
    return reply.code(200).send({
      places: places.list(key).map(([id, place]) => ({
        id,
        label: place.label,
        area: place.area,
        lat: place.lat,
        lng: place.lng,
      })),
      requestId: request.id,
    });
  });

  // The fingerprint is a query value: a 128-character path parameter is longer than Fastify's default limit (100).
  app.get<{ Params: { key: string }; Querystring: { fingerprint?: string; order?: string } }>(
    "/communities/:key/route",
    async (request, reply) => {
      const { key } = request.params;
      const fingerprint = request.query.fingerprint ?? "";
      const order = request.query.order ?? "";
      const gated = await gateFor(request, reply, key);
      if (gated.refused) return reply;
      const { actor, nonce, now } = gated;
      const member = await hub.isMember(actor, key);
      if (!member)
        return refuse(request, reply, 403, "not_member", ROUTE_MESSAGES.not_member_read, actor);
      const used = claimNonce(nonces, { actor, nonce, now });
      if (used !== undefined)
        return refuse(request, reply, 409, used, nonceRefusalMessage(used), actor);
      const route = routes.get(key, order, fingerprint);
      if (route === undefined) {
        return refuse(request, reply, 404, "not_found", ROUTE_MESSAGES.not_found, actor);
      }
      const origin = places.get(key, route.origin);
      const destination = places.get(key, route.destination);
      if (origin === undefined || destination === undefined) {
        return refuse(request, reply, 404, "not_found", ROUTE_MESSAGES.not_found, actor);
      }
      return reply.code(200).send(answer(key, fingerprint, route, origin, destination, request.id));
    },
  );
}
