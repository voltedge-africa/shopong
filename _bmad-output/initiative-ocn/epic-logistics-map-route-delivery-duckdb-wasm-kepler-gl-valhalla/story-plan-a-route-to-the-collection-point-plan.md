---
title: 'Plan a route to the collection point'
type: 'feature'
ticket: 4
created: '2026-10-26'
status: 'draft'
baseline_revision: '2d1ef5d846450eee09b35853682df06a69a0c175'
---

## Intent

**Problem:** A paid order needs a driver to take it from the supplier's depot to the collection point. Nothing computes that route in the app. The only place that plans one is the scenario (`packages/scenario-stokvel/src/steps.ts`), and it writes exact coordinates into `delivery.planned`.

**Approach:** The OCN Node computes one road route behind the `Routing` port and returns it to a signed caller. The caller's `delivery.planned` event carries the summary and place ids. The phone shows the route on the Delivery map and three plain sentences. Valhalla never reaches the phone (decision 7.1).

## Boundaries & Constraints

**Always:** Routing runs on the Node only. The event id is SHA-512 of the canonical event (rule 5). The record holds place ids, labels and coarse areas, never exact coordinates or addresses (rule 6). The planner's authority is judged at log time (story 3.6). Refusals are plain sentences.

**Never:** Truck costing (later). Turn-by-turn steps (the port's `Route` has no manoeuvres). Payments or money. Real road tiles before 7.2. Any change to the `Routing` port. A second event envelope.

**Needs from parallel plans:** 7.2 (tile release id, manifest location, South African region per D-8). 7.3 (place registry shape: id, label, area). 3.7 is not needed here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Route planned | Registered depot and collection point, covered | `delivery.planned` with distance, time, costing, tile release, place ids | None |
| Outside tiles | A place outside the tile set | Nothing recorded | "That place is outside the area this Node can route." |
| No road | Covered, but no route | Nothing recorded | "No road route was found between these places." |
| Not allowed | Member who is neither treasurer nor current driver | Refused by the Node | "Only the treasurer or the driver can plan a route." |
| Replayed request | Same signed request twice | Second refused | "That request was already used." |
| Fallback in use | Straight-line adapter, no tiles | Route labelled as not a road route | Shown on the card |
| Offline | No Node connection | No route created | "Planning a route needs a connection." Last synced route still shows |

## Code Map

- `packages/ports/src/routing.ts` -- `Routing`, `RouteRequest`, `Route` (read only).
- `packages/ports-contract/src/routing.ts` -- `runRoutingContract`, the suite every adapter passes.
- `packages/adapters-memory/src/routing.ts` -- `MemoryRouting`: straight line times 1.3, passes the contract; the fallback candidate. `contracts.test.ts` runs it.
- `packages/scenario-stokvel/src/steps.ts` (`plan-delivery`) and `plan.ts` -- exact `latMicro/lngMicro` in `delivery.planned`, and literal coordinates. Must change to place ids.
- `packages/events/src/registry.ts` -- `delivery.planned` is listed, but its validator is `anyObject`, so the payload is loose until this story.
- `packages/events/src/personal.ts` -- field names with `cell`, `address`, `street` or `contact` are refused unless they hold commitments.
- `packages/community/src/roles.ts` -- `ROLES.driver` (`delivery/confirm`), `checkAction`.
- `packages/community/src/apply.ts` -- `CHECKED` does not list `delivery.*`, so they are not checked today.
- `apps/node/src/pool-routes.ts`, `signed.ts` -- member-only signed GET pattern and the request gate.
- `apps/node/src/sync.ts` -- `POST /spaces/:key/events` refuses only `ledger.posted`.
- `apps/node/src/app.ts` -- route registration. Nothing in `apps/node` references `Routing` or Valhalla yet.
- `miniapps/vendor/delivery/src/protocol.ts`, `datasets.ts` -- `Leg` is from and to only; legs draw straight lines. Page rebuild needed for any change.
- `_bmad-output/initiative-ocn/shortcuts.md` -- no epic 7 section yet.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/node/src/` -- wire the `Routing` adapter chosen in Q1 behind the port; it passes `runRoutingContract`.
- [ ] `packages/community/` -- place registry entry type and the planner check at log time.
- [ ] `apps/node/src/` -- signed `POST /communities/:key/routes` (plans) and a member-only read of the planned route. No coordinates in logs.
- [ ] `packages/events/` -- strict `delivery.planned` validator; `apply` checks it; the scenario emits place ids.
- [ ] `miniapps/vendor/delivery/` -- optional route line in `protocol.ts`, drawn in `datasets.ts`; three plain sentences in the app; page rebuilt.
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- rows for the fallback, no truck costing, no turn steps, Node-only planning.

**Acceptance Criteria:**
- Given a registered depot and collection point inside the tiles, when a treasurer or the driver plans, then `delivery.planned` holds distance, time, costing, tile release and place ids, and no coordinates.
- Given a member who is neither, then the Node refuses with the plain sentence.
- Given the phone is offline, then planning says it needs a connection and the last synced route shows.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:** `pnpm exec vp test run packages/adapters-memory`; `pnpm --filter @shopong/node test`; `pnpm --filter @shopong/miniapp-delivery build`; `pnpm run ci`.

**Manual:** on the web console and on the Android emulator, both every time: plan the route, see the line and the three sentences, and read the event log to confirm no coordinates are in it.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (the first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; older wording that says the emulator is checked only when asked is out of date. Routes are computed off the phone (docs/decisions/7-1-valhalla-on-device.md). Photos: all metadata is stripped. The tile region is the KwaZulu-Natal extract; the ODbL share-alike position needs a lawyer's confirmation before the first public release.**

1. **Which routing adapter answers for Demonstration 1 until 7.2 lands?**
   - A) (Recommended) A straight-line fallback on the Node: the `MemoryRouting` logic, labelled `straight-line` as its tile release. The card says it is not a road route.
   - B) Wait for 7.2 and a South African extract (D-8). No demo routing before then.
   - C) Use the Eswatini tiles from spike 7.1. Wrong country, and not in the repo now.
2. **Is the polyline stored in the event?**
   - A) As the architecture says: polyline6 in `delivery.planned`. Its ends are exact coordinates, so both ends must be public places.
   - B) (Recommended) The SHA-512 of the polyline6 and the tile release go in the event; the polyline stays on the Node and reaches members over the signed route. The ticket's verify line changes to "hash present".
3. **Who may plan a route?**
   - A) (Recommended) The treasurer (creator or co-treasurer), or a driver with a current driver role at log time. Fits the demo, where the treasurer plans and assigns.
   - B) Driver only, as the ticket's wording says.
   - C) Any member.
4. **Who sees a route?**
   - A) (Recommended) Every member sees the summary and the line, with place labels only.
   - B) Treasurer and driver only.
5. **Where are depot and collection point coordinates kept?**
   - A) (Recommended) In a Node place registry keyed by an opaque place id. The record holds the id, label, coarse area and a keyed commitment of the exact address (AD-9).
   - B) In the record as coordinates, as the scenario does now. Allowed only for public places such as halls and depots.
6. **Costing for Demonstration 1?**
   - A) (Recommended) `auto` now, with truck costing later. The spike ran only `auto`, so truck costing is unverified on the engine.
   - B) `truck` with default dimensions now.

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 1 high, 5 medium, 8 low. The orchestrator also checked the Delivery screen on web and the Android emulator.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `delivery.confirmed` with coordinates was accepted into the record from any signed member | high, real | patch | A strict shape (order, photo hash, optional opaque place) with no coordinate keys; the scenario migrated; a standing driver role in `apply`; tests failed first |
| 2 | Numbers and text in `delivery.planned` could carry a coordinate or an address | medium, real | patch | Bounded distance, duration and window; `tileRelease` must be a release id |
| 3 | A place label or area could hold a street address | medium, real | patch | `looksLikeAddress` (street number plus street word, erf/stand/unit/flat/house) in the validator, the Node place route and `apply`; mutation-checked |
| 4 | A removed co-treasurer or driver could still plan on the Node | medium, real | patch | Current membership checked after the signature and before the one-time number; mutation-checked |
| 5 | One node-wide secret for address commitments, with no domain separation | medium, real | patch | Per-community key with the label `ocn/address/v1`; an address commitment never equals the phone commitment of the same text |
| 6 | A corrupt places or routes file stopped the Node | medium, real | patch | Quarantined to `.bad`; writes go to disk first |
| 7, 8, 9, 11, 12, 14 | Fingerprint collisions; the named driver not checked in `apply`; no rate or body limits; "already used" for a full table; jargon; truncated polylines | low, real | patch | Tested |
| 10, 13 | Duplicate places on retry; "Road" not mapped to "Rd" | low | defer | S-7.4-15, S-7.4-16 |
| 14b | The Kepler page posts with target `*` | low | defer | S-7.4-17 |
| bundle | The phone bundle contained `MemoryRouting` and `encodePolyline6` through the adapters barrel | real | patch | Routing moved to a subpath; the exported Hermes bundle has zero occurrences; a guard test |

