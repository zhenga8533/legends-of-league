# Simulation engine and rulesets

The engine (`packages/sim`) is pure TypeScript with no DOM and no I/O. The same code runs in
browser Web Workers for the Simulation Studio and in Node for tests and precomputed odds.
`packages/data` loads the dataset and rulesets and adapts them into engine inputs.

## Building blocks

| Layer        | What it does                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `rng`        | Seeded xoshiro128\*\*. `Math.random` is banned in the package by lint, so a seed always reproduces a run.                           |
| `model`      | `MatchupModel.pGame(a, b)`, the chance that `a` wins one game. Game-level Elo with region-mean starts and between-event regression. |
| `series`     | Exact Bo-N win probability and game-by-game series play.                                                                            |
| `formats`    | Swiss, GSL group, round robin (with tiebreakers), single and double elimination, and parallel groups.                               |
| `ruleset`    | Zod-validated JSON that chains stages and maps final buckets to placements.                                                         |
| `resolver`   | Supplies known facts: locked results (actual or user-picked) and fixed draws. Everything else is drawn or simulated.                |
| `replay`     | A resolver backed by recorded series. Strict mode requires every match and draw to come from the record.                            |
| `montecarlo` | Many seeded runs, aggregated into placement, championship and stage-reach shares.                                                   |

## Rulesets (`rulesets/*.json`)

A ruleset lists the editions it describes, then its stages in order. Each stage has a
`format`, plus `entrants` that come from the edition's direct entries (`{ "entry": true }`) or
from an earlier stage's bucket (`{ "stage": "play-in", "bucket": "qualified" }`). `placements`
maps terminal buckets to final places.

Each format produces these buckets:

| Format              | Buckets                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `swiss`             | `qualified` (best record first), `eliminated`, and `qualified:3-1`, `eliminated:2-3`, …                        |
| `gsl`, `groups`     | `qualified`, `eliminated`, `qualified:1`, `qualified:2`, `eliminated:3`, `eliminated:4` (merged across groups) |
| `roundRobin`        | `qualified` (top `advance`), `eliminated`, `rank:1`, `rank:2`, …                                               |
| `singleElimination` | `champion`, `eliminated:final`, `eliminated:semifinal`, `eliminated:quarterfinal`, …                           |
| `doubleElimination` | `champion`, `eliminated:grand-final`, `eliminated:lower-final`, `eliminated:lower-round-1` … `-3`              |

Swiss uses `bestOf.decisive` when a match can decide advancement or elimination. Round robin
applies its `tiebreakers` after series wins: `headToHead`, `headToHeadGameDiff`, `gameDiff`,
`gameWins`. Whenever a tie splits, each smaller group restarts the list. Ties that survive
every tiebreaker are drawn at random, which is an error in replays.

## Replays: how rulesets are verified

`packages/data/test/replay.test.ts` replays **every imported edition** against its ruleset in
strict mode, and fails in each of these cases:

- An imported edition has no ruleset.
- The engine asks for a match or draw that never happened.
- A series length differs from the ruleset (for example, a Swiss decider that wasn't Bo3).
- A recorded series goes unused.
- The final placements differ from `results.json`.
- A bracket with `standard` seeding was not actually drawn that way. This also checks the
  preceding stage's ranking and tiebreakers.

This replaces the "ruleset replay inside the import" from the original plan. The engine is
TypeScript, so CI checks replays across the whole dataset on every PR, data PRs included.

Draws (Swiss rounds, groups, bracket positions) come from the recorded series. A team's next
unplayed series in a stage defines its pairing, and the engine checks that pairing is legal:
same record, no rematch, and so on.

## What forward simulation does not model yet

Real draws follow constraints the engine doesn't encode yet: Swiss round-1 seed pools, region
protection, and the exact post-Swiss knockout draw. Forward simulations draw these at random,
except that undefeated Swiss teams are kept apart and face 3-2 teams. Each ruleset's `notes`
say what is approximate.

## Ratings and calibration

`ratingsBefore(games, date)` builds Elo only from games before an event, so pre-event odds
never use the event's own results. `packages/data/test/calibration.test.ts` predicts every
recorded game from earlier games only. With the three imported editions (219 games), Elo
reaches a Brier score of 0.238 and log-loss of 0.669, against 0.250 and 0.693 for a coin flip.
That is a real but modest edge, because most teams start without rating history.
