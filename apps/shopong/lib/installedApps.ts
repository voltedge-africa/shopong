import { useSyncExternalStore } from "react";

type Listener = () => void;

/**
 * What people have changed about which apps are installed, for as long as the app runs: an app's id
 * maps to true (installed) or false (uninstalled). An app with no entry is as the app ships it.
 * Nothing persists it yet.
 */
export function createInstallStore() {
  let state: ReadonlyMap<string, boolean> = new Map();
  const listeners = new Set<Listener>();

  const set = (id: string, installed: boolean) => {
    state = new Map(state).set(id, installed);
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    install: (id: string) => set(id, true),
    uninstall: (id: string) => set(id, false),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const installStore = createInstallStore();

export const useInstallChoices = (): ReadonlyMap<string, boolean> =>
  useSyncExternalStore(installStore.subscribe, installStore.get, installStore.get);

/** The apps with the person's choices applied: `installed` is what they chose, else the default. */
export function withInstallChoices<T extends { id: string; installed: boolean }>(
  apps: readonly T[],
  choices: ReadonlyMap<string, boolean>,
): readonly T[] {
  return apps.map((app) => {
    const installed = choices.get(app.id) ?? app.installed;
    return installed === app.installed ? app : { ...app, installed };
  });
}
