import type { MatchupModel } from "./model";
import type { Rng } from "./rng";
import { playSeries, winsNeeded } from "./series";
import type {
  GroupsRequest,
  MatchSpec,
  PairingRequest,
  PlayedMatch,
  Resolver,
  TeamId,
} from "./types";

export class SimulationError extends Error {
  override name = "SimulationError";
}

export function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new SimulationError(message);
  return value;
}

/** Indexed access that fails loudly instead of yielding undefined (negative = from the end). */
export function at<T>(items: readonly T[], index: number): T {
  return must(items.at(index), `index ${index} out of range (length ${items.length})`);
}

export interface SimulationOptions {
  rng: Rng;
  model: MatchupModel;
  resolver?: Resolver;
  /**
   * Fail instead of drawing or simulating anything the resolver does not answer. Replays use
   * this so that a gap in the data, or a ruleset that disagrees with it, is an error.
   */
  strict?: boolean;
}

export class Context {
  readonly rng: Rng;
  readonly strict: boolean;
  private readonly model: MatchupModel;
  private readonly resolver: Resolver;

  constructor(options: SimulationOptions) {
    this.rng = options.rng;
    this.model = options.model;
    this.resolver = options.resolver ?? {};
    this.strict = options.strict ?? false;
  }

  play(spec: MatchSpec): PlayedMatch {
    const locked = this.resolver.result?.(spec);
    const needed = winsNeeded(spec.bestOf);
    let score: [number, number];
    let source: PlayedMatch["source"];
    if (locked) {
      ({ score, source } = locked);
      if (Math.max(...score) !== needed || score[0] === score[1]) {
        throw new SimulationError(
          `${spec.stage} ${spec.label}: ${score.join("-")} is not a finished Bo${spec.bestOf}`,
        );
      }
    } else if (this.strict) {
      throw new SimulationError(
        `${spec.stage} ${spec.label}: no result for ${spec.teams.join(" vs ")}`,
      );
    } else {
      score = playSeries(this.rng, this.model.pGame(...spec.teams), spec.bestOf);
      source = "simulated";
    }
    const [winner, loser] = score[0] > score[1] ? spec.teams : [spec.teams[1], spec.teams[0]];
    return { ...spec, score, winner, loser, source };
  }

  /**
   * Pairs teams, taking whatever pairs the resolver knows (possibly only some, for a round in
   * progress) and drawing the remaining teams with `draw`.
   */
  pair(request: PairingRequest, draw: (teams: TeamId[]) => [TeamId, TeamId][]): [TeamId, TeamId][] {
    const fixed = this.resolver.pairing?.(request) ?? [];
    const fixedTeams = new Set(fixed.flat());
    const rest = request.teams.filter((team) => !fixedTeams.has(team));
    if (rest.length > 0 && this.strict) {
      throw new SimulationError(`${request.stage} ${request.purpose}: no draw available`);
    }
    const pairs = [...fixed, ...(rest.length > 0 ? draw(rest) : [])];
    const used = pairs.flat();
    if (used.length !== request.teams.length || new Set(used).size !== used.length) {
      throw new SimulationError(
        `${request.stage} ${request.purpose}: pairing must cover each team once`,
      );
    }
    for (const team of used) {
      if (!request.teams.includes(team)) {
        throw new SimulationError(`${request.stage} ${request.purpose}: ${team} is not eligible`);
      }
    }
    return pairs;
  }

  tiebreakerSeeds(stage: string, teams: TeamId[]): TeamId[] {
    const fixed = this.resolver.tiebreakerSeeds?.({ stage, teams });
    if (!fixed && this.strict) {
      throw new SimulationError(`${stage}: no tiebreaker order for ${teams.join(", ")}`);
    }
    const seeds = fixed ?? this.rng.shuffle(teams);
    if (seeds.length !== teams.length || !teams.every((team) => seeds.includes(team))) {
      throw new SimulationError(`${stage}: tiebreaker order must list exactly the tied teams`);
    }
    return seeds;
  }

  groups(request: GroupsRequest, draw: () => TeamId[][]): TeamId[][] {
    const fixed = this.resolver.groups?.(request);
    if (!fixed && this.strict) {
      throw new SimulationError(`${request.stage}: no group draw available`);
    }
    const groups = fixed ?? draw();
    if (groups.length !== request.count || groups.flat().length !== request.teams.length) {
      throw new SimulationError(`${request.stage}: expected ${request.count} groups of all teams`);
    }
    return groups;
  }
}
