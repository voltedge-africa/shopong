import { describe, expect, it } from "vite-plus/test";
import { unqueuedMessage } from "./nodeMessages";

describe("a change that could not be queued is said so plainly (review P3)", () => {
  it("never claims the change is on the phone", () => {
    const message = unqueuedMessage(
      "The invitation was made",
      "It could not be saved on this phone.",
    );
    expect(message).toBe(
      "The invitation was made, but it could not be saved on this phone. It is not recorded yet.",
    );
    expect(message).not.toContain("on your phone");
  });
});
