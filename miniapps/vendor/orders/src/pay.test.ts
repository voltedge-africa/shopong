// The pay card's words (story 4.3). The card takes only what the Node says about the member's pledge: it never takes
// a redirect parameter, so "Paid" cannot come from a return link. Every card that talks about a payment says it is a
// test payment with no money moving, and no card names the processor, a webhook, a capability token or an idempotency key.
import { describe, expect, it } from "vite-plus/test";
import { createSingleFlight, payCardOf, type PaymentView, SIMULATED_NOTE } from "./pay";

const base: PaymentView = { onNode: true, queued: false, pledgedMinor: 15000 };
const withStatus = (status: PaymentView["status"]): PaymentView => ({ ...base, status });

describe("the pay card, by what the Node says", () => {
  it("asks for a pledge when the member has none", () => {
    const card = payCardOf({ onNode: true, queued: false });
    expect(card.heading).toBe("No pledge yet");
    expect(card.actions).toEqual(["pledge"]);
  });

  it("says a pledge is saved on the phone while it has not reached the Node", () => {
    const card = payCardOf({ onNode: true, queued: true });
    expect(card.heading).toBe("Pledge saved on this phone");
    expect(card.body.join(" ")).toContain("when this phone is online");
    expect(card.actions).toEqual(["check"]);
  });

  it("offers Pay on a pledge the Node holds with no request yet, showing the amount", () => {
    const card = payCardOf(withStatus("none"));
    expect(card.heading).toBe("Pledge of R150.00");
    expect(card.actions).toEqual(["pay"]);
    expect(card.amountText).toBe("R150.00");
  });

  it("shows waiting for confirmation while the Node says pending, never paid", () => {
    const card = payCardOf(withStatus("pending"));
    expect(card.heading).toBe("Waiting for confirmation");
    expect(card.actions).toEqual(["check"]);
  });

  it("says not paid yet, pledge still open, with Check again and Pay again, for a closed unpaid request", () => {
    const card = payCardOf(withStatus("cancelled"));
    expect(card.heading).toBe("Not paid yet, pledge still open");
    expect(card.actions).toEqual(["check", "pay_again"]);
  });

  it("says the request ran out, and offers Pay again", () => {
    const card = payCardOf(withStatus("expired"));
    expect(card.heading).toBe("Not paid. The request ran out.");
    expect(card.actions).toEqual(["pay_again"]);
  });

  it("says the payment did not go through, and offers Pay again", () => {
    const card = payCardOf(withStatus("failed"));
    expect(card.heading).toBe("Not paid. The payment did not go through.");
    expect(card.actions).toEqual(["pay_again"]);
  });

  it("says the Node could not be reached, and offers Try again", () => {
    const card = payCardOf(withStatus("unreachable"));
    expect(card.heading).toBe("Could not reach your community's Node");
    expect(card.body.join(" ")).toContain("Try Pay again");
    expect(card.actions).toEqual(["try_again"]);
  });

  it("says a completed test payment only as a simulated one, and never as a bare Paid", () => {
    const card = payCardOf(withStatus("completed"));
    expect(card.heading).toBe("Test payment received (simulated)");
    expect(card.heading).not.toMatch(/^Paid/u);
    expect(card.actions).toEqual([]);
  });

  it("says pay is not set up when the phone is not in a community on the Node", () => {
    const card = payCardOf({ onNode: false, queued: false });
    expect(card.heading).toBe("Pay is not set up here");
    expect(card.actions).toEqual([]);
  });
});

describe("the words hold for every state", () => {
  const states: PaymentView[] = [
    { onNode: true, queued: false },
    { onNode: true, queued: true },
    withStatus("none"),
    withStatus("pending"),
    withStatus("cancelled"),
    withStatus("expired"),
    withStatus("failed"),
    withStatus("completed"),
    withStatus("unreachable"),
  ];

  it.each(states.map((s) => [s.status ?? (s.queued ? "queued" : "no pledge"), s] as const))(
    "%s: no card calls a payment paid, names the processor, a webhook, a token or an idempotency key",
    (_name, view) => {
      const card = payCardOf(view);
      const words = [
        card.heading,
        ...card.body,
        ...(card.amountText ? [card.amountText] : []),
      ].join(" ");
      expect(words).not.toMatch(/\bPaid\b/u);
      expect(words).not.toMatch(/stitch|webhook|ucan|idempoten|token/iu);
    },
  );

  it.each(
    states
      .filter(
        (s) => s.status !== undefined && s.status !== "completed" && s.status !== "unreachable",
      )
      .map((s) => [s.status, s] as const),
  )("%s: every payment card says it is a test payment and no money moves", (_name, view) => {
    const card = payCardOf(view);
    expect(card.body).toContain(SIMULATED_NOTE);
    expect(SIMULATED_NOTE).toBe("Test payment (simulated): no money moves.");
  });
});

describe("review items 5, 6 and 9: no dead ends, a card for each answer", () => {
  it("offers Pay again, not only Pay, when the window has closed with no request (item 5)", () => {
    const card = payCardOf({
      onNode: true,
      queued: false,
      pledgedMinor: 15000,
      status: "none",
      windowOpen: false,
    });
    expect(card.heading).toBe("Your pledge's time to pay has run out");
    expect(card.actions).toEqual(["pay_again"]);
  });

  it.each([
    ["clock", "Check your phone's clock"],
    ["not_reached", "Your pledge has not reached the Node yet"],
    ["busy", "The Node is busy"],
  ] as const)("gives %s its own card with Check again (item 6)", (status, heading) => {
    const card = payCardOf(withStatus(status));
    expect(card.heading).toBe(heading);
    expect(card.actions).toEqual(["check"]);
  });

  it("an unknown status word gets the plain fallback card with Check again, never nothing (item 9)", () => {
    const card = payCardOf(withStatus("mystery" as never));
    expect(card.heading).toBe("We could not read this payment's status. Try again.");
    expect(card.actions).toEqual(["check"]);
  });
});

describe("review item 12: one tap, one tab", () => {
  it("runs a task once while it is still running, even when called twice before it returns", async () => {
    const flight = createSingleFlight();
    let calls = 0;
    const slow = () =>
      new Promise<string>((resolve) => {
        calls += 1;
        setTimeout(() => resolve("opened"), 5);
      });
    const [first, second] = await Promise.all([flight.run(slow), flight.run(slow)]);
    expect(calls).toBe(1);
    expect(first).toBe("opened");
    expect(second).toBeUndefined();
    expect(flight.busy()).toBe(false);
  });

  it("is free again once the task has finished", async () => {
    const flight = createSingleFlight();
    await flight.run(async () => 1);
    expect(await flight.run(async () => 2)).toBe(2);
  });

  it("is free again even when the task fails", async () => {
    const flight = createSingleFlight();
    await expect(flight.run(async () => Promise.reject(new Error("no tab")))).rejects.toThrow();
    expect(await flight.run(async () => 3)).toBe(3);
  });
});
