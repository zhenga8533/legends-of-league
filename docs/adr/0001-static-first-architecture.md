# ADR 0001: Static-first architecture with data in git

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The platform must archive every international LoL tournament, with picks/bans and player stats,
and run tournament simulations. It is a personal open-source project, so running costs and
operational burden should stay close to zero. Historical data must never be silently
overwritten, and every change should be reviewable.

## Decision

- Canonical data lives as deterministic JSON files in `data/`, committed to git. Every change
  arrives through a pull request, which serves as the transaction boundary and the audit log.
- Python (`ingest/`) fetches data from providers and normalizes and validates it into those files.
- The site is a static Astro build deployed to GitHub Pages, with no server and no database.
- The simulation engine is TypeScript. It runs in the browser (Web Workers) for interactive use
  and in Node at build time for precomputed odds.
- Pydantic models are the single schema source. JSON Schema and TS types are generated from
  them, and CI checks for drift.

## Consequences

- Hosting is free, and there is no backend to secure or operate.
- Features that need server state (accounts, shared leaderboards) need a separate backend later.
- Scenarios are shared through the URL and JSON export rather than stored on a server.
- The repository size grows with the dataset. Estimates for all international events, including
  player stats, are well within GitHub limits. Raw provider responses are cached outside git.
