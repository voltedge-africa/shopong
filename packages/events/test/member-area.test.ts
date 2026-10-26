// The member's area (story 7.3): `member.area` names a suburb or a town and nothing finer (AGENTS rule 6). The coarsening
// rule is one function, `coarseArea`, used on the phone before anything is sent and again by the shape check, so a
// street-level entry is refused in both places.
import { describe, expect, it } from "vite-plus/test";
import { PAYLOAD_VALIDATORS, EVENT_TYPES, coarseArea, type JsonObject } from "../src/index.js";

const area = (over: JsonObject = {}): JsonObject => ({ area: "Umbilo", ...over });
const shape = PAYLOAD_VALIDATORS["member.area"];

describe("member.area shape", () => {
  it("is an event type the registry knows", () => {
    expect(EVENT_TYPES).toContain("member.area");
  });

  it("accepts a suburb or a town name", () => {
    expect(shape(area())).toEqual([]);
    expect(shape(area({ area: "Mamelodi East" }))).toEqual([]);
  });

  it("refuses a street-level area, so no street or number reaches the record", () => {
    expect(shape(area({ area: "12 Church Street, Umbilo" })).length).toBeGreaterThan(0);
    expect(shape(area({ area: "Church Street" })).length).toBeGreaterThan(0);
  });

  it("refuses an area with a digit in it, and any field other than the area", () => {
    expect(shape(area({ area: "Erf 45" })).length).toBeGreaterThan(0);
    expect(shape(area({ street: "Church Street" })).length).toBeGreaterThan(0);
  });

  it("refuses an empty area and one that is too long", () => {
    expect(shape(area({ area: "   " })).length).toBeGreaterThan(0);
    expect(shape(area({ area: "x".repeat(61) })).length).toBeGreaterThan(0);
  });
});

describe("coarseArea (the coarsening rule, on the phone and in the shape check)", () => {
  it("tidies the spacing and keeps the name as typed", () => {
    expect(coarseArea("  Mamelodi   East ")).toEqual({ ok: true, area: "Mamelodi East" });
  });

  it("refuses a street name, a number or an erf, with one plain sentence", () => {
    for (const text of ["Church Street", "Berea Road", "12 Church", "Erf 45", "Unit 3"]) {
      expect(coarseArea(text), text).toEqual({
        ok: false,
        reason: "Give the suburb or town only, with no street, number or erf.",
      });
    }
  });

  it("refuses an empty name", () => {
    expect(coarseArea("   ").ok).toBe(false);
  });
});
