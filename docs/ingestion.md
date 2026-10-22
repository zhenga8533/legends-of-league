# Data ingestion

`lol-ingest` (in `ingest/`) turns provider data into the canonical files under `data/`. Every
change reaches `main` through a pull request, so a failed or questionable import never touches
published data.

## Pipeline

For each edition selected from [`data/editions.yaml`](../data/editions.yaml):

1. **Fetch.** One snapshot of every Leaguepedia table the edition needs: schedule, games,
   drafts, player stats, rosters, results, team and player metadata. Requests are throttled
   and paged (500 rows per request) and retried with backoff on rate limits.
2. **Normalize** into canonical records with stable IDs. Teams and players not yet in
   `data/entities/` are proposed as new entities in the same PR. Unknown values stay empty:
   Vikings Esports has no tag on Leaguepedia, so its `shortName` is absent rather than guessed.
3. **Validate.**
   - References: every team, player and region exists.
   - Series: the winner matches the score, Bo-N scores are complete, and game winners add up
     to the series score.
   - Games: sides agree with player stats.
   - Completed editions have every result.
   - Errors stop the run before anything is written. Warnings go in the report.
4. **Merge** with the committed edition:

   | Situation                             | Default                     | With `--force` |
   | ------------------------------------- | --------------------------- | -------------- |
   | New record                            | added                       | added          |
   | Changed record, still `provisional`   | updated                     | updated        |
   | Changed record, `verified`            | **blocked**, old value kept | updated        |
   | Record the provider no longer returns | **blocked**, kept           | removed        |

   Records of completed editions are `verified`; records of upcoming or live editions are
   `provisional`. Blocked changes are listed in the report and labelled on the PR.

5. **Write** atomically. The edition is written to a staging directory and swapped into place,
   along with a log in `data/_meta/import-runs/`. Output is deterministic, so re-running against
   unchanged provider data produces no diff and no PR.

## Running locally

Copy `.env.example` to `.env` and fill in a Leaguepedia bot password. Create it at
Special:BotPasswords with the Cargo grant. Anonymous Cargo queries are rate-limited to the
point of being unusable. Then, from `ingest/`:

```sh
uv run --env-file ../.env lol-ingest run --tournament worlds --year 2024 --op dry-run
uv run --env-file ../.env lol-ingest run --tournament worlds --year 2024 --op import
uv run lol-ingest run --op validate   # offline, checks everything committed
```

| Operation  | Fetches                    | Writes |
| ---------- | -------------------------- | ------ |
| `dry-run`  | yes (uses the local cache) | no     |
| `import`   | yes (uses the local cache) | yes    |
| `refresh`  | yes (always re-fetches)    | yes    |
| `validate` | no                         | no     |

Provider responses are cached in `.cache/leaguepedia/`. Delete the folder, or use `refresh`, to
see provider updates. Reports are written to `.cache/reports/report.{md,json}`.

## GitHub Actions

The **Data import** workflow (`.github/workflows/ingest.yml`, manual trigger) takes these
inputs: tournament, year, operation, provider, force (which requires typing a confirmation
phrase), status (only editions with that status) and auto-merge.

- It runs the CLI with the `LEAGUEPEDIA_BOT_*` secrets, without a response cache, so it
  always sees current provider data.
- The report goes to the job summary. Report and raw responses are uploaded as an artifact
  for 30 days.
- For `import` and `refresh` with changes, it opens a PR on `data/<tournament>-<year>-<run>`,
  using the report as the description, and closes older open PRs for the same selection.
- Labels: `data`, plus `blocked-changes` or `modifies-verified` when they apply.

CI runs on PRs opened with the default `GITHUB_TOKEN` wait for approval ("action required"), so
the workflow approves the PR's run once it appears. A run dispatched on the same commit would
not count as the PR's required checks. A GitHub App (the `DATA_BOT_APP_ID` variable and `DATA_BOT_PRIVATE_KEY`
secret) is used instead when configured.

With auto-merge on, the PR merges itself once CI passes, but only if the report's
`autoMergeSafe` is true: no errors, no blocked changes and nothing forced. Anything else waits
for review.

## Live events

An edition being played has `status: live` in `data/editions.yaml`. Its records are imported as
`provisional`, so results filling in, rounds being drawn and places being decided all apply as
ordinary updates.

- Series whose teams aren't decided yet (`TBD` or empty on Leaguepedia) are skipped and listed
  as gaps, and so are placements without a team. They arrive on a later run.
- The **Live sync** workflow (`.github/workflows/live-sync.yml`) runs twice an hour. If any
  edition is live, it calls the import workflow with status `live`, operation `refresh` and
  auto-merge on. Live PRs use the `data/live-<run>` branches and supersede each other.
- Auto-merges are made with the default token, whose pushes don't trigger the deploy workflow,
  so each live sync run also dispatches a deploy when `main` has changed since the last one.
  The site, its live forecast included, is at most about half an hour behind the data.
- When the event is over (every participant placed, every series played), the live import
  sets its status to `completed` in `data/editions.yaml` and re-imports it, so its records are
  promoted to `verified`. That PR is labelled `edition-completed` and never auto-merges: review
  the final results and merge it. The live sync pauses while it is open, so it is not
  superseded. From then on, changes need review like any other verified data. (Setting the
  status by hand and running an import does the same.)

The repository needs **Allow auto-merge** enabled in its settings for live PRs to merge
themselves.

## Organization lineage

Imports create one organization per new team identity, so a rebrand (SK Telecom T1 → T1) starts
out as two organizations. `lol-ingest lineage` fixes that from Leaguepedia's `TeamRenames`
table, following chains through names that never played internationally (Samsung Galaxy →
KSV → Gen.G):

- `rename` and `rebrand` put identities under one organization: the one of the most recently
  named identity. Organizations left without identities are removed.
- `acquire` keeps the organizations apart and records an `acquisition` link on the buyer.
- Other verbs (`partner`) are listed in the report and ignored. The table's misspellings
  (`acuire`, `reband`) and casing are accepted.

Stats count titles and records per organization, so this decides whose history is whose. Run it
after importing editions with new teams: locally with `uv run --env-file ../.env lol-ingest
lineage` (add `--write` to apply), or through the import workflow with operation `lineage`,
which opens a PR for review like any other import.

## Adding an edition

1. Add it to `data/editions.yaml`: stages, the Leaguepedia pages, and how each page's schedule
   tabs map onto stages.
2. Make sure every Leaguepedia region code it uses maps to exactly one region in
   `data/entities/regions.json` for that date. Unmapped codes fail the import.
3. Run a `dry-run`, review the report, then `import`.
4. Add its ruleset under `rulesets/`. For an edition still being played, the replay test checks
   what has been played so far (see `docs/simulation.md`).
