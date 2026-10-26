// What the Orders screen needs from the app's community: whether this person is the treasurer, the
// quotes recorded for an order, and a way to record one. The app provides it (apps/shopong), so this
// package never reaches into the app.

import { createContext } from "react";
import type { Quote } from "@shopong/community";
import type { PaymentView } from "./pay";
import type { PaymentRecord } from "./payouts";

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
  /** The supplier payments host (story 4.7). Absent in a build without it. */
  readonly payouts?: PayoutHost;
}

export const OrdersHostContext = createContext<OrdersHost | null>(null);

/** A payment's bank details as the treasurer types them. Sent to the Node only; the phone keeps nothing. */
export interface BankForm {
  readonly name: string;
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountType: "current" | "savings";
}

/** What the Orders screen shows for the payments on an order, as this phone's copy of the record and the Node hold them. */
export interface PayoutsReading {
  readonly payments: readonly PaymentRecord[];
  /** Approvals needed in this community (the record's setting, two by default). */
  readonly required: number;
  /** The Node's plain sentence for each payment it has sent, by payment id. */
  readonly sent: ReadonlyMap<string, string>;
  /** The DID of the person looking at the screen. */
  readonly me: string;
  readonly treasurer: boolean;
  /** The record's plain reason for each approval this phone sent that did not count, by payment id. */
  readonly approvalNotices?: ReadonlyMap<string, string>;
  /** The record's plain reasons for payments this phone proposed that the record refused. */
  readonly proposalNotices?: readonly string[];
}

/** The supplier payments host (story 4.7). The app does the signing and the network; the screen shows the answers. */
export interface PayoutHost {
  paymentsOf(order: string): Promise<PayoutsReading>;
  /** Records the treasurer's payment for a supplier's quote. Resolves with the plain reason refused, or `undefined`. */
  propose(
    order: string,
    supplier: string,
    amountMinor: number,
    recommendation: string,
  ): Promise<string | undefined>;
  /** Signs this person's approval (after they confirmed it on screen) and sends it. Resolves with the reason refused. */
  approve(payout: string): Promise<string | undefined>;
  /** Asks the Node to pay the supplier. Resolves with the Node's plain reason when refused, or `undefined` once sent. */
  pay(payout: string): Promise<string | undefined>;
  /** Keeps a supplier's bank details on the Node. Resolves with the reason refused, or `undefined`. */
  saveBank(supplier: string, bank: BankForm): Promise<string | undefined>;
}
