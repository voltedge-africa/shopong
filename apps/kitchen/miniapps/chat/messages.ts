export type ChatMessage = { id: string; from: "me" | "them"; text: string };

/** Demo conversation. */
export const seedMessages: readonly ChatMessage[] = [
  { id: "m1", from: "them", text: "Hi! The maize meal order is ready for collection." },
  { id: "m2", from: "me", text: "Great, I'll send a driver this afternoon." },
  { id: "m3", from: "them", text: "Perfect. Ask them for the delivery note." },
];

/** Appends a message from the user. Blank text changes nothing. */
export function sendMessage(
  messages: readonly ChatMessage[],
  text: string,
): readonly ChatMessage[] {
  const trimmed = text.trim();
  if (trimmed === "") return messages;
  return [...messages, { id: `m${messages.length + 1}`, from: "me", text: trimmed }];
}
