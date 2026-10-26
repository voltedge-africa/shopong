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
| S-2.3-7 | The joiner checks expiry with the device clock, and `apply` trusts the event's own `claimedAt` | a log time checked against the record | A wrong or forged clock can stretch or shrink an invitation | Story 3.6 (log time) |
| S-2.3-8 | The community key is random 64-hex, not the Autobase key | the real record's key | Epic 3 has to map one to the other | Epic 3 |
| S-2.3-9 | No roles: the creator is the only inviter, and members get `member/join` only | roles with limits | A treasurer cannot delegate inviting | Story 2.4 |
| S-2.3-10 | An invitation link opened while the PIN screen is up is not resumed after unlock | remembering the link | The person pastes the code again | Later polish |
| S-2.3-11 | Sharing the full DID uses React Native's built-in `Share`, with selectable text as the fallback | a clipboard library | A share sheet may be missing on web | A clipboard dependency is accepted |
