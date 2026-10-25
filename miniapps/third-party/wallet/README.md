# @shopong/miniapp-wallet

The Wallet mini app (category: Money): a demo balance and a top-up form that checks the amount. Nothing is paid; it is demo data local to the page.

It is a **third-party** mini app: plain `html` and `js` strings, built on the host's CSS kit (`ui-*`
classes), that run in a sandboxed WebView (an iframe on web) with no network and no access to the app.
It has no React Native dependency and cannot import app code. `src/index.ts` exports its `manifest`
(`@shopong/miniapp`).

```sh
pnpm --filter @shopong/miniapp-wallet check-types
vp test miniapps/third-party/wallet   # from the repo root
```

See [`miniapps/README.md`](../../README.md) for the layout and how to add one. The host registry is
[`apps/shopong/components/miniapps.ts`](../../../apps/shopong/components/miniapps.ts).
