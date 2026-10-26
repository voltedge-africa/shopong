---
title: "Files and photos in Hyperdrive with hash references"
ticket: 7
status: draft
baseline_revision: '2d1ef5d846450eee09b35853682df06a69a0c175'
---

## Intent

**Problem:** Demonstration 1 needs two kinds of file in the record: the supplier's price list (quotes now, OCR later) and the delivery photo that backs a collection (story 7.6). Both are too large for an event (the events route refuses bodies over 64 KiB), and the record must never hold their bytes or anything personal in them. Story 2.7 built `verifyAttachment`, but no screen calls it (S-2.7-9).

**Approach:** The OCN Node holds each community's files in a Hyperdrive beside its record (decision 3.1). A phone strips metadata, hashes the file with SHA-512 and uploads it. The Node stores it under that hash, and the event carries only the reference. A member's phone fetches a file from the Node when opened, checks it with `verifyAttachment`, and may delete its copy. Uploads queue on the phone with story 3.4's queue.

## Boundaries & Constraints

**Always:** An event carries the hash and a reference, never bytes. The hash is over the stored (stripped) bytes. EXIF, XMP and GPS data are removed on the phone before hashing. Every upload and read is a signed request the Node checks (story 3.5). The event id stays SHA-512 of the canonical JSON (rule 5). A file is refused unless its hash matches what the sender declared.

**Never:** Bytes inside the JSON queue file. Phone-side Hyperdrive or the Bare worklet (decision 3.1 defers them). Face detection, OCR or any model call. A file readable without a member's identity proof. Changing the `SharedRecord` port or the envelope.

**Left for later:** OCR of price lists (Unlimited OCR epic), face blurring, HEIC and video, per-community storage quotas, Node backup of the drive, on-phone Hyperdrive.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Photo with GPS | JPEG 3 MB with GPS EXIF, member with the role | Stored file has no EXIF or GPS; event hash equals the stored bytes' hash | None |
| Too large | 12 MB price list | Refused before upload | "That file is too big (limit 10 MB)." |
| Wrong type | A ZIP or an HEIC | Refused before upload | "That kind of file isn't accepted." |
| Declared hash differs | Node hashes different bytes | Nothing stored | 400, "The file didn't arrive intact." |
| Same bytes again | Same SHA-512 | One stored copy; event accepted if new | None |
| Non-member read | No valid signed proof | Nothing returned | Refused, reason logged without bytes |
| Tampered on fetch | Bytes differ from the event's hash | Not shown as verified | "does not match" |
| Offline | No connection after a photo is taken | Bytes kept in the phone's file store; event not sent | "Waiting to send" |
| Node disk full | Write fails | Upload stays queued | "Couldn't save the file. We'll try again." |
| Low phone storage | Cached copy removed by the phone | Fetched again when opened | None |

## Code Map

- `apps/node/src/sync.ts` -- the 64 KiB events route and the signed-request pattern to copy. A new `apps/node/src/files.ts` (to create) registers the upload and read routes beside it.
- `apps/node/src/signed.ts` -- `verifySignedRequest` and `checkSignedRequest`, used for every file call.
- `apps/node/src/hub.ts` -- `ReplicaHub`, which holds each community's replica; the drive opens beside it (new method).
- `apps/node/src/config.ts` -- `dataDir` and the new file size limit.
- `apps/node/src/redact.ts` -- keeps paths and metadata out of logs.
- `packages/events/src/hash.ts` -- `verifyAttachment`, `sha512Hex`, `ATTACHMENT_MESSAGES`.
- `packages/events/src/envelope.ts` -- the envelope; the new event type is added here.
- `packages/community/src/community.ts` -- the write path that must accept the new event.
- `apps/shopong/lib/offlineQueue.ts` and `queueStore.ts` -- the queue to reuse; `QueueItem` holds an event, so the bytes need their own store.
- `apps/shopong/lib/sha512.ts` -- hashing on the phone.
- `apps/shopong/lib/sync.ts` and `syncMessages.ts` -- where the upload message is sent.
- `apps/shopong/package.json` -- `expo-image-picker` and `expo-file-system` are already dependencies.
- `docs/decisions/3-1-record-on-the-node.md` -- the Node holds the files.
- `_bmad-output/initiative-ocn/shortcuts.md` -- S-2.7-9 closes here; add this story's rows.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/events` -- the file reference shape and the event that names it, with a contract test -- the reference
- [ ] `apps/node/src/files.ts` -- a Hyperdrive per community; signed upload (size, type, declared hash) and signed read with byte ranges -- the Node holds bytes
- [ ] `apps/shopong/lib/` -- metadata strip, hash, type and size check, a byte store, a queue that sends bytes before the event -- the phone
- [ ] `apps/shopong/` screens -- attach a photo or price list to an order; show "verified" or "does not match" from `verifyAttachment` -- closes S-2.7-9
- [ ] `_bmad-output/initiative-ocn/shortcuts.md` -- close S-2.7-9 and add rows for each shortcut taken

**Acceptance Criteria:**
- Given a photo with GPS data, when it is uploaded, then the stored bytes carry no EXIF or GPS and the event's SHA-512 is the hash of those stored bytes.
- Given a fetched file, when a device checks it, then it shows "verified", and a changed byte shows "does not match".
- Given a non-member's read, then the Node refuses it and returns no bytes.
- Given a file that is too large or of the wrong type, then it is refused on the phone and by the Node.
- Given no connection, when a photo is taken, then no event is sent until the bytes are stored on the Node.
- Given `pnpm run ci`, then it passes.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/node test` -- expected: upload, read, limit and refusal tests pass, over HTTP
- `pnpm exec vp test run packages/events` -- expected: event and hash tests pass

**Manual checks (app changed, so both are required):**
- Web: attach a sample photo that has GPS data to an order, see "verified", and confirm the stored file has no GPS (the web queue is memory only, S-3.4-3).
- Android emulator: the same flow, then airplane mode during an attach and restore; the photo sends once and shows "verified".

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (the first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; older wording that says the emulator is checked only when asked is out of date. Routes are computed off the phone (docs/decisions/7-1-valhalla-on-device.md). Photos: all metadata is stripped. The tile region is the KwaZulu-Natal extract; the ODbL share-alike position needs a lawyer's confirmation before the first public release.**

1. **Where do the bytes live?**
   - A) A Hyperdrive on the Node, one per community beside its record (recommended: the ticket, AD-2 and decision 3.1 all say it).
   - B) Plain files on the Node's disk named by SHA-512. Simpler, but loses Hyperdrive's streaming and `clear` features.
2. **Does a phone keep a copy?** The ticket's `clear(path)` wording assumes a Hyperdrive replica on the phone.
   - A) The phone caches fetched files in its file store, deletes them when storage runs low, and fetches again on demand (recommended: no phone Hyperdrive under decision 3.1). The product owner should reword that verify line.
   - B) A Hyperdrive replica on the phone. Blocked until the Bare worklet is built (R-1).
3. **Size and type limits.**
   - A) Photos JPEG, PNG or WebP up to 5 MB; price lists PDF, JPEG or PNG up to 10 MB; anything else refused (recommended; the numbers are my proposal, not measured).
   - B) As A, and also resize photos on the phone first. This needs an image-processing dependency, which needs a note in the PR.
   - C) Use the picker's quality setting only, with no resize (no new dependency; photos are larger).
4. **Metadata and faces.**
   - A) Strip all metadata; no face handling; a plain warning before a photo is taken, "Don't photograph people's faces" (recommended: the event already holds the time and coarse place that 7.6 needs).
   - B) Keep the capture time inside the file and strip the rest.
   - C) Blur faces. Needs a model, so later.
5. **Who may upload and read?**
   - A) Upload needs the role for the event that carries the file, checked by the Node and in `apply`. Read is for members of that community only (recommended).
   - B) Any authenticated person of the Node may read any file (simpler, weaker).
6. **Offline upload order.**
   - A) Store the bytes on the phone, send them to the Node first, then send the event, so the record never names a missing file (recommended).
   - B) Send the event with a "photo waiting" marker and send the bytes later.
7. **How does an event name a file?**
   - A) A new `file.attached` event that other events point to, so there is one reference shape (recommended: rule 2 adds types, not envelopes).
   - B) A `file` field inside each event that needs one (`quote.added`, `delivery.confirmed`), with no new type.
