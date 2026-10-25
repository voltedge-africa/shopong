import { useMemo } from "react";

import type { PublishedApp } from "../lib/publish";
import { usePublishedApps } from "../lib/publishedApps";
import { GeneratedApp } from "./GeneratedApp";
import { installedMiniApps, miniApps, type MiniApp } from "./miniapps";

const cache = new WeakMap<PublishedApp, MiniApp>();

/** A published app as a mini app, so Home, Discover and the app screen treat it like any other. */
export function toMiniApp(app: PublishedApp): MiniApp {
  let miniApp = cache.get(app);
  if (!miniApp) {
    miniApp = {
      id: app.id,
      title: app.name,
      icon: app.icon,
      category: app.category,
      // The same function every time, so the app screen loads it once.
      content: {
        kind: "native",
        load: () => Promise.resolve({ default: () => <GeneratedApp build={app.build} /> }),
      },
      installed: true,
    };
    cache.set(app, miniApp);
  }
  return miniApp;
}

/** Every app: the ones the app ships and the ones people have built and published. */
export function useAllMiniApps(): readonly MiniApp[] {
  const published = usePublishedApps();
  return useMemo(() => [...miniApps, ...published.map(toMiniApp)], [published]);
}

/** What Home shows: the apps installed by default, and everything published since. */
export function useHomeMiniApps(): readonly MiniApp[] {
  const published = usePublishedApps();
  return useMemo(() => [...installedMiniApps, ...published.map(toMiniApp)], [published]);
}
