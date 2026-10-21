import type { TeamId } from "./types";

/** Probability that team `a` wins a single game against team `b`. */
export interface MatchupModel {
  pGame(a: TeamId, b: TeamId): number;
}

export const coinFlip: MatchupModel = { pGame: () => 0.5 };

export function eloWinProbability(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function eloModel(ratings: ReadonlyMap<TeamId, number>, fallback = 1500): MatchupModel {
  return {
    pGame: (a, b) => eloWinProbability(ratings.get(a) ?? fallback, ratings.get(b) ?? fallback),
  };
}

export interface RatedGame {
  /** ISO date or datetime; games are processed in this order. */
  date: string;
  teams: readonly [TeamId, TeamId];
  winner: TeamId;
  /** The teams' regions at the time, used to seed teams the book has not seen. */
  regions: readonly [string, string];
}

export interface EloOptions {
  initial: number;
  k: number;
  /** Share of a team's distance from its region mean kept across a long break. */
  carryover: number;
  /** A gap longer than this (in days) between a team's games counts as a long break. */
  breakDays: number;
}

export const DEFAULT_ELO: EloOptions = { initial: 1500, k: 32, carryover: 0.75, breakDays: 60 };

/**
 * Game-level Elo over international games. Teams seen for the first time start at their
 * region's mean rating, which is how cross-region results inform teams with no history.
 */
export class EloBook {
  readonly ratings = new Map<TeamId, number>();
  private readonly lastPlayed = new Map<TeamId, number>();
  private readonly regionOf = new Map<TeamId, string>();

  constructor(private readonly options: EloOptions = DEFAULT_ELO) {}

  regionMean(region: string): number {
    const values = [...this.ratings].filter(([team]) => this.regionOf.get(team) === region);
    if (values.length === 0) return this.options.initial;
    return values.reduce((sum, [, rating]) => sum + rating, 0) / values.length;
  }

  rating(team: TeamId): number {
    return this.ratings.get(team) ?? this.options.initial;
  }

  /** Updates ratings with a result and returns the pre-game probability that teams[0] won. */
  record(game: RatedGame): number {
    const when = Date.parse(game.date);
    const [a, b] = game.teams;
    for (const [i, team] of [a, b].entries()) this.prepare(team, game.regions[i] ?? "", when);
    const expected = eloWinProbability(this.rating(a), this.rating(b));
    const delta = this.options.k * ((game.winner === a ? 1 : 0) - expected);
    this.ratings.set(a, this.rating(a) + delta);
    this.ratings.set(b, this.rating(b) - delta);
    this.lastPlayed.set(a, when);
    this.lastPlayed.set(b, when);
    return expected;
  }

  private prepare(team: TeamId, region: string, when: number): void {
    const current = this.ratings.get(team);
    this.regionOf.set(team, region);
    if (current === undefined) {
      this.ratings.set(team, this.regionMean(region));
      return;
    }
    const last = this.lastPlayed.get(team) ?? when;
    if ((when - last) / 86_400_000 > this.options.breakDays) {
      const mean = this.regionMean(region);
      this.ratings.set(team, mean + (current - mean) * this.options.carryover);
    }
  }
}

/** Ratings from every game strictly before `before` (no leakage from the event itself). */
export function ratingsBefore(
  games: readonly RatedGame[],
  before: string,
  options: EloOptions = DEFAULT_ELO,
): EloBook {
  const book = new EloBook(options);
  const cutoff = Date.parse(before);
  [...games]
    .filter((game) => Date.parse(game.date) < cutoff)
    .sort((x, y) => Date.parse(x.date) - Date.parse(y.date))
    .forEach((game) => book.record(game));
  return book;
}
