# @shopong/miniapp-wallet

The Wallet mini app (category: Money): a stack of cards with one in front, a total balance that rolls
digit by digit, Top up, Send and Freeze, a spending chart by week, month or year that you can drag to
read, and recent activity whose rows swipe open to split a payment or hide it. All of it is demo data
in rand; no money moves.

It is PanelUI's [Wallet block](https://panelui.dev/docs/blocks/wallet) (MIT), adapted:

- Imports come from `panelui-native` instead of copied `@/components/ui` files.
- Glyphs are Ionicons, which the app already ships, instead of Hugeicons.
- The sample data is rand and South African, and the card, balance and activity logic is in
  `src/data.ts` (`moveMoney`, `splitTransaction`, `hideTransaction`, `spending`, `money`) so it can be
  tested.
- The host screen provides the header, so the block's own title and back button are gone.

It is a **vendored** mini app: our own React Native component, shipped in the app and run in the app's
process. `src/index.ts` exports its `manifest` (`@shopong/miniapp`), which loads `src/Wallet.tsx` the
first time it is opened. It carries the app's pinned peers (`panelui-native`, `react`, `react-native`,
`uniwind`, `@expo/vector-icons`) and must resolve the same copy as the app. Tailwind scans it through
the `@source` line in `apps/shopong/global.css`.

```sh
pnpm --filter @shopong/miniapp-wallet check-types
pnpm --filter @shopong/miniapp-wallet test
```

See [`miniapps/README.md`](../../README.md) for the layout and how to add one.
