import { manifest as chat } from "@shopong/miniapp-chat";
import { manifest as delivery } from "@shopong/miniapp-delivery";
import { manifest as insights } from "@shopong/miniapp-insights";
import { manifest as shop } from "@shopong/miniapp-shop";
import { manifest as wallet } from "@shopong/miniapp-wallet";
import { CATEGORIES, type MiniAppCategory, type MiniAppManifest } from "@shopong/miniapp";

export { CATEGORIES, type MiniAppCategory };

export type MiniApp = MiniAppManifest & {
  /** Part of the default install: shown on Home, and ticked in Discover. */
  installed: boolean;
};

/**
 * The mini apps this app ships. Shop is third-party: a web page in a sandbox. Chat, Wallet, Insights
 * and Delivery are vendored: ours, shipped in the app.
 */
export const miniApps: readonly MiniApp[] = [
  { ...shop, installed: true },
  { ...wallet, installed: true },
  { ...chat, installed: true },
  // Vendored but not in the default install: found in Discover.
  { ...insights, installed: false },
  { ...delivery, installed: false },
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
