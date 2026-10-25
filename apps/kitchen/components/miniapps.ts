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

export const CATEGORIES = ["Commerce", "Money", "Logistics", "Community", "Insights"] as const;
export type MiniAppCategory = (typeof CATEGORIES)[number];

export type MiniApp = {
  id: string;
  title: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  category: MiniAppCategory;
  /** Part of the default install: shown on Home, and ticked in Discover. */
  installed: boolean;
  /** Without content, a placeholder page is shown. */
  content?: MiniAppContent;
};

export const miniApps: readonly MiniApp[] = [
  {
    id: "shop",
    title: "Shop",
    icon: "storefront-outline",
    category: "Commerce",
    installed: true,
    content: { kind: "web", source: shopSource },
  },
  {
    id: "stokvel",
    title: "Stokvel",
    icon: "people-outline",
    category: "Community",
    installed: true,
  },
  {
    id: "wallet",
    title: "Wallet",
    icon: "wallet-outline",
    category: "Money",
    installed: true,
    content: { kind: "web", source: walletSource },
  },
  {
    id: "delivery",
    title: "Delivery",
    icon: "bicycle-outline",
    category: "Logistics",
    installed: true,
    content: {
      kind: "bundle",
      // `require` so Metro bundles the page as an asset; nothing runs until the mini app is opened.
      asset: () => require("@shopong/kepler-miniapp/dist/index.html") as number,
      messages: deliveryMessages,
    },
  },
  { id: "orders", title: "Orders", icon: "receipt-outline", category: "Commerce", installed: true },
  {
    id: "suppliers",
    title: "Suppliers",
    icon: "cube-outline",
    category: "Commerce",
    installed: true,
  },
  {
    id: "chat",
    title: "Chat",
    icon: "chatbubbles-outline",
    category: "Community",
    installed: true,
    content: { kind: "native", load: () => import("../miniapps/chat") },
  },
  {
    id: "insights",
    title: "Insights",
    icon: "stats-chart-outline",
    category: "Insights",
    installed: true,
    content: { kind: "native", load: () => import("../miniapps/insights") },
  },
  // Not installed by default: placeholders that show what the catalogue would hold.
  { id: "funding", title: "Funding", icon: "cash-outline", category: "Money", installed: false },
  {
    id: "savings",
    title: "Savings",
    icon: "trending-up-outline",
    category: "Money",
    installed: false,
  },
  { id: "stock", title: "Stock", icon: "layers-outline", category: "Commerce", installed: false },
  { id: "drivers", title: "Drivers", icon: "car-outline", category: "Logistics", installed: false },
  {
    id: "noticeboard",
    title: "Noticeboard",
    icon: "megaphone-outline",
    category: "Community",
    installed: false,
  },
  {
    id: "prices",
    title: "Prices",
    icon: "pricetag-outline",
    category: "Insights",
    installed: false,
  },
  {
    id: "documents",
    title: "Documents",
    icon: "document-text-outline",
    category: "Insights",
    installed: false,
  },
];

/** What Home shows. */
export const installedMiniApps: readonly MiniApp[] = miniApps.filter((app) => app.installed);

export type DiscoverFilter = {
  /** Text to look for in the title, ignoring case and surrounding spaces. Empty matches all. */
  query?: string;
  /** Only this category. Omitted or `undefined` matches all. */
  category?: MiniAppCategory | undefined;
};

export function filterMiniApps(
  apps: readonly MiniApp[],
  { query = "", category }: DiscoverFilter = {},
): readonly MiniApp[] {
  const needle = query.trim().toLowerCase();
  return apps.filter(
    (app) =>
      (category === undefined || app.category === category) &&
      (needle === "" || app.title.toLowerCase().includes(needle)),
  );
}

export const contentOf = (app: MiniApp): MiniAppContent =>
  app.content ?? { kind: "web", source: placeholderSource(app) };
