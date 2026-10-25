import { useMemo } from "react";

import { YOU, type PublishedApp } from "../lib/publish";
import { useInstallChoices, withInstallChoices } from "../lib/installedApps";
import { usePublishedApps } from "../lib/publishedApps";
import { GeneratedApp } from "./GeneratedApp";
import { miniApps, type MiniApp } from "./miniapps";

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
      description: app.description,
      // The same function every time, so the app screen loads it once.
      content: {
        kind: "native",
        load: () => Promise.resolve({ default: () => <GeneratedApp build={app.build} /> }),
      },
      // What you built is yours to use at once; what others published waits in Discover.
      installed: app.publisher === YOU,
      publisher: app.publisher,
      published: app,
    };
    cache.set(app, miniApp);
  }
  return miniApp;
}

/** Every app, the ones the app ships and the ones people have published, as installed or not. */
export function useAllMiniApps(): readonly MiniApp[] {
  const published = usePublishedApps();
  const choices = useInstallChoices();
  return useMemo(
    () => withInstallChoices([...miniApps, ...published.map(toMiniApp)], choices),
    [published, choices],
  );
}

/** What Home shows: the installed apps. */
export function useHomeMiniApps(): readonly MiniApp[] {
  const apps = useAllMiniApps();
  return useMemo(() => apps.filter((app) => app.installed), [apps]);
}
