# Data

This directory holds the canonical, reviewed dataset behind Legends of League. It is the single
source of truth for the site and the simulator, and it is licensed under
[CC BY-SA 3.0](LICENSE) because it derives from [Leaguepedia](https://lol.fandom.com/).

Data enters this directory only through pull requests. The ingestion CLI (`ingest/`) produces
them, and they are never edited ad hoc. Manual corrections go in `overrides/` with an author and
reason. See [docs/data-model.md](../docs/data-model.md) for the schema.

Planned layout (populated from milestone M1 onward):

| Path                               | Contents                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `entities/`                        | Regions, organizations, team identities, players, tournaments |
| `tournaments/<tournament>/<year>/` | One directory per edition: stages, series, games, stats, etc. |
| `mappings/`                        | Provider names and IDs mapped to canonical IDs                |
| `overrides/`                       | Reviewed manual corrections, applied after provider data      |
| `_meta/import-runs/`               | Compact log of every import run                               |
