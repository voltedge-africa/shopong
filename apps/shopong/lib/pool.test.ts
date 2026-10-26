// The pool card's states and words (story 4.6). The phone shows what the Node sends and does no money arithmetic: these
// tests check the mapping from the Node's answer to the state, and the plain lines the card shows.
import type { PoolView } from "@shopong/community";
import { describe, expect, it } from "vite-plus/test";
import type { NodeReply } from "./nodeClient";
import { freshnessOf, poolLines, poolScreenOf } from "./pool";

const view: PoolView = {
  currency: "ZAR",
  total: { minor: "50000", text: "The pool holds R500.00." },
  target: { minor: "100000", text: "The target is R1000.00." },
  you: {
    minor: "10000",
    text: "You have paid R100.00",
    share: "50000",
    shareText: "Your share is R500.00",
    status: { kind: "part_paid", label: "Part paid" },
  },
  members: [
    { you: false, status: { kind: "paid", label: "Paid" } },
    { you: true, status: { kind: "part_paid", label: "Part paid" } },
  ],
  flags: [],
};

const ok = (value: PoolView): NodeReply<PoolView> => ({ ok: true, value });

describe("poolScreenOf: the Node's answer to the state the card shows", () => {
  it("shows the Node's figures when the Node answers", () => {
    const screen = poolScreenOf(ok(view), 1_000);
    expect(screen).toEqual({ state: "shown", view, checkedAt: 1_000 });
  });

  it("says the Node cannot be reached, with no totals shown as current", () => {
    const screen = poolScreenOf(
      { ok: false, failure: { kind: "offline", reason: "No answer from the OCN Node." } },
      1_000,
    );
    expect(screen).toEqual({
      state: "unreachable",
      message: "We can't reach the Node. Figures may be out of date.",
    });
    expect(JSON.stringify(screen)).not.toContain("R500");
  });

  it("says the books can't be read, and shows nothing", () => {
    const screen = poolScreenOf(
      {
        ok: false,
        failure: {
          kind: "refused",
          status: 503,
          problem: "books_unavailable",
          reason: "The books can't be read right now.",
        },
      },
      1_000,
    );
    expect(screen).toEqual({ state: "unavailable", message: "The books can't be read right now." });
  });

  it("gives the Node's plain reason when the Node refuses, such as for a stranger", () => {
    const screen = poolScreenOf(
      {
        ok: false,
        failure: {
          kind: "refused",
          status: 403,
          problem: "not_member",
          reason: "You are not a member of this community.",
        },
      },
      1_000,
    );
    expect(screen).toEqual({
      state: "refused",
      message: "You are not a member of this community.",
    });
  });
});

describe("poolLines: the simulated notice (review item 1)", () => {
  it("shows the Node's sentence first when the figures include simulated payments", () => {
    const note = "These figures include test payments (simulated). No real money has moved.";
    const lines = poolLines(poolScreenOf(ok({ ...view, simulatedNote: note } as PoolView), 1_000));
    expect(lines[0]).toBe(note);
    expect(lines).toContain("The pool holds R500.00.");
  });

  it("shows no notice when the Node does not say the payments are simulated", () => {
    const lines = poolLines(poolScreenOf(ok(view), 1_000));
    expect(lines.some((line) => line.includes("(simulated)"))).toBe(false);
  });
});

describe("poolLines: the plain words the card shows", () => {
  it("shows the total, the target, your own amount and status, and each member's status", () => {
    const lines = poolLines({ state: "shown", view, checkedAt: 1_000 });
    expect(lines).toEqual([
      "The pool holds R500.00.",
      "The target is R1000.00.",
      "You have paid R100.00",
      "Your share is R500.00",
      "Your status: Part paid",
      "Member 1: Paid",
      "Member 2: Part paid (you)",
    ]);
  });

  it("shows each flag in the Node's words, with both amounts", () => {
    const flagged: PoolView = {
      ...view,
      flags: [
        {
          kind: "mismatch",
          text: "The books show R500.00 but the shared record shows R450.00. The difference is R50.00.",
        },
      ],
    };
    const lines = poolLines({ state: "shown", view: flagged, checkedAt: 1_000 });
    expect(lines).toContain(
      "The books show R500.00 but the shared record shows R450.00. The difference is R50.00.",
    );
    // The total still shows next to the flag.
    expect(lines).toContain("The pool holds R500.00.");
  });

  it("shows No target yet when the record has no target, and no share line", () => {
    const noTarget: PoolView = {
      ...view,
      target: null,
      you: {
        ...view.you,
        share: null,
        shareText: null,
        status: { kind: "no_target", label: "No target yet" },
      },
      members: view.members.map((m) => ({
        ...m,
        status: { kind: "no_target", label: "No target yet" },
      })),
    };
    const lines = poolLines({ state: "shown", view: noTarget, checkedAt: 1_000 });
    expect(lines).toContain("No target yet.");
    expect(lines).not.toContain("Your share is R500.00");
    expect(lines).toContain("Your status: No target yet");
  });

  it("shows only the state's sentence when the Node cannot be reached or the books are unreadable", () => {
    expect(
      poolLines({
        state: "unreachable",
        message: "We can't reach the Node. Figures may be out of date.",
      }),
    ).toEqual(["We can't reach the Node. Figures may be out of date."]);
    expect(
      poolLines({ state: "unavailable", message: "The books can't be read right now." }),
    ).toEqual(["The books can't be read right now."]);
  });
});

describe("the freshness of the figures (triage 2 and 9)", () => {
  // Local-time clock: the words are the phone's own, so the test builds its dates in local time too.
  const at = (hours: number, minutes: number, seconds = 0) =>
    new Date(2026, 9, 26, hours, minutes, seconds).getTime();

  it("says when the figures were last checked, to the minute", () => {
    expect(freshnessOf(at(9, 5), at(9, 5, 20))).toEqual({
      checkedText: "Last checked 09:05",
      stale: false,
    });
  });

  it("marks the figures as possibly out of date only after 30 seconds", () => {
    expect(freshnessOf(at(9, 5), at(9, 5, 30)).stale).toBe(false);
    expect(freshnessOf(at(9, 5), at(9, 5, 31)).stale).toBe(true);
  });
});
