// The proof events of story 7.6: `delivery.confirmed` with a coarse place, `collection.confirmed` and `delivery.disputed`.
// Their shapes are strict: a coordinate finer than two decimal places, or any other field, is refused (AGENTS.md rule 6).
import { describe, expect, it } from "vite-plus/test";
import { PAYLOAD_VALIDATORS, type JsonObject } from "../src/index.js";

const PHOTO = "f".repeat(128);
const DELIVERY = "e".repeat(128);
const MEMBER = `did:key:z6Mk${"x".repeat(44)}`;

const confirmedPayload = (over: JsonObject = {}): JsonObject => ({
  order: "o1",
  photoSha512: PHOTO,
  ...over,
});
const collectedPayload = (over: JsonObject = {}): JsonObject => ({
  order: "o1",
  delivery: DELIVERY,
  member: MEMBER,
  ...over,
});
const disputedPayload = (over: JsonObject = {}): JsonObject => ({
  order: "o1",
  delivery: DELIVERY,
  ...over,
});

describe("delivery.confirmed with a coarse place (story 7.6)", () => {
  const confirmed = PAYLOAD_VALIDATORS["delivery.confirmed"];

  it("accepts a place rounded to two decimal places, as decimal text", () => {
    expect(confirmed(confirmedPayload({ lat: "-25.71", lng: "28.40" }))).toEqual([]);
    expect(confirmed(confirmedPayload({ lat: "-25.7", lng: "28" }))).toEqual([]);
  });

  it("refuses a place with more than two decimal places", () => {
    expect(confirmed(confirmedPayload({ lat: "-25.7079", lng: "28.4" }))).not.toEqual([]);
    expect(confirmed(confirmedPayload({ lat: "-25.71", lng: "28.4004" }))).not.toEqual([]);
  });

  it("refuses a float, which the canonical JSON does not take", () => {
    expect(confirmed(confirmedPayload({ lat: -25.71, lng: "28.40" }))).not.toEqual([]);
  });

  it("refuses a latitude without a longitude, and the other way round", () => {
    expect(confirmed(confirmedPayload({ lat: "-25.71" }))).not.toEqual([]);
    expect(confirmed(confirmedPayload({ lng: "28.40" }))).not.toEqual([]);
  });

  it("refuses a value out of the range of the globe, or not a number", () => {
    expect(confirmed(confirmedPayload({ lat: "-95", lng: "28.40" }))).not.toEqual([]);
    expect(confirmed(confirmedPayload({ lat: "-25.71", lng: "200" }))).not.toEqual([]);
    expect(confirmed(confirmedPayload({ lat: "south", lng: "28.40" }))).not.toEqual([]);
  });

  it("still refuses the micro-degree fields of story 7.4", () => {
    expect(
      confirmed(confirmedPayload({ latMicro: -25_710_000, lngMicro: 28_400_000 })),
    ).not.toEqual([]);
  });
});

describe("collection.confirmed shape (story 7.6)", () => {
  const collected = PAYLOAD_VALIDATORS["collection.confirmed"];

  it("accepts the order, the delivery it collects from, and the member", () => {
    expect(collected(collectedPayload())).toEqual([]);
  });

  it("refuses a missing delivery, a missing member, and any other field", () => {
    const { delivery: _d, ...noDelivery } = collectedPayload();
    expect(collected(noDelivery)).not.toEqual([]);
    const { member: _m, ...noMember } = collectedPayload();
    expect(collected(noMember)).not.toEqual([]);
    expect(collected(collectedPayload({ lat: -25.71 }))).not.toEqual([]);
  });

  it("refuses a member that is not a did:key", () => {
    expect(collected(collectedPayload({ member: "Ama" }))).not.toEqual([]);
  });
});

describe("delivery.disputed shape (story 7.6)", () => {
  const disputed = PAYLOAD_VALIDATORS["delivery.disputed"];

  it("accepts the order and the confirmation it disputes, with a short note optional", () => {
    expect(disputed(disputedPayload())).toEqual([]);
    expect(disputed(disputedPayload({ note: "2 of 10 bags did not arrive" }))).toEqual([]);
  });

  it("refuses a note longer than 280 characters, or an empty one", () => {
    expect(disputed(disputedPayload({ note: "x".repeat(281) }))).not.toEqual([]);
    expect(disputed(disputedPayload({ note: "   " }))).not.toEqual([]);
  });

  it("refuses a coordinate, and a missing confirmation", () => {
    expect(disputed(disputedPayload({ lat: -25.71, lng: 28.4 }))).not.toEqual([]);
    const { delivery: _d, ...noDelivery } = disputedPayload();
    expect(disputed(noDelivery)).not.toEqual([]);
  });
});
