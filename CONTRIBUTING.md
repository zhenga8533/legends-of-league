# Contributing

## Workflow

- Branch from `main` using `feat/…`, `fix/…`, `docs/…` or `data/…`. Pull requests are
  squash-merged, and `main` is protected.
- Write commit messages and PR titles as [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(sim): add Swiss pairing`, `fix(ingest): …`, `data(worlds-2024): …`).
- Every PR must pass CI and describe what changed, why, and how it was tested.

## Code

- TypeScript is strict. ESLint and Prettier must pass (`pnpm lint`, `pnpm format:check`).
- Python must pass ruff (lint and format), `mypy --strict` and pytest.
- **The schema has a single source of truth.** Edit the Pydantic models in
  `ingest/src/lol_ingest/models/`, then run `pnpm schema:gen` and commit the regenerated files
  under `packages/schema/`. Never edit them by hand. CI fails on drift.
- Behaviour changes need tests that follow the patterns already in place.

## Data

- Everything in `data/` is CC BY-SA 3.0. Contribute only data you are allowed to release under
  that license.
- Never hand-edit provider-derived records. Fix them upstream (on Leaguepedia), or add a reviewed
  correction in `data/overrides/` with an author and reason.
- Previously verified records must never change silently. PRs that modify or remove them need
  explicit review.

## Secrets

Never commit credentials. Ingestion credentials are read from environment variables locally and
from GitHub Actions secrets in CI.
