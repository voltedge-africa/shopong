import { describe, expect, it } from "vite-plus/test";
import { collectedWords, dayWords, timelineWords } from "./closing";

describe("the closing screen's words", () => {
  it("says a day the same way on every phone", () => {
    expect(dayWords(Date.UTC(2026, 9, 26, 23, 59))).toBe("26 Oct 2026");
  });

  it("adds the day to a timeline line only when the record has a time", () => {
    expect(timelineWords({ sentence: "You closed the order." })).toBe("You closed the order.");
    expect(timelineWords({ sentence: "You closed the order.", at: Date.UTC(2026, 0, 5) })).toBe(
      "You closed the order. (5 Jan 2026)",
    );
  });

  it("words collection for a member's line", () => {
    expect(collectedWords(true)).toBe("Collected");
    expect(collectedWords(false)).toBe("Not collected yet");
  });
});
