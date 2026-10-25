---
type: epic
title: "Builder layer: agents and generated interfaces"
parent: initiative-ocn
covers: [FR23, FR24, FR25, FR26, AR3, AR13, NFR3, NFR5, UX-DR4]
assignee: ""
risk: high
---

# Builder layer: agents and generated interfaces

## Description

A person describes a workflow in plain language; an agent composes it from platform capabilities with narrower authority than the person; a generated interface appears; the person can save, share and fork it.

## Outcome

For a community member who wants a workflow of their own, one plain-language sentence becomes a working screen with real data that acts only within the member's authority, and a saved screen can be shared and forked.

## Requirements

- FR23: A person can describe a workflow in plain language and an agent composes it from the platform's capabilities.
- FR24: The agent's result is shown as a generated interface built only from an approved component library.
- FR25: A custom solution can be saved, shared with a community and forked.
- FR26: Agents act only with narrower authority than the person, and money actions require human confirmation.
- AR3: Decisions D-1 to D-8 in the architecture are tracked; spike stories end in a decision record.
- AR13: Agents reach platform capabilities only through one OCN Capability MCP server that enforces UCAN on every call (architecture AD-17).
- NFR3: Personal information is minimised (POPIA): the shared record holds keyed commitments, not phone or ID numbers; exact addresses stay on the device.
- NFR5: Secrets (payment, ledger, LLM keys) exist only on the OCN Node; webhooks are signature-verified and replay-safe; agents run in a sandbox.
- UX-DR4: Generated interfaces look and behave like native Shopong screens and cannot reach outside the component library.

## Done when

1. A member describes a workflow in one sentence and sees a screen with real data stream in, with any out-of-library component dropped and a notice shown.
2. A button on a generated screen runs a capability with the member's UCAN, and a money action does not run until the member confirms it.
3. An agent session runs sandboxed with authority narrower than the member's, and a built-in tool such as bash or edit is refused and the attempt is logged.
4. Injected-instruction red-team tests cause no out-of-authority call, no unconfirmed money action and no cross-space data access, and per-space spend and token limits hold.
5. A working solution can be saved, shared, and forked by another community under its own authority.
6. The agent runtime choice is recorded as confirmed or reversed (AD-10, D-9) before the agent stories depend on it.

## Boundaries

The builder layer over the four capabilities (AD-16), not a fifth capability. Not the capabilities themselves (epics 2 to 7), not the first and second demonstrations' flows (epics 8 and 9), and not the operator hardening of the agent sandbox and model routing (epic 12, Operations, privacy and sovereignty hardening), which secures what this epic builds.

## References

- parent — ../initiative-ocn.md
- spec — ../spec-ocn/spec-ocn.md, Functional Requirements FR23 to FR26 and the Additional Requirements cited above
- constraint — ../architecture-ocn/architecture-ocn.md, AD-17 (one OCN Capability MCP server enforces UCAN on every call) and AD-16 (intelligence is a builder layer, not a fifth capability)

## Notes

- Tracer: entry 1, the runtime spike, is the first entry and the thinnest path: one session run against a stub capability MCP server and a local endpoint.
- Waits on epic 2 because: the UCAN authority that agents are narrowed from and that the member's buttons present (2.4, 2.5).
- Waits on epic 3 because: the record that agent actions are appended to and the Hyperdrive that saved solutions are stored in (3.2, 3.7).
- Waits on epic 8 because: a working order flow for the agent to compose screens over, here the pledge and funding progress that the "who still owes" prompt reads (8.4).
- Open question: entry 7 enforces per-space spend and token limits, but the cost caps are built in entry 9, which comes after it in build order; the user decides whether to move entry 9 earlier or to drop the cap check from entry 7.
- Open question: entry 2 needs the capability ports and the event envelope (epic 1, 1.2 and 1.3), and entry 5's "who still owes this month" needs obligations (epic 10); neither epic is in this epic's after, so neither is pinned until the user says whether to declare them.
- Assumption: entry 10, a closing Refactor sweep, was added by default because the epic has more than three entries; declining it is a `Decision:` line.
