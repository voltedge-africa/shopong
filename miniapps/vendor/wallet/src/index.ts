import type { MiniAppManifest } from "@shopong/miniapp";

export const manifest: MiniAppManifest = {
  id: "wallet",
  title: "Wallet",
  icon: "wallet-outline",
  category: "Money",
  description:
    "See your balance and recent payments, and split or hide a payment. This is a demo: no real money moves.",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Wallet") },
};
