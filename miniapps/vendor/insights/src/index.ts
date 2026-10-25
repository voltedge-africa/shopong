import type { MiniAppManifest } from "@shopong/miniapp";

export const manifest: MiniAppManifest = {
  id: "insights",
  title: "Insights",
  icon: "stats-chart-outline",
  category: "Insights",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Insights") },
};
