// Gives the Orders mini app what it needs from this phone's community: whether I am the treasurer, the quotes for an
// order, recording a quote, and the member's own pledge and bank payment (story 4.3). The rules are in
// `@shopong/community` and on the Node; the mini app only shows the answers. Mounted only around the Orders app
// (see app/miniapp/[id].tsx).
import * as WebBrowser from "expo-web-browser";
import { useMemo, type ReactNode } from "react";
import {
  OrdersHostContext,
  type OrdersHost,
  type PaymentHost,
  type PayoutHost,
} from "@shopong/miniapp-orders";

import { useCommunity } from "../lib/CommunityProvider";

export function OrdersHostProvider({ children }: { children: ReactNode }) {
  const {
    canAddQuotes,
    addQuote,
    quotesFor,
    pledgeOrder,
    paymentOf,
    payOrder,
    paymentsOf,
    proposePayment,
    approvePayment,
    payPayment,
    saveSupplierBank,
  } = useCommunity();
  const host = useMemo<OrdersHost>(() => {
    const payments: PaymentHost = {
      paymentOf,
      pledge: pledgeOrder,
      pay: async (order) => {
        const asked = await payOrder(order);
        if (!asked.ok) return asked.message;
        // The bank page opens in an in-app browser tab (AD-15). Closing it says nothing about the payment: the screen
        // asks the Node afterwards, and only the Node's record decides what is shown.
        try {
          await WebBrowser.openBrowserAsync(asked.url);
          return undefined;
        } catch {
          return "The bank page could not be opened. Try Pay again.";
        }
      },
    };
    // Supplier payments (story 4.7): the Node and the record decide; the screen only shows their answers.
    const payouts: PayoutHost = {
      paymentsOf,
      propose: proposePayment,
      approve: approvePayment,
      pay: payPayment,
      saveBank: saveSupplierBank,
    };
    return { canAdd: canAddQuotes, addQuote, quotesFor, payments, payouts };
  }, [
    canAddQuotes,
    addQuote,
    quotesFor,
    pledgeOrder,
    paymentOf,
    payOrder,
    paymentsOf,
    proposePayment,
    approvePayment,
    payPayment,
    saveSupplierBank,
  ]);
  return <OrdersHostContext.Provider value={host}>{children}</OrdersHostContext.Provider>;
}
