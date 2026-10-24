# Shopong

**OCN (Open Commerce Network)** is open, modular infrastructure for connected microeconomies in South Africa: stokvels, spaza shops, street and social sellers, suppliers, drivers and funders. **Shopong** is an Expo app (iOS, Android, web) that is one access point to OCN and its first demonstration. It does not define the platform's limits.

> OCN provides the infrastructure. People define the use.

## The spine

1. **Digital sovereignty**: people choose how they organise, interact, trade and coordinate.
2. **Open, modular infrastructure**: shared capabilities builders combine without a prescribed workflow.
3. **Social economic coordination**: individuals, communities, small businesses, suppliers, drivers and funders connect around real needs.
4. **Trust and accountability**: transparent transactions, verifiable identities, clear obligations, reliable fulfilment.
5. **Stronger microeconomies**: communities gain purchasing power; small businesses gain stock, capital, markets and delivery.

## Capabilities

| Capability       | What it gives people                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Identity**     | Verifiable identities and the authority to act for a group                         |
| **Data**         | A transparent, replicated shared record that works offline                         |
| **Finance**      | Collect, hold, pay and reconcile money, including pooled funds                     |
| **Logistics**    | Where goods are, how they get there, proof they arrived                            |
| **Intelligence** | The builder layer: AI agents and generated interfaces composed over the other four |

## Repository layout

```
apps/                     runnable apps (Shopong client, web console, OCN Node) — coming
packages/                 shared libraries, published as @shopong/*
docs/source/              original inputs: project spine, technology-stack diagram, links
_bmad-output/             planning artifacts (brief, architecture, epics) and sprint status
_bmad/, .claude/skills/   BMAD method install used to plan and deliver stories
AGENTS.md                 rules and delivery protocol for contributors and coding agents
```

## Getting started

Requires Node 24 or later and pnpm (pinned in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm run ci    # lint and format check, type check, tests, build
```

## Docs

- [Product brief](_bmad-output/planning-artifacts/product-brief-ocn.md)
- [Architecture](_bmad-output/planning-artifacts/architecture.md)
- [Technology register](_bmad-output/planning-artifacts/technology-register.md)
- [Epics and stories](_bmad-output/planning-artifacts/epics.md)
- [Contributor and agent rules](AGENTS.md)

## License

To be decided.
