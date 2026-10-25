# @shopong/miniapp-chat

The Chat mini app (category: Community): a demo conversation with a supplier where you can send messages (`src/messages.ts`). Demo data; nothing is sent anywhere.

It is a **vendored** mini app: our own React Native component, shipped in the app and run in the app's
process. `src/index.ts` exports its `manifest` (`@shopong/miniapp`), which loads the component the
first time it is opened.

It uses PanelUI and Uniwind, so it carries the app's pinned peers (`panelui-native`, `react`,
`react-native`, `uniwind`) and must resolve the same copy as the app. Tailwind scans it through the
`@source` line in `apps/shopong/global.css`.

```sh
pnpm --filter @shopong/miniapp-chat check-types
pnpm --filter @shopong/miniapp-chat test
```

See [`miniapps/README.md`](../../README.md) for the layout and how to add one.
