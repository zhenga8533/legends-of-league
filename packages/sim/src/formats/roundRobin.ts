import { type Context, at, SimulationError, must } from "../context";
import type { Format, Tiebreaker } from "../ruleset";
import type { Entrant, PlayedMatch, StageOutcome, TeamId } from "../types";

type RoundRobinFormat = Extract<Format, { type: "roundRobin" }>;

export function runRoundRobin(
  format: RoundRobinFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
  label = "",
): StageOutcome {
  const teams = entrants.map((e) => e.team);
  const matches: PlayedMatch[] = [];
  for (let leg = 1; leg <= format.legs; leg++) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const pair: [TeamId, TeamId] =
          leg === 1 ? [at(teams, i), at(teams, j)] : [at(teams, j), at(teams, i)];
        matches.push(
          ctx.play({ stage, label: label || "Round robin", teams: pair, bestOf: format.bestOf }),
        );
      }
    }
  }

  const ranking = rankStandings(teams, matches, format.tiebreakers, ctx);
  const entrant = (team: TeamId): Entrant =>
    must(
      entrants.find((e) => e.team === team),
      team,
    );
  const buckets: StageOutcome["buckets"] = {
    qualified: ranking.slice(0, format.advance).map(entrant),
    eliminated: ranking.slice(format.advance).map(entrant),
  };
  ranking.forEach((team, index) => (buckets[`rank:${index + 1}`] = [entrant(team)]));
  return { stage, matches, buckets };
}

interface Tally {
  seriesWins: number;
  gameWins: number;
  gameLosses: number;
}

function tally(team: TeamId, matches: readonly PlayedMatch[], among?: ReadonlySet<TeamId>): Tally {
  const result: Tally = { seriesWins: 0, gameWins: 0, gameLosses: 0 };
  for (const match of matches) {
    const side = match.teams.indexOf(team);
    if (side === -1) continue;
    const opponent = at(match.teams, 1 - side);
    if (among && !among.has(opponent)) continue;
    if (match.winner === team) result.seriesWins++;
    result.gameWins += at(match.score, side);
    result.gameLosses += at(match.score, 1 - side);
  }
  return result;
}

function criterion(
  name: Tiebreaker | "seriesWins",
  team: TeamId,
  group: readonly TeamId[],
  matches: readonly PlayedMatch[],
): number {
  const among = new Set(group);
  switch (name) {
    case "seriesWins":
      return tally(team, matches).seriesWins;
    case "headToHead":
      return tally(team, matches, among).seriesWins;
    case "headToHeadGameDiff": {
      const t = tally(team, matches, among);
      return t.gameWins - t.gameLosses;
    }
    case "gameDiff": {
      const t = tally(team, matches);
      return t.gameWins - t.gameLosses;
    }
    case "gameWins":
      return tally(team, matches).gameWins;
  }
}

/**
 * Orders teams by series wins, then breaks ties with the configured criteria. Whenever a
 * criterion splits a tied group, each smaller group restarts the criteria from the top, so
 * head-to-head is always computed among exactly the teams still tied (standard practice).
 * Ties that survive every criterion are drawn at random, or rejected in strict mode.
 */
export function rankStandings(
  teams: readonly TeamId[],
  matches: readonly PlayedMatch[],
  tiebreakers: readonly Tiebreaker[],
  ctx: Context,
): TeamId[] {
  const resolve = (group: TeamId[], criteria: readonly (Tiebreaker | "seriesWins")[]): TeamId[] => {
    if (group.length <= 1) return group;
    const [current, ...rest] = criteria;
    if (current === undefined) {
      if (ctx.strict) {
        throw new SimulationError(`unresolved tie between ${group.join(", ")}`);
      }
      return ctx.rng.shuffle(group);
    }
    const values = new Map(group.map((team) => [team, criterion(current, team, group, matches)]));
    const distinct = [...new Set(values.values())].sort((a, b) => b - a);
    if (distinct.length === 1) return resolve(group, rest);
    return distinct.flatMap((value) =>
      resolve(
        group.filter((team) => values.get(team) === value),
        tiebreakers,
      ),
    );
  };
  return resolve([...teams], ["seriesWins", ...tiebreakers]);
}
