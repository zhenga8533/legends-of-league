# Legends of League — Implementation Plan

## Context

`plan.md` describes **Legends of League** (`legends-of-league`): an open-source platform that does two things:

- **Archive.** It holds every international League of Legends tournament, starting with Worlds (2011–), MSI (2015–) and First Stand (2025–). It should be easy to add other events later.
- **Simulator.** It can replay, change or forecast those tournaments.

The repo is empty apart from `plan.md` and `.gitattributes`. The local toolchain has Node 22.20, Python 3.12.10 and Docker 29. pnpm is not installed; we'll enable it through corepack.

### Decisions made so far

| Topic | Decision |
|---|---|
| Hosting | Static site on **GitHub Pages**. No server and no database. |
| Data storage | Curated, versioned **JSON files in the repo**. They are the single source of truth. |
| Languages | **Python** fetches, normalizes and validates data into static files. **TypeScript** for the site and the simulation engine, which runs in the browser and in Node for CI and precomputed batches. |
| Frontend | **Astro + React islands**. |
| Accounts | None in the MVP. Saves are local, and sharing works through a URL or JSON export. |
| MVP data depth | Everything, including picks/bans and per-player game stats. |
| Live events | In the MVP. |
| Data sources | **Leaguepedia** is the primary source. The **lolesports** API is a secondary source for live events and cross-checks. |
| Data landing | Every change arrives as a **PR**. During live events, PRs that only *add* records auto-merge. |
| Licensing | **MIT** for code. **CC BY-SA 3.0** for `data/`, with Leaguepedia credited. |

---

## 1. Data source findings (checked live on 2026-10-20)

| Source | Type | Coverage | Access | License / policy | Role |
|---|---|---|---|---|---|
| **Leaguepedia** Cargo API (`lol.fandom.com/api.php?action=cargoquery`) | Community wiki with a structured, SQL-like API | All of 2011–2026. Series, games, picks/bans (`PicksAndBansS7`), per-player stats (`ScoreboardPlayers`), rosters, results, team/player redirects | Without a login, Cargo queries hit the rate limit immediately. A **bot password plus a confirmed email** is required. No numeric limit is published. Clients: `mwrogue`/`mwcleric` | CC BY-SA 3.0. "Not an official Riot resource." Cargo row IDs are **not stable** | **Primary** |
| **lolesports** persisted API (`esports-api.lolesports.com`) | Unofficial, undocumented Riot endpoint that uses a public key | Worlds 2011, 2014–16 and 2020–26. MSI 2015–16 and 2021–26. First Stand 2025–26. **Missing:** Worlds 2012–13 and 2017–19, MSI 2017–19 | Public key. `getStandings` returns brackets and series results | Not a "supported service" under Riot's developer policy, so it's a grey area | **Secondary**: live schedule and results, cross-checks. Labelled as unofficial |
| Oracle's Elixir | Downloadable CSVs (2014–) | Detailed per-game stats | Behind a Cloudflare challenge, so automated downloads aren't practical | Non-commercial use only | Not used in the MVP. Possible future cross-check |
| Games of Legends (gol.gg) | HTML only | Broad | Would need scraping | No terms page found | Avoid |
| Liquipedia | Wiki API / LPDB | Broad | MediaWiki API: 1 request per 2 s. LPDB needs an approved key, 60 requests per hour | CC BY-SA 3.0 | Possible gap-filler later |
| GRID, PandaScore | Commercial | — | Paid only for LoL history | Commercial | Excluded |

**Still unverified** (to confirm in milestone M1):
- Whether queries succeed once logged in to Leaguepedia, and what throughput we get.
- The exact Fandom terms of use, which wouldn't load during research.
- Whether the lolesports `getEventDetails` endpoint and the livestats feed have per-game detail for live events.

---

## 2. Architecture

**One monorepo**, with a pnpm workspace for TypeScript and a uv project for Python. There are no services. Everything is built into static files.

```
Leaguepedia ─┐                        ┌─> data/ (canonical JSON, CC BY-SA)
lolesports  ─┴─> ingest/ (Python) ────┤        │
                fetch → map → normalize│        ├─> packages/sim (TS)  ─> precomputed odds (build time)
                → validate → diff ─────┘        └─> apps/web (Astro)  ─> GitHub Pages
                       │                                  └─ Simulation Studio: sim in Web Workers
                       └─> PR + import report (GitHub Actions)
```

### Repository layout

```
legends-of-league/
├─ apps/web/                 Astro site with React islands (brackets, charts, Studio)
├─ packages/
│  ├─ schema/                TS types + JSON Schema generated from the Python models (never hand-edited)
│  ├─ data/                  Typed loaders and query helpers over data/ (build-time only)
│  └─ sim/                   Pure TS simulation engine: no DOM, no I/O, seeded RNG
├─ ingest/                   Python package `lol_ingest` (uv)
│  ├─ src/lol_ingest/
│  │  ├─ models/             Pydantic canonical models (THE schema source of truth)
│  │  ├─ providers/          leaguepedia.py, lolesports.py (one shared Provider interface)
│  │  ├─ identity/           Maps source names/IDs to canonical IDs
│  │  ├─ normalize/          Converts provider records into canonical records
│  │  ├─ validate/           Schema and integrity checks, plus ruleset consistency
│  │  ├─ diff/               Classifies changes; detects conflicts
│  │  ├─ report/             Markdown/JSON import summaries
│  │  └─ cli.py              `lol-ingest …`
│  └─ tests/                 pytest with recorded provider fixtures (no network in CI)
├─ data/                     CC BY-SA 3.0 — see §3
├─ rulesets/                 Versioned, data-driven tournament format definitions
├─ docs/                     Architecture, data model, ADRs, contributing, data provenance
├─ .github/workflows/        ci, deploy, ingest, live-sync
├─ LICENSE (MIT), data/LICENSE (CC BY-SA 3.0), README, CONTRIBUTING, CLAUDE.md
```

### Why this shape

- **Static-first.** It costs nothing, has nothing to operate, and every data change is a diff someone can review in git.
- **Schema contract.** Pydantic models are the single source of the schema. They export JSON Schema, and `json-schema-to-typescript` turns that into the TS types. CI fails if the generated files drift from the models.
- **Engine separation.** `packages/sim` has no dependency on the web app or on ingestion. It consumes plain typed data plus a ruleset.

---

## 3. Data model (canonical JSON)

**IDs.** We mint our own stable, readable slugs, for example `org:samsung-galaxy`, `player:faker`, `ed:worlds-2024` and `ser:worlds-2024-swiss-r3-07`.
- Leaguepedia and lolesports identifiers are stored only as `externalRefs`.
- Display names are never used as keys.

**Entities** (global, in `data/entities/`):

| Entity | What it holds |
|---|---|
| `Region` | Region ID plus active era (e.g. LMS, PCS, LTA, LCS) and parent/successor links, so splits and merges can be represented. |
| `Organization` | The persistent org. `lineage` links cover acquisitions and rebrands (e.g. Samsung Galaxy → KSV → Gen.G). |
| `TeamIdentity` | An org's name, tag, logo and region over a date range (SKT T1 → T1). Each historical record points at the identity that was valid *at that time*. |
| `Player` | Stable ID with a dated history of handles and names. |
| `Tournament` | The series itself: Worlds, MSI, First Stand, and later All-Star, Rift Rivals, IWCI, etc. |

**Per edition** (`data/tournaments/<tournament>/<year>/`):

| File | Contents |
|---|---|
| `edition.json` | Dates, venues, ruleset reference, participants (team identity, region at the time, seed/qualification path), and a status of `completed`, `live` or `upcoming`. |
| `stages.json` | Stages, then groups or brackets, then rounds. The structure is generated by the ruleset and confirmed against the source. |
| `series.json` | Series: stage/round, teams, best-of, score, winner, date, side selection. |
| `games.json` | Games: side, winner, duration, patch, picks/bans in order. |
| `player-stats.json` | One row per game per player: champion, role, K/D/A, gold, CS, damage, vision, etc. |
| `rosters.json` | Who was on each team's registered roster, with role and start/end. |
| `results.json` | Final placements. |
| `provenance.json` | For each record: source, source reference, `fetchedAt`, content hash, import run ID, and a **status** of `verified`, `provisional`, `unverified`, `missing` or `conflicting`. |

**Corrections and audit trail:**
- `data/overrides/*.yaml` holds manual, reviewed corrections. Each has an author and reason, and they are applied after provider data. This is how "versioned corrections" work.
- `data/_meta/import-runs/*.json` holds a compact log of every import run.

**Rulesets** (`rulesets/worlds/2023-swiss.json`, …) describe a pipeline of stages built from format primitives (listed in §5), with per-match series-length rules and tiebreaker policies. Editions reference a ruleset by ID and version, so a new format means a new ruleset file and no code change. The exception is a genuinely new primitive.

**Simulation entities** (`SimulationScenario`, `SimulationResult`) are TS-only types. They are never written to `data/`. This is part of keeping simulated and real results strictly apart.

---

## 4. Ingestion and GitHub Actions

### CLI

```
lol-ingest run --tournament worlds|msi|first-stand|all --year 2024|all \
               --op import|refresh|validate|dry-run --provider auto|leaguepedia|lolesports [--force]
```

### Pipeline (per edition)

1. **Fetch.** Calls are rate-limited with retries and backoff. Raw responses are cached to `.cache/` and uploaded as a workflow artifact. They are not committed, but their hash is recorded.
2. **Map identities.** Source names are resolved through `data/mappings/*.yaml` (Leaguepedia redirects plus our own aliases).
   - An unknown team or player **fails loudly**, and the run proposes a new entity in the PR.
   - Matching is never fuzzy and never silent.
3. **Normalize** into canonical records, then apply `overrides/`.
4. **Validate:**
   - Schema checks.
   - Series score equals the game winners.
   - Rostered players appear in the player stats.
   - No duplicate games.
   - Dates fall within the edition.
   - **Ruleset replay:** feeding the actual results through the ruleset must reproduce the recorded standings and bracket advancement.
5. **Diff** against what is committed:
   - Changes are classified as `added`, `modified` or `removed`.
   - A change to a `verified` record is **never applied automatically**. It becomes a conflict entry. With `--force` it is applied, but always lands in a PR labelled `modifies-verified`.
   - Removals are never applied automatically.
6. **Write atomically.** Output goes to a temp directory and replaces the edition directory only if every check passed. The PR is the transaction boundary, so `main` never gets partial data.
7. **Report.** A Markdown summary covers counts, conflicts, missing fields and coverage, and is used as the PR body.

**Idempotency.** Output is serialized deterministically (sorted keys and arrays, stable IDs). Re-running on unchanged sources produces no diff, and so no PR.

### Workflows

| Workflow | Trigger | Behaviour |
|---|---|---|
| `ci.yml` | PR, push | Python: ruff, mypy, pytest. TS: eslint, prettier, tsc, vitest. Also: schema drift check, `lol-ingest validate --all`, sim regression and statistical tests, Astro build, Playwright smoke + axe. |
| `ingest.yml` | `workflow_dispatch` (inputs: tournament, year, operation, provider, force + a confirmation string when force is on) | Validates inputs, runs the CLI, then creates or updates the PR branch `data/<tournament>-<year>` (no PR if nothing changed). `concurrency: ingest-<t>-<y>`. Uploads the report and raw cache as artifacts. |
| `live-sync.yml` | `schedule` every 20–30 min, but does nothing unless `data/live.json` lists an event inside its active window | Refreshes the live edition from lolesports and Leaguepedia. If validation passes **and** the diff only adds records, it enables auto-merge (`gh pr merge --auto`, gated by required CI). Otherwise it leaves the PR for review. |
| `deploy.yml` | Push to `main` | Builds the site, precomputes simulation odds (cached by a hash of the data and engine), and deploys with `actions/deploy-pages`. |

**Secrets and permissions:**
- Secrets are `LEAGUEPEDIA_BOT_USER` and `LEAGUEPEDIA_BOT_PASSWORD`, plus a **GitHub App token** used to open PRs. PRs created with the default `GITHUB_TOKEN` don't trigger CI, which would block auto-merge.
- Each workflow gets the least `permissions:` it needs.
- Branch protection on `main` requires CI to pass.

**Cost.** Actions minutes are free for public repos. The live cron only runs during event windows.

---

## 5. Simulation engine (`packages/sim`)

The engine is built in layers. Each layer is pure, deterministic and covered by tests.

1. **RNG.** A seeded PRNG (e.g. xoshiro128**). `Math.random` is banned by a lint rule. Every scenario stores its seed.
2. **Matchup model.** An interface `pGame(a, b, ctx) → probability`.
   - **MVP model:** game-level **Elo**.
     - Ratings come from international games plus region-strength offsets learned from cross-region results.
     - Ratings decay toward the region mean between events.
     - Values are user-adjustable, and a "coin flip" or flat-probability mode is available.
   - **Why Elo:** it is easy to explain ("T1 62% vs BLG"), easy to backtest, and needs only the data we will have.
   - **Later models:** Glicko-2 or Bradley–Terry with time decay. Those need domestic-league results to be well calibrated (see the open questions).
3. **Series.** Bo1, Bo3 and Bo5 from per-game probabilities. The pluggable side-selection rule is a no-op in the MVP.
4. **Format primitives:**
   - Round robin (single or double, Bo1/Bo3, constraints on regions per group).
   - Standings tiebreakers: series wins, game wins, head-to-head mini-tables, Bo1 tiebreaker games, and seeding of those games by victory time or coin flip.
   - GSL groups.
   - Linked qualifier series.
   - Single elimination: byes, best-of per round, seeding constraints (same group/region on opposite halves, random draw).
   - 8-team double elimination.
   - Swiss: 3 wins advance / 3 losses eliminated, pool-based round 1 with region protection, same-record draws with rematch avoidance (backtracking), Bo3 when advancement or elimination is at stake.
   - Knockout seeding from Swiss records.
   - Multi-stage pipelines with entry points at different stages.
5. **Ruleset interpreter.** Turns the ruleset JSON plus participants into a stage graph.
6. **Tournament state.** Each match is `actual`, `user-picked` or `simulated`. Any subset can be locked, and the rest is simulated. This one mechanism supports historical replays, "what if" changes, and forecasting the rest of a live event.
7. **Monte Carlo runner.** Batch runs aggregate championship, advancement and placement distributions. Runs happen in Web Workers in the browser and in Node for precomputation.

**Keeping simulated and real apart:**
- Sim output uses distinct types.
- The UI shows a persistent "SIMULATED" treatment (badge, pattern and colour), and never mixes simulated output into archive pages except in an explicit comparison view.

**Engine tests:**
- Unit tests for every primitive and tiebreaker.
- **Historical replay fixtures:** every edition's actual results must reproduce its real standings and bracket.
- Property tests with fast-check, e.g. Swiss always yields valid pairings and placements form a permutation.
- Statistical tests: the analytic Bo-N probability must match Monte Carlo within a tolerance, and Elo calibration is backtested with Brier score and log-loss.
- Determinism: same seed, same result.
- Performance benchmark target: 10k simulations of Worlds Swiss plus knockouts in under ~2 s in Node.

---

## 6. Frontend and UX (`apps/web`)

**Stack:**
- Astro (static output) with React islands and Tailwind CSS.
- Brackets are custom SVG components.
- Charts use a light React chart library, chosen in milestone M3.
- **Pagefind** for static full-text search.
- Zustand for Simulation Studio state.
- Dark mode via design tokens. WCAG AA, keyboard-navigable brackets.

**Pages and navigation:**

| Route | Purpose |
|---|---|
| `/` | The live or upcoming event, recent champions, and an entry point to the Studio. |
| `/tournaments`, `/tournaments/[t]`, `/tournaments/[t]/[year]` | Edition overview with tabs for stages, bracket/standings, teams & rosters, format explainer and stats, plus a timeline. |
| `/matches/[seriesId]` | Games, draft, player stats and provenance badges. |
| `/teams/[org]` | Identity timeline and international history. |
| `/players/[id]` | International career. |
| `/regions/[id]` | Regional history. |
| `/stats` | Championships, finals appearances, head-to-head tool, records, win rates, trends. |
| `/simulate` | Simulation Studio, client-only. The scenario lives in the URL hash (compressed JSON), can be saved to localStorage, and can be exported/imported as JSON. |
| `/data` | Sources, licences/attribution, coverage matrix and data-quality statuses. |

GitHub Pages serves the site under the base path `/legends-of-league/` unless we add a custom domain.

---

## 7. Feature priority

| Tier | Features |
|---|---|
| **MVP (v1.0)** | Full archive of Worlds/MSI/First Stand, including picks/bans and player stats. Tournament explorer, brackets and standings. Match, team, player and region pages. Core stats (titles, finals, head-to-head, win rates). Simulation Studio (manual picks, Elo auto-sim, Monte Carlo, comparison with actual results, URL share and export). Live-event sync with forecasting of the remaining matches. Search, dark mode, responsive layout, accessibility. Coverage/provenance page. |
| **Phase 2** | Historical power rankings. Upset-probability analysis. Monte Carlo distribution charts. Format comparisons (the same field run through different formats). Alternative seeding experiments. Cross-era comparisons. Champion meta views. |
| **Phase 3 / experimental** | Domestic-league ingestion for better ratings, Glicko-2/Bradley–Terry models. Discontinued events (All-Star, Rift Rivals, IWCI, Mid-Season Cup 2020). Prediction challenges and leaderboards (these need a backend and accounts). Internationalization. |

*Since v1 (October 2026):* the backlog lives in [GitHub issues](https://github.com/zhenga8533/legends-of-league/issues), labelled `phase 2` and `phase 3`, along with the data-corrections file and filterable players and teams lists. Prediction challenges and internationalization aren't filed: the first needs a backend, which the static site doesn't have, and there is no demand for the second yet.

---

## 8. Engineering workflow

- **Git:**
  - Trunk-based: short-lived `feat/…`, `fix/…` and `data/…` branches and squash-merged PRs.
  - Conventional Commits; branch protection on `main`.
  - No versioned releases: nothing consumes a version, and deploys follow `main`. A tag can still mark a dataset snapshot if someone needs one to cite.
- **Tooling:**
  - pnpm through corepack, Node version pinned in `.nvmrc`/`engines`.
  - uv with `pyproject.toml` and a lockfile.
  - A devcontainer for reproducibility.
  - Optional pre-commit hooks (lefthook) running formatters and linters.
- **Quality:**
  - TS: ESLint + Prettier (with Astro plugins), `tsc --strict`, Vitest, fast-check, Playwright + axe.
  - Python: ruff (lint and format), mypy `--strict`, pytest, hypothesis.
- **Security:** Dependabot for npm, pip and GitHub Actions. CodeQL. GitHub secret scanning and push protection. `pnpm audit` and `pip-audit` in CI. Actions pinned to SHAs.
- **Docs:**
  - `README` and `CONTRIBUTING`.
  - `docs/architecture.md`, `docs/data-model.md` and `docs/rulesets.md`.
  - ADRs in `docs/adr/`.
  - Instructions for adding a provider and adding a ruleset.
- **Environment:** a `.env.example` for local ingestion credentials only. The site needs no runtime configuration.

---

## 9. Roadmap and acceptance criteria

| Milestone | Deliverables | Acceptance |
|---|---|---|
| **M0 Foundations** | Monorepo scaffold, toolchains, licences, docs skeleton, CI, Pages deploy of a placeholder, Pydantic → JSON Schema → TS pipeline | CI is green. `pnpm dev` and `uv run lol-ingest --help` work. The schema drift check fails when it should. |
| **M1 Data vertical slice** | Leaguepedia provider (bot login, throttling, recorded fixtures), identity mapping, normalization, validation, diff, report, `ingest.yml`. **Worlds 2024** imported fully, including stats. | A dispatch run opens a PR with Worlds 2024 and a report. Re-running opens no PR. A deliberate change to a verified record shows up as a conflict and is not applied. |
| **M2 Engine core** | RNG, Elo, series, all primitives, ruleset interpreter, Monte Carlo in Node. Rulesets for 2023+ Worlds, MSI and First Stand. | The Worlds 2024, MSI 2024 and First Stand 2025 replays reproduce the actual results. Determinism and statistical tests pass. The performance benchmark is met. |
| **M3 Archive UI** | Astro site: explorer, edition pages, brackets/standings, match, team and player pages, search, dark mode | The deployed site shows the vertical slice. Lighthouse accessibility score ≥ 95. Playwright smoke tests pass. |
| | *As built (October 2026):* Lighthouse (12.6.1) scores accessibility, best practices and SEO 100 on the home, edition, live edition, stats, team and Studio pages, and performance 96–100. CI runs axe on every page type in both themes. | |
| **M4 Historical backfill** | Every Worlds (2011–), MSI (2015–) and First Stand edition, with a ruleset for each format era. Coverage matrix and `/data` page. | Every edition passes validation and replay, or has a documented exception. Gaps are visibly marked. |
| **M5 Simulation Studio** | Interactive bracket, manual picks, rating editor, Web Worker Monte Carlo, comparison with actual results, URL share, export/import, precomputed pre-event odds | Scenarios round-trip through the URL exactly. 10k runs in the browser don't block the UI. Simulated content is always visually labelled. |
| **M6 Live events** | lolesports provider, `live.json` windows, `live-sync.yml`, additive-only auto-merge, "forecast the rest of the event" | A dry run against a recorded live-event fixture produces correct additive PRs, and a modifying diff blocks auto-merge. |
| | *As built (October 2026):* editions are marked live by `status: live` in `editions.yaml` instead of `live.json`, and auto-merge requires the report's `autoMergeSafe`. The lolesports provider was dropped: Leaguepedia alone kept up with Worlds 2026, and a second, unofficial source would have added mixed provenance for little gain. | |
| **M7 Stats** | Head-to-head, records, titles, finals appearances, win rates, trend charts | Stats are cross-checked against Leaguepedia totals for a sample. |
| | *As built (October 2026):* stats count rebrands together through organization lineage from Leaguepedia's renames. The cross-check covered every completed edition (champions and per-organization game records). No v1.0 tag: see §8. | |

---

## 10. Risks and limitations

- **Leaguepedia:**
  - Fandom could tighten rate limits or terms. Mitigations: cache aggressively, keep the provider abstraction, treat Liquipedia as a fallback.
  - Logged-in throughput is unverified until M1.
- **lolesports API** is unofficial and could break or be disallowed at any time. It is an optional provider, and the system must work without it.
- **Data quality.** 2011–2013 data, and some player stats, will be incomplete. Statuses make the gaps explicit. Tiebreaker rules for older years are partly unverified, so the replay tests will expose that.
- **Identity curation** (org lineage, rebrands, players with the same handle) is manual, ongoing work.
- **Rating quality.** International-only data is sparse, so Elo will be noisy early in each season. The UI will be honest about this, and users can adjust ratings.
- **Timing.** Worlds 2026 (final on Nov 14) will finish before M6. The first real live test will probably be First Stand 2027.

## 11. Open questions (for later; none of them blocks M0–M1)

1. **Rating inputs.** Should domestic-league series results be ingested in Phase 2 to calibrate ratings? This is a significantly larger dataset.
2. **Custom domain** vs. `<user>.github.io/legends-of-league`.
3. **Analytics.** None, or a privacy-friendly option such as a self-hosted counter or Plausible?
4. **Mid-Season Cup 2020.** Should it appear as MSI 2020's stand-in, or wait for the "discontinued events" phase?
5. **Leaguepedia bot account.** You will need to create it (Special:BotPasswords, with Cargo rights and a confirmed email) and add the secrets before M1.

## Verification of the plan itself

Each milestone's acceptance criteria above are the verification gates. The overall check, end to end:
1. Run `ingest.yml` for one edition and see a PR with a report.
2. Merge it; CI passes, then the deploy runs.
3. The edition page renders with its bracket and stats.
4. The Studio replays the edition, and a seeded Monte Carlo reproduces identical odds when re-run.
