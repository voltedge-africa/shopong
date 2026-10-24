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

- `app/`: expo-router routes (`_layout.tsx`, `index.tsx` is the signed-out home, `demo.tsx` is the scripted stokvel order, `vectors.tsx` is the platform check for the event id).
- `src/`: plain TypeScript with no React Native imports, unit tested with `vite-plus/test`: `appInfo` (name, tagline, button state), `theme` (light and dark palettes), `demo/` (controller and view model for the `/demo` screen), `sha512` (the expo-crypto SHA-512 adapter) and `vectorCheck` (runs the golden vectors of `@shopong/events` through a SHA-512 implementation).

## The scripted stokvel order (`/demo`)

Story 1.4's tracer: a stokvel of five members (one treasurer) buys R4 180.00 of groceries together. From the home screen, follow "See a stokvel order, step by step". Sixteen scripted steps run the whole order on the in-memory adapters from `@shopong/adapters-memory` through the scenario package `@shopong/scenario-stokvel`: community created, members join, order proposed and approved, quotes added and one selected, each member pledges and pays (one payment fails once and is retried), the pool is funded, the treasurer approves and the supplier is paid within her ceiling, delivery is planned and confirmed, every member collects, and the order closes with a per-member summary. Every money state is written in words (Payment requested, Paid, Payment failed) and every timeline entry carries the first 8 hex characters of the real event id.

To run it:

```sh
pnpm --filter @shopong/shopong dev    # then open /demo; /vectors shows the platform check
```

`/vectors` runs all 65 golden vectors through the expo-crypto SHA-512 and prints PASS or FAIL.

Honest limits: this demo has only been run and verified on web. Hermes (iOS and Android) was bundled, never executed; the expo-crypto path is verified on web only (`crypto.subtle` underneath). Real money states a scenario never shows (such as refunded) exist in the type and word list but no step triggers them.

## Notes

- `metro.config.js` adds a resolver fallback: workspace packages are TypeScript that imports siblings the NodeNext way (`./canonical.js` for `canonical.ts`), which Metro does not resolve on its own. See the comment at the top of that file.
- `typescript` is pinned to the repo-wide 7.0.2 and excluded from `expo install --check` (`expo.install.exclude`), because the Expo SDK expects ~6.0.3.
- Heavy WASM (DuckDB, Kepler.gl, Valhalla) must never be bundled here; it lives in the web console.
