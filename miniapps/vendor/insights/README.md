# @shopong/miniapp-insights

The Insights mini app (category: Insights): a week of takings for a spaza shop, with revenue, orders, trend and a category breakdown (`src/data.ts`). Demo data; nothing is sent anywhere.

It is a **vendored** mini app: our own React Native component, shipped in the app and run in the app's
process. `src/index.ts` exports its `manifest` (`@shopong/miniapp`), which loads the component the
first time it is opened.

It uses PanelUI and Uniwind, so it carries the app's pinned peers (`panelui-native`, `react`,
`react-native`, `uniwind`) and must resolve the same copy as the app. Tailwind scans it through the
`@source` line in `apps/shopong/global.css`.

```sh
pnpm --filter @shopong/miniapp-insights check-types
pnpm --filter @shopong/miniapp-insights test
```

See [`miniapps/README.md`](../../README.md) for the layout and how to add one.
