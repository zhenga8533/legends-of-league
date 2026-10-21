# Legends of League

An archive of every international League of Legends tournament (Worlds, the Mid-Season
Invitational and First Stand), plus a simulation engine for replaying history and forecasting
what comes next.

> **Status:** the archive covers every completed Worlds, MSI and First Stand (M4); the Simulation Studio (M5) is next. See the
> [implementation plan](docs/plan.md) for the roadmap.

## Repository layout

| Path              | What it is                                                            |
| ----------------- | --------------------------------------------------------------------- |
| `apps/web`        | Astro static site, deployed to GitHub Pages                           |
| `packages/schema` | TypeScript types and JSON Schema generated from the Python models     |
| `packages/sim`    | Tournament simulation engine (formats, Elo, Monte Carlo, replays)     |
| `packages/data`   | Loaders for the dataset and rulesets; replay and calibration tests    |
| `rulesets`        | Tournament format definitions, verified by replaying history          |
| `ingest`          | Python CLI (`lol-ingest`) that fetches, normalizes and validates data |
| `data`            | Canonical dataset (CC BY-SA 3.0)                                      |
| `docs`            | Plan, data model and architecture decision records                    |

## Getting started

Requirements: Node 24 (see `.nvmrc`) with corepack enabled, Python 3.12 and
[uv](https://docs.astral.sh/uv/). A devcontainer is provided as an alternative.

```sh
corepack enable
pnpm install
(cd ingest && uv sync)

pnpm dev                          # site at http://localhost:4321
uv run --project ingest lol-ingest --help
```

Importing data needs a Leaguepedia bot password; see [docs/ingestion.md](docs/ingestion.md).

### Checks

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm schema:check                 # generated schema/types match the Pydantic models
pnpm --filter @lol/web exec playwright install chromium   # once
pnpm --filter @lol/web test:e2e   # smoke + axe accessibility tests against the build

cd ingest
uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest
uv run lol-ingest run --op validate   # committed data is consistent
```

## Licensing

- Code: [MIT](LICENSE)
- Data in `data/`: [CC BY-SA 3.0](data/LICENSE), derived from
  [Leaguepedia](https://lol.fandom.com/)

Legends of League is a fan project and is not endorsed by or affiliated with Riot Games.
