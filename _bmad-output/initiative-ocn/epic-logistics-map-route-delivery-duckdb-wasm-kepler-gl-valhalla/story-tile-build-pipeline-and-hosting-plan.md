---
title: "Tile build pipeline and hosting"
ticket: 2
status: draft
baseline_revision: '2d1ef5d846450eee09b35853682df06a69a0c175'
---

## Intent

**Problem:** Routing in the web console and on the Node needs graph tiles built from an OpenStreetMap extract. Spike 7.1 proved the engine on Eswatini as a stand-in, but its builds are not byte-reproducible by release id, nothing is hosted, and no South African region has been chosen (D-8).

**Approach:** One pinned extract for one agreed region builds into an immutable, versioned release: tiles, `graph.tar` and a `manifest.json` that lists the SHA-512 of every file. The release sits in a static folder served over HTTPS with byte ranges. The console and the Node check each file's hash before they route. OSM (ODbL) attribution appears in the app, the console and the Node.

## Boundaries & Constraints

**Always:** The extract's SHA-256 is checked before any build. A release is immutable: a name that exists is never overwritten. The manifest lists a SHA-512 for every file. Byte ranges work. Attribution is shown on every surface. Tiles are never bundled into the mobile app (rule 7). Routes are computed on the console or the Node (decision 7.1).

**Never:** Routing on the phone. Calling the route engine from the app. Multi-country or whole-continent coverage in this story. Changing the pinned Valhalla versions (builder 3.8.3, `valhalla-browser` 0.2.1) without a note. Putting tiles inside `miniapps/vendor/delivery`, whose basemap is its own Clermont extract.

**Cost and licence:** The Geofabrik download is free. OSM data is ODbL 1.0 (© OpenStreetMap contributors). Tiles built from it are probably a derived database, so attribution and share-alike duties apply; this needs legal confirmation (question 5). Build cost and bandwidth are not measured for a province-sized extract. The spike's Eswatini figures were 30 MB in, 51 tiles, a 22 MB `graph.tar`, and a 7.9 s build with Docker.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean build | Pinned extract, matching SHA-256, new release name | Release folder with tiles, `graph.tar`, manifest | None |
| Bad extract | SHA-256 mismatch | Nothing written | "The map file didn't match its checksum." |
| Name reused | Existing release name, different bytes | Existing release untouched | "Release <name> already exists." |
| Same build again | Same name, same bytes | No change | None |
| Tampered tile | A file's hash differs from the manifest | Routing refused | "Map data can't be checked." |
| Outside coverage | Point outside the extract's box | Refused | `OUTSIDE_COVERAGE`: "Outside the map area." |
| Inside box, other country | Point across the border | Routes silently (spike finding) | Coverage shown as the extract's box, not the border |
| Range request | `graph.tar` with `Range` | 206 with the requested bytes | None |
| No release yet | Host empty | 404 | Console: "No map data yet." |
| No attribution | Config lacks the text | Build stops | "Add the OpenStreetMap attribution." |
| No Docker | Builder image cannot run | Build stops | "Docker is needed to build map data." |

## Code Map

- `scripts/sandbox/fetch-osm-extract.sh` -- fetches and verifies the extract; `SNAPSHOT="261023"` pins Eswatini today.
- `scripts/sandbox/swaziland-261023.osm.pbf.sha256` -- the committed hash to replace for the chosen region.
- `docs/sandbox-setup.md` (section 5) -- the OSM step and its licence note.
- `docs/decisions/7-1-valhalla-on-device.md` -- routes off the phone; D-8 still open.
- `docs/spike-findings.md` (spike 7.1 and its addendum) -- the numbers and the reproducibility finding.
- `git show 9bc22c4:spikes/7-1-valhalla/scripts/02-build-tiles.sh` and `.../scripts/range-server.mjs` -- the spike build and static server to port. They are in git history, not in the working tree.
- `packages/ports/src/routing.ts` -- the `Routing` port (the SDK exposes `route` only).
- `apps/node/src/app.ts` -- `buildApp`; `/ready` reports the active release.
- `apps/node/src/config.ts` -- add the tile folder and the active release.
- `miniapps/vendor/delivery/src/basemap/style.ts` and its `README.md` -- the current ODbL attribution text.
- `apps/shopong/components/miniapps.ts` -- where the Delivery mini app is registered.
- `_bmad-output/initiative-ocn/architecture-ocn/architecture-ocn.md` -- section 4.4 and D-8 in section 9.

## Tasks & Acceptance

**Execution:**
- [ ] `scripts/sandbox/` -- pin the extract for the region chosen under D-8, with a new SHA-256 file -- the input
- [ ] `scripts/tiles/` (new) -- the build from the spike, with an explicit release name, a manifest with SHA-512 per file and the attribution, and the immutability check -- the pipeline
- [ ] `apps/node/src/` -- serve the release folder read-only with byte ranges; `/ready` names the active release; the manifest carries the attribution -- the host
- [ ] `apps/shopong/` and the routing adapter -- check each file against the manifest before routing; show the attribution in the Delivery map -- the users' check
- [ ] `docs/` and `shortcuts.md` -- record the region, licence note and release procedure; add rows for each shortcut

**Acceptance Criteria:**
- Given the pinned extract, when the build runs twice with the same name and bytes, then the release is unchanged; with different bytes it is refused.
- Given the hosted release, when `graph.tar` is requested with a `Range` header, then the answer is 206 and its SHA-512 matches the manifest.
- Given a tampered tile, when routing starts, then it is refused with "Map data can't be checked."
- Given the app, the console and the Node, then the ODbL attribution is shown or served.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `bash scripts/sandbox/fetch-osm-extract.sh` -- expected: a verified extract
- Build the same release name twice -- expected: identical manifest hashes, the second run a no-op
- `curl -r 0-99 <host>/<release>/graph.tar` -- expected: 206
- `pnpm run ci` -- expected: exit 0

**Manual checks (the app changes, so both are required):**
- Web: route between two points on the hosted tiles in the console; the attribution is visible.
- Android emulator: open the Delivery map; it loads and shows the attribution.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (the first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; older wording that says the emulator is checked only when asked is out of date. Routes are computed off the phone (docs/decisions/7-1-valhalla-on-device.md). Photos: all metadata is stripped. The tile region is the KwaZulu-Natal extract; the ODbL share-alike position needs a lawyer's confirmation before the first public release.**

1. **Which region? (D-8)**
   - A) The KwaZulu-Natal province extract from Geofabrik, since the Delivery basemap is Durban (recommended: lets work proceed; changing it later is one pinned file). Its existence and size are not verified; the fetch will check.
   - B) All of South Africa in one extract: larger, build cost and bandwidth unmeasured.
   - C) Keep Eswatini: serves no South African community.
   - D) Wait for the product owner: blocks the pilot map and stories 7.4 to 7.6.
2. **Hosting.**
   - A) A static release folder outside the Node's data folder, served over HTTPS with byte ranges by the Node or a reverse proxy in front of it (recommended: the Node is always on, the data is public, and the app keeps one origin).
   - B) A separate static host or object storage. Needs range support and CSP `connect-src` for that origin.
   - C) Only `valhalla-server` on the Node, with no static files. Leaves the console without tiles, so not recommended.
3. **Reproducibility.**
   - A) Release names are chosen by us and are immutable; the manifest lists each file's SHA-512; a rebuild under an existing name with different bytes is refused (recommended). Each route stores the release name it used (story 7.4).
   - B) Make builds byte-reproducible by pinning the native config and removing the release path from `tile_url` in the upstream dataset script. More work, and an upstream change.
   - C) Accept a new release id per build and record the manifest's SHA-512 in each route. Works, but a route cannot be rebuilt from its id.
4. **Where is attribution shown?**
   - A) The app's Delivery map, the console, and the Node's manifest response, each with a link to openstreetmap.org/copyright (recommended).
   - B) The console only.
5. **Share-alike for tiles.**
   - A) Treat the tiles as a derived database: publish each release under ODbL with attribution and a link to the source (recommended; the Delivery basemap is read the same way). Confirm with counsel.
   - B) Take legal advice before the first release. Blocks only the pilot release, not the build.

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 2 high, 3 medium, 6 low. The builder also reported that the plan's region (KwaZulu-Natal from Geofabrik) does not exist as a province file; the national South Africa extract is the only South African file (423,139,578 bytes). The region is decision D-8 and is still with the product owner; the KwaZulu-Natal pin stays unpinned and the build refuses it.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The served manifest was re-read from disk on every request after a once-per-process check | high, real | patch | The verified manifest bytes and digest are kept in memory and served; test failed first |
| 2 | Listed files were found with `stat` (follows symlinks) and not re-checked after verification | high, real | patch | `lstat`, no symlinks, size/mtime/inode stamps compared on open, a mismatch re-hashes the release; tests failed first. (`O_NOFOLLOW` itself is redundant with the `lstat` check) |
| 3 | `If-Range` was ignored, so a resumed download could splice releases | medium, real | patch | Full 200 when the validator no longer matches; test failed first; mutation-checked |
| 4 | `manifest.sha512` proves consistency, not authenticity | medium | defer | S-7.2-15 (no signature or pinned root; fine for a demo) |
| 5 | Publish race: a file added to staging between the scan and the copy | low to medium, real | patch | The copy is re-scanned before the rename; incoming removed on failure; tests failed first |
| 6 | Scripts trusted a planted binary in world-writable `/tmp` | medium, real | patch | Private scratch under `~/.cache/ocn-tiles` (owned, no group/other write, no symlink); a prebuilt binary is reused only with a recorded SHA-256 |
| 7, 8 | A pipeline failure after publish aborted cleanup; unquoted paths | low, real | patch | Trap cleanup; arrays and quoting |
| 9 | The config check was lexical, not on real paths | low, real | patch | Real paths; an ancestor of the data folder is refused |
| 10 | A failed check was cached for the life of the process | low, real | patch | Retried after 30 s |
| 11 | No ignore patterns for map files | low, real | patch | `*.pbf`, `*.osm`, `*.tar`, `*.zip` and the scratch folders ignored |

