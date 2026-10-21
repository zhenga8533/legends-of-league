import { type Context, at, SimulationError, must } from "../context";
import type { Rng } from "../rng";
import type { Format } from "../ruleset";
import type { Entrant, PlayedMatch, StageOutcome, TeamId } from "../types";

type SingleEliminationFormat = Extract<Format, { type: "singleElimination" }>;
type DoubleEliminationFormat = Extract<Format, { type: "doubleElimination" }>;

/** Bracket positions for seeds 1..n so that 1 and 2 can only meet in the final. */
export function standardBracket(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, next - seed]);
  }
  return order;
}

function toPairs(slots: readonly TeamId[]): [TeamId, TeamId][] {
  const pairs: [TeamId, TeamId][] = [];
  for (let i = 0; i < slots.length; i += 2) pairs.push([at(slots, i), at(slots, i + 1)]);
  return pairs;
}

/**
 * First-round pairs, in bracket order, for a seeding method.
 *
 * `swissKnockout` approximates the post-Swiss draw used at Worlds since 2023: undefeated teams
 * are kept apart and face teams with the worst qualifying record; everything else is random.
 * Region protection and other draw constraints are not modelled.
 */
export function seedBracket(
  method: SingleEliminationFormat["seeding"],
  entrants: readonly Entrant[],
  rng: Rng,
): [TeamId, TeamId][] {
  const teams = entrants.map((e) => e.team);
  if (method === "random") return toPairs(rng.shuffle(teams));
  if (method === "groupDraw") return groupDraw(entrants, rng);
  if (method === "standard") {
    return toPairs(standardBracket(teams.length).map((seed) => at(teams, seed - 1)));
  }
  const losses = (e: Entrant): number => must(e.record, `${e.team} has no Swiss record`).losses;
  const fewest = Math.min(...entrants.map(losses));
  const most = Math.max(...entrants.map(losses));
  const top = rng.shuffle(entrants.filter((e) => losses(e) === fewest).map((e) => e.team));
  const bottom = rng.shuffle(entrants.filter((e) => losses(e) === most).map((e) => e.team));
  const pairs: [TeamId, TeamId][] = [];
  for (const team of top) {
    const opponent = bottom.shift();
    if (opponent && fewest !== most) pairs.push([team, opponent]);
  }
  const used = new Set(pairs.flat());
  const others = toPairs(rng.shuffle(teams.filter((team) => !used.has(team))));
  // Undefeated teams go to opposite halves of the bracket.
  const half = teams.length / 4;
  const [firstTop, ...restTop] = pairs;
  const ordered = [
    ...(firstTop ? [firstTop] : []),
    ...others.splice(0, half - (firstTop ? 1 : 0)),
    ...restTop,
    ...others,
  ];
  return ordered;
}

/**
 * Group winners (first half of the entrants) against runners-up (second half) from other
 * groups, with each group's two teams in opposite halves of the bracket, as at Worlds before
 * the Swiss era. Retries random draws until the constraints hold.
 */
function groupDraw(entrants: readonly Entrant[], rng: Rng): [TeamId, TeamId][] {
  const half = entrants.length / 2;
  const winners = entrants.slice(0, half);
  const runnersUp = entrants.slice(half);
  let pairs: [Entrant, Entrant][] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const drawn = rng.shuffle(runnersUp);
    pairs = rng.shuffle(winners).map((w, i): [Entrant, Entrant] => [w, at(drawn, i)]);
    const sameGroup = pairs.some(([w, r]) => w.group !== undefined && w.group === r.group);
    const halfOf = (team: TeamId) =>
      Math.floor(pairs.findIndex((p) => p.some((e) => e.team === team)) / (half / 2));
    const sameHalf = pairs.some(([w]) => {
      const mate = runnersUp.find((r) => r.group !== undefined && r.group === w.group);
      return mate !== undefined && halfOf(mate.team) === halfOf(w.team);
    });
    if (!sameGroup && !sameHalf) break;
  }
  return pairs.map(([w, r]) => [w.team, r.team]);
}

function roundName(roundsFromEnd: number): string {
  if (roundsFromEnd === 0) return "final";
  if (roundsFromEnd === 1) return "semifinal";
  if (roundsFromEnd === 2) return "quarterfinal";
  return `round-of-${2 ** (roundsFromEnd + 1)}`;
}

export function runSingleElimination(
  format: SingleEliminationFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
): StageOutcome {
  const rounds = format.bestOf.length;
  if (entrants.length !== 2 ** rounds) {
    throw new SimulationError(
      `${stage}: ${rounds} rounds need ${2 ** rounds} teams, got ${entrants.length}`,
    );
  }
  const entrant = (team: TeamId): Entrant =>
    must(
      entrants.find((e) => e.team === team),
      team,
    );
  let pairs = ctx.pair({ stage, purpose: "round-1", teams: entrants.map((e) => e.team) }, (rest) =>
    seedBracket(
      format.seeding,
      entrants.filter((e) => rest.includes(e.team)),
      ctx.rng,
    ),
  );
  if (ctx.strict && format.seeding === "standard") {
    // Standard seeding is deterministic, so a replay can check that the real bracket (and
    // therefore the earlier stage's ranking and tiebreakers) matches it.
    const key = ([a, b]: [TeamId, TeamId]) => [a, b].sort().join("|");
    const expected = new Set(seedBracket("standard", entrants, ctx.rng).map(key));
    const mismatch = pairs.find((pair) => !expected.has(key(pair)));
    if (mismatch) {
      throw new SimulationError(`${stage}: ${mismatch.join(" vs ")} contradicts standard seeding`);
    }
  }
  const matches: PlayedMatch[] = [];
  const buckets: StageOutcome["buckets"] = {};
  for (let round = 0; round < rounds; round++) {
    const name = roundName(rounds - 1 - round);
    const label = name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
    const played = pairs.map((teams) =>
      ctx.play({ stage, label, teams, bestOf: at(format.bestOf, round) }),
    );
    matches.push(...played);
    buckets[`eliminated:${name}`] = played.map((m) => entrant(m.loser));
    if (round < rounds - 1) pairs = toPairs(played.map((m) => m.winner));
  }
  buckets["champion"] = [entrant(at(matches, -1).winner)];
  return { stage, matches, buckets };
}

/**
 * Double elimination without a grand final reset. Eight teams as at MSI since 2023 (losers of
 * the upper semifinals cross over in the lower bracket to avoid immediate rematches); four
 * teams as in the Worlds 2011 playoffs.
 */
export function runDoubleElimination(
  format: DoubleEliminationFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
): StageOutcome {
  if (entrants.length !== 4 && entrants.length !== 8) {
    throw new SimulationError(
      `${stage}: double elimination needs 4 or 8 teams, got ${entrants.length}`,
    );
  }
  const entrant = (team: TeamId): Entrant =>
    must(
      entrants.find((e) => e.team === team),
      team,
    );
  const firstRound = ctx.pair(
    { stage, purpose: "upper-round-1", teams: entrants.map((e) => e.team) },
    (rest) =>
      seedBracket(
        format.seeding,
        entrants.filter((e) => rest.includes(e.team)),
        ctx.rng,
      ),
  );
  const matches: PlayedMatch[] = [];
  const play = (label: string, a: TeamId, b: TeamId): PlayedMatch => {
    const match = ctx.play({ stage, label, teams: [a, b], bestOf: format.bestOf });
    matches.push(match);
    return match;
  };
  const upper1 = firstRound.map(([a, b]) => play("Upper round 1", a, b));
  if (upper1.length === 2) {
    // Four teams (Worlds 2011): upper final, one lower round, lower final, grand final.
    const [first, second] = [at(upper1, 0), at(upper1, 1)];
    const upperFinal = play("Upper final", first.winner, second.winner);
    const lower1 = play("Lower round 1", first.loser, second.loser);
    const lowerFinal = play("Lower final", upperFinal.loser, lower1.winner);
    const grandFinal = play("Grand final", upperFinal.winner, lowerFinal.winner);
    return {
      stage,
      matches,
      buckets: {
        champion: [entrant(grandFinal.winner)],
        "eliminated:grand-final": [entrant(grandFinal.loser)],
        "eliminated:lower-final": [entrant(lowerFinal.loser)],
        "eliminated:lower-round-1": [entrant(lower1.loser)],
      },
    };
  }
  const [u0, u1, u2, u3] = upper1 as [PlayedMatch, PlayedMatch, PlayedMatch, PlayedMatch];
  const lower1 = [
    play("Lower round 1", u0.loser, u1.loser),
    play("Lower round 1", u2.loser, u3.loser),
  ];
  const upperSemis = [
    play("Upper semifinal", u0.winner, u1.winner),
    play("Upper semifinal", u2.winner, u3.winner),
  ];
  const lower2 = [
    play("Lower round 2", at(upperSemis, 0).loser, at(lower1, 1).winner),
    play("Lower round 2", at(upperSemis, 1).loser, at(lower1, 0).winner),
  ];
  const upperFinal = play("Upper final", at(upperSemis, 0).winner, at(upperSemis, 1).winner);
  const lower3 = play("Lower round 3", at(lower2, 0).winner, at(lower2, 1).winner);
  const lowerFinal = play("Lower final", upperFinal.loser, lower3.winner);
  const grandFinal = play("Grand final", upperFinal.winner, lowerFinal.winner);

  return {
    stage,
    matches,
    buckets: {
      champion: [entrant(grandFinal.winner)],
      "eliminated:grand-final": [entrant(grandFinal.loser)],
      "eliminated:lower-final": [entrant(lowerFinal.loser)],
      "eliminated:lower-round-3": [entrant(lower3.loser)],
      "eliminated:lower-round-2": lower2.map((m) => entrant(m.loser)),
      "eliminated:lower-round-1": lower1.map((m) => entrant(m.loser)),
    },
  };
}
