import { SimulationError, must } from "./context";
import { type MatchupModel, coinFlip } from "./model";
import { createRng } from "./rng";
import { pairKey } from "./formats/swiss";
import { type TournamentInput, type TournamentResult, simulateTournament } from "./tournament";
import type { GroupsRequest, MatchSpec, PairingRequest, Resolver, Score, TeamId } from "./types";

/** A series whose teams are known, played or not. */
export interface ScheduledSeries {
  stage: string;
  teams: [TeamId, TeamId];
  bestOf: number;
  /** Used to order series; earlier series are matched first. */
  start?: string;
  number?: number;
  score?: Score;
}

/** A series that really happened, as recorded in the archive. */
export interface ActualSeries extends ScheduledSeries {
  score: Score;
}

const neverSimulate: MatchupModel = {
  pGame: () => {
    throw new SimulationError("replays never simulate");
  },
};

/**
 * Answers results and draws from recorded series. Every answer is checked against the
 * engine's request, so a ruleset that disagrees with history fails loudly.
 *
 * In lenient mode (an event still in progress), anything not yet recorded is left to the
 * simulation instead of being an error. Scheduled series without a score fix pairings only.
 */
export class ReplayResolver implements Resolver {
  private readonly byStage = new Map<string, ScheduledSeries[]>();
  private readonly used = new Set<ScheduledSeries>();

  constructor(
    private readonly series: readonly ScheduledSeries[],
    private readonly options: { lenient?: boolean } = {},
  ) {
    const ordered = [...series].sort(
      (a, b) => (a.start ?? "").localeCompare(b.start ?? "") || (a.number ?? 0) - (b.number ?? 0),
    );
    for (const s of ordered) this.byStage.set(s.stage, [...(this.byStage.get(s.stage) ?? []), s]);
  }

  fork(): ReplayResolver {
    return new ReplayResolver(this.series, this.options);
  }

  /** Played series the simulation never asked for. */
  unused(): ScheduledSeries[] {
    return [...this.byStage.values()].flat().filter((s) => s.score && !this.used.has(s));
  }

  private pending(stage: string): ScheduledSeries[] {
    return (this.byStage.get(stage) ?? []).filter((s) => !this.used.has(s));
  }

  result(match: MatchSpec): { score: Score; source: "actual" } | undefined {
    const key = pairKey(...match.teams);
    const series = this.pending(match.stage).find((s) => pairKey(...s.teams) === key);
    if (!series?.score && this.options.lenient) {
      // A scheduled series is simulated now, so it must not be offered as a later pairing.
      if (series) this.used.add(series);
      return undefined;
    }
    if (!series?.score) {
      throw new SimulationError(
        `${match.stage} ${match.label}: ${match.teams.join(" vs ")} ${series ? "not played yet" : "never played"}`,
      );
    }
    const { score } = series;
    if (series.bestOf !== match.bestOf) {
      throw new SimulationError(
        `${match.stage} ${match.label}: ruleset expects Bo${match.bestOf}, ` +
          `${match.teams.join(" vs ")} was Bo${series.bestOf}`,
      );
    }
    this.used.add(series);
    const aligned = series.teams[0] === match.teams[0];
    return { score: aligned ? score : [score[1], score[0]], source: "actual" };
  }

  /**
   * Each team's next unplayed series must be against another team in the request. In lenient
   * mode, teams without one are left out for the engine to draw.
   */
  pairing(request: PairingRequest): [TeamId, TeamId][] {
    const pending = this.pending(request.stage);
    const pairs: [ScheduledSeries, [TeamId, TeamId]][] = [];
    const paired = new Set<TeamId>();
    for (const team of request.teams) {
      if (paired.has(team)) continue;
      const next = pending.find((s) => s.teams.includes(team));
      const partner = next?.teams.find((t) => t !== team);
      if (!next || !partner || !request.teams.includes(partner) || paired.has(partner)) {
        if (this.options.lenient) continue;
        throw new SimulationError(
          `${request.stage} ${request.purpose}: ${team}'s next series is not a valid pairing`,
        );
      }
      paired.add(team).add(partner);
      pairs.push([next, next.teams]);
    }
    const ordered = pairs
      .sort(([a], [b]) => pending.indexOf(a) - pending.indexOf(b))
      .map(([s]) => s);
    // A bracket's first round must be in bracket order (neighbours' winners meet next), which
    // the schedule order does not always follow; recover it from who met whom afterwards.
    const bracket = /^(upper-)?round-1$/.test(request.purpose)
      ? bracketOrder(
          ordered,
          pending.filter((s) => !ordered.includes(s)),
        )
      : ordered;
    return bracket.map((s) => s.teams);
  }

  /**
   * A tiebreaker bracket's order from the tied teams' remaining series: the first series is
   * the opening game; with three teams, the team not in it had the bye.
   */
  tiebreakerSeeds(request: { stage: string; teams: TeamId[] }): TeamId[] | undefined {
    const tied = new Set(request.teams);
    const pending = this.pending(request.stage).filter(
      (s) => tied.has(s.teams[0]) && tied.has(s.teams[1]),
    );
    const openers = request.teams.length === 4 ? pending.slice(0, 2) : pending.slice(0, 1);
    const seeded = openers.flatMap((s) => s.teams);
    const byes = request.teams.filter((team) => !seeded.includes(team));
    const valid =
      openers.length === (request.teams.length === 4 ? 2 : 1) &&
      new Set(seeded).size === seeded.length &&
      byes.length === request.teams.length - seeded.length &&
      byes.length <= 1;
    if (!valid) {
      if (this.options.lenient) return undefined;
      throw new SimulationError(
        `${request.stage}: no recorded tiebreaker games between ${request.teams.join(", ")}`,
      );
    }
    return [...byes, ...seeded];
  }

  /** Groups are the connected components of who played whom in the stage. */
  groups(request: GroupsRequest): TeamId[][] | undefined {
    const parent = new Map(request.teams.map((t) => [t, t]));
    const find = (t: TeamId): TeamId => {
      const p = must(parent.get(t), t);
      return p === t ? t : find(p);
    };
    for (const s of this.byStage.get(request.stage) ?? []) {
      if (parent.has(s.teams[0]) && parent.has(s.teams[1])) {
        parent.set(find(s.teams[0]), find(s.teams[1]));
      }
    }
    const components = new Map<TeamId, TeamId[]>();
    for (const team of request.teams) {
      components.set(find(team), [...(components.get(find(team)) ?? []), team]);
    }
    const firstSeen = (group: TeamId[]): number =>
      (this.byStage.get(request.stage) ?? []).findIndex((s) => group.includes(s.teams[0]));
    const groups = [...components.values()].sort((a, b) => firstSeen(a) - firstSeen(b));
    if (groups.length !== request.count && this.options.lenient) return undefined;
    if (groups.length !== request.count) {
      throw new SimulationError(
        `${request.stage}: series form ${groups.length} groups, ruleset expects ${request.count}`,
      );
    }
    return groups;
  }
}

const winnerOf = (s: ScheduledSeries): TeamId | undefined =>
  s.score && s.teams[s.score[0] > s.score[1] ? 0 : 1];

/**
 * Orders a round's series so that the winners of series 2k and 2k+1 meet in a later series,
 * recursively. Returns the input order if the later rounds don't pin it down.
 */
function bracketOrder(round: ScheduledSeries[], later: ScheduledSeries[]): ScheduledSeries[] {
  if (round.length <= 1) return round;
  const meeting = (a: ScheduledSeries, b: ScheduledSeries) => {
    const [winnerA, winnerB] = [winnerOf(a), winnerOf(b)];
    return winnerA && winnerB
      ? later.find((s) => pairKey(...s.teams) === pairKey(winnerA, winnerB))
      : undefined;
  };
  const remaining = [...round];
  const pairs: [ScheduledSeries, ScheduledSeries, ScheduledSeries][] = [];
  while (remaining.length > 0) {
    const first = remaining.shift();
    if (!first) break;
    // Winners can meet more than once (a semifinal, then a final): neighbours are the ones whose
    // winners meet earliest.
    const candidates = remaining
      .map((other) => ({ other, met: meeting(first, other) }))
      .filter((c): c is { other: ScheduledSeries; met: ScheduledSeries } => c.met !== undefined)
      .sort((a, b) => (a.met.start ?? "").localeCompare(b.met.start ?? ""));
    const best = candidates[0];
    if (!best) return round;
    remaining.splice(remaining.indexOf(best.other), 1);
    pairs.push([first, best.other, best.met]);
  }
  const next = pairs.map(([, , meetingSeries]) => meetingSeries);
  const nextOrdered = bracketOrder(
    next,
    later.filter((s) => !next.includes(s)),
  );
  return nextOrdered.flatMap((series) => {
    const pair = must(
      pairs.find(([, , m]) => m === series),
      "pair",
    );
    return [pair[0], pair[1]];
  });
}

export interface ReplayResult {
  result: TournamentResult;
  /** Played series the ruleset never asked for; should be empty. */
  unused: ScheduledSeries[];
}

/**
 * Re-runs a tournament from its recorded series and nothing else. An event in progress
 * (`inProgress`) is played out with coin flips past what has been recorded: only its matches
 * with source "actual" are real, and only the placements already decided are meaningful.
 */
export function replayTournament(
  input: TournamentInput,
  series: readonly ScheduledSeries[],
  { inProgress = false }: { inProgress?: boolean } = {},
): ReplayResult {
  const resolver = new ReplayResolver(series, { lenient: inProgress });
  const result = simulateTournament(input, {
    rng: createRng("replay"),
    model: inProgress ? coinFlip : neverSimulate,
    resolver,
    strict: !inProgress,
  });
  return { result, unused: resolver.unused() };
}
