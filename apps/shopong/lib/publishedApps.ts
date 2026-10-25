import { useSyncExternalStore } from "react";

import { communityApps } from "./communityApps";
import type { PublishedApp } from "./publish";

type Listener = () => void;

/** The id a published app gets, from the project it came from. */
export const publishIdFor = (conversationId: string): string => `build-${conversationId}`;

/**
 * Published apps for as long as the app runs. Publishing an app that is already published replaces
 * it, which is how a new version updates the old one. Nothing persists them yet.
 */
export function createPublishedStore(initial: readonly PublishedApp[] = []) {
  let state: readonly PublishedApp[] = initial;
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    publish: (app: PublishedApp) => {
      state = state.some((item) => item.id === app.id)
        ? state.map((item) => (item.id === app.id ? app : item))
        : [...state, app];
      for (const listener of listeners) listener();
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const publishedStore = createPublishedStore(communityApps);

export const usePublishedApps = (): readonly PublishedApp[] =>
  useSyncExternalStore(publishedStore.subscribe, publishedStore.get, publishedStore.get);

/** What the Publish button offers for a build: publish it, publish an update, or open what is there. */
export function publishOffer(
  published: readonly PublishedApp[],
  id: string,
  version: string,
): "publish" | "update" | "open" {
  const existing = published.find((item) => item.id === id);
  if (!existing) return "publish";
  return existing.version === version ? "open" : "update";
}
