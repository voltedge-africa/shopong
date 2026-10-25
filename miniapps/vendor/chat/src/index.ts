import type { MiniAppManifest } from "@shopong/miniapp";

export const manifest: MiniAppManifest = {
  id: "chat",
  title: "Chat",
  icon: "chatbubbles-outline",
  category: "Community",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Chat") },
};
