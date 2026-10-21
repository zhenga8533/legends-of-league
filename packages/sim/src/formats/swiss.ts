import { type Context, SimulationError, must } from "../context";
import type { Rng } from "../rng";
import type { Format } from "../ruleset";
import type { Entrant, PlayedMatch, StageOutcome, TeamId, WinLoss } from "../types";

type SwissFormat = Extract<Format, { type: "swiss" }>;

export function pairKey(a: TeamId, b: TeamId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pairs teams with no rematches where possible (backtracking over a shuffled order). If no
 * rematch-free pairing exists, falls back to a random pairing rather than failing.
 */
export function drawSwissPairs(
  rng: Rng,
  teams: readonly TeamId[],
  played: ReadonlySet<string>,
): [TeamId, TeamId][] {
  const order = rng.shuffle(teams);
  const search = (remaining: TeamId[]): [TeamId, TeamId][] | undefined => {
    const [first, ...rest] = remaining;
    if (first === undefined) return [];
    for (const partner of rest) {
      if (played.has(pairKey(first, partner))) continue;
      const tail = search(rest.filter((team) => team !== partner));
      if (tail) return [[first, partner], ...tail];
    }
    return undefined;
  };
  const pairs = search(order);
  if (pairs) return pairs;
  const fallback: [TeamId, TeamId][] = [];
  for (let i = 0; i < order.length; i += 2) {
    fallback.push([must(order[i], "odd team count"), must(order[i + 1], "odd team count")]);
  }
  return fallback;
}

/** Whether the teams can be paired without any rematch. */
export function rematchFreePairingExists(
  teams: readonly TeamId[],
  played: ReadonlySet<string>,
): boolean {
  const [first, ...rest] = teams;
  if (first === undefined) return true;
  return rest.some(
    (partner) =>
      !played.has(pairKey(first, partner)) &&
      rematchFreePairingExists(
        rest.filter((team) => team !== partner),
        played,
      ),
  );
}

export function runSwiss(
  format: SwissFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
): StageOutcome {
  const records = new Map<TeamId, WinLoss>(entrants.map((e) => [e.team, { wins: 0, losses: 0 }]));
  const played = new Set<string>();
  const matches: PlayedMatch[] = [];
  const isActive = (team: TeamId): boolean => {
    const record = must(records.get(team), team);
    return record.wins < format.wins && record.losses < format.losses;
  };

  for (let round = 1; entrants.some((e) => isActive(e.team)); round++) {
    const groups = new Map<string, TeamId[]>();
    for (const { team } of entrants.filter((e) => isActive(e.team))) {
      const { wins, losses } = must(records.get(team), team);
      const key = `${wins}-${losses}`;
      groups.set(key, [...(groups.get(key) ?? []), team]);
    }
    const ordered = [...groups].sort(([a], [b]) => recordOrder(a, b));
    for (const [key, teams] of ordered) {
      if (teams.length % 2 !== 0) {
        throw new SimulationError(`${stage} round ${round}: odd number of teams at ${key}`);
      }
      const avoid = format.rematches !== "allow";
      const pairs = ctx.pair({ stage, purpose: `round-${round}:${key}`, teams }, (rest) =>
        drawSwissPairs(ctx.rng, rest, avoid ? played : new Set()),
      );
      const rematch = pairs.find(([a, b]) => played.has(pairKey(a, b)));
      if (rematch && avoid && rematchFreePairingExists(teams, played)) {
        throw new SimulationError(
          `${stage} round ${round}: ${rematch.join(" vs ")} is an avoidable rematch`,
        );
      }
      const [wins, losses] = key.split("-").map(Number) as [number, number];
      const decisive = wins === format.wins - 1 || losses === format.losses - 1;
      for (const [a, b] of pairs) {
        const match = ctx.play({
          stage,
          label: `Round ${round}`,
          teams: [a, b],
          bestOf: decisive ? format.bestOf.decisive : format.bestOf.default,
        });
        played.add(pairKey(a, b));
        matches.push(match);
        must(records.get(match.winner), match.winner).wins++;
        must(records.get(match.loser), match.loser).losses++;
      }
    }
  }

  const withRecord = (team: TeamId): Entrant & { record: WinLoss } => {
    const entrant = must(
      entrants.find((e) => e.team === team),
      team,
    );
    return { ...entrant, record: { ...must(records.get(team), team) } };
  };
  const finished = entrants.map((e) => withRecord(e.team));
  const qualified = finished
    .filter((e) => e.record.wins === format.wins)
    .sort((a, b) => a.record.losses - b.record.losses);
  const eliminated = finished
    .filter((e) => e.record.wins < format.wins)
    .sort((a, b) => b.record.wins - a.record.wins);

  const buckets: StageOutcome["buckets"] = { qualified, eliminated };
  for (const entrant of finished) {
    const { wins, losses } = entrant.record;
    const name = `${wins === format.wins ? "qualified" : "eliminated"}:${wins}-${losses}`;
    buckets[name] = [...(buckets[name] ?? []), entrant];
  }
  return { stage, matches, buckets };
}

/** Higher records first, so the order of play is stable: 2-0 before 1-1 before 0-2. */
function recordOrder(a: string, b: string): number {
  const [aw, al] = a.split("-").map(Number) as [number, number];
  const [bw, bl] = b.split("-").map(Number) as [number, number];
  return bw - aw || al - bl;
}
