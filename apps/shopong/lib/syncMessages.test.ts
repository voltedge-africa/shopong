import { describe, expect, it } from "vite-plus/test";
import { syncLine } from "./syncMessages";
import type { SyncState } from "./sync";

const line = (state: SyncState, extra: Partial<Parameters<typeof syncLine>[0]> = {}) =>
  syncLine({ state, offlineHint: false, onWeb: false, ...extra });

describe("plain words for the sync state (story 3.4 UI)", () => {
  it("connected, with nothing waiting", () => {
    expect(line({ result: "connected", pending: 0 })).toMatchObject({
      headline: "Connected to your OCN Node.",
      tone: "good",
      tryAgain: false,
    });
  });

  it("offline: says the changes are saved on the phone, and how many wait", () => {
    const l = line({ result: "offline", pending: 3, retryInMs: 2000 });
    expect(l.headline).toBe("You are offline. Your changes are saved on your phone.");
    expect(l.detail).toBe("Waiting to send 3 changes.");
  });

  it("waiting to send N, in the singular and the plural", () => {
    expect(line({ result: "connected", pending: 1 }).headline).toBe("Waiting to send 1 change.");
    expect(line({ result: "waiting", pending: 2 }).headline).toBe("Waiting to send 2 changes.");
  });

  it("could not send, with the Node's plain reason and a Try again", () => {
    const l = line({
      result: "refused",
      pending: 2,
      refusal: "Only a member of the community can read it.",
    });
    expect(l.headline).toBe("Could not send 2 changes.");
    expect(l.detail).toBe("Only a member of the community can read it.");
    expect(l.tryAgain).toBe(true);
  });

  it("the hint says offline before the first answer, but the last result is the truth", () => {
    expect(line({ result: "none", pending: 0 }, { offlineHint: true }).headline).toContain(
      "You are offline",
    );
    expect(line({ result: "connected", pending: 0 }, { offlineHint: true }).headline).toBe(
      "Connected to your OCN Node.",
    );
  });

  it("a build with no Node says so, and that changes stay on the phone", () => {
    const l = line(
      { result: "no_node", pending: 1 },
      { noNodeReason: "No OCN Node is set for this build." },
    );
    expect(l.headline).toBe("No OCN Node is set for this build.");
    expect(l.detail).toBe("Changes stay on this phone for now.");
  });

  it("a clock refusal says to check the phone's clock, and retries (review P7)", () => {
    const l = line({ result: "clock_skew", pending: 1, retryInMs: 2000 });
    expect(l.headline).toBe("Check your phone's clock.");
    expect(l.tryAgain).toBe(false);
  });

  it("a set-aside queue is said plainly (review P6)", () => {
    const l = line({ result: "none", pending: 0, setAside: true });
    expect(l.detail ?? l.headline).toContain(
      "Some waiting changes could not be read and were set aside.",
    );
  });

  it("entries the Node sent that were ignored are counted (review P4)", () => {
    const l = line({ result: "connected", pending: 0, ignored: 2 });
    expect(l.detail).toBe("2 entries from the Node could not be checked and were ignored.");
  });

  it("on the web, says the waiting changes are lost on reload", () => {
    const l = line({ result: "offline", pending: 1 }, { onWeb: true });
    expect(l.detail).toContain("lost if this page is reloaded");
    expect(line({ result: "offline", pending: 0 }, { onWeb: true }).detail ?? "").not.toContain(
      "reloaded",
    );
  });
});
