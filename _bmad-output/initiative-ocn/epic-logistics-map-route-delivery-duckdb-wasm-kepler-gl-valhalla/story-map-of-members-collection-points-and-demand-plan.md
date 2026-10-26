---
title: "Map of members, collection points and demand"
type: "feature"
ticket: 3
created: "2026-10-26"
status: done
baseline_revision: "5471d90"
risk: "medium"
hitl: false
depends_on: ["3.8 (spike, not merged)", "7.4 (merged)", "7.2 (merged)"]
covers: ["FR14", "AR7", "NFR3"]
---

### Intent

**Problem:** A treasurer must see where members are and which collection points are possible, so the stokvel can choose a collection point. Story 7.4 planned routes between registered places, but no screen registers a place (S-7.4-7). Member areas are not in the record at all, and an exact home address must never enter the shared record (AGENTS rule 6).

**Approach:** Add the treasurer's screen where places are registered: collection points (with a label and a coarse area) and each member's coarse area. The Node already keeps coordinates for places (`apps/node/src/places.ts`); the record keeps only the opaque place id, label and area. Member areas are coarsened on the device before they leave it. The console map reads the coarsened data from the community view (3.8) through DuckDB-WASM and Kepler.gl (AD-20 page in `miniapps/vendor/delivery`).

### Boundaries & Constraints

**Always:** Exact coordinates and addresses stay on the Node (`apps/node/src/places.ts`, S-7.4-5). The record keeps `label`, `area` and an address commitment only (`packages/community/src/delivery.ts`, `placeJson`). Member areas are coarsened on the device before anything is sent (`packages/community/src/delivery.ts` already has a "coarse" word for places; the device rule is to be written). Only a treasurer or co-treasurer registers a place (`placeAdderProblem`). DuckDB-WASM and Valhalla-WASM stay in the console; Kepler.gl is the only page in the app (AGENTS rule 7 and AD-20).

**Never:** A member's exact home address, GPS or phone number in the record, the Node's logs or a payload. Bundling DuckDB-WASM into the mobile app.

### I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register a collection point | Treasurer types a label, an area, a point on the map and an address | Node keeps the point; the record gets `place.registered` with label and area | "Send a label, an area, a place on the map and its address." (`ROUTE_MESSAGES.invalid_place`) |
| Label reads as an address | Label "12 Main Road" | Refused | "A place is named, never addressed." (per `route-routes.ts` patch) |
| Not the treasurer | A member tries to register | Refused | "Only the treasurer can add a place." |
| Retry after a lost answer | Same registration sent twice | One place (fix needed: S-7.4-15) | Node returns the existing place |
| Member area | Member types or picks an area on their phone | Coarsened on the device, then recorded as a member-area entry | Area too fine (a street name) refused |
| Map | Console opens the map | Members (coarse) and collection points show; clusters by area | No data: "No places are registered yet." |
| Exact address search | Someone searches the record for an address | Nothing found | Test asserts |

### Code Map

- `apps/node/src/route-routes.ts` -- `POST /communities/:key/places` (about line 266), `ROUTE_MESSAGES`, `placeBody`. Exists (7.4).
- `apps/node/src/places.ts` -- `PlaceRegistry` (`places.json`), `PlaceEntry`. Exists.
- `packages/community/src/delivery.ts` -- `placeKey`, `placeJson`, `placeAdderProblem`, `DELIVERY_MESSAGES`. Exists.
- `packages/community/src/apply.ts` -- `place.registered` check (`placeRegisteredCheck`). Exists.
- `packages/events/src/registry.ts` -- `place.registered` (about line 92). Exists.
- `apps/shopong/lib/route.ts` -- route logic on the phone. Exists. **Missing:** any place-registration screen (S-7.4-7).
- `miniapps/vendor/delivery/src/main.tsx`, `datasets.ts`, `data.ts` -- the Kepler page. Exists; read `datasets.ts` before the story starts to see whether it already takes a dataset of points.
- `_bmad-output/initiative-ocn/epic-shared-community-record-hyper-stack/tickets.toml` -- 3.8 (spike: query community data with SQL in the web console). Not merged.
- `packages/ports/src/geo.ts` and `packages/ports-contract/src/geo.ts` -- the geo port (coarsening helpers may live here; read before writing new ones).
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-7.4-5, S-7.4-7, S-7.4-15, S-7.4-16.

### Tasks & Acceptance

**Execution:**
- [ ] Treasurer's screen "Places": add a collection point (label, area, a point on the map, the address), list the registered places, and show the plain refusal for each row of the matrix. Put it in the app's treasurer area (question 1). Test on web and emulator.
- [ ] Member area: a coarse area picker on the member's phone; coarsening rule on the device (question 2); the record gets the area only. Test that a street-level entry is refused.
- [ ] Map page: load the coarsened members and collection points from the community view into DuckDB-WASM in the console and show them in the Kepler page. No DuckDB-WASM in the mobile bundle.
- [ ] Test: the record and the view contain no exact coordinate and no address (search the view JSON).
- [ ] Fix the duplicate-on-retry gap (S-7.4-15) by keying the place on the registration's event id, or record it as a shortcut (question 3).
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- retire S-7.4-7 when the screen exists; add rows for the coarsening rule and for the area list.

**Acceptance Criteria:**
- Given the treasurer registers a collection point, when it is saved, then the record shows the label and the area, and the Node keeps the point.
- Given a member gives an area, when it is saved, then the record shows only the coarse area.
- Given the console map, when it opens, then members (coarse) and collection points show with demand clusters.
- Given the record is searched for an exact address or coordinate, then none is found.
- Given `pnpm run ci`, then it passes.

### Shortcuts

- **Retire on this story:** S-7.4-7 (no phone screen registers places).
- **Decide on this story:** S-7.4-15 (duplicate places on retry) and S-7.4-16 (address normalisation).
- **Keep:** S-7.4-5 (exact coordinates in `places.json` on the Node).
- **Add:** the coarsening level (for example a town or a suburb) as a shortcut until the product owner sets the level.

### Verification

**Commands:** `pnpm run test`, `pnpm run ci`.

**Manual, both every time:**
- Web: register two collection points and one member area as the treasurer; open the console map; search the record for the address and confirm nothing is found. Screenshot the Places screen, the member's area picker and the map.
- Android emulator: the Places screen and the member's area picker on Expo Go; check the map page in the WebView. Note what was not checked.

### Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted.**


1. **Where does the treasurer's Places screen live?**
   - A) A "Places" section in the community's treasurer area of the app. (Recommended: the same place as the other treasurer tools.)
   - B) A miniapp (`miniapps/vendor/places`).
2. **How coarse is a member's area?**
   - A) A suburb or town name, typed or picked from a list of the community's areas; no street. (Recommended: meets FR14 and AGENTS rule 6.)
   - B) A ward or a postcode, from a fixed list.
3. **Duplicate places on retry.**
   - A) Fix it in this story: the place's id comes from the registration's event id. (Recommended: small and removes S-7.4-15.)
   - B) Keep the shortcut and revisit later.
4. **Who may see member areas on the map?**
   - A) Every member sees collection points; only the treasurer sees member areas. (Recommended.)
   - B) Every member sees the coarse areas of all members.
5. **Is 3.8 a prerequisite?** 3.8 is a spike (query community data with SQL in the web console) and no merge was found.
   - A) Wait for 3.8 to merge; the map reads its view. (Recommended.)
   - B) Build the map on the existing Node route and move it to 3.8 later.

---

## Cross-cutting questions for the product owner

1. **Is `packages/scenario-stokvel` the demonstration's driver or only its test oracle?**
   - A) Oracle: the real app runs each step and the scenario checks the figures. (Recommended: keeps the scenario as the expected output.)
   - B) Driver: the demonstration runs the scripted steps and the app shows them.
2. **Does 8.x need a fresh demo Node?** Each story assumes a Node with the ledger on (S-4.5-10).
   - A) Yes: a demo Node with a seeded community. (Recommended.)
   - B) No: start each demo from the scenario's reset.
3. **Stitch is simulated.** Confirm every money screen in the demonstration says so, as in `pay.ts` and `pool-routes.ts`.

## Verification standard for all five stories

- Check on the web and on the Android emulator, every time (memory: test on web and emulator). Each story's report says what was not checked (for example iPhone, a low-end phone).
- `pnpm run ci` must pass. New behaviour comes with tests.
- The PR lists each acceptance criterion as a checkbox with how it was verified.
- Do not edit the plan's `status:` in a story PR.
