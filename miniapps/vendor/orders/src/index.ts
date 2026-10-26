import type { MiniAppManifest } from "@shopong/miniapp";

export { OrdersHostContext, type OrdersHost } from "./host";

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
