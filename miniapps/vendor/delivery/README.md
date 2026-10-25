# @shopong/miniapp-delivery

The Delivery mini app, a vendored one: Kepler.gl as **one self-contained HTML file**, shipped inside
the Shopong app and shown in a WebView. `src/index.ts` is its manifest; the rest of `src/` is
the page. See AD-20 in the architecture: it supersedes the Kepler part of
AD-5 and AGENTS.md rule 7.

Kepler is React DOM only, so it cannot run as a native screen. This package builds it into a page
the app opens from disk.

## Build

```sh
pnpm --filter @shopong/miniapp-delivery build   # vp build, then scripts/inline.mjs
```

`dist/index.html` (about 22 MB, 5.9 MB gzipped) has its scripts and styles inlined. It is git-ignored;
`apps/shopong`'s `dev`, `android`, `ios`, `web` and `build` scripts build it first. It uses React 18
(Kepler's requirement) while the app uses React 19; the two never meet, because the page is a file.

## How the page talks to the app

`src/protocol.ts` describes the messages, and `src/data.ts` is the demo data the manifest sends:

- The page says `{ type: "ready" }` once mounted (through `window.ReactNativeWebView` in the app,
  `window.parent` in an iframe).
- The app then sends `{ type: "load", map: { stops, legs } }`. The page turns it into two Kepler
  datasets (`src/datasets.ts`: stops as points, legs as lines) and fits the map with some padding.

The page never asks for anything. There is no other channel.

## The base map: Clermont, Durban

There are no map tiles. `src/basemap/clermont.json` (4 MB) is an extract of OpenStreetMap for a box
of about 3.3 x 3.1 km around Clermont (roads, buildings, water, green areas), and
`src/basemap/style.ts` draws it as a MapLibre style with GeoJSON sources, so nothing is fetched.
The map shows "© OpenStreetMap contributors (ODbL)" in its corner; keep that if you change it.

```sh
node scripts/fetch-osm.mjs   # about 5 minutes: it asks the public Overpass server politely
```

The box is in the script; the test in `apps/shopong/miniapps/delivery` keeps the demo stops inside it.
A different area needs its own extract (or a tile source and a looser policy). OpenStreetMap has
almost no named places in Clermont, so the demo stops are unnamed points on residential streets.
The legs between stops are straight lines, not routes along the roads.

## What it deliberately cannot do

The page's Content-Security-Policy (in `index.html`) allows no network, forms, frames or WebAssembly.

- **No outside requests.** Kepler wants an icon list from a Foursquare server on start; `main.tsx`
  answers that one fetch with an empty list.
- **One console error on load** ("Uncaught (in promise)") is the meshoptimizer WebAssembly decoder,
  used for compressed 3D models, being refused by the policy. Nothing here uses it.

## Looking at it in a browser

Serve `dist/` with any static server, open it, and post a `load` message from the console:
`window.postMessage({ type: "load", map }, "*")`.

## Dependencies

`@kepler.gl/{components,reducers,actions}` 3.2.6 (the stable line; npm's `latest` tag points at an
alpha), `react`/`react-dom` 18.3.1, `react-redux` 8.1.3, `redux` 4.2.1, `styled-components` 6.1.8.
Licences of the production tree: MIT, BSD, ISC and Apache-2.0 apart from a few items for the
licence register (story 12.7): `object-stream` (no licence, only via Kepler's Parquet loader, not in
the built page), `spdx-exceptions` (CC-BY-3.0, attribution), `jsts` (EDL-1.0 or EPL-1.0).
