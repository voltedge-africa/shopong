// The business profile (story 9.1): `business.profile` names a small retailer's shown fields and a signature over them.
// Only the name is always shown; the kind and the suburb or town are shown only when the retailer chooses. Nothing else
// is accepted, so no phone, ID number, address or registration number can reach the record (AGENTS rule 6).
import { describe, expect, it } from "vite-plus/test";
import {
  BUSINESS_KINDS,
  businessProfileBytes,
  parseEvent,
  toBase64,
  type BusinessProfileFields,
} from "../src/index.js";

const base = {
  v: 1,
  space: "ab".repeat(32),
  actor: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  proof: [],
  claimedAt: 1793001600000,
  nonce: "00".repeat(16),
};
/** An 86-character base64url text: the length a 64-byte Ed25519 signature has. */
const SIG = "A".repeat(86);
/** A signature whose characters all read as digits, which the phone-number shape would otherwise catch. */
const DIGIT_SIG = "0123456789".repeat(9).slice(0, 86);

const good = { name: "Thabo's Spaza", signature: SIG };

function parse(payload: unknown) {
  return parseEvent({ ...base, type: "business.profile", payload } as never);
}

describe("business.profile payload", () => {
  it("is refused unless the name and the signature are both given", () => {
    expect(parse(good).ok).toBe(true);
    expect(parse({ signature: SIG }).ok).toBe(false);
    expect(parse({ name: "Thabo's Spaza" }).ok).toBe(false);
  });

  it("accepts the shown fields the retailer chose: kind and suburb, each optional", () => {
    expect(parse({ ...good, kind: "spaza shop" }).ok).toBe(true);
    expect(parse({ ...good, area: "Umbilo" }).ok).toBe(true);
    expect(parse({ ...good, kind: "street seller", area: "Mamelodi East" }).ok).toBe(true);
  });

  it("accepts a signature made of digits, which the record must not refuse", () => {
    expect(parse({ ...good, signature: DIGIT_SIG }).ok).toBe(true);
  });

  it("refuses a kind that is not on the fixed list", () => {
    expect(parse({ ...good, kind: "bank" }).ok).toBe(false);
    for (const kind of BUSINESS_KINDS) expect(parse({ ...good, kind }).ok).toBe(true);
  });

  it.each([
    ["an address as the name", { ...good, name: "12 Church Street" }],
    ["a phone number as the name", { ...good, name: "082 123 4567" }],
    ["an ID number as the name", { ...good, name: "8001015009087" }],
    ["an empty name", { ...good, name: "   " }],
    ["a name longer than 80 characters", { ...good, name: "N".repeat(81) }],
    ["a name with a line break", { ...good, name: "Thabo\nSpaza" }],
    ["a street as the area", { ...good, area: "12 Church Street" }],
    ["an area with a number", { ...good, area: "Erf 45" }],
    ["a phone number field", { ...good, phone: "+27821234567" }],
    ["an address field", { ...good, address: "12 Church Street" }],
    ["a registration number field", { ...good, registrationNumber: "2019/123456/07" }],
    ["a coordinate", { ...good, lat: -29.85 }],
    ["a signature that is too short", { ...good, signature: "A".repeat(85) }],
    ["a signature with a space", { ...good, signature: `${"A".repeat(85)} ` }],
  ])("refuses %s", (_label, payload) => {
    expect(parse(payload).ok).toBe(false);
  });
});

describe("businessProfileBytes", () => {
  const fields: BusinessProfileFields = {
    name: "Thabo's Spaza",
    kind: "spaza shop",
    area: "Umbilo",
  };
  const space = "ab".repeat(32);

  it("is the same for the same fields in any key order, and differs for any change", () => {
    const reordered = { area: "Umbilo", kind: "spaza shop", name: "Thabo's Spaza" };
    expect(toBase64(businessProfileBytes(space, fields))).toBe(
      toBase64(businessProfileBytes(space, reordered)),
    );
    expect(toBase64(businessProfileBytes(space, fields))).not.toBe(
      toBase64(businessProfileBytes(space, { ...fields, area: "Mamelodi" })),
    );
  });

  it("differs when a field is hidden, so a signature over shown fields cannot be read as one over more", () => {
    const withoutArea = { name: fields.name, kind: fields.kind };
    expect(toBase64(businessProfileBytes(space, withoutArea))).not.toBe(
      toBase64(businessProfileBytes(space, fields)),
    );
  });

  it("differs for another community, so a profile cannot be moved to a different one", () => {
    expect(toBase64(businessProfileBytes("cd".repeat(32), fields))).not.toBe(
      toBase64(businessProfileBytes(space, fields)),
    );
  });
});
