import { describe, expect, it } from "vite-plus/test";
import { checkWords, stateWords, type FileRowView } from "./files";

const photo: FileRowView = {
  hash: "a".repeat(128),
  name: "front",
  type: "image/jpeg",
  size: 10,
  purpose: "delivery-photo",
  state: "saved",
};
const list: FileRowView = { ...photo, purpose: "price-list", supplier: "Makro" };

describe("the words for a file on an order", () => {
  it("says what the phone is doing, in plain words", () => {
    expect(stateWords({ ...photo, state: "sending" })).toBe("Sending photo");
    expect(stateWords({ ...photo, state: "saved" })).toBe("Photo saved");
    expect(stateWords({ ...list, state: "sending" })).toBe("Sending price list");
    expect(stateWords({ ...list, state: "saved" })).toBe("Price list saved");
    expect(stateWords({ ...photo, state: "waiting" })).toBe("Waiting to send");
    expect(
      stateWords({
        ...photo,
        state: "refused",
        reason: "Only a driver can attach a delivery photo.",
      }),
    ).toBe("Only a driver can attach a delivery photo.");
  });

  it("says whether the bytes match the record, and flags a file that does not", () => {
    expect(checkWords("delivery-photo", "verified")).toBe("verified");
    expect(checkWords("delivery-photo", "does_not_match")).toBe(
      "Photo does not match, kept and flagged",
    );
    expect(checkWords("price-list", "does_not_match")).toBe(
      "Price list does not match, kept and flagged",
    );
    expect(checkWords("price-list", "unavailable")).toBe("Couldn't check it now. Try again.");
    expect(checkWords("price-list", undefined)).toBe("Checking…");
  });
});
