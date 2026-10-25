import type { MiniAppManifest } from "@shopong/miniapp";

import { deliveryMessages } from "./data";

export const manifest: MiniAppManifest = {
  id: "delivery",
  title: "Delivery",
  icon: "bicycle-outline",
  category: "Logistics",
  content: {
    kind: "bundle",
    // `require` so Metro bundles the built page as an asset; nothing runs until it is opened.
    asset: () => require("../dist/index.html") as number,
    messages: deliveryMessages,
  },
};
