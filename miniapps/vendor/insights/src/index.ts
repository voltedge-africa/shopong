import type { MiniAppManifest } from "@shopong/miniapp";

export const manifest: MiniAppManifest = {
  id: "insights",
  title: "Insights",
  icon: "stats-chart-outline",
  category: "Insights",
  description:
    "See sales and orders for the last 7 days in simple charts. This is a demo with sample numbers.",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Insights") },
};
