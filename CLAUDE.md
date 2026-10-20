# Legends of League

A static archive and simulator for international LoL tournaments. The plan and roadmap are in
`docs/plan.md`, and architecture decisions are in `docs/adr/`.

## Layout

- `apps/web`: Astro static site (GitHub Pages). Build links with `withBase()` from
  `src/lib/paths.ts`, because the site is served under a base path.
- `packages/schema`: generated TS types and JSON Schema. **Never edit by hand.**
- `ingest`: Python (uv) CLI `lol-ingest`. Its Pydantic models in `src/lol_ingest/models/` are the
  schema source of truth.
- `data`: canonical dataset (CC BY-SA 3.0). Changes arrive only through ingestion PRs or
  `data/overrides/`.

## Commands

- `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`
- `pnpm schema:gen` after any model change, and `pnpm schema:check` to verify there is no drift
- In `ingest/`: `uv run ruff check`, `uv run ruff format --check`, `uv run mypy`, `uv run pytest`

## Conventions

- Canonical IDs are prefixed slugs (`team:skt-t1`, `player:faker`). Never use provider row IDs or
  display names as keys. Provider IDs go in `externalRefs`.
- JSON field names are camelCase; Python attributes are snake_case through Pydantic aliases.
- Simulation output never goes into `data/` and must always be visually labelled as simulated.
- Never fabricate historical data. Mark missing or unverified records explicitly.
- pnpm refuses package versions published less than 7 days ago (`minimumReleaseAge`).
