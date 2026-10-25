import type { ActionEvent } from "@openuidev/react-lang";

import { DEFINITIONS } from "./genui";

/** What a button does in a preview, in plain words. Nothing is really sent or changed. */
const PREVIEW: Record<string, string> = {
  "message.send": "In the finished app this sends the message. Nothing was sent.",
  "order.propose": "In the finished app this prepares the order for your OK. Nothing was ordered.",
  "route.plan": "In the finished app this plans the stops. Nothing was planned.",
  "delivery.confirm": "In the finished app this saves the delivery. Nothing was saved.",
  "ledger.read": "In the finished app this refreshes the information.",
};

export const NOTHING_HAPPENED = "This is a preview. Nothing happened.";

/**
 * The plain notice for a button press. A button with no action, or one the preview does not know,
 * says nothing happened. The action's name (`MessageSend`) and its tool (`message.send`) are
 * internal and never shown.
 */
export function previewNotice(event: Pick<ActionEvent, "type">): string {
  const tool = DEFINITIONS.toolOfAction.get(event.type);
  return (tool && PREVIEW[tool]) || NOTHING_HAPPENED;
}
