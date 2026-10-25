---
type: epic
title: "Operations, privacy and sovereignty hardening"
parent: initiative-ocn
covers: [FR27, FR28, NFR2, NFR3, NFR5, NFR7, NFR8, NFR9, AR8, UX-DR3]
assignee: ""
risk: high
---

# Operations, privacy and sovereignty hardening

## Description

A community or organisation can self-host, recover from loss, show it respects privacy law and performs on the devices people have.

## Outcome

For a community or organisation that runs its own OCN Node, the platform can be run, restored and monitored without the vendor, and it performs on low-end Android, so the signal is a clean self-hosted install that passes its smoke test and restores to the same balances.

## Requirements

- FR27: A community or organisation can self-host an OCN Node and its services.
- FR28: Keys, the record and the ledger mapping can be backed up and recovered after device loss.
- NFR2: The Shopong app meets a memory, battery and data budget on a low-end Android baseline (to be fixed with decision D-6).
- NFR3: Personal information is minimised (POPIA): the shared record holds keyed commitments, not phone or ID numbers; exact addresses stay on the device.
- NFR5: Secrets (payment, ledger, LLM keys) exist only on the OCN Node; webhooks are signature-verified and replay-safe; agents run in a sandbox.
- NFR7: Operators can see replication lag, webhook failures, queue depth and reconciliation status.
- NFR8: Third-party licences and attributions (OSM ODbL, Valhalla notices, Apache/MIT) are tracked and shipped.
- NFR9: Flows are usable with low data cost and in low-connectivity conditions.
- AR8: The web console's CSP allows `'wasm-unsafe-eval'` and `blob:` workers on its own origin only.
- UX-DR3: A low-data mode and clear offline indicators ("saved on your phone, will sync").

## Done when

1. Following the operator guide on a clean machine starts the Node, tile host, laya-serve and optional GPU services, passes a smoke test, and keeps every secret out of the repo.
2. A restored Node and a member's new phone show the same record, identity and balances as before, and the ledger rebuilt from record events matches Ledfra.
3. An operator is alerted, naming the space and event id, when a webhook fails, a queue stalls or replication lags past its threshold.
4. Each demonstration flow meets the start-up, memory, battery and data budgets on the baseline device, and low-data mode defers photos and large files.
5. Every personal-data field has a classification with its lawful basis, retention and deletion approach, and the licence register fails CI on an unregistered licence.

## Boundaries

This epic hardens what epics 1 to 11 build and adds no product features. It is not the features themselves, not the agent runtime or its authority (epic 11, Builder layer), and not the ledger or payment behaviour (epic 4, Pooled money), which it tests, backs up and monitors.

## References

- parent — ../initiative-ocn.md
- spec — ../spec-ocn/spec-ocn.md, Functional Requirements FR27 and FR28, and the Non-Functional and Additional Requirements cited above
- constraint — ../architecture-ocn/architecture-ocn.md, AD-3 (the OCN Node is the only writer to Ledfra, Stitch and the stablecoin adapter, so credentials stay off devices) and section 7 (POPIA, keys, webhooks, supply chain, CSP)

## Notes

- Tracer: entry 1, the self-host kit, is the first entry and the thinnest path: a clean machine runs the Node and passes a smoke test.
- Waits on epic 1 because: the ports and contract suites it hardens, the CI it extends, and the Node configuration and secrets it runs with (1.1, 1.2, 1.5).
- Waits on epic 2 because: the identity recovery and revocation it tests, and the keyed commitments the POPIA review classifies (2.6, 2.7).
- Waits on epic 3 because: the replicated record it backs up, monitors and runs in the console (3.2, 3.5, 3.8).
- Waits on epic 4 because: the ledger and payments it secures, reconciles and restores (4.2, 4.5).
- Waits on epic 5 because: the stablecoin adapter and its keys that the security review covers (5.2).
- Waits on epic 6 because: the OCR and Laya services the self-host kit packages (6.2, 6.5).
- Waits on epic 7 because: the tile build and hosting the kit runs, and the OSM and Valhalla notices the register lists (7.2).
- Waits on epic 8 because: the first demonstration's flows whose per-flow budgets are measured (8.7).
- Waits on epic 9 because: the second demonstration's flows whose per-flow budgets are measured (9.6).
- Waits on epic 10 because: the reconciliation status that the observability alerts report (10.3).
- Waits on epic 11 because: the agent sandbox that the security review checks (11.3).
- Open question: entries 3 and 6 need a person to do part of the work (a data-protection review of lawful basis and an independent security review); no one is named for either, so the user decides who does them.
- Unknown: the low-end Android baseline device is not yet fixed (decision D-6); entry 5 waits on it before its budgets can be set.
- Assumption: UX-DR3 (low-data mode and offline indicators) is delivered by entry 5 with the low-end Android and data budgets; placed here because the spec does not map it to an epic.
- Assumption: entry 8, a closing Refactor sweep, was added by default because the epic has more than three entries; declining it is a `Decision:` line.
