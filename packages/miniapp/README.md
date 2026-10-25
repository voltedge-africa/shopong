# @shopong/miniapp

The contract for mini apps: what a mini app is and the kinds of content it can have. Types and
constants only; no runtime code beyond `CATEGORIES`.

A mini app package exports a `manifest` (`MiniAppManifest`): `id`, `title`, `icon` (an Ionicons
name), `category` (one of `CATEGORIES`) and `content`. Whether it is installed is the host app's
choice, so it is not in the manifest.

| `content.kind` | What it is                                                       | Runs                                         |
| -------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| `web`          | `html`, `css` and `js` strings                                   | In a sandboxed WebView or iframe, no network |
| `native`       | A React Native component, loaded the first time it is opened     | In the app's process                         |
| `bundle`       | A built web page shipped as an asset, sent `messages` when ready | In a sandboxed WebView, like `web`           |

```ts
import type { MiniAppManifest } from "@shopong/miniapp";

export const manifest: MiniAppManifest = {
  id: "chat",
  title: "Chat",
  icon: "chatbubbles-outline",
  category: "Community",
  content: { kind: "native", load: () => import("./Chat") },
};
```

The packages that implement it are in [`miniapps/`](../../miniapps/README.md); the app that ships them
is [`apps/shopong`](../../apps/shopong/README.md). It has `check-types` only, because it is source
only.
