# Data model

The source of truth is the Pydantic models in `ingest/src/lol_ingest/models/`. The generated
[JSON Schema](../packages/schema/json/canonical.schema.json) and
[TypeScript types](../packages/schema/src/generated.ts) are derived from them with
`pnpm schema:gen`.

## Principles

- **Our own stable IDs.** Every record has a prefixed slug (`region:lck`, `org:t1`,
  `team:skt-t1`, `player:faker`, `tour:worlds`). Provider identifiers are stored only in
  `externalRefs`, because Leaguepedia regenerates its Cargo row IDs and names change over time.
- **Historical accuracy.** Records point at what existed _at the time_: the team identity, the
  region, and the ruleset of that year.
- **Explicit gaps.** Missing or unverified data is marked, never invented.
- **camelCase JSON.** Python uses snake_case attributes with camelCase aliases.

## Entities (implemented)

| Model          | Purpose                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `Region`       | A region during one era. Splits and merges are linked through `predecessors` / `successors`. |
| `Organization` | The persistent org. `lineage` records acquisitions, mergers and spin-offs between orgs.      |
| `TeamIdentity` | An org's name, tag and region over a `DateRange` (SKT T1 → T1).                              |
| `Player`       | Stable ID with a dated history of handles.                                                   |
| `Tournament`   | A tournament series (Worlds, MSI, First Stand). Individual years are editions.               |

## Per-edition records (milestone M1)

Edition, stage, series, game (with picks/bans), per-player game stats, rosters, results and
provenance. These will be modelled against real Leaguepedia data in M1. See section 3 of
[plan.md](plan.md).
