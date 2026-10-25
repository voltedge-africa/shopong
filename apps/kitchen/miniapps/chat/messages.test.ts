import { describe, expect, it } from "vite-plus/test";

import { seedMessages, sendMessage } from "./messages";

describe("sendMessage", () => {
  it("appends the trimmed text as a message from the user", () => {
    const next = sendMessage(seedMessages, "  On my way  ");
    expect(next).toHaveLength(seedMessages.length + 1);
    expect(next.at(-1)).toMatchObject({ from: "me", text: "On my way" });
  });

  it("leaves the list untouched for blank text", () => {
    expect(sendMessage(seedMessages, "   ")).toBe(seedMessages);
    expect(sendMessage(seedMessages, "")).toBe(seedMessages);
  });

  it("gives every message a unique id", () => {
    let messages = seedMessages;
    for (const text of ["a", "b", "c"]) messages = sendMessage(messages, text);
    expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);
  });
});
