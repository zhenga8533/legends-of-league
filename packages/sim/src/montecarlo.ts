import { must } from "./context";
import type { MatchupModel } from "./model";
import { createRng } from "./rng";
import { type TournamentInput, placeLabel, simulateTournament } from "./tournament";
import type { Resolver, TeamId } from "./types";

export interface MonteCarloOptions {
  iterations: number;
  seed: string | number;
  model: MatchupModel;
  /** Locked results and draws shared by every iteration, e.g. matches already played. */
  resolver?: Resolver;
}

export interface TeamOutlook {
  /** Share of iterations the team won the tournament. */
  champion: number;
  /** Share of iterations per final place label ("1", "3-4", ...). */
  placements: { [place: string]: number };
  /** Share of iterations the team played in each stage. */
  reached: { [stage: string]: number };
}

export interface MonteCarloResult {
  iterations: number;
  seed: string | number;
  teams: { [team: TeamId]: TeamOutlook };
}

export function runMonteCarlo(
  input: TournamentInput,
  options: MonteCarloOptions,
): MonteCarloResult {
  const rng = createRng(options.seed);
  const counts = new Map<TeamId, { placements: Map<string, number>; reached: Map<string, number> }>(
    input.participants.map((p) => [p.team, { placements: new Map(), reached: new Map() }]),
  );
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  for (let i = 0; i < options.iterations; i++) {
    const resolver = options.resolver?.fork?.() ?? options.resolver;
    const result = simulateTournament(input, {
      rng,
      model: options.model,
      ...(resolver ? { resolver } : {}),
    });
    for (const [team, place] of result.placements)
      bump(must(counts.get(team), team).placements, placeLabel(place));
    for (const [stage, outcome] of Object.entries(result.stages)) {
      const teams = new Set(outcome.matches.flatMap((m) => m.teams));
      for (const team of teams) bump(must(counts.get(team), team).reached, stage);
    }
  }

  const share = (map: Map<string, number>) =>
    Object.fromEntries([...map].map(([key, n]) => [key, n / options.iterations]));
  const teams: MonteCarloResult["teams"] = {};
  for (const [team, { placements, reached }] of counts) {
    teams[team] = {
      champion: (placements.get("1") ?? 0) / options.iterations,
      placements: share(placements),
      reached: share(reached),
    };
  }
  return { iterations: options.iterations, seed: options.seed, teams };
}
