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
  const legs = format.legsBySize[String(teams.length)] ?? format.legs;
  const matches: PlayedMatch[] = [];
  for (let leg = 1; leg <= legs; leg++) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const pair: [TeamId, TeamId] =
          leg % 2 === 1 ? [at(teams, i), at(teams, j)] : [at(teams, j), at(teams, i)];
        matches.push(
          ctx.play({ stage, label: label || "Round robin", teams: pair, bestOf: format.bestOf }),
        );
      }
    }
  }

  const standings = rankWithTiebreakers(teams, matches, format, ctx, stage, label);
  const order = standings.tiers.flat();
  const ranks = new Map<TeamId, [number, number]>();
  let position = 1;
  for (const tier of standings.tiers) {
    for (const team of tier) ranks.set(team, [position, position + tier.length - 1]);
    position += tier.length;
  }
  const entrant = (team: TeamId): Entrant => {
    const regular = tally(team, matches);
    return {
      ...must(
        entrants.find((e) => e.team === team),
        team,
      ),
      rank: must(ranks.get(team), team),
      // Tiebreaker games don't count towards the record.
      record: { wins: regular.seriesWins, losses: regular.seriesLosses },
    };
  };
  const buckets: StageOutcome["buckets"] = {
    qualified: order.slice(0, format.advance).map(entrant),
    eliminated: order.slice(format.advance).map(entrant),
  };
  order.forEach((team, index) => (buckets[`rank:${index + 1}`] = [entrant(team)]));
  return { stage, matches: [...matches, ...standings.tiebreakers], buckets };
}

interface Tally {
  seriesWins: number;
  seriesLosses: number;
  gameWins: number;
  gameLosses: number;
}

function tally(team: TeamId, matches: readonly PlayedMatch[], among?: ReadonlySet<TeamId>): Tally {
  const result: Tally = { seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 };
  for (const match of matches) {
    const side = match.teams.indexOf(team);
    if (side === -1) continue;
    const opponent = at(match.teams, 1 - side);
    if (among && !among.has(opponent)) continue;
    if (match.winner === team) result.seriesWins++;
    else result.seriesLosses++;
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
 * Orders teams by series wins, then splits ties with the criteria. Whenever a criterion splits
 * a tied group, each smaller group restarts the criteria from the top, so head-to-head is
 * always computed among exactly the teams still tied (standard practice). Returns tiers: teams
 * in the same tier are still tied.
 */
function splitByCriteria(
  teams: readonly TeamId[],
  matches: readonly PlayedMatch[],
  tiebreakers: readonly Tiebreaker[],
): TeamId[][] {
  const resolve = (
    group: TeamId[],
    criteria: readonly (Tiebreaker | "seriesWins")[],
  ): TeamId[][] => {
    if (group.length <= 1) return [group];
    const [current, ...rest] = criteria;
    if (current === undefined) return [group];
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

/**
 * Plays a tiebreaker bracket between tied teams and returns them as ordered tiers:
 * - two teams play once;
 * - three teams play a bye bracket (the first game's loser is last) when the top spot matters;
 *   when only the lower cut-off matters, the first seed takes the top spot and the other two
 *   play once (MSI 2017);
 * - four teams play two games and a final, the losers sharing the bottom places unless
 *   `lowerMatters`.
 */
function playTiebreakers(
  tied: TeamId[],
  ctx: Context,
  stage: string,
  label: string,
  bestOf: number,
  topMatters: boolean,
  lowerMatters: boolean,
): { tiers: TeamId[][]; matches: PlayedMatch[] } {
  const seeds = ctx.tiebreakerSeeds(stage, tied);
  const matches: PlayedMatch[] = [];
  const play = (a: TeamId, b: TeamId): PlayedMatch => {
    const match = ctx.play({
      stage,
      label: label ? `${label} tiebreaker` : "Tiebreaker",
      teams: [a, b],
      bestOf,
    });
    matches.push(match);
    return match;
  };
  if (seeds.length === 2) {
    const game = play(at(seeds, 0), at(seeds, 1));
    return { tiers: [[game.winner], [game.loser]], matches };
  }
  if (seeds.length === 3) {
    const [bye, a, b] = [at(seeds, 0), at(seeds, 1), at(seeds, 2)];
    const first = play(a, b);
    if (!topMatters) return { tiers: [[bye], [first.winner], [first.loser]], matches };
    const final = play(bye, first.winner);
    return { tiers: [[final.winner], [final.loser], [first.loser]], matches };
  }
  if (seeds.length === 4) {
    const [a, b, c, d] = [at(seeds, 0), at(seeds, 1), at(seeds, 2), at(seeds, 3)];
    const first = play(a, b);
    const second = play(c, d);
    const final = play(first.winner, second.winner);
    if (lowerMatters) {
      const lower = play(first.loser, second.loser);
      return { tiers: [[final.winner], [final.loser], [lower.winner], [lower.loser]], matches };
    }
    return { tiers: [[final.winner], [final.loser], [first.loser, second.loser]], matches };
  }
  throw new SimulationError(
    `${stage}: tiebreakers between ${seeds.length} teams are not supported`,
  );
}

/**
 * Standings as ordered tiers. With `tiebreakerGames`, ties spanning a configured position are
 * played off and other ties stay shared (a tier of several teams). Without it, ties that
 * survive every criterion are drawn at random, or rejected in strict mode.
 */
export function rankWithTiebreakers(
  teams: readonly TeamId[],
  matches: readonly PlayedMatch[],
  format: Pick<RoundRobinFormat, "tiebreakers" | "tiebreakerGames">,
  ctx: Context,
  stage: string,
  label = "",
): { tiers: TeamId[][]; tiebreakers: PlayedMatch[] } {
  const tiers: TeamId[][] = [];
  const tiebreakers: PlayedMatch[] = [];
  const games = format.tiebreakerGames;
  const positions = new Set(games?.positions ?? []);
  for (const tier of splitByCriteria(teams, matches, format.tiebreakers)) {
    if (tier.length === 1) {
      tiers.push(tier);
      continue;
    }
    if (!games) {
      if (ctx.strict) throw new SimulationError(`unresolved tie between ${tier.join(", ")}`);
      tiers.push(...ctx.rng.shuffle(tier).map((team) => [team]));
      continue;
    }
    const first = tiers.reduce((sum, t) => sum + t.length, 0) + 1;
    const last = first + tier.length - 1;
    const spans = (position: number) =>
      positions.has(position) && position >= first && position < last;
    if (![...positions].some(spans)) {
      tiers.push(tier);
      continue;
    }
    const played = playTiebreakers(
      tier,
      ctx,
      stage,
      label,
      games.bestOf,
      spans(first),
      spans(first + 2),
    );
    tiers.push(...played.tiers);
    tiebreakers.push(...played.matches);
  }
  return { tiers, tiebreakers };
}

/** A full order by series wins and criteria; ties that survive every criterion are drawn. */
export function rankStandings(
  teams: readonly TeamId[],
  matches: readonly PlayedMatch[],
  tiebreakers: readonly Tiebreaker[],
  ctx: Context,
): TeamId[] {
  return rankWithTiebreakers(
    teams,
    matches,
    { tiebreakers: [...tiebreakers] },
    ctx,
    "",
  ).tiers.flat();
}
