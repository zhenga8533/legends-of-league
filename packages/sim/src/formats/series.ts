import { type Context, SimulationError, at } from "../context";
import type { Rng } from "../rng";
import type { Format } from "../ruleset";
import type { Entrant, StageOutcome, TeamId } from "../types";

type SeriesFormat = Extract<Format, { type: "series" }>;

/**
 * Draws the first half of the entrants against the second half, keeping teams from the same
 * group apart when possible (e.g. group winners vs runners-up of other groups).
 */
export function drawHalves(entrants: readonly Entrant[], rng: Rng): [TeamId, TeamId][] {
  const half = entrants.length / 2;
  const top = entrants.slice(0, half);
  const bottom = entrants.slice(half);
  let best: [TeamId, TeamId][] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const shuffled = rng.shuffle(bottom);
    const pairs = top.map((e, i): [TeamId, TeamId] => [e.team, at(shuffled, i).team]);
    best = pairs;
    const clash = top.some((e, i) => e.group !== undefined && e.group === at(shuffled, i).group);
    if (!clash) break;
  }
  return best;
}

/** Standalone series between entrants, e.g. a last-chance qualifier or crossed Bo5s. */
export function runSeries(
  format: SeriesFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
): StageOutcome {
  const fixed = format.pairs.map(([a, b]): [TeamId, TeamId] => [
    at(entrants, a).team,
    at(entrants, b).team,
  ]);
  if (format.draw === "fixed") {
    const used = format.pairs.flat();
    if (new Set(used).size !== used.length || used.length !== entrants.length) {
      throw new SimulationError(
        `${stage}: pairs must use each of the ${entrants.length} entrants exactly once`,
      );
    }
  } else if (entrants.length % 2 !== 0) {
    throw new SimulationError(`${stage}: a halves draw needs an even number of entrants`);
  }
  // Fixed pairings are part of the format and are played as configured (a replay fails if
  // history paired the teams differently); only "halves" draws consult the resolver.
  const pairs =
    format.draw === "fixed"
      ? fixed
      : ctx.pair({ stage, purpose: "series", teams: entrants.map((e) => e.team) }, (rest) =>
          drawHalves(
            entrants.filter((e) => rest.includes(e.team)),
            ctx.rng,
          ),
        );
  const matches = pairs.map((teams, index) =>
    ctx.play({
      stage,
      label: pairs.length > 1 ? `Series ${index + 1}` : "Series",
      teams,
      bestOf: format.bestOf,
    }),
  );
  const entrant = (team: TeamId) =>
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
