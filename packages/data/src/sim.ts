/** Adapters from the canonical dataset to simulation engine inputs. */
import type {
  ActualSeries,
  Participant,
  RatedGame,
  Ruleset,
  TeamId,
  TournamentInput,
} from "@lol/sim";
import type { EditionBundle } from "./load";

export function tournamentInput(bundle: EditionBundle, ruleset: Ruleset): TournamentInput {
  const participants: Participant[] = bundle.edition.participants.map((p) => ({
    team: p.team,
    region: p.region,
    entryStage: p.entryStage,
  }));
  return { ruleset, participants };
}

export function actualSeries(bundle: EditionBundle): ActualSeries[] {
  return bundle.series.flatMap((s): ActualSeries[] =>
    s.score
      ? [
          {
            stage: s.stage,
            teams: s.teams,
            score: s.score,
            bestOf: s.bestOf,
            ...(s.start ? { start: s.start } : {}),
            number: s.number,
          },
        ]
      : [],
  );
}

export function actualPlacements(bundle: EditionBundle): Map<TeamId, [number, number]> {
  return new Map(bundle.placements.map((p) => [p.team, [p.placeFrom, p.placeTo]]));
}

/** Every recorded game with the teams' regions at the time, for rating models. */
export function ratedGames(bundles: readonly EditionBundle[]): RatedGame[] {
  return bundles.flatMap((bundle) => {
    const regions = new Map(bundle.edition.participants.map((p) => [p.team, p.region]));
    const seriesStart = new Map(bundle.series.map((s) => [s.id, s.start]));
    return bundle.games.flatMap((game): RatedGame[] => {
      const date = game.start ?? seriesStart.get(game.series);
      if (!date) return [];
      return [
        {
          date,
          teams: [game.blue, game.red],
          winner: game.winner,
          regions: [regions.get(game.blue) ?? "", regions.get(game.red) ?? ""],
        },
      ];
    });
  });
}
