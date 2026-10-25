import type { ComponentProps, ComponentType } from "react";
import type Ionicons from "@expo/vector-icons/Ionicons";

export const CATEGORIES = ["Commerce", "Money", "Logistics", "Community", "Insights"] as const;
export type MiniAppCategory = (typeof CATEGORIES)[number];

/** The html, css and js of a mini app that runs in a sandboxed WebView. */
export type MiniAppSource = { html: string; css?: string; js?: string };

/** A native mini app is a React Native component, loaded the first time it is opened. */
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

/**
 * What a mini app package exports as `manifest`. Whether it is installed is the host app's choice,
 * so it is not part of the manifest.
 */
export type MiniAppManifest = {
  id: string;
  title: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  category: MiniAppCategory;
  /** What the app is for, in a sentence or two of plain words. Shown on its details page. */
  description: string;
  content: MiniAppContent;
};
