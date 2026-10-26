// The Timeline screen's words: the steps in the Node's order, the agreement's tone, and the list's labels.
import { describe, expect, it } from "vite-plus/test";
import { transactionTimeline } from "@shopong/community";

import { agreementTone, paymentLabel, SHORT_ID, stepLines } from "./lines";

const PLEDGE = "a".repeat(128);
const OUTCOME = "c".repeat(128);

const timeline = transactionTimeline({
  pledge: { eventId: PLEDGE, minor: 15_000 },
  requests: [{ eventId: "b".repeat(128), minor: 15_000 }],
  outcomes: [{ eventId: OUTCOME, minor: 15_000, status: "completed" }],
  postings: [{ eventId: "d".repeat(128), key: OUTCOME, minor: 15_000 }],
  books: { readable: true, postings: [{ key: OUTCOME, minor: 15_000 }] },
});

describe("stepLines", () => {
  it("keeps the Node's order and labels, and shows the first characters of each event id", () => {
    const lines = stepLines(timeline);
    expect(lines.map((line) => line.label)).toEqual([
      "Pledged",
      "Payment requested",
      "Paid",
      "Recorded in the pool books",
    ]);
    expect(lines[0]?.ref).toBe(PLEDGE.slice(0, SHORT_ID));
    expect(lines[0]?.words).toBe("You pledged R150.00.");
  });

  it("gives every line a distinct key", () => {
    const keys = stepLines(timeline).map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves out the event id of a step that shows no record event", () => {
    const waiting = transactionTimeline({
      pledge: { eventId: PLEDGE, minor: 15_000 },
      requests: [],
      outcomes: [],
      postings: [],
      books: { readable: true, postings: [] },
    });
    const lines = stepLines(waiting);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.ref).toBe(PLEDGE.slice(0, SHORT_ID));
  });
});

describe("agreementTone", () => {
  it("is ok when they agree, warn when they differ, and neutral otherwise", () => {
    expect(agreementTone("agree")).toBe("ok");
    expect(agreementTone("disagree")).toBe("warn");
    expect(agreementTone("waiting")).toBe("neutral");
    expect(agreementTone("unchecked")).toBe("neutral");
  });
});

describe("paymentLabel", () => {
  it("names the order and the amount in rand", () => {
    expect(paymentLabel({ pledgeId: PLEDGE, order: "March groceries", minor: 15_000 })).toBe(
      "March groceries: R150.00",
    );
  });
});
