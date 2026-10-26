// The pool view (story 4.6): the rows of the plan's I/O matrix, judged on plain inputs. The Node reads the books and
// the record; this module only says what they mean, in plain words, with exact integer cents.
import { describe, expect, it } from "vite-plus/test";
import { POOL_STATUS_LABELS, poolView, type PoolInputs } from "./pool.js";

const A = "a".repeat(128);
const B = "b".repeat(128);
const C = "c".repeat(128);

/** Inputs with the books and the record in step, nothing paid and no target, the caller `A`. */
function inputs(over: Partial<PoolInputs> = {}): PoolInputs {
  return {
    currency: "ZAR",
    books: { pool: 0n, members: new Map() },
    record: { pool: 0n, members: new Map() },
    memberIds: [A, B],
    you: A,
    target: undefined,
    ...over,
  };
}

const flagKinds = (view: ReturnType<typeof poolView>) => view.flags.map((f) => f.kind);

describe("poolView: books and record agree", () => {
  it("shows the ledger's totals and no flag when the books and the record agree", () => {
    const view = poolView(
      inputs({
        books: { pool: 50_000n, members: new Map([[A, 10_000n]]) },
        record: { pool: 50_000n, members: new Map([[A, 10_000n]]) },
      }),
    );
    expect(view.total.minor).toBe("50000");
    expect(view.total.text).toBe("The pool holds R500.00.");
    expect(view.flags).toEqual([]);
  });
});

describe("poolView: mismatch between the books and the record", () => {
  it("flags the difference with both amounts in plain words, and still shows the ledger total", () => {
    const view = poolView(
      inputs({
        books: { pool: 50_000n, members: new Map() },
        record: { pool: 45_000n, members: new Map() },
      }),
    );
    expect(view.total.minor).toBe("50000");
    expect(view.total.text).toBe("The pool holds R500.00.");
    expect(view.flags).toEqual([
      {
        kind: "mismatch",
        text: "The books show R500.00 but the shared record shows R450.00. The difference is R50.00.",
      },
    ]);
  });

  it("flags a difference in the other direction too (record ahead of the books)", () => {
    const view = poolView(
      inputs({
        books: { pool: 45_000n, members: new Map() },
        record: { pool: 50_000n, members: new Map() },
      }),
    );
    expect(flagKinds(view)).toContain("mismatch");
    expect(view.flags[0]?.text).toBe(
      "The books show R450.00 but the shared record shows R500.00. The difference is R50.00.",
    );
  });

  it("flags a member account that has no matching member in the record", () => {
    const view = poolView(
      inputs({
        books: { pool: 0n, members: new Map([[C, 2_500n]]) },
        record: { pool: 0n, members: new Map() },
      }),
    );
    expect(view.flags).toContainEqual({
      kind: "unmatched_member",
      text: "A member account has no matching member in the record.",
    });
  });
});

describe("poolView: the caller's own contribution", () => {
  it("says what the caller has paid", () => {
    const view = poolView(
      inputs({
        books: { pool: 10_000n, members: new Map([[A, 10_000n]]) },
        record: { pool: 10_000n, members: new Map([[A, 10_000n]]) },
      }),
    );
    expect(view.you.minor).toBe("10000");
    expect(view.you.text).toBe("You have paid R100.00");
  });

  it("says R0.00 and Waiting when nothing is paid yet", () => {
    const view = poolView(inputs({ target: 20_000n }));
    expect(view.you.minor).toBe("0");
    expect(view.you.text).toBe("You have paid R0.00");
    expect(view.you.status).toEqual({ kind: "waiting", label: "Waiting" });
  });
});

describe("poolView: statuses", () => {
  it("shows Paid for each member once each share is paid", () => {
    const view = poolView(
      inputs({
        books: {
          pool: 20_000n,
          members: new Map([
            [A, 10_000n],
            [B, 10_000n],
          ]),
        },
        record: {
          pool: 20_000n,
          members: new Map([
            [A, 10_000n],
            [B, 10_000n],
          ]),
        },
        target: 20_000n,
      }),
    );
    expect(view.members.map((m) => m.status.label)).toEqual(["Paid", "Paid"]);
    expect(view.you.status.kind).toBe("paid");
  });

  it("shows Part paid while some of the share is still owed", () => {
    const view = poolView(
      inputs({
        books: { pool: 5_000n, members: new Map([[A, 5_000n]]) },
        record: { pool: 5_000n, members: new Map([[A, 5_000n]]) },
        target: 20_000n,
      }),
    );
    expect(view.you.status).toEqual({ kind: "part_paid", label: "Part paid" });
  });

  it("shows No target yet for everyone when the record has no target", () => {
    const view = poolView(
      inputs({
        books: { pool: 5_000n, members: new Map([[A, 5_000n]]) },
        record: { pool: 5_000n, members: new Map([[A, 5_000n]]) },
      }),
    );
    expect(view.target).toBeNull();
    expect(view.you.share).toBeNull();
    expect(view.members.map((m) => m.status.label)).toEqual([
      POOL_STATUS_LABELS.no_target,
      POOL_STATUS_LABELS.no_target,
    ]);
    expect(view.total.text).toBe("The pool holds R50.00.");
  });
});

describe("poolView: exact share arithmetic", () => {
  it("splits the target in whole cents, the first members in id order taking the remainder cent", () => {
    // R100.01 over three members: 3334, 3334, 3333 cents.
    const three = [A, B, C];
    const view = poolView(inputs({ memberIds: three, you: C, target: 10_001n }));
    expect(view.you.share).toBe("3333");
    expect(view.you.text).toBe("You have paid R0.00");
    expect(view.you.shareText).toBe("Your share is R33.33");
  });
});

describe("poolView: privacy", () => {
  it("never shows another member's amount to the caller, only that member's status", () => {
    const view = poolView(
      inputs({
        books: {
          pool: 77_777n,
          members: new Map([
            [A, 1_111n],
            [B, 66_666n],
          ]),
        },
        record: {
          pool: 77_777n,
          members: new Map([
            [A, 1_111n],
            [B, 66_666n],
          ]),
        },
        target: 90_000n,
      }),
    );
    const text = JSON.stringify(view.members);
    expect(text).not.toContain("666");
    expect(text).not.toContain("R666.66");
    expect(text).not.toContain(B);
    expect(view.members.every((m) => Object.keys(m).sort().join() === "status,you")).toBe(true);
    expect(view.members.map((m) => m.you)).toEqual([true, false]);
  });

  it("keeps another member's mismatch as a flag with no amounts in it", () => {
    const view = poolView(
      inputs({
        books: { pool: 10_000n, members: new Map([[B, 10_000n]]) },
        record: { pool: 10_000n, members: new Map([[B, 4_000n]]) },
      }),
    );
    const flag = view.flags.find((f) => f.kind === "member_mismatch");
    expect(flag).toBeDefined();
    expect(flag?.text).not.toMatch(/R\d/);
    expect(JSON.stringify(view.flags)).not.toContain("6000");
  });

  it("shows the caller their own mismatch with their own amounts", () => {
    const view = poolView(
      inputs({
        books: { pool: 10_000n, members: new Map([[A, 10_000n]]) },
        record: { pool: 10_000n, members: new Map([[A, 4_000n]]) },
      }),
    );
    expect(view.flags).toContainEqual({
      kind: "member_mismatch",
      text: "Your amounts do not match. The books show R100.00 and the shared record shows R40.00.",
    });
  });
});

describe("poolView: money is exact", () => {
  it("keeps sums past 2^53 exact and shows the amount in rand and cents", () => {
    const big = 9_007_199_254_740_993n;
    const view = poolView(
      inputs({
        books: { pool: big, members: new Map() },
        record: { pool: big, members: new Map() },
      }),
    );
    expect(view.flags).toEqual([]);
    expect(view.total.text).toBe("The pool holds R90071992547409.93.");
  });

  it("refuses a negative total in the plain text as a minus sign, never a wrong figure", () => {
    const view = poolView(
      inputs({
        books: { pool: -150n, members: new Map() },
        record: { pool: -150n, members: new Map() },
      }),
    );
    expect(view.total.text).toBe("The pool holds -R1.50.");
  });
});
