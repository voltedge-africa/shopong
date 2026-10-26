// What the Orders screen needs from the app's community: whether this person is the treasurer, the
// quotes recorded for an order, and a way to record one. The app provides it (apps/shopong), so this
// package never reaches into the app.

import { createContext } from "react";
import type { Quote } from "@shopong/community";

export interface OrdersHost {
  /** Whether this person is the treasurer, so may add a quote. */
  readonly canAdd: boolean;
  /** The quotes recorded for one order, as this phone's record holds them now. */
  quotesFor(order: string): Promise<readonly Quote[]>;
  /** Record a quote. Resolves with the plain reasons it was refused, or `undefined` when it was recorded. */
  addQuote(input: unknown): Promise<string | undefined>;
}

export const OrdersHostContext = createContext<OrdersHost | null>(null);
