import type { MiniAppManifest } from "@shopong/miniapp";

export const manifest: MiniAppManifest = {
  id: "discrepancies",
  title: "Discrepancies",
  icon: "alert-circle-outline",
  category: "Money",
  description:
    "See where the bank, the pool books and the shared record disagree about a payment, and record why a difference was resolved. Simulated payments; nothing is repaired here.",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Discrepancies") },
};
