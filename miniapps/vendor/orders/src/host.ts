// What the Orders screen needs from the app's community: whether this person is the treasurer, the
// quotes recorded for an order, and a way to record one. The app provides it (apps/shopong), so this
// package never reaches into the app.

import { createContext } from "react";
import type { Quote } from "@shopong/community";
import type { PaymentView } from "./pay";

/**
 * The member's own pledge and its bank payment for one order (story 4.3). The app does the network and the browser;
 * the screen shows only what these answer. Amounts are whole rand cents.
 */
export interface PaymentHost {
  /** What the Node's record and payments hold for this member and order, and what this phone has queued. */
  paymentOf(order: string): Promise<PaymentView>;
  /** Pledge `minor` cents to the order. Resolves with the plain reason it was refused, or `undefined` when queued. */
  pledge(order: string, minor: number): Promise<string | undefined>;
  /**
   * Asks the Node for this member's bank payment of their pledge, then opens the simulated bank page in an in-app
   * browser tab. Resolves with the plain reason it could not, or `undefined` once the tab has been closed.
   */
  pay(order: string): Promise<string | undefined>;
}

export interface OrdersHost {
  /** Whether this person is the treasurer, so may add a quote. */
  readonly canAdd: boolean;
  /** The quotes recorded for one order, as this phone's record holds them now. */
  quotesFor(order: string): Promise<readonly Quote[]>;
  /** Record a quote. Resolves with the plain reasons it was refused, or `undefined` when it was recorded. */
  addQuote(input: unknown): Promise<string | undefined>;
  /** The pay card's host. Absent in a build without a payments host. */
  readonly payments?: PaymentHost;
}

export const OrdersHostContext = createContext<OrdersHost | null>(null);
