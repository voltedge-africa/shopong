# @shopong/shopong

The Shopong app: an Expo universal app (iOS, Android, web) and one access point to OCN. It has four
tabs (Home, Discover, Notifications, Settings), a 6-digit PIN gate, and mini apps that open in one
generic activity.

## Run

```sh
pnpm install
pnpm --filter @shopong/shopong web       # http://localhost:8081
pnpm --filter @shopong/shopong android   # Expo Go on a device or emulator
pnpm --filter @shopong/shopong ios
```

`dev`, `android`, `ios`, `web` and `build` build the Delivery mini app first
(`@shopong/miniapp-delivery`), because the app ships it as a built page.

The PIN is kept in the device's secure store (`expo-secure-store`). On web it is kept in memory, so a
full reload asks for a new one.

## Layout

| Path          | What it holds                                                                               |
| ------------- | ------------------------------------------------------------------------------------------- |
| `app/`        | Expo Router routes: `auth` (PIN), `(tabs)`, `miniapp/[id]`, `thinking`                      |
| `components/` | UI, and `miniapps.ts`, the registry of mini apps this app ships and which are on by default |
| `lib/`        | Pure logic with tests: PIN, notifications, bundle messages, the web mini app document       |
| `global.css`  | Tailwind 4 and PanelUI theme through Uniwind; scans `miniapps/vendor/*/src`                 |

Mini apps are workspace packages under `miniapps/`; see [`miniapps/README.md`](../../miniapps/README.md)
for the layout and how to add one.

## Checks

```sh
pnpm --filter @shopong/shopong check-types
pnpm --filter @shopong/shopong test
```

`pnpm run ci` at the root runs everything, including the web export (`web-dist/`, git-ignored).
