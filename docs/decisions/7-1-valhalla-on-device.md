# Decision 7.1: where routes are computed for Demonstration 1

**Status:** draft, for the product owner to accept. Closes spike 7.1 when accepted.
**Epic:** 7 (delivery). Affects stories 7.2, 7.4, 7.6 and risk R-9.

## Question

Do we compute routes on the phone with Valhalla, or on the web console or the OCN Node?

## Evidence

- Desktop spike (see `docs/spike-findings.md`, spike 7.1): single routes work from our own tiles.
- Emulator test, 2026-10-26: `valhalla-browser` 0.2.1 starts and routes in Chrome on an Android 16
  emulator, with the same answers as desktop, but slower to start and for the first route (start-up
  2.5 s, cold first route 1.7 to 3.1 s, warm repeat 35 to 209 ms). It needs a secure (HTTPS or
  localhost) page.

## Decision (proposed)

**For Demonstration 1, routes are computed on the web console or the Node and shown on the phone.** The
phone does not run Valhalla. This keeps architecture rule 7 and avoids shipping tiles to phones.

On-phone routing stays possible later behind the same routing port: the emulator test shows the engine
runs in a phone browser, so it is a later choice, not a blocked one.

## Still open

- A South African tile region (D-8) and the tile hosting over HTTPS.
- Truck costing for suppliers' delivery vehicles.
- A test on a real low-end phone and in the in-app WebView, before anyone proposes on-phone routing.
