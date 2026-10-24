---
type: epic
title: "Logistics: map, route, delivery (DuckDB-WASM, Kepler.gl, Valhalla)"
parent: initiative-ocn
covers: [FR14, FR15, FR16, FR17, AR4, AR7, AR9, NFR3, NFR8]
assignee: ""
status: in-progress
risk: high
---

# Logistics: map, route, delivery (DuckDB-WASM, Kepler.gl, Valhalla)

## Description

Members see where demand and collection points are, a driver gets a route, and delivery and collection are confirmed with proof.

## Outcome

For members, treasurers and drivers, collection points are chosen on a map, routes are planned, and every delivery and collection is confirmed with proof, so that a delivered order shows confirmed progress and any late or failed delivery is visible to approvers.

## Requirements

- FR14: Collection points and demand can be shown on a map and queried spatially.
- FR15: A delivery route to a collection point can be planned, with estimated distance and time.
- FR16: Delivery and collection are confirmed with proof (who, where, when, photo) that triggers the next step.
- FR17: Members can follow a delivery and see exceptions (late, failed, partial).
- AR4: The shared record uses one versioned event envelope; one Autobase per community space with a Hyperbee view and Hyperdrive for files (AD-2).
- AR7: Heavy WASM (DuckDB, Kepler.gl, Valhalla) runs in the web console; mobile receives results (AD-5).
- AR9: A reproducible tile build pipeline (OSM extract to Valhalla tiles and manifest) with versioned releases and ODbL attribution.
- NFR3: Personal information is minimised (POPIA): the shared record holds keyed commitments, not phone or ID numbers; exact addresses stay on the device.
- NFR8: Third-party licences and attributions (OSM ODbL, Valhalla notices, Apache/MIT) are tracked and shipped.

## Done when

1. On the deployed web console, a treasurer sees demand clusters and candidate collection points, and inspecting the shared record finds no exact home address.
2. A driver plans a truck route to a collection point and sees its distance, time and map line, with the polyline and tile release id stored in the delivery.planned event.
3. A run of two to eight collection points is ordered, shows its total time, and names its ordering method.
4. A driver's signed arrival with photo and each member's collection confirmation show progress on the order.
5. A member sees a delivery's status and last confirmed point, and a late, failed or partial delivery appears as an exception to every approver.
6. The tile release and OSM attribution are live on the production site and in the OCN Node, and the spike 7.1 mobile viability decision is on record.

## Boundaries

The map, route, multi-stop and delivery-proof capabilities in the web console and the OCN Node. Not the shared record's storage and writer admission (epic 3), not the pool that pays suppliers (epic 4), and not the order flows that use these (epics 8 and 9). Routing on iOS and Android is not assumed: spike 7.1 decides it, and if it fails the route is computed on the console or Node and only the result goes to the phone.

## References

- parent — ../initiative-ocn.md, section Epics
- spec — ../spec-ocn/spec-ocn.md, section Requirements Inventory (FR14–FR17, AR4, AR7, AR9, NFR3, NFR8)
- constraint — ../architecture-ocn/architecture-ocn.md, section 4.4 Logistics and AD-5 (heavy WASM stays in the web console; mobile receives results); pin the DuckDB-WASM version explicitly
- constraint — ../architecture-ocn/architecture-ocn.md, AD-9 (personal data as keyed commitments, never in the shared record) and section 4.2 on coarsened member locations
- constraint — ../spec-ocn/spec-ocn.md, AR8 (web console CSP allows 'wasm-unsafe-eval' and blob: workers on its own origin only)

## Notes

- Tracer: 7.1 (the spike) is the thinnest path: one pinned OSM extract built to tiles and one truck route run in the browser and in Node.
- Waits on epic 3 because: the community space and its Hyperbee view (3.2, 3.8) hold the member data the map reads and the route events are written to, and Hyperdrive (3.7) holds the proof photos.
- Waits on epic 4 because: the pool that pays the supplier (4.7) is the step a proved delivery is meant to release, which entry 7.6 pins.
- Assumption: the map reads coarsened member locations from the community Hyperbee view through the web console (3.8), not from a separate store.
- Open question: entry 7.6 pins 4.7 because the top-level row names it, but proof of delivery is what the pool consumes; if the pool needs this epic's proof event, the dependency runs the other way (epic 4 on epic 7). The user decides which epic owns that link and whether the row should move.
- Open question: no Refactor sweep story is planned (the standard asks for one when an epic has more than three entries); the user decides whether to add it.
