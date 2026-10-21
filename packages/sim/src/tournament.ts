import { Context, SimulationError, type SimulationOptions } from "./context";
import { runDoubleElimination, runSingleElimination } from "./formats/elimination";
import { runGroups } from "./formats/groups";
import { runGsl } from "./formats/gsl";
import { runRoundRobin } from "./formats/roundRobin";
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
    for (const { team } of stages[rule.stage]?.buckets[rule.bucket] ?? []) {
      if (placements.has(team)) {
        throw new SimulationError(`${team} matches more than one placement rule`);
      }
      placements.set(team, rule.place);
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

export function placeLabel([from, to]: readonly [number, number]): string {
  return from === to ? String(from) : `${from}-${to}`;
}
