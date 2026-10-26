# Shortcuts register

Every shortcut, workaround or untested corner taken to get a story done, with what was chosen over it, what it costs, and when it must be revisited. Add a row whenever a story takes one. A shortcut is not a bug: it was a decision (or a limit) and it is written down so it is not forgotten.

Columns: **ID** (`S-<epic>.<story>-<n>`), **Shortcut**, **Instead of**, **Cost if it bites**, **Revisit when**.

## Story 2.1 (UCAN library decision and adapter)

| ID | Shortcut | Instead of | Cost if it bites | Revisit when |
|---|---|---|---|---|
| S-2.1-1 | iso-ucan accepted after web and Android emulator (x86_64, Hermes) runs only | also testing a real low-end Android phone and an iPhone | Unknown behaviour on iOS, and unknown memory and cold-start cost on a cheap phone | Before any pilot, or when an iPhone or low-end phone is available |
| S-2.1-2 | The in-app check runs 9 of the 17 contract cases | the full contract on a device | A rule outside those 9 could fail on a phone unseen | The full contract can run on a device |
| S-2.1-3 | Metro maps Node's `crypto` to a stand-in that only exposes `webcrypto`, for every package | a narrower mapping, or a dependency that does not need it | Any later dependency that needs another Node `crypto` function will fail at runtime on a phone | A new dependency imports `crypto` |
| S-2.1-4 | A development-only `/ucan-check` screen lives in the app source | removing it after the check | Dead code, and a screen reachable by URL in development builds | Release hardening (epic 12) |
| S-2.1-5 | The ~90-line mapping from our capability model to UCAN 1.0 has had no independent security review | an external review | A subtle mapping bug could grant more than intended | Story 2.5 and the security review (epic 12) |
| S-2.1-6 | The 2.1 PRs (#13, #14) are stacked and unmerged, and 2.2 and 2.3 are built on top | merging each story before starting the next | Merge order matters; a change to #13 ripples up the stack | Each PR merges |

## Story 2.2 (create my identity on this device)

| ID | Shortcut | Instead of | Cost if it bites | Revisit when |
|---|---|---|---|---|
| S-2.2-1 | On web the identity lives in memory only and is gone on reload | a lasting web identity | A web identity can never be relied on; any community joined on web is lost | The web console identity is designed |
| S-2.2-2 | Recover is a placeholder; the recovery seed is made and stored but cannot be shown or backed up | the real backup and restore | If the phone is lost, the identity is lost | Story 2.6 |
| S-2.2-3 | The seed is stored as plain hex in the keystore, with no extra PIN or biometric layer (the PIN is stored the same way) | an encrypted or biometric-gated store | Anyone who can read the keystore entry gets the seed; the PIN protects the screen, not the entry | Story 2.6 and the security review |
| S-2.2-4 | iOS keeps the keychain entry after an app delete, so a reinstall brings the old identity back (accepted) | an install marker so iOS also offers recovery | The reinstalled app silently shows the old identity | An iPhone is available, or story 2.6 |
| S-2.2-5 | Android behaviour of the stored entry on uninstall and backup restore is unverified | testing it | Auto Backup might restore the entry without its key, so a read throws and the card shows "Couldn't read your identity" | A real device test |
| S-2.2-6 | A failed keystore read is a dead end with no retry (rejected review finding) | a retry button | A transient failure needs an app restart | It is seen in practice |
| S-2.2-7 | `create` has no unmount guard (rejected review finding), and a failure while building the identity is reported as a save failure | a guard and a separate error | A harmless state update, and a slightly wrong message | A reviewer or user hits it |
| S-2.2-8 | Tested on web and an Android emulator only | an iPhone and a low-end phone | See S-2.1-1 | See S-2.1-1 |

## Story 2.3 (create a community and join by invitation)

| ID | Shortcut | Instead of | Cost if it bites | Revisit when |
|---|---|---|---|---|
| S-2.3-1 | Named invitations: the newcomer sends their DID first, and the treasurer issues the invitation to it | an open invitation anyone with the link can use | An extra step; no "hand a link round the room" flow | A key export in the port is accepted, or a better join flow is designed |
| S-2.3-2 | The "code" is the same long text as the link, pasted into a box | a short typed code | Several hundred characters; awkward by hand | A server or relay can look a short code up |
| S-2.3-3 | A second real phone cannot join the first phone's community: each phone has its own in-memory record. Tests simulate it. The Join screen only checks the invitation | a real two-phone join | The visible join flow does not work between phones yet | Epic 3 (the shared record) |
| S-2.3-4 | Communities and members are lost when the app closes (in-memory record, nothing saved) | a persisted record | A treasurer who closes the app loses the community | Epic 3 |
| S-2.3-5 | Every invitation lasts a fixed 7 days; the treasurer cannot change it or cancel one | a chosen lifetime and revocation | A leaked invitation stays valid until it expires or is used | Story 2.6 (revocation) |
| S-2.3-6 | A reused invitation is caught only when the records meet: the first join in log order wins, so a second phone may look joined until it syncs | a coordinator, or the treasurer's phone deciding | A short window where two phones both believe they joined | Epic 3 (convergence) |
| S-2.3-7 | The joiner checks expiry with the device clock, and `apply` takes the event's own `claimedAt` as the time. The joiner picks `claimedAt`, so a joiner can backdate it and an expired or leaked invitation works for ever (found in the 2.3 review) | a log time derived from the record | The 7-day limit is not enforced against a hostile joiner; with no revocation (S-2.3-5) a leaked invitation is permanent | Story 3.6 (log time), and before any real join between phones |
| S-2.3-8 | The community key is random 64-hex, not the Autobase key | the real record's key | Epic 3 has to map one to the other | Epic 3 |
| S-2.3-9 | **Closed in story 2.4.** No roles: the creator is the only inviter, and members get `member/join` only | roles with limits | A treasurer cannot delegate inviting | Closed |
| S-2.3-10 | An invitation link opened while the PIN screen is up is not resumed after unlock | remembering the link | The person pastes the code again | Later polish |
| S-2.3-11 | Sharing the full DID uses React Native's built-in `Share`, with selectable text as the fallback | a clipboard library | A share sheet may be missing on web | A clipboard dependency is accepted |
| S-2.3-12 | The creator's own first `member.joined` (invitation `founder`) and every `member.invited` carry no token: `apply` accepts them only when the event's actor is the creator's DID **and** is the writer who appended it (the writer check was added by the 2.3 review fix) | a signed root grant checked in the record | Authority of these two events is a DID comparison until the record verifies authority | Story 2.5 |
| S-2.3-13 | The `member.invited` and `member.joined` payload schemas require their fields but allow extra fields | rejecting unknown payload fields | A typo'd extra field passes the schema | A story needs closed payloads |
| S-2.3-14 | The Join screen only checks an invitation; the community name is kept in the app, not the record | recording the name and a real join | A joiner never sees the community name | Epic 3 |
| S-2.3-15 | `createEvent({...} as never)` in `packages/community/src/community.ts` bypasses compile-time payload typing | a typed payload union per event type | A wrong payload shape compiles; it is caught only at run time by the schemas | A story adds more event types through `append` |
| S-2.3-16 | The community card does not reset if the identity changes (the app cannot change it today) | resetting on an identity change | A card could show an old community after an identity switch | The app can switch or remove an identity (story 2.6) |
| S-2.3-17 | The golden `member.invited` vector was regenerated (new event id) when the payload gained required fields; hashing code is unchanged | keeping the old vector | Any outside holder of the old vector must regenerate it from `gen_vectors.py` | Another implementation of the event hash exists |
| S-2.3-18 | The in-app "already used" check only sees a community made in this run of the app (it cannot know about other phones) | a shared view of used invitations | A reused invitation passes the Join screen's check on a phone that has no record of it | Epic 3 (S-2.3-3, S-2.3-6) |
| S-2.3-19 | Tested on web and an Android emulator only; on Android by hand: blank name, bad identity, valid invitation, garbage text, a second link opened over the Join screen. "Someone else's" was checked on web and in tests, not by hand on Android | iOS, a low-end phone, and every refusal on every platform | See S-2.1-1 | See S-2.1-1 |
| S-2.3-20 | A person becomes a record writer as soon as they are invited, before they have joined, and stays one if the invitation expires unused (they need write access to send their own join) | admitting a writer only on a valid join | An invited person who never joins can still append events (each refused one adds a `rejected/` entry) | Story 2.5 (authority in the record) |
| S-2.3-21 | The creator and community in an invitation link are taken from the link; the Join screen now shows the creator's short identity but nothing confirms it is who the person expects | confirming the creator out of band or from a known contact | A self-made invitation to an attacker's community looks "good" | Epic 3, when joining is real |
| S-2.3-22 | Every refused event writes a `rejected/<id>` entry to the view, with no limit | capping or aggregating refusals | A writer can grow every phone's view by sending refused events | Epic 3 |
| S-2.3-23 | `apply` does not read the recorded `invitations/<id>` at join time: any token the creator signed admits, whether or not a `member.invited` was recorded | requiring a recorded invitation | The recorded invitee and end time are only informational | Story 2.5 |
| S-2.3-24 | **Closed in story 2.4.** `CapabilityAuth.verify` accepts a chain, so an invitee could re-delegate their `member/join` token. Now an invitation may only be passed on by a co-treasurer, from their recorded role grant (at most two links); `apply` and the phone check both refuse any other pass-on, and tests cover it | requiring a direct creator-to-person token | None known | Closed |

## Story 2.4 (roles with limits as delegated capabilities)

| ID | Shortcut | Instead of | Cost if it bites | Revisit when |
|---|---|---|---|---|
| S-2.4-1 | A rand limit caps each payment approval; a budget over a period (for example R5000 a month) is not checked | a budget checked against the ledger | A holder can approve many payments each under the limit | Epic 4 (ledger) |
| S-2.4-2 | A role's end is checked against the time the event claims (`apply`) and the device clock ("What can I do?"), so a backdated grant can run longer than the treasurer meant | a time from the record or the Node's clock | A grant can be backdated to outlive its days (same issue as S-2.3-7) | Story 2.5 (the Node checks with its own clock) and 3.6 (log time) |
| S-2.4-3 | No early revoking: a role ends only at its end time, and a second grant replaces the first without withdrawing an older one | revoking a role early | A treasurer cannot cut off a role before it ends | Story 2.6 |
| S-2.4-4 | Only the creator has a "Give a role" screen; a holder can pass on part of their role in the port and the tests, but no screen does it | a screen for holders | A co-treasurer cannot pass a role on from the app | Epic 3 (a real second phone) |
| S-2.4-5 | The payment, delivery and quote abilities are names only: nothing pays, confirms a delivery or offers a quote yet, and "What can I do?" only says allowed or refused | the real actions | A role's abilities show "Allowed" for an action nothing performs | Epics 4 (payment), 5 (delivery), and the quote epic |
| S-2.4-6 | Dates in messages (the "ended on" day, the "starts on" day) are the UTC day, so a user in South Africa can see the day before or after their local day for the first two hours of a day | a local day (`apply` must not read the time zone, AD-6) | A message names the wrong day near midnight | A display layer that formats in the user's zone, outside `apply` |
| S-2.4-7 | The `member/invite` ability is part of the co-treasurer role but nothing checks it: inviting is authorised by the `member/join` chain alone | a separate check of `member/invite` | An unused ability that looks like a control | Epic 3, when an invitation is checked against the record |
| S-2.4-8 | A co-treasurer's invitation is accepted only by a phone whose record holds that co-treasurer's role; a phone that has not synced the role refuses a valid invitation | carrying the role proof inside the invitation | A joiner who has not synced sees "can't be checked" for a good invitation | Epic 3 (sync) |
| S-2.4-9 | The role tokens are kept in the record's view as text, so any member who reads the record holds the tokens of others. Authority is not yet checked by holder signature at the Node | keeping tokens out of the view, or checking the holder's signature | A member could present another member's token to the Node until story 2.5 checks it | Story 2.5, before any role has real effect |
| S-2.4-10 | A role's limit is recorded only in the tokens, not in the `role.granted` payload, so a reader of the event alone does not see the limit | a limit field in the payload | The event alone does not say the limit | Story 2.5 or a payload revision |
| S-2.4-11 | A holder whose chain includes a role that has been replaced (a second grant) keeps the older tokens until they expire | checking the chain against the latest grant | A holder can still pass on under an older grant until it ends | Story 2.6 (revoking) |
| S-2.4-12 | "What can I do?" cannot be tried end to end on one phone: a second person cannot join here (S-2.3-3), so no one can be given a role on the same device. The refusals are covered by tests with simulated phones | a two-phone run | The plain-reason copy is not seen on a device | Epic 3 (a real join between phones) |
| S-2.4-13 | The golden `role.granted` envelope vector was changed to a valid payload (`role`, `grantee`, `expiresAt`), so its id changed; the Python generator is the source | keeping the empty payload as a loose example | Any outside holder of the old vector must regenerate it | Another implementation of the event hash exists |
| S-2.4-14 | The demo `scenario-stokvel` now gives `role.granted` an end time (90 days) to pass the strict payload check; its own role model (node, driver, member) is not the fixed list | migrating the scenario to the fixed list | The demo's roles and this story's roles are two different things | The demo is rebuilt on the community |
| S-2.4-15 | An older, higher grant stays valid until its own end date: a re-grant only replaces the record in the view, and a holder who kept the old token could build a `role.granted` with it as the parent (found in the 2.4 review) | revoking the old token | A role cut back to a lower limit can still be passed on at the old limit until it ends | Story 2.6 (revocation), and story 2.5 must check against the holder's current record, not any valid token |
| S-2.4-16 | Any holder who may give a role can replace another person's recorded role of the same name, including one the creator gave, with a shorter one | letting only the original giver or the creator replace it | A co-treasurer could shorten a 90-day role to 7 days | Story 2.5 or 2.6 |
| S-2.4-17 | A co-treasurer whose role came through another co-treasurer cannot send valid invitations (an invitation chain is at most two links), and "What can I do?" now says so | longer invitation chains | The second co-treasurer's role cannot invite | If deeper delegation of inviting is wanted |
| S-2.4-18 | On the community card a message from "Give a role" stays on screen while a "What can I do?" result shows | clearing it when another action runs | Two messages can show together, one stale | Later polish |

