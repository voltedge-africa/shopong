import type { MiniAppManifest } from "@shopong/miniapp";

export const manifest: MiniAppManifest = {
  id: "wallet",
  title: "Wallet",
  icon: "wallet-outline",
  category: "Money",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Wallet") },
};
