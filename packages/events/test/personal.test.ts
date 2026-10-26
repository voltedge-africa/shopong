// The personal-data guard (AGENTS.md rule 6): a payload may not hold a raw phone number or ID number,
// by field name or by shape in free text. It is pure, so `apply` can call it.
import { describe, expect, it } from "vite-plus/test";
import { PERSONAL_DATA_MESSAGE, checkPersonalFields, type JsonObject } from "../src/index.js";
import { vectors } from "./vectors.js";

const DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const commitment = vectors.commitments[0]?.commitment ?? "";

const refused = (payload: JsonObject) => checkPersonalFields(payload).length > 0;

describe("personal-data guard, by field name (matrix: raw phone in a field)", () => {
  it("refuses a raw phone number in a field named phone, with the plain reason", () => {
    const issues = checkPersonalFields({ phone: "082 123 4567" });
    expect(issues).toEqual([{ path: "$.payload.phone", message: PERSONAL_DATA_MESSAGE }]);
    expect(PERSONAL_DATA_MESSAGE).toBe("Personal details can't be written to the shared record.");
  });

  it("accepts a commitment in a field named phone (matrix: commitment in a field)", () => {
    expect(checkPersonalFields({ phone: commitment })).toEqual([]);
  });

  it("refuses a raw ID number, a raw address and a raw phone under other names", () => {
    expect(refused({ idNumber: "8001015009087" })).toBe(true);
    expect(refused({ id_number: "8001015009087" })).toBe(true);
    expect(refused({ address: "12 Vilakazi Street, Soweto" })).toBe(true);
    expect(refused({ mobileNumber: "+27821234567" })).toBe(true);
    expect(refused({ msisdn: "27821234567" })).toBe(true);
  });

  it("refuses a personal field at any depth, including inside an array", () => {
    expect(refused({ lines: [{ item: "Maize", phone: "082 123 4567" }] })).toBe(true);
    expect(checkPersonalFields({ lines: [{ item: "Maize", phone: "082 123 4567" }] })).toEqual([
      { path: "$.payload.lines[0].phone", message: PERSONAL_DATA_MESSAGE },
    ]);
  });

  it("refuses a field ending in Commitment that does not hold a commitment", () => {
    expect(refused({ phoneCommitment: "+27821234567" })).toBe(true);
    expect(refused({ idNumberCommitment: { digits: "8001015009087" } })).toBe(true);
    expect(checkPersonalFields({ idNumberCommitment: commitment })).toEqual([]);
  });

  it("accepts null in a personal field, since nothing is written", () => {
    expect(refused({ phone: null, address: null })).toBe(false);
  });
});

describe("personal-data guard, by shape in free text (matrix: phone-shaped free text)", () => {
  it("refuses a phone number typed into free text", () => {
    expect(refused({ note: "Call 0821234567 after five" })).toBe(true);
    expect(refused({ note: "+27 (0)82 123 4567" })).toBe(true);
  });

  it("refuses a 13-digit run that passes the ID check digit", () => {
    expect(refused({ note: "ID 8001015009087" })).toBe(true);
  });

  it("accepts ordinary text with short numbers", () => {
    expect(refused({ note: "Sugar 2kg, 3 bags, collect at 5pm" })).toBe(false);
  });

  it("accepts a commitment in free text, since it reveals nothing", () => {
    expect(refused({ note: commitment })).toBe(false);
  });

  it("accepts a did:key and a 64-character lowercase hex id as structural values", () => {
    expect(refused({ invitee: DID, invitation: "a".repeat(64) })).toBe(false);
  });

  it("can skip the free-text shape check, which a caller with its own check uses", () => {
    expect(checkPersonalFields({ item: "Sugar 0821234567" }, { freeText: false })).toEqual([]);
    expect(checkPersonalFields({ phone: "082 123 4567" }, { freeText: false })).not.toEqual([]);
  });
});

// Round 2 (review of 2.7): separators and digit variants, invitation and DID exemptions, dates, field names.

describe("separators and digit variants are normalised before the shape check (M1)", () => {
  const variants: Record<string, string> = {
    dotted: "082.123.4567",
    slashed: "082/123/4567",
    "zero-width separated": "082​123​4567",
    "fullwidth digits": "０８２１２３４５６７",
    "Arabic-Indic digits": "٠٨٢١٢٣٤٥٦٧",
    "bracketed and dotted": "(082).123.4567",
  };
  for (const [name, text] of Object.entries(variants)) {
    it(`refuses a phone number written with ${name}`, () => {
      expect(refused({ note: text }), name).toBe(true);
    });
  }
});

describe("dates are not phone numbers (M5)", () => {
  it("accepts an ISO date and an 8-digit date in ordinary text", () => {
    expect(refused({ note: "Due 2026-10-26" })).toBe(false);
    expect(refused({ title: "Stokvel order 20261026" })).toBe(false);
  });

  it("still refuses a phone number written next to a date", () => {
    expect(refused({ note: "Due 2026-10-26, call 082 123 4567" })).toBe(true);
  });
});

describe("the did:key and invitation exemptions are exact (M3, H4)", () => {
  it("does not exempt a string that only starts like a did:key", () => {
    expect(refused({ invitee: "did:key:z27821234567" })).toBe(true);
    expect(refused({ note: "did:key:z27821234567" })).toBe(true);
  });

  it("does not exempt a phone number in the invitation field", () => {
    expect(refused({ invitation: "082 123 4567" })).toBe(true);
    expect(checkPersonalFields({ invitation: "082 123 4567" })).toEqual([
      { path: "$.payload.invitation", message: PERSONAL_DATA_MESSAGE },
    ]);
  });

  it("exempts an invitation token id in the shape the token library produces", () => {
    expect(refused({ invitation: `bafyrei${"a".repeat(52)}` })).toBe(false);
  });

  it("exempts a hex string only at exactly 64 or 128 characters, whole value", () => {
    expect(refused({ note: `${"1234567"}${"a".repeat(57)}` })).toBe(false); // 64
    expect(refused({ note: `${"1234567"}${"a".repeat(56)}` })).toBe(true); // 63
    expect(refused({ note: `x${"1234567"}${"a".repeat(57)}` })).toBe(true); // 65, not whole
  });
});

describe("personal field names (L1)", () => {
  // The value has no digits, so only the field name can refuse it.
  for (const name of [
    "idNo",
    "idNum",
    "tel",
    "cell",
    "whatsapp",
    "contact",
    "idNumber",
    "homeAddress",
  ]) {
    it(`refuses a raw value in a field named ${name}`, () => {
      expect(refused({ [name]: "Thandi Mokoena" }), name).toBe(true);
    });
  }

  it("refuses an address only as a whole word, so IP and e-mail addresses pass", () => {
    expect(refused({ ipAddress: "10.0.0.1" })).toBe(false);
    expect(refused({ emailAddress: "thandi@example.org" })).toBe(false);
    expect(refused({ address: "12 Vilakazi Street" })).toBe(true);
  });
});
