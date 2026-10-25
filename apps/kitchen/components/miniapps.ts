import type { ComponentProps, ComponentType } from "react";
import type Ionicons from "@expo/vector-icons/Ionicons";

import type { MiniAppSource } from "../lib/webui/document";
import { deliveryMessages } from "../miniapps/delivery/data";
import { placeholderSource, shopSource, walletSource } from "./miniapp-content";

/** A native mini app is a React Native component vendored under `miniapps/` and loaded on first open. */
export type NativeMiniAppLoader = () => Promise<{ default: ComponentType }>;

export type MiniAppContent =
  /** html/css/js in a sandboxed WebView. Untrusted: no network, no access to the app. */
  | { kind: "web"; source: MiniAppSource }
  /** Our own code, shipped in the app bundle. Runs in the app's process, like any other screen. */
  | { kind: "native"; load: NativeMiniAppLoader }
  /**
   * A built web page shipped as an asset (a library that only runs in a browser, such as Kepler.gl).
   * It is sandboxed like `web`, and is sent `messages` once it says it is ready.
   */
  | { kind: "bundle"; asset: () => number; messages: readonly unknown[] };

export type MiniApp = {
  id: string;
  title: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  /** Without content, a placeholder page is shown. */
  content?: MiniAppContent;
};

export const miniApps: readonly MiniApp[] = [
  {
    id: "shop",
    title: "Shop",
    icon: "storefront-outline",
    content: { kind: "web", source: shopSource },
  },
  { id: "stokvel", title: "Stokvel", icon: "people-outline" },
  {
    id: "wallet",
    title: "Wallet",
    icon: "wallet-outline",
    content: { kind: "web", source: walletSource },
  },
  {
    id: "delivery",
    title: "Delivery",
    icon: "bicycle-outline",
    content: {
      kind: "bundle",
      // `require` so Metro bundles the page as an asset; nothing runs until the mini app is opened.
      asset: () => require("@shopong/kepler-miniapp/dist/index.html") as number,
      messages: deliveryMessages,
    },
  },
  { id: "orders", title: "Orders", icon: "receipt-outline" },
  { id: "suppliers", title: "Suppliers", icon: "cube-outline" },
  {
    id: "chat",
    title: "Chat",
    icon: "chatbubbles-outline",
    content: { kind: "native", load: () => import("../miniapps/chat") },
  },
  {
    id: "insights",
    title: "Insights",
    icon: "stats-chart-outline",
    content: { kind: "native", load: () => import("../miniapps/insights") },
  },
];

export const contentOf = (app: MiniApp): MiniAppContent =>
  app.content ?? { kind: "web", source: placeholderSource(app) };
