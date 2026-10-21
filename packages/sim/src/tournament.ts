import { Context, SimulationError, type SimulationOptions, at } from "./context";
import { runDoubleElimination, runSingleElimination } from "./formats/elimination";
import { runGroups } from "./formats/groups";
import { runGsl } from "./formats/gsl";
import { runRoundRobin } from "./formats/roundRobin";
import { runSeries } from "./formats/series";
import { runSwiss } from "./formats/swiss";
import type { Ruleset, StageDefinition } from "./ruleset";
import type { Entrant, PlayedMatch, StageOutcome, TeamId } from "./types";

export interface Participant {
  team: TeamId;
  region?: string;
  /** ID of the ruleset stage the team enters at. */
  entryStage: string;
}

export interface TournamentInput {
  ruleset: Ruleset;
  participants: readonly Participant[];
}

export interface TournamentResult {
  matches: PlayedMatch[];
  stages: { [stage: string]: StageOutcome };
  /** Final place range per team, e.g. [3, 4] for a shared third place. */
  placements: Map<TeamId, [number, number]>;
}

function runStage(definition: StageDefinition, entrants: Entrant[], ctx: Context): StageOutcome {
  const { format, id } = definition;
  switch (format.type) {
    case "swiss":
      return runSwiss(format, id, entrants, ctx);
    case "gsl":
      return runGsl(format, id, entrants, ctx);
    case "roundRobin":
      return runRoundRobin(format, id, entrants, ctx);
    case "singleElimination":
      return runSingleElimination(format, id, entrants, ctx);
    case "doubleElimination":
      return runDoubleElimination(format, id, entrants, ctx);
    case "groups":
      return runGroups(format, id, entrants, ctx);
    case "series":
      return runSeries(format, id, entrants, ctx);
  }
}

export function simulateTournament(
  input: TournamentInput,
  options: SimulationOptions,
): TournamentResult {
  const ctx = new Context(options);
  const stages: TournamentResult["stages"] = {};

  for (const definition of input.ruleset.stages) {
    const entrants: Entrant[] = definition.entrants.flatMap((source) => {
      if ("entry" in source) {
        return input.participants
          .filter((p) => p.entryStage === definition.id)
          .map((p): Entrant =>
            p.region === undefined ? { team: p.team } : { team: p.team, region: p.region },
          );
      }
      const bucket = stages[source.stage]?.buckets[source.bucket];
      if (!bucket) {
        throw new SimulationError(
          `${definition.id}: ${source.stage} has no bucket ${source.bucket}`,
        );
      }
      return bucket;
    });
    stages[definition.id] = runStage(definition, entrants, ctx);
  }

  const placements = new Map<TeamId, [number, number]>();
  for (const rule of input.ruleset.placements) {
    const teams = stages[rule.stage]?.buckets[rule.bucket] ?? [];
    for (const [team, place] of placeBucket(rule, teams)) {
      if (placements.has(team)) {
        throw new SimulationError(`${team} matches more than one placement rule`);
      }
      placements.set(team, place);
    }
  }
  const unplaced = input.participants.filter((p) => !placements.has(p.team));
  if (unplaced.length > 0) {
    throw new SimulationError(`no placement rule covers ${unplaced.map((p) => p.team).join(", ")}`);
  }

  return {
    matches: Object.values(stages).flatMap((stage) => stage.matches),
    stages,
    placements,
  };
}

function placeBucket(
  rule: Ruleset["placements"][number],
  teams: readonly Entrant[],
): [TeamId, [number, number]][] {
  if (rule.split === undefined) return teams.map((e) => [e.team, rule.place]);
  // Teams in the same tier share consecutive places; better tiers come first.
  const tierKey = (e: Entrant): [number, number] =>
    rule.split === "wins"
      ? [-(e.record?.wins ?? 0), 0]
      : (e.rank ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
  const tiers = new Map<string, Entrant[]>();
  for (const entrant of teams) {
    const key = tierKey(entrant).join("|");
    tiers.set(key, [...(tiers.get(key) ?? []), entrant]);
  }
  const ordered = [...tiers.values()].sort((a, b) => {
    const [ka, kb] = [tierKey(at(a, 0)), tierKey(at(b, 0))];
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
  const result: [TeamId, [number, number]][] = [];
  let next = rule.place[0];
  for (const tier of ordered) {
    const place: [number, number] = [next, next + tier.length - 1];
    for (const entrant of tier) result.push([entrant.team, place]);
    next += tier.length;
  }
  if (next - 1 !== rule.place[1]) {
    throw new SimulationError(
      `${rule.stage} ${rule.bucket}: ${teams.length} teams do not fill places ${rule.place.join("-")}`,
    );
  }
  return result;
}

export function placeLabel([from, to]: readonly [number, number]): string {
  return from === to ? String(from) : `${from}-${to}`;
}
