// Gives the Orders mini app what it needs from this phone's community: whether I am the treasurer, the
// quotes for an order, and recording a quote. The rules are in `@shopong/community`; the mini app only
// shows the answers. Mounted only around the Orders app (see app/miniapp/[id].tsx).
import { useMemo, type ReactNode } from "react";
import { OrdersHostContext, type OrdersHost } from "@shopong/miniapp-orders";

import { useCommunity } from "../lib/CommunityProvider";

export function OrdersHostProvider({ children }: { children: ReactNode }) {
  const { canAddQuotes, addQuote, quotesFor } = useCommunity();
  const host = useMemo<OrdersHost>(
    () => ({ canAdd: canAddQuotes, addQuote, quotesFor }),
    [canAddQuotes, addQuote, quotesFor],
  );
  return <OrdersHostContext.Provider value={host}>{children}</OrdersHostContext.Provider>;
}
