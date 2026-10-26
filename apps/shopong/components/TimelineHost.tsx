// Gives the Payment timeline mini app this member's own payments and the Node's timeline of one of them (story 10.2).
// The Node decides what may be read (only the member who pledged); the screen only shows its answer. Mounted only around
// the Timeline app (see app/miniapp/[id].tsx).
import { useMemo, type ReactNode } from "react";
import {
  TimelineHostContext,
  type TimelineAnswer,
  type TimelineHost,
} from "@shopong/miniapp-timeline";

import { useCommunity } from "../lib/CommunityProvider";
import { nodeFailureMessage } from "../lib/nodeMessages";

export function TimelineHostProvider({ children }: { children: ReactNode }) {
  const { myPaymentsOf, timelineOf } = useCommunity();
  const host = useMemo<TimelineHost>(
    () => ({
      payments: myPaymentsOf,
      timelineOf: async (pledgeId): Promise<TimelineAnswer> => {
        const reply = await timelineOf(pledgeId);
        if (!reply.ok) {
          return { ok: false, message: nodeFailureMessage(reply.failure, "show the timeline") };
        }
        // The Node's notes (simulated payments, books that could not be read) are shown beside the steps, never dropped.
        const note = [reply.value.simulatedNote, reply.value.booksNote]
          .filter((text): text is string => text !== undefined)
          .join(" ");
        return {
          ok: true,
          timeline: reply.value.timeline,
          ...(note === "" ? {} : { note }),
        };
      },
    }),
    [myPaymentsOf, timelineOf],
  );
  return <TimelineHostContext.Provider value={host}>{children}</TimelineHostContext.Provider>;
}
