# @shopong/miniapp-discrepancies

The discrepancies mini app (story 10.3): the treasurer's list of differences the reconciler found between the bank
(the simulated payment provider), the pool books (ledger) and the shared record. Each entry shows the three readings,
the event id and a plain sentence; a treasurer resolves it only by recording a reason. Nothing is repaired.

It is a **vendored** mini app: our own React Native component (`src/Discrepancies.tsx`), shipped in the app. The pure
layout and the reason check are in `src/data.ts`, tested without React Native.

**Not mounted yet.** It is not in `apps/shopong/components/miniapps.ts`: the host does not yet sign and send the
treasurer's requests to `GET /communities/:key/discrepancies` and `POST .../resolve`. Shortcut S-10.3-6.

It carries the app's pinned peers, copied from `@shopong/miniapp-insights`, so there is one copy of each library.

```sh
pnpm --filter @shopong/miniapp-discrepancies check-types
pnpm --filter @shopong/miniapp-discrepancies test
```

See [`miniapps/README.md`](../../README.md) for the layout and how to add one.
