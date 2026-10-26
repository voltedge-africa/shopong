import type { MiniAppManifest } from "@shopong/miniapp";

export {
  OrdersHostContext,
  type AttachmentHost,
  type OrderList,
  type OrdersHost,
  type PaymentHost,
  type ProofHost,
  type ProofView,
  type BankForm,
  type PayoutHost,
  type PayoutsReading,
} from "./host";
export {
  ARRIVAL_HELP,
  arrivalWords,
  collectionWords,
  disputeWords,
  progressWords,
  type ArrivalState,
} from "./proof";
export { type PaymentRecord } from "./payouts";
export {
  attachOrReason,
  checkWords,
  READ_FAILED,
  stateWords,
  type FileCheck,
  type FilePurpose,
  type FileRowView,
} from "./files";
export { SIMULATED_NOTE, payCardOf, type PaymentView, type PayAction, type PayCard } from "./pay";

export const manifest: MiniAppManifest = {
  id: "orders",
  title: "Orders",
  icon: "receipt-outline",
  category: "Commerce",
  description:
    "Type each supplier's prices and delivery terms for an order, so members can compare them. Only the treasurer can add a quote. Nothing is chosen for you here.",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Orders") },
};
