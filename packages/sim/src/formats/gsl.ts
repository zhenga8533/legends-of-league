import { type Context, at, SimulationError, must } from "../context";
import type { Format } from "../ruleset";
import type { Entrant, StageOutcome } from "../types";

type GslFormat = Extract<Format, { type: "gsl" }>;

/**
 * Four-team double-elimination group: two opening matches, then the winners' match (its
 * winner qualifies first), the elimination match, and a decider for the second spot.
 */
export function runGsl(
  format: GslFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
  label = "",
): StageOutcome {
  if (entrants.length !== 4) {
    throw new SimulationError(`${stage}: a GSL group needs 4 teams, got ${entrants.length}`);
  }
  const teams = entrants.map((e) => e.team);
  const prefix = label ? `${label} ` : "";
  const purpose = label ? `${label.toLowerCase().replaceAll(" ", "-")}:opening` : "opening";
  // Without a known draw, seeds 1 and 4 open against each other, as do 2 and 3.
  const [first, second] = ctx.pair({ stage, purpose, teams }, (rest) =>
    rest.length === 4
      ? [
          [at(rest, 0), at(rest, 3)],
          [at(rest, 1), at(rest, 2)],
        ]
      : [[at(rest, 0), at(rest, 1)]],
  ) as [[string, string], [string, string]];

  const play = (name: string, a: string, b: string) =>
    ctx.play({ stage, label: `${prefix}${name}`, teams: [a, b], bestOf: format.bestOf });
  const opening1 = play("opening match", ...first);
  const opening2 = play("opening match", ...second);
  const winners = play("winners' match", opening1.winner, opening2.winner);
  const elimination = play("elimination match", opening1.loser, opening2.loser);
  const decider = play("decider match", winners.loser, elimination.winner);

  const entrant = (team: string): Entrant =>
    must(
      entrants.find((e) => e.team === team),
      team,
    );
  return {
    stage,
    matches: [opening1, opening2, winners, elimination, decider],
    buckets: {
      qualified: [entrant(winners.winner), entrant(decider.winner)],
      eliminated: [entrant(decider.loser), entrant(elimination.loser)],
      "qualified:1": [entrant(winners.winner)],
      "qualified:2": [entrant(decider.winner)],
      "eliminated:3": [entrant(decider.loser)],
      "eliminated:4": [entrant(elimination.loser)],
    },
  };
}
