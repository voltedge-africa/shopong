// The phone's reading of a failed status read (story 4.3, review items 6 and 9): every failure kind has its own answer,
// and the Node's completed status is never made from a failure.
import { describe, expect, it } from "vite-plus/test";
import type { NodeFailure } from "./nodeClient";
import { paymentStatusOfFailure, storedPledgeEvent } from "./paymentStatus";

const failure = (over: {
  kind: NodeFailure["kind"];
  status: number;
  problem: string;
}): NodeFailure => ({ reason: "x", ...over }) as NodeFailure;

describe("a failed status read says why (review item 6)", () => {
  it("a network failure says the Node could not be reached", () => {
    expect(paymentStatusOfFailure({ kind: "offline", reason: "No answer" })).toBe("unreachable");
  });

  it("a clock refusal (401 clock_skew) says to check the clock", () => {
    expect(
      paymentStatusOfFailure(failure({ kind: "clock", status: 401, problem: "clock_skew" })),
    ).toBe("clock");
  });

  it("a pledge the Node does not hold yet (404 unknown_pledge) says it has not reached the Node", () => {
    expect(
      paymentStatusOfFailure(failure({ kind: "refused", status: 404, problem: "unknown_pledge" })),
    ).toBe("not_reached");
  });

  it("a 429 says the Node is busy: try later", () => {
    expect(
      paymentStatusOfFailure(failure({ kind: "waiting", status: 429, problem: "rate_limited" })),
    ).toBe("busy");
  });

  it("any other refusal is unreadable, never the network sentence", () => {
    expect(
      paymentStatusOfFailure(failure({ kind: "refused", status: 403, problem: "not_yours" })),
    ).toBe("unreadable");
  });

  it("never gives the Node's completed status: a failure is not a payment", () => {
    const all: NodeFailure[] = [
      { kind: "offline", reason: "x" },
      failure({ kind: "clock", status: 401, problem: "clock_skew" }),
      failure({ kind: "waiting", status: 429, problem: "rate_limited" }),
      failure({ kind: "refused", status: 404, problem: "unknown_pledge" }),
      failure({ kind: "refused", status: 500, problem: "boom" }),
    ];
    for (const item of all) expect(paymentStatusOfFailure(item)).not.toBe("completed");
  });
});

describe("the pledge a payment names", () => {
  it("is the event id of the stored pledge, and nothing when there is none", () => {
    expect(storedPledgeEvent({ event: "ab".repeat(64), minor: 15000 })).toBe("ab".repeat(64));
    expect(storedPledgeEvent(undefined)).toBeUndefined();
    expect(storedPledgeEvent({ minor: 15000 })).toBeUndefined();
  });
});
