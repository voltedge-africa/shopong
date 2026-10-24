# @shopong/shopong

Shopong is the Expo universal app (iOS, Android, web) and one access point to the Open Commerce Network (OCN). Expo SDK 58, expo-router, TypeScript.

Today it opens on a signed-out home screen: the name, a one-line tagline and a disabled "Create my identity" button marked "Coming soon". It does no networking, holds no secrets and has no analytics.

## Install and start

From the repository root (Node >= 24, pnpm via corepack):

```sh
pnpm install
cd apps/shopong
pnpm run dev       # Expo dev server; press i (iOS simulator), a (Android emulator) or w (web)
pnpm run web       # open straight in the browser
pnpm run ios       # needs Xcode and a simulator (macOS only)
pnpm run android   # needs Android Studio and an emulator
```

The app has no native modules of its own yet, so Expo Go or a simulator build both work.

## Scripts

| Script                   | What it does                                                      |
| ------------------------ | ----------------------------------------------------------------- |
| `pnpm run dev`           | `expo start`                                                      |
| `pnpm run build`         | `expo export --platform web` into `web-dist/` (gitignored)        |
| `pnpm run bundle:native` | Bundles Android and iOS (Hermes) into `native-dist/` (gitignored) |
| `pnpm run check-types`   | `tsc --noEmit`                                                    |
| `pnpm run test`          | `vp test`; the root `pnpm run test` also covers this package      |

## Layout

- `app/`: expo-router routes (`_layout.tsx`, `index.tsx` is the signed-out home).
- `src/`: plain TypeScript with no React Native imports, unit tested with `vite-plus/test`: `appInfo` (name, tagline, button state) and `theme` (light and dark palettes).

## Notes

- Metro needs no custom config for the pnpm monorepo: Expo SDK 58 detects workspaces and pnpm's isolated `node_modules` itself.
- `typescript` is pinned to the repo-wide 7.0.2 and excluded from `expo install --check` (`expo.install.exclude`), because the Expo SDK expects ~6.0.3.
- Heavy WASM (DuckDB, Kepler.gl, Valhalla) must never be bundled here; it lives in the web console.
