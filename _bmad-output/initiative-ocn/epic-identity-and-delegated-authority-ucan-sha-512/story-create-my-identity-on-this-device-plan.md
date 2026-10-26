---
title: 'Create my identity on this device'
type: 'feature'
ticket: 2
created: '2026-10-26'
status: done
baseline_revision: 'd904351297102d17c2812110deeab2ea143b0baf'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A person has no identity in Shopong yet. Every later epic (communities, roles, payments) needs a DID whose private key lives only on their phone, and a fresh install must never pass off a lost identity as the old one.

**Approach:** Add a "Your identity" card to the Settings tab. Choosing Create my identity makes a random recovery seed, derives the Ed25519 key from it with the AD-18 KDF, saves the seed in the platform keystore, and shows a short readable DID. The adapter builds its signer from that seed.

## Boundaries & Constraints

**Always:** Show a DID only after the seed is saved. Keep the private key and seed on the device: never logged, never sent, never in an event. Mirror the PIN code's store split (`pinStore.ts`, `pin.ts`, `auth.tsx`). Use the `CapabilityAuth` port; nothing outside `packages/adapter-ucan-iso` imports `iso-ucan`. Plain words in the UI.

**Never:** The recovery-phrase display, backup or restore flow (story 2.6). Invitations, roles, or posting the DID to the shared record (2.3+). Changing the `CapabilityAuth` port. Deleting or overwriting a stored seed that cannot be read.

**Decisions (product owner, 2026-10-26):**
1. Web: the identity lives in memory only, like the PIN. It is gone on reload, and a key never touches browser storage.
2. Recover: the card shows a Recover choice that says recovery is coming and does nothing else. The restore is story 2.6.
3. The key is derived from a random recovery seed with the AD-18 KDF now, so 2.6 restores the same identity with no rework.
4. iOS: a reinstall brings the old identity back from the keychain, which is accepted. Say so in a code comment and in the PR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | No stored seed, tap Create my identity | 32 random bytes saved, DID shown as `did:key:z6Mk…` plus the last 6 characters | No error expected |
| Relaunch | Seed stored | Same DID shown, no new key made | No error expected |
| Fresh install | No stored seed | Card offers Create and Recover; nothing is created without a tap | No error expected |
| Save fails | Keystore write throws | No DID shown, nothing half-saved | "Couldn't save your identity on this device." |
| Unreadable seed | Stored value is not 64 hex characters | Card says the identity can't be read; stored value left alone | "Couldn't read your identity." Never overwritten |
| Double tap | Create tapped twice quickly | One identity only | No error expected |
| Web reload | Identity created on web, page reloaded | Identity gone; Create offered again | No error expected |

</frozen-after-approval>

## Code Map

- `apps/shopong/lib/pinStore.ts`, `lib/pin.ts`, `lib/auth.tsx`, `lib/pin.test.ts` -- the pattern to mirror: store type, SecureStore on native and memory on web, Effect errors, a context provider, tests with an injected store. Do not change them.
- `apps/shopong/app/(tabs)/settings.tsx` -- empty tab; hosts the card.
- `apps/shopong/app/_layout.tsx` -- provider tree (`AuthProvider` wraps the stack); add the identity provider inside it.
- `apps/shopong/lib/cryptoPolyfills.ts`, `lib/cryptoShim.js`, `metro.config.js`, `lib/ucanCheck.ts` -- 2.1 work: import the polyfills before the adapter; reuse `installedPolyfills`.
- `packages/adapter-ucan-iso/src/adapter.ts` -- `IsoUcanCapabilityAuth` holds signers in memory and takes a `createSigner` option. Add an `identitySeed` option so the first `createIdentity()` returns the DID of the seed's key. Do not change the port in `packages/ports/src/capability-auth.ts`.
- `git show 9bc22c4:spikes/2-1-ucan/src/identity/seed.ts` -- the validated HKDF code. The golden vector: recovery seed `000102…1f` gives `did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL`.
- `@noble/hashes` (already in the app) for HKDF; `expo-crypto` for random bytes.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/adapter-ucan-iso/src/adapter.ts` -- add the `identitySeed` option -- the app needs a stable DID from a stored seed
- [ ] `packages/adapter-ucan-iso/src/adapter.test.ts` -- the golden seed gives the golden DID; the contract still passes -- guards the AD-18 derivation
- [ ] `apps/shopong/lib/identitySeed.ts` and `identitySeed.test.ts` -- seed derivation, hex helpers, `shortDid` -- one tested home for the AD-18 code
- [ ] `apps/shopong/lib/identityStore.ts` -- keystore on native, memory on web per question 1 -- mirrors `pinStore.ts`
- [ ] `apps/shopong/lib/identity.ts` and `identity.test.ts` -- load and create over an injected store, covering every I/O row -- keeps the logic testable without a phone
- [ ] `apps/shopong/lib/IdentityProvider.tsx` and `app/_layout.tsx` -- context provider inside `AuthProvider` -- mirrors `auth.tsx`
- [ ] `apps/shopong/components/IdentityCard.tsx` and `app/(tabs)/settings.tsx` -- the card and its states -- the user-facing part

**Acceptance Criteria:**
- Given an unlocked app with no identity, when I tap Create my identity, then a short DID is shown and the seed is in the keystore.
- Given a stored seed, when I relaunch and unlock, then the same DID is shown.
- Given a fresh install, when I open Settings, then Create and Recover are offered and no identity exists until I tap Create.
- Given `pnpm run ci`, then it passes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens). Verdicts: 0 high, 0 medium, 3 low kept, 1 low rejected, 1 low rejected.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| A failed keystore read shows "Couldn't read your identity." with no retry or Create (`IdentityProvider.tsx`, `IdentityCard.tsx`) | low | rejected | Real, but not creating is the safe outcome: if the read throws, a seed may exist and `createIdentity` reads first and would throw too. The PIN code has the same dead end. A retry button is added complexity for a rare case. |
| Comment in `identityStore.ts` says "Android clears the keystore entry on uninstall", unverified | low | patch | The claim came from the plan's question 4 and nothing here confirms it; Android Auto Backup may behave differently. Smallest fix: drop the claim from the comment. |
| The identity loads while the PIN screen is showing (`IdentityProvider.tsx`) | low | patch | Real: the provider sits above the stack, so the keystore is read and the signer built before unlock. The criterion still holds. Smallest fix: start the load only once `useAuth().status` is `unlocked`. |
| The "Couldn't read your identity." text can show twice (`IdentityCard.tsx`) | low | patch | Real: `create()` returning `unreadable` sets the status, which renders the text, and the card also sets `error` to the same text. Smallest fix: do not set `error` for `unreadable`. |
| No unmount guard in `create` | low | rejected | The provider lives at the root and is never unmounted while the app runs, so the state updates are harmless. A guard adds a branch for no reachable case. |

## Design Notes

The seed, not the key, is stored: 2.6 restores the same DID from the same seed, and the Corestore `primaryKey` can later come from the same seed with another label. `shortDid("did:key:z6Mkmtmq…VouVZtL")` keeps the first 12 characters of the key part and the last 6.

## Verification

**Commands:**
- `pnpm run ci` -- expected: exit 0, new tests included
- `pnpm --filter @shopong/adapter-ucan-iso test` -- expected: contract and seed tests pass

**Manual checks (if no CLI):**
- Web: create a PIN, open Settings, tap Create my identity, a short DID appears. Android is checked only if asked.
