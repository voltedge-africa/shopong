---
id: 1
type: story
title: "Runnable Shopong app shell and CI"
parent: epic-walking-skeleton-and-capability-seams
covers: [AR2]
after: []
refined: false
hitl: false
risk: low
---

# Runnable Shopong app shell and CI

## Description

Sets up the monorepo with the Expo universal Shopong app, the OCN Node service and CI, so every later story lands in a tested, runnable shell.

As a builder,  
I want a monorepo with an Expo universal Shopong app, an OCN Node service and CI,  
So that every later story lands in a tested, runnable shell.

## Acceptance Criteria

1. **Given** a fresh clone
   **When** I run the documented install and start commands
   **Then** the Shopong app opens on iOS simulator, Android emulator and web with a signed-out home screen
   **And** the OCN Node starts and reports healthy on a local port.
2. **Given** a pull request
   **When** CI runs
   **Then** lint, type-check and unit tests run for app, node and shared packages
   **And** dependency versions are pinned by lockfile (including `@duckdb/duckdb-wasm`).

## References

- parent — _bmad-output/initiative-ocn/epic-walking-skeleton-and-capability-seams/epic-walking-skeleton-and-capability-seams.md
