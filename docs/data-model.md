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

## Entities (`data/entities/`)

| File                 | Model          | Purpose                                                                                 |
| -------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `regions.json`       | `Region`       | A region during one era, mapped from provider region codes by date. Curated by hand.    |
| `tournaments.json`   | `Tournament`   | A tournament series (Worlds, MSI, First Stand). Curated by hand.                        |
| `organizations.json` | `Organization` | The persistent org. `lineage` records acquisitions, mergers and spin-offs between orgs. |
| `teams.json`         | `TeamIdentity` | An org's name, tag and region over a `DateRange` (SKT T1 → T1).                         |
| `players.json`       | `Player`       | Stable ID with handle history, real and native name, and ISO country.                   |

Imports propose new organizations, teams and players. Review them in the PR. In particular,
merge organizations by hand when a team rebranded, because the importer never guesses lineage.

## Per-edition records (`data/tournaments/<tournament>/<year>/`)

| File                | Contents                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `edition.json`      | Name, status, dates, stages, and participants with their region at the time and entry stage. |
| `series.json`       | Series: stage, round, best-of, teams, score, winner, start (UTC), patch, MVP.                |
| `games.json`        | Games: blue/red, winner, duration, patch, and the draft (bans and picks in order).           |
| `player-stats.json` | One row per player per game: champion, role, KDA, gold, CS, damage, vision, build, runes.    |
| `rosters.json`      | Registered roster entries (players and coaches) per team.                                    |
| `results.json`      | Final placements (`placeFrom`/`placeTo` for shared places) and prize money in USD.           |
| `provenance.json`   | Per record: provider, source reference, content hash, import run and status, plus gaps.      |

List files hold one record per line, sorted by record key, so a data PR's diff shows exactly
which records changed. Generated IDs follow the edition and the source schedule, for example
`ser:worlds-2024-swiss-round-3-04` and `game:worlds-2024-knockout-finals-01-g5`.

### Record status and gaps

- `verified`: imported for a completed edition. Provider changes to it are blocked until a
  forced import (see [ingestion.md](ingestion.md)).
- `provisional`: imported while an edition is upcoming or live. Updates apply freely.
- `gaps` in `provenance.json`: data the edition should have but the provider lacks, such as
  missing drafts or player stats.

### Not yet modelled

- Seeds and qualification paths. Leaguepedia has no structured table for them, so they will be
  curated alongside the rulesets in M2.
- Champions as entities. Champions are stored by name for now.
