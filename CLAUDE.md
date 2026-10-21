# Legends of League

A static archive and simulator for international LoL tournaments. The plan and roadmap are in
`docs/plan.md`, and architecture decisions are in `docs/adr/`.

## Layout

- `apps/web`: Astro static site (GitHub Pages). Build links with `withBase()` from
  `src/lib/paths.ts`, because the site is served under a base path. Pages read the archive at build
  time through `src/lib/archive.ts`. Brackets and stage views come from the engine's verified
  replays (`editionStages`), not from provider labels. Pagefind indexes pages marked `searchable`.
  Matches and stages render with the React `components/board/` (static on archive pages, interactive
  in the Simulation Studio, `src/studio/`, a `client:only` island with a Web Worker).
- `packages/schema`: generated TS types and JSON Schema. **Never edit by hand.**
- `packages/sim`: pure TS simulation engine (no DOM, no I/O, seeded `Rng` only). See `docs/simulation.md`.
- `packages/data`: Node loaders for `data/` and `rulesets/`, plus adapters into engine inputs. Its tests
  replay every imported edition against its ruleset.
- `rulesets/*.json`: per-edition tournament formats. Every imported edition needs one, verified by replay.
- `ingest`: Python (uv) CLI `lol-ingest`. Its Pydantic models in `src/lol_ingest/models/` are the
  schema source of truth.
- `data`: canonical dataset (CC BY-SA 3.0). Provider-derived records change only through
  ingestion PRs (`docs/ingestion.md`). `editions.yaml`, `entities/regions.json` and
  `entities/tournaments.json` are curated by hand.

## Commands

- `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`
- E2E and accessibility (axe, light and dark, desktop and mobile): `pnpm --filter @lol/web build`, then
  `pnpm --filter @lol/web test:e2e`. Needs `playwright install chromium` once.
- `pnpm schema:gen` after any model change, and `pnpm schema:check` to verify there is no drift
- In `ingest/`: `uv run ruff check`, `uv run ruff format --check`, `uv run mypy`, `uv run pytest`
- Imports, from `ingest/`: `uv run --env-file ../.env lol-ingest run --tournament worlds --year 2024 --op dry-run`
  (operations `import|refresh|validate|dry-run`). `--op validate` is offline and runs in CI.
- Tests never hit the network. Leaguepedia fixtures live in `ingest/tests/fixtures/`.

## Conventions

- Canonical IDs are prefixed slugs (`team:skt-t1`, `player:faker`). Never use provider row IDs or
  display names as keys. Provider IDs go in `externalRefs`.
- JSON field names are camelCase; Python attributes are snake_case through Pydantic aliases.
- Simulation output never goes into `data/` and must always be visually labelled as simulated.
- Never fabricate historical data. Leave unknown fields empty and record gaps in provenance.
- Leaguepedia quirks: Cargo returns `Foo_Bar` fields as `Foo Bar` (the client aliases them),
  caps results at 500 rows (the client pages them), and matches strings case-insensitively,
  so tables link the same page with different casing (`EasyLove`/`Easylove`). `Teams.Region`
  is the team's current region; use `TournamentRosters.Region` for the historical one.
- pnpm refuses package versions published less than 7 days ago (`minimumReleaseAge`).
