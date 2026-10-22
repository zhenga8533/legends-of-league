/** Turns a scenario into engine inputs. Shared by the page and the Monte Carlo worker. */
import {
  type MatchupModel,
  ReplayResolver,
  type Resolver,
  type ScheduledSeries,
  type TournamentInput,
  eloModel,
  winsNeeded,
} from "@lol/sim";
import type { EditionPayload } from "./payload";
import { NOW, type Scenario, pickKey } from "./scenario";

/**
 * Real results for kept stages come first (and can't be overridden), then the user's picks;
 * everything else is simulated.
 */
function scenarioResolver(series: ScheduledSeries[], picks: Record<string, string>): Resolver {
  const replay = new ReplayResolver(series, { lenient: true });
  return {
    result: (match) => {
      const actual = replay.result(match);
      if (actual) return actual;
      const winner = picks[pickKey(match.stage, match.teams)];
      if (!winner || !match.teams.includes(winner)) return undefined;
      const n = winsNeeded(match.bestOf);
      return { score: match.teams[0] === winner ? [n, 0] : [0, n], source: "picked" };
    },
    pairing: (request) => replay.pairing(request),
    groups: (request) => replay.groups(request),
    tiebreakerSeeds: (request) => replay.tiebreakerSeeds(request),
    fork: () => scenarioResolver(series, picks),
  };
}

export interface ScenarioSetup {
  input: TournamentInput;
  model: MatchupModel;
  resolver: Resolver;
  ratings: Record<string, number>;
  keptStages: Set<string>;
}

export function setupScenario(payload: EditionPayload, scenario: Scenario): ScenarioSetup {
  const stageIds = payload.ruleset.stages.map((stage) => stage.id);
  const now = scenario.from === NOW;
  const fromIndex =
    scenario.from === null ? 0 : now ? stageIds.length : stageIds.indexOf(scenario.from);
  const keptStages = new Set(stageIds.slice(0, Math.max(fromIndex, 0)));
  // Upcoming series' pairings are real too; picks can still decide their results.
  const known = now ? [...payload.actualSeries, ...payload.scheduledSeries] : payload.actualSeries;
  const ratings = { ...payload.ratings, ...scenario.ratings };
  return {
    input: { ruleset: payload.ruleset, participants: payload.participants },
    model: eloModel(new Map(Object.entries(ratings))),
    resolver: scenarioResolver(
      known.filter((series) => keptStages.has(series.stage)),
      scenario.picks,
    ),
    ratings,
    keptStages,
  };
}
