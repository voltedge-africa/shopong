import { describe, expect, it } from "vite-plus/test";

import {
  MAX_REASON_LENGTH,
  reasonProblem,
  shortEventId,
  titleOf,
  viewOf,
  type RawDiscrepancy,
} from "./data";

const EVENT = "9f".repeat(64);

const raw = (overrides: Partial<RawDiscrepancy> = {}): RawDiscrepancy => ({
  id: "1".repeat(128),
  kind: "bank_paid_not_in_books",
  eventId: EVENT,
  text: "The simulated bank shows a R500.00 payment as paid, but the pool books do not have it. (simulated)",
  record: "not shown as paid",
  books: "not posted",
  provider: "paid",
  openedAt: Date.now(),
  lastSeenAt: Date.now(),
  ...overrides,
});

describe("viewOf", () => {
  it("says no decision is needed when nothing is open", () => {
    expect(viewOf({ open: [], resolved: [] }).summary).toBe(
      "No open differences. Nothing needs a decision.",
    );
  });

  it("counts open differences in plain words and lists the three readings in order", () => {
    const view = viewOf({ open: [raw(), raw({ id: "2".repeat(128) })], resolved: [] });
    expect(view.summary).toBe("2 differences need a decision from a treasurer.");
    expect(view.open[0]!.sides).toEqual([
      { label: "Bank", value: "paid" },
      { label: "Pool books", value: "not posted" },
      { label: "Shared record", value: "not shown as paid" },
    ]);
    expect(view.open[0]!.openedText).toBe("Found today");
  });

  it("keeps resolved differences apart, with the recorded reason", () => {
    const view = viewOf({
      open: [],
      resolved: [raw({ resolution: { reason: "Bank statement checked", at: 1, by: "did:key:z" } })],
    });
    expect(view.open).toEqual([]);
    expect(view.resolved[0]!.resolutionText).toBe("Resolved: Bank statement checked");
  });

  it("shows the event id shortened, with the full id kept for copying", () => {
    const row = viewOf({ open: [raw()], resolved: [] }).open[0]!;
    expect(row.shortEventId).toBe(`${EVENT.slice(0, 12)}…`);
    expect(row.eventId).toBe(EVENT);
  });
});

describe("titles", () => {
  it("has a plain title for each kind the reconciler opens, and a plain fallback for any other", () => {
    expect(titleOf("paid_no_pledge")).toContain("no pledge");
    expect(titleOf("something_new")).toBe("The three records do not agree on this payment");
  });

  it("shortens only long event ids", () => {
    expect(shortEventId("abc")).toBe("abc");
  });
});

describe("reasonProblem", () => {
  it("refuses an empty or blank reason, and one over the limit, and accepts a reason", () => {
    expect(reasonProblem("   ")).toBe("Write why you are resolving this difference.");
    expect(reasonProblem("x".repeat(MAX_REASON_LENGTH + 1))).toBe(
      "Keep the reason under 500 characters.",
    );
    expect(reasonProblem("  Checked the bank statement.  ")).toBeUndefined();
  });
});
