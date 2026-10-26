// The transaction timeline (story 10.2): the steps of one payment in order, joined by event id, and the agreement of the
// record, the pool books and the outcome. Pure: the facts are built here, the Node gathers them in production.
import { describe, expect, it } from "vite-plus/test";
import {
  randWords,
  transactionTimeline,
  type BooksReading,
  type TransactionFacts,
} from "./timeline.js";

const PLEDGE = "a".repeat(128);
const REQUEST = "b".repeat(128);
const OUTCOME = "c".repeat(128);
const COPY = "d".repeat(128);
const LINK_EVENT = "e".repeat(128);
const MINOR = 15_000;

function facts(over: Partial<TransactionFacts> = {}): TransactionFacts {
  return {
    pledge: { eventId: PLEDGE, at: 1_000, minor: MINOR },
    requests: [{ eventId: REQUEST, at: 1_001, minor: MINOR }],
    outcomes: [{ eventId: OUTCOME, minor: MINOR, status: "completed" }],
    postings: [{ eventId: COPY, key: OUTCOME, at: 1_002, minor: MINOR }],
    books: { readable: true, postings: [{ key: OUTCOME, minor: MINOR }] },
    ...over,
  };
}

const kinds = (timeline: ReturnType<typeof transactionTimeline>) =>
  timeline.steps.map((step) => step.kind);

describe("randWords", () => {
  it("writes whole cents as rand and two decimals, exactly", () => {
    expect(randWords(15_000)).toBe("R150.00");
    expect(randWords(5)).toBe("R0.05");
    expect(randWords(150_50)).toBe("R150.50");
  });
});

describe("transactionTimeline steps", () => {
  it("shows a completed payment as pledged, requested, paid, posted, in that order, joined by event id", () => {
    const timeline = transactionTimeline(facts());
    expect(kinds(timeline)).toEqual(["pledged", "requested", "confirmed", "posted"]);
    expect(timeline.pledgeId).toBe(PLEDGE);
    const [pledged, requested, confirmed, posted] = timeline.steps;
    expect(pledged?.eventId).toBe(PLEDGE);
    expect(requested?.eventId).toBe(REQUEST);
    expect(confirmed?.eventId).toBe(OUTCOME);
    expect(posted?.eventId).toBe(COPY);
    expect(posted?.joinedTo).toBe(OUTCOME);
  });

  it("writes every step as one plain sentence in the scenario's words", () => {
    const [pledged, requested, confirmed, posted] = transactionTimeline(facts()).steps;
    expect(pledged?.words).toBe("You pledged R150.00.");
    expect(pledged?.label).toBe("Pledged");
    expect(requested?.label).toBe("Payment requested");
    expect(requested?.words).toBe("Payment of R150.00 requested. You pay it in your banking app.");
    expect(confirmed?.label).toBe("Paid");
    expect(confirmed?.words).toBe("The bank confirmed the payment of R150.00.");
    expect(posted?.words).toBe("The pool books recorded R150.00 from you.");
  });

  it("shows a payment still waiting for the bank as pledged, requested, waiting, with no posting", () => {
    const timeline = transactionTimeline(
      facts({ outcomes: [], postings: [], books: { readable: true, postings: [] } }),
    );
    expect(kinds(timeline)).toEqual(["pledged", "requested", "confirmed"]);
    expect(timeline.steps[2]?.label).toBe("Waiting");
    expect(timeline.agreement.state).toBe("waiting");
  });

  it("shows a failed payment without a posting, and says the member can pay again", () => {
    const timeline = transactionTimeline(
      facts({
        outcomes: [{ eventId: OUTCOME, minor: MINOR, status: "failed" }],
        postings: [],
        books: { readable: true, postings: [] },
      }),
    );
    expect(kinds(timeline)).toEqual(["pledged", "requested", "confirmed"]);
    expect(timeline.steps[2]?.label).toBe("Payment failed");
    expect(timeline.steps[2]?.words).toBe(
      "The bank did not take the payment of R150.00. You can pledge and pay again.",
    );
    expect(timeline.agreement.state).toBe("agree");
  });

  it("shows a completed payment that the books do not show yet as not in the books", () => {
    const timeline = transactionTimeline(
      facts({ postings: [], books: { readable: true, postings: [] } }),
    );
    const posted = timeline.steps[3];
    expect(posted?.label).toBe("Not in the books yet");
    expect(posted?.eventId).toBeUndefined();
    expect(timeline.agreement.state).toBe("disagree");
  });

  it("puts transaction links after the posting, joined by their event id", () => {
    const timeline = transactionTimeline(
      facts({ links: [{ eventId: LINK_EVENT, url: "https://chain.example/tx/1" }] }),
    );
    expect(kinds(timeline)).toEqual(["pledged", "requested", "confirmed", "posted", "link"]);
    expect(timeline.steps[4]?.eventId).toBe(LINK_EVENT);
    expect(timeline.steps[4]?.words).toBe("Transaction link: https://chain.example/tx/1");
  });

  it("leaves out the request step when no request was recorded", () => {
    const timeline = transactionTimeline(facts({ requests: [] }));
    expect(kinds(timeline)).toEqual(["pledged", "confirmed", "posted"]);
  });

  it("uses the first request and the first outcome when the record holds more than one", () => {
    const timeline = transactionTimeline(
      facts({
        requests: [
          { eventId: "9".repeat(128), at: 9_000, minor: MINOR },
          { eventId: REQUEST, at: 1_001, minor: MINOR },
        ],
      }),
    );
    expect(timeline.steps[1]?.eventId).toBe(REQUEST);
  });
});

describe("transactionTimeline agreement", () => {
  it("agrees when the record, the books and the copy hold the same completed amount", () => {
    expect(transactionTimeline(facts()).agreement).toEqual({
      state: "agree",
      words: "The record, the bank and the pool books agree on R150.00.",
    });
  });

  it("is unchecked, and says so, when the books cannot be read", () => {
    const books: BooksReading = { readable: false };
    const timeline = transactionTimeline(facts({ books }));
    expect(timeline.agreement.state).toBe("unchecked");
    expect(timeline.steps[3]?.label).toBe("Not checked");
    expect(timeline.steps[3]?.words).toBe(
      "The pool books could not be read right now, so they are not checked yet.",
    );
  });

  it("disagrees, with both amounts, when the books hold a different amount", () => {
    const timeline = transactionTimeline(
      facts({ books: { readable: true, postings: [{ key: OUTCOME, minor: 10_000 }] } }),
    );
    expect(timeline.agreement.state).toBe("disagree");
    expect(timeline.agreement.words).toBe(
      "The record says R150.00, but the pool books show R100.00. Ask the treasurer to check.",
    );
  });

  it("disagrees when the bank confirmed an amount different from the pledge", () => {
    const timeline = transactionTimeline(
      facts({
        outcomes: [{ eventId: OUTCOME, minor: 20_000, status: "completed" }],
        books: { readable: true, postings: [{ key: OUTCOME, minor: 20_000 }] },
        postings: [{ eventId: COPY, key: OUTCOME, minor: 20_000 }],
      }),
    );
    expect(timeline.agreement.state).toBe("disagree");
    expect(timeline.agreement.words).toBe(
      "The bank confirmed a different amount from the one you pledged. Ask the treasurer to check.",
    );
  });

  it("disagrees when the books hold the payment but the record has no copy of it", () => {
    const timeline = transactionTimeline(facts({ postings: [] }));
    expect(timeline.agreement.state).toBe("disagree");
    expect(timeline.agreement.words).toBe(
      "The pool books show the payment, but the shared record has no copy of it yet. Ask the treasurer to check.",
    );
  });

  it("disagrees when the record's copy and the books differ in amount", () => {
    const timeline = transactionTimeline(
      facts({ postings: [{ eventId: COPY, key: OUTCOME, minor: 14_000 }] }),
    );
    expect(timeline.agreement.state).toBe("disagree");
  });

  it("disagrees when a failed payment is in the books", () => {
    const timeline = transactionTimeline(
      facts({
        outcomes: [{ eventId: OUTCOME, minor: MINOR, status: "failed" }],
        postings: [],
        books: { readable: true, postings: [{ key: OUTCOME, minor: MINOR }] },
      }),
    );
    expect(timeline.agreement.state).toBe("disagree");
  });

  it("is the same for the same facts, every time", () => {
    expect(transactionTimeline(facts())).toEqual(transactionTimeline(facts()));
  });
});
