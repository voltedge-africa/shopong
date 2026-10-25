# @shopong/miniapp-shop

The Shop mini app (category: Commerce): a list of demo products with a cart, a Clear button and a running total in rand. Nothing is ordered; it is demo data local to the page.

It is a **third-party** mini app: plain `html` and `js` strings, built on the host's CSS kit (`ui-*`
classes), that run in a sandboxed WebView (an iframe on web) with no network and no access to the app.
It has no React Native dependency and cannot import app code. `src/index.ts` exports its `manifest`
(`@shopong/miniapp`).

```sh
pnpm --filter @shopong/miniapp-shop check-types
vp test miniapps/third-party/shop   # from the repo root
```

See [`miniapps/README.md`](../../README.md) for the layout and how to add one. The host registry is
[`apps/shopong/components/miniapps.ts`](../../../apps/shopong/components/miniapps.ts).
