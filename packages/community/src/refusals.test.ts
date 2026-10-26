import { describe, expect, it } from "vite-plus/test";
import { REFUSAL_LOG_LIMIT, addRefusal, type Refusal } from "./refusals.js";

describe("the phone's refusal log", () => {
  it("keeps the newest 20 refusals, newest first", () => {
    let log: readonly Refusal[] = [];
    for (let i = 0; i < 25; i++) {
      log = addRefusal(log, { at: i, action: "Check an invitation", reason: `No ${i}` });
    }
    expect(REFUSAL_LOG_LIMIT).toBe(20);
    expect(log).toHaveLength(20);
    expect(log[0]?.reason).toBe("No 24");
    expect(log[19]?.reason).toBe("No 5");
  });
});
