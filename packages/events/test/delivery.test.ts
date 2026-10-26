// The delivery events of story 7.4: `place.registered` and `delivery.planned`. Their shapes are strict, so a
// coordinate or an address can never be written to the record (AGENTS.md rule 6), and the route fingerprint is
// SHA-512 of the polyline and the tile release (decision: the line stays on the Node).
import { describe, expect, it } from "vite-plus/test";
import {
  NormalisationError,
  PAYLOAD_VALIDATORS,
  commitAddress,
  encodeUtf8,
  normaliseAddress,
  routeFingerprint,
  sha512Hex,
  webCryptoSha512,
  type HmacSha512,
  type JsonObject,
} from "../src/index.js";

const PLACE = "a".repeat(64);
const OTHER_PLACE = "b".repeat(64);
const DRIVER = `did:key:z6Mk${"x".repeat(44)}`;
const FINGERPRINT = "c".repeat(128);
const COMMITMENT = "d".repeat(128);

const plannedPayload = (over: JsonObject = {}): JsonObject => ({
  order: "o1",
  driver: DRIVER,
  origin: PLACE,
  destination: OTHER_PLACE,
  route: {
    costing: "auto",
    distanceMeters: 12_400,
    durationSeconds: 1_500,
    tileRelease: "straight-line",
    fingerprint: FINGERPRINT,
  },
  windowStart: 1_793_000_000_000,
  windowEnd: 1_793_007_200_000,
  ...over,
});

const registeredPayload = (over: JsonObject = {}): JsonObject => ({
  place: PLACE,
  label: "Mamelodi Wholesale depot",
  area: "Mamelodi, Pretoria",
  addressCommitment: COMMITMENT,
  ...over,
});

const planned = PAYLOAD_VALIDATORS["delivery.planned"];
const registered = PAYLOAD_VALIDATORS["place.registered"];

describe("delivery.planned shape", () => {
  it("accepts ids, a route summary and a fingerprint", () => {
    expect(planned(plannedPayload())).toEqual([]);
  });

  it("accepts the window left out", () => {
    const { windowStart: _a, windowEnd: _b, ...rest } = plannedPayload();
    expect(planned(rest)).toEqual([]);
  });

  it.each([
    ["latMicro", -25_707_900],
    ["lngMicro", 28_400_400],
    ["lat", -25.7079],
    ["lng", 28.4004],
    ["address", "12 Church Street"],
    ["polyline6", "_p~iF~ps|U_ulLnnqC"],
  ])("refuses a %s field at the top level", (name, value) => {
    expect(planned(plannedPayload({ [name]: value }))).not.toEqual([]);
  });

  it("refuses coordinates or a polyline inside the route", () => {
    const route = { ...(plannedPayload().route as JsonObject), polyline6: "_p~iF~ps|U" };
    expect(planned(plannedPayload({ route }))).not.toEqual([]);
  });

  it("refuses a place that is not an opaque 64-character id", () => {
    expect(planned(plannedPayload({ origin: "-25.7079,28.4004" }))).not.toEqual([]);
    expect(planned(plannedPayload({ destination: "Mamelodi depot" }))).not.toEqual([]);
  });

  it("refuses a fingerprint that is not a 128-character hex digest", () => {
    const route = { ...(plannedPayload().route as JsonObject), fingerprint: "abc" };
    expect(planned(plannedPayload({ route }))).not.toEqual([]);
  });

  it("refuses an unknown costing and a negative distance", () => {
    const route = { ...(plannedPayload().route as JsonObject), costing: "teleport" };
    expect(planned(plannedPayload({ route }))).not.toEqual([]);
    const far = { ...(plannedPayload().route as JsonObject), distanceMeters: -1 };
    expect(planned(plannedPayload({ route: far }))).not.toEqual([]);
  });

  it("refuses a missing driver", () => {
    const { driver: _d, ...rest } = plannedPayload();
    expect(planned(rest)).not.toEqual([]);
  });
});

describe("place.registered shape", () => {
  it("accepts an opaque id, a label, a coarse area and an address commitment", () => {
    expect(registered(registeredPayload())).toEqual([]);
  });

  it.each([
    ["lat", -25.7079],
    ["lng", 28.4004],
    ["address", "12 Church Street, Mamelodi"],
    ["street", "Church Street"],
  ])("refuses a %s field, so no exact place reaches the record", (name, value) => {
    expect(registered(registeredPayload({ [name]: value }))).not.toEqual([]);
  });

  it("refuses an address that is not a commitment", () => {
    expect(registered(registeredPayload({ addressCommitment: "12 Church Street" }))).not.toEqual(
      [],
    );
  });

  it("refuses a place id that is not 64 hex characters", () => {
    expect(registered(registeredPayload({ place: "depot-1" }))).not.toEqual([]);
  });

  it("refuses an empty label", () => {
    expect(registered(registeredPayload({ label: "   " }))).not.toEqual([]);
  });
});

describe("normaliseAddress and its commitment", () => {
  it("tidies spacing and case, so one address has one commitment", () => {
    expect(normaliseAddress("  12  Church   STREET, Mamelodi ")).toBe("12 church street, mamelodi");
  });

  it("refuses an empty address", () => {
    expect(() => normaliseAddress("   ")).toThrow(NormalisationError);
  });

  it("commits to the normalised address with the community secret", async () => {
    const secret = new Uint8Array(32).fill(7);
    const hmac: HmacSha512 = async (key, message) => {
      const subtle = globalThis.crypto.subtle;
      const material = new Uint8Array(key);
      const data = new Uint8Array(message);
      const k = await subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-512" }, false, [
        "sign",
      ]);
      return new Uint8Array(await subtle.sign("HMAC", k, data));
    };
    const a = await commitAddress(secret, "12 Church Street", hmac);
    const b = await commitAddress(secret, " 12  church street ", hmac);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{128}$/);
    const other = await commitAddress(new Uint8Array(32).fill(9), "12 Church Street", hmac);
    expect(other).not.toBe(a);
  });
});

describe("routeFingerprint", () => {
  it("is SHA-512 of the polyline and the tile release, as 128 hex characters", async () => {
    const fp = await routeFingerprint("_p~iF~ps|U", "straight-line", webCryptoSha512);
    expect(fp).toMatch(/^[0-9a-f]{128}$/);
    const again = await routeFingerprint("_p~iF~ps|U", "straight-line", webCryptoSha512);
    expect(again).toBe(fp);
  });

  it("changes when the line or the tile release changes", async () => {
    const base = await routeFingerprint("_p~iF~ps|U", "straight-line", webCryptoSha512);
    expect(await routeFingerprint("_p~iF~ps|V", "straight-line", webCryptoSha512)).not.toBe(base);
    expect(await routeFingerprint("_p~iF~ps|U", "memory-tiles-2026.01", webCryptoSha512)).not.toBe(
      base,
    );
  });

  it("is not a bare hash of the polyline (the release is part of it)", async () => {
    const bare = await sha512Hex(encodeUtf8("_p~iF~ps|U"), webCryptoSha512);
    expect(await routeFingerprint("_p~iF~ps|U", "straight-line", webCryptoSha512)).not.toBe(bare);
  });
});

// Patch of story 7.4 (review): address-like names, bounded numbers, release ids, and the confirmation shape.
import { looksLikeAddress } from "../src/index.js";

describe("looksLikeAddress (place names are names, never addresses)", () => {
  it.each(["14 Mkhize Street", "Erf 123 Mamelodi", "Unit 5, Church Rd", "12 Church Rd, Soweto"])(
    "refuses %s",
    (text) => expect(looksLikeAddress(text)).toBe(true),
  );
  it.each([
    "Collection point",
    "Drop-off A",
    "Spar 24",
    "Thandi's spaza",
    "Orlando community hall",
  ])("accepts %s", (text) => expect(looksLikeAddress(text)).toBe(false));
  it("reads Unicode digits as their ASCII value", () => {
    expect(looksLikeAddress("14 Mkhize Street")).toBe(true);
  });
});

describe("place names and bounded numbers (patch)", () => {
  it("refuses a place whose label or area is an address", () => {
    expect(registered(registeredPayload({ label: "14 Mkhize Street" }))).not.toEqual([]);
    expect(registered(registeredPayload({ area: "Erf 123 Mamelodi" }))).not.toEqual([]);
    expect(registered(registeredPayload({ label: "Spar 24", area: "Soweto" }))).toEqual([]);
  });

  it("refuses an implausible distance, duration or window", () => {
    const route = (over: JsonObject) => ({ ...(plannedPayload().route as JsonObject), ...over });
    expect(planned(plannedPayload({ route: route({ distanceMeters: 25_707_900 }) }))).not.toEqual(
      [],
    );
    expect(planned(plannedPayload({ route: route({ distanceMeters: 0 }) }))).not.toEqual([]);
    expect(planned(plannedPayload({ route: route({ durationSeconds: 200_000 }) }))).not.toEqual([]);
    expect(planned(plannedPayload({ windowStart: 5 }))).not.toEqual([]);
  });

  it("accepts only a release id as the tile release, never free text", () => {
    const route = (over: JsonObject) => ({ ...(plannedPayload().route as JsonObject), ...over });
    expect(
      planned(plannedPayload({ route: route({ tileRelease: "14 Mkhize Street, Mamelodi" }) })),
    ).not.toEqual([]);
    expect(planned(plannedPayload({ route: route({ tileRelease: "Straight-Line" }) }))).not.toEqual(
      [],
    );
    expect(planned(plannedPayload({ route: route({ tileRelease: "za-kzn-2026.05" }) }))).toEqual(
      [],
    );
  });
});

describe("delivery.confirmed shape (patch: no coordinate in a confirmation)", () => {
  const confirmed = PAYLOAD_VALIDATORS["delivery.confirmed"];
  const photo = "f".repeat(128);
  it("accepts the order and the photo's SHA-512, with the place optional", () => {
    expect(confirmed({ order: "o1", photoSha512: photo })).toEqual([]);
    expect(confirmed({ order: "o1", photoSha512: photo, place: PLACE })).toEqual([]);
  });
  it.each([
    ["latMicro", -25_707_900],
    ["lngMicro", 28_400_400],
    ["lat", -25.7],
  ])("refuses a %s coordinate", (name, value) => {
    expect(confirmed({ order: "o1", photoSha512: photo, [name]: value })).not.toEqual([]);
  });
  it("refuses a place that is not an opaque id", () => {
    expect(confirmed({ order: "o1", photoSha512: photo, place: "-25.7,28.4" })).not.toEqual([]);
  });
});
