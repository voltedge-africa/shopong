---
title: "Runnable Shopong app shell and CI"
ticket: 1
status: done
---

## Story and acceptance criteria

As a builder,
I want a monorepo with an Expo universal Shopong app, an OCN Node service and CI,
So that every later story lands in a tested, runnable shell.

**Acceptance Criteria:**

**Given** a fresh clone  
**When** I run the documented install and start commands  
**Then** the Shopong app opens on iOS simulator, Android emulator and web with a signed-out home screen  
**And** the OCN Node starts and reports healthy on a local port.  

**Given** a pull request  
**When** CI runs  
**Then** lint, type-check and unit tests run for app, node and shared packages  
**And** dependency versions are pinned by lockfile (including `@duckdb/duckdb-wasm`).  
