import { type Context, SimulationError, at } from "../context";
import type { Format } from "../ruleset";
import type { Entrant, StageOutcome } from "../types";

type SeriesFormat = Extract<Format, { type: "series" }>;

/** Standalone series between fixed entrants, e.g. a last-chance qualifier. */
export function runSeries(
  format: SeriesFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
): StageOutcome {
  const used = format.pairs.flat();
  if (new Set(used).size !== used.length || used.length !== entrants.length) {
    throw new SimulationError(
      `${stage}: pairs must use each of the ${entrants.length} entrants exactly once`,
    );
  }
  const matches = format.pairs.map(([a, b], index) =>
    ctx.play({
      stage,
      label: format.pairs.length > 1 ? `Series ${index + 1}` : "Series",
      teams: [at(entrants, a).team, at(entrants, b).team],
      bestOf: format.bestOf,
    }),
  );
  const entrant = (team: string) =>
    at(
      entrants.filter((e) => e.team === team),
      0,
    );
  return {
    stage,
    matches,
    buckets: {
      winners: matches.map((m) => entrant(m.winner)),
      losers: matches.map((m) => entrant(m.loser)),
    },
  };
}
