import { manifest as chat } from "@shopong/miniapp-chat";
import { manifest as delivery } from "@shopong/miniapp-delivery";
import { manifest as insights } from "@shopong/miniapp-insights";
import { manifest as shop } from "@shopong/miniapp-shop";
import { manifest as wallet } from "@shopong/miniapp-wallet";
import { CATEGORIES, type MiniAppCategory, type MiniAppManifest } from "@shopong/miniapp";

import { YOU, type PublishedApp } from "../lib/publish";

export { CATEGORIES, type MiniAppCategory };

export type MiniApp = MiniAppManifest & {
  /** Part of the default install: shown on Home, and ticked in Discover. */
  installed: boolean;
  /** Who made it, as shown on its details page. */
  publisher: string;
  /** The record of an app people built and published; the apps the app ships have none. */
  published?: PublishedApp;
};

/**
 * The mini apps this app ships. Shop is third-party: a web page in a sandbox. Chat, Wallet, Insights
 * and Delivery are vendored: ours, shipped in the app.
 */
export const miniApps: readonly MiniApp[] = [
  { ...shop, installed: true, publisher: "Third party" },
  { ...wallet, installed: true, publisher: "Shopong" },
  { ...chat, installed: true, publisher: "Shopong" },
  // Vendored but not in the default install: found in Discover.
  { ...insights, installed: false, publisher: "Shopong" },
  { ...delivery, installed: false, publisher: "Shopong" },
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

export type MiniAppGroup = { title: string; apps: readonly MiniApp[] };

/**
 * Discover's sections, in this order: what Shopong made, what you built, then what everyone else made.
 * A section with no apps is left out.
 */
export function groupMiniApps(apps: readonly MiniApp[]): readonly MiniAppGroup[] {
  const groups: MiniAppGroup[] = [
    { title: "By Shopong", apps: apps.filter((app) => app.publisher === "Shopong") },
    { title: "Your apps", apps: apps.filter((app) => app.publisher === YOU) },
    {
      title: "Community apps",
      apps: apps.filter((app) => app.publisher !== "Shopong" && app.publisher !== YOU),
    },
  ];
  return groups.filter((group) => group.apps.length > 0);
}
