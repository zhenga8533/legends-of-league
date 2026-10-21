import { SimulationError, must } from "./context";
import type { MatchupModel } from "./model";
import { createRng } from "./rng";
import { pairKey } from "./formats/swiss";
import { type TournamentInput, type TournamentResult, simulateTournament } from "./tournament";
import type { GroupsRequest, MatchSpec, PairingRequest, Resolver, Score, TeamId } from "./types";

/** A series that really happened, as recorded in the archive. */
export interface ActualSeries {
  stage: string;
  teams: [TeamId, TeamId];
  score: Score;
  bestOf: number;
  /** Used to order series; earlier series are matched first. */
  start?: string;
  number?: number;
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
 * simulation instead of being an error.
 */
export class ReplayResolver implements Resolver {
  private readonly byStage = new Map<string, ActualSeries[]>();
  private readonly used = new Set<ActualSeries>();

  constructor(
    private readonly series: readonly ActualSeries[],
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

  unused(): ActualSeries[] {
    return [...this.byStage.values()].flat().filter((s) => !this.used.has(s));
  }

  private pending(stage: string): ActualSeries[] {
    return (this.byStage.get(stage) ?? []).filter((s) => !this.used.has(s));
  }

  result(match: MatchSpec): { score: Score; source: "actual" } | undefined {
    const key = pairKey(...match.teams);
    const series = this.pending(match.stage).find((s) => pairKey(...s.teams) === key);
    if (!series && this.options.lenient) return undefined;
    if (!series) {
      throw new SimulationError(
        `${match.stage} ${match.label}: ${match.teams.join(" vs ")} never played`,
      );
    }
    if (series.bestOf !== match.bestOf) {
      throw new SimulationError(
        `${match.stage} ${match.label}: ruleset expects Bo${match.bestOf}, ` +
          `${match.teams.join(" vs ")} was Bo${series.bestOf}`,
      );
    }
    this.used.add(series);
    const aligned = series.teams[0] === match.teams[0];
    return { score: aligned ? series.score : [series.score[1], series.score[0]], source: "actual" };
  }

  /**
   * Each team's next unplayed series must be against another team in the request. In lenient
   * mode, teams without one are left out for the engine to draw.
   */
  pairing(request: PairingRequest): [TeamId, TeamId][] {
    const pending = this.pending(request.stage);
    const pairs: [ActualSeries, [TeamId, TeamId]][] = [];
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
    return pairs.sort(([a], [b]) => pending.indexOf(a) - pending.indexOf(b)).map(([, p]) => p);
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

export interface ReplayResult {
  result: TournamentResult;
  /** Recorded series the ruleset never asked for; should be empty. */
  unused: ActualSeries[];
}

/** Re-runs a tournament from its recorded series and nothing else. */
export function replayTournament(
  input: TournamentInput,
  series: readonly ActualSeries[],
): ReplayResult {
  const resolver = new ReplayResolver(series);
  const result = simulateTournament(input, {
    rng: createRng("replay"),
    model: neverSimulate,
    resolver,
    strict: true,
  });
  return { result, unused: resolver.unused() };
}
