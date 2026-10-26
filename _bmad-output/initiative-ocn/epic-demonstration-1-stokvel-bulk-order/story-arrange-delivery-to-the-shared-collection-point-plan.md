---
title: "Arrange delivery to the shared collection point"
type: "integration"
ticket: 6
created: "2026-10-26"
status: draft
baseline_revision: "5471d90"
risk: "medium"
hitl: false
depends_on: ["7.4 (merged)", "7.3", "8.5"]
---

### Intent

**Problem:** After the supplier is paid, the order must reach the chosen collection point. The treasurer plans the route, names the driver, and members must learn the delivery window. The route planning exists (7.4); the demonstration needs it wired to the order, with an arrival estimate and a notification the members can see.

**Approach:** The treasurer plans the delivery from the order's supplier depot to the chosen collection point through the 7.4 route screen and the `delivery.planned` event. Add what is missing: an arrival estimate that members can read, a driver assignment that the members see, and a delivery-window message in each member's list. Keep the route as the Node's own calculation.

### Boundaries & Constraints

**Always:** Places are named by opaque ids; the record holds no coordinate or address (AGENTS rule 6; `packages/community/src/delivery.ts`). The planner is a treasurer or co-treasurer (`placeAdderProblem` / planner rules in `delivery.ts`). The route is computed on the Node (`apps/node/src/route-routes.ts`). The driver must hold the driver role at log time (`apply`, `delivery.planned` check).

**Never:** Exact GPS on a member's screen or in the record. Calling a routing engine from the phone. Starting a delivery (7.6 does that). Paying anyone.

### I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Paid order, collection point chosen | Supplier paid (8.5); collection point registered (7.3) | Route planned; `delivery.planned` recorded with the driver and place ids; members see "Delivery planned to <place>" | None |
| No collection point | Order has no registered collection point | Planning refused | "That place is not registered with this community." (`DELIVERY_MESSAGES.unknown_place`) |
| Not a driver | Chosen driver has no current driver role | Refused at log time | `DELIVERY_MESSAGES` driver refusal (see `delivery.ts`) |
| Same place twice | Depot and collection point are the same | Refused | "A route needs two different places." |
| Offline | Phone has no connection | Planning not offered | "Planning a route needs a connection." (S-7.4-10) |
| Node has no road route | Node's routing fails or is out of area | Refused with the plain sentence from `route-routes.ts` | `no_route` / `out_of_coverage` |

### Code Map

- `packages/community/src/delivery.ts` -- `deliveryKey`, `placeKey`, `placeAdderProblem`, `DELIVERY_MESSAGES`, `driverStands`. Exists (7.4).
- `packages/events/src/registry.ts` -- `delivery.planned` (about line 113), `place.registered` (about line 92). Exists. Check whether `delivery.planned` carries a time window or ETA; the reading here did not confirm it.
- `apps/node/src/route-routes.ts` -- `POST /communities/:key/routes` (about line 343), `GET` by fingerprint (about line 437). Exists.
- `apps/node/src/places.ts` -- `PlaceRegistry`, `RouteStore`, `RouteEntry.durationSeconds`. Exists. The duration is on the Node, not in the record.
- `apps/shopong/lib/route.ts`, `apps/shopong/lib/route.test.ts` -- phone route logic. Exists.
- `miniapps/vendor/delivery/src/main.tsx`, `data.ts`, `datasets.ts` -- the map page in the sandboxed WebView (AD-20). Exists.
- `apps/shopong/lib/notifications.ts` -- `demoNotifications` is a fixed list; nothing here is driven by events. **Missing:** a member notification from `delivery.planned`.
- `packages/scenario-stokvel/src/steps.ts` -- steps `plan-delivery` (about line 469) and the `delivery:planned` event (about line 559), which shows a distance, a duration and a window start. Use as the expected output.

### Tasks & Acceptance

**Execution:**
- [ ] Attach the delivery to the order: the planner picks the order from the record, not the fixed word `current` (S-7.4-8). Test with two orders.
- [ ] Show the arrival estimate from the Node's route duration plus the planned start (question 2). Test the rounding in words ("about 40 minutes").
- [ ] Assign the driver from the record's driver role, and show the driver's name to members.
- [ ] Member notification: a list entry for each member, produced from the `delivery.planned` event on the phone (no push). Test on two replicas.
- [ ] Demo check on the scenario's `plan-delivery` snapshot.
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- retire S-7.4-8; add rows for the straight-line fallback (S-7.4-1 stays until the real Valhalla route is used).

**Acceptance Criteria:**
- Given a paid order and a registered collection point, when the treasurer plans delivery, then the order gets a route, an arrival estimate and a driver, and every member sees the delivery window.
- Given the planner is not a treasurer, or the driver lacks the role, then nothing is recorded and the plain reason shows.
- Given `pnpm run ci`, then it passes.

### Shortcuts

- **Retire on this story:** S-7.4-8 (one delivery per community, order id `current`).
- **Keep:** S-7.4-1 (straight-line fallback), S-7.4-2 (car only), S-7.4-3 (no turn-by-turn), S-7.4-9 (first driver on the phone's clock).
- **Add:** a row for the arrival estimate, which is the Node's straight-line time times 1.3 and not a timed road route.

### Verification

**Commands:** `pnpm run test`, `pnpm run ci`.

**Manual, both every time:**
- Web: order, supplier paid, collection point registered (7.3), then plan delivery. Screenshot the member's delivery window and the treasurer's plan. Check the map page loads in the WebView.
- Android emulator: the same on Expo Go; check the WebView map and the member notification. Note what was not checked.

### Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Who may plan a delivery?**
   - A) The treasurer or a co-treasurer, as in 7.4. (Recommended.)
   - B) A driver may plan their own run.
2. **What does the arrival estimate mean?**
   - A) Planned start plus the Node's route duration, labelled "about". (Recommended: the honest value the Node has.)
   - B) No estimate in the demonstration; show distance only.
3. **When is a paid order ready for delivery?**
   - A) After the supplier is paid (8.5). (Recommended: the supplier must be paid before the goods move.)
   - B) After the pool is funded (8.4), before the supplier is paid.
4. **Member notification.**
   - A) A list entry in each member's app, produced from the event on the phone. (Recommended; no push service is in the code.)
   - B) Push notifications, which need a service and a secret: out of scope for this demonstration.
