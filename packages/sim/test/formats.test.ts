import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SimulationError } from "../src/context";
import {
  runDoubleElimination,
  runSingleElimination,
  seedBracket,
  standardBracket,
} from "../src/formats/elimination";
import { runGroups } from "../src/formats/groups";
import { runGsl } from "../src/formats/gsl";
import { rankStandings, runRoundRobin } from "../src/formats/roundRobin";
import { drawSwissPairs, pairKey, runSwiss } from "../src/formats/swiss";
import { createRng } from "../src/rng";
import type { Format } from "../src/ruleset";
import type { PlayedMatch } from "../src/types";
import { context, entrants, favourites, teams } from "./helpers";

const worldsSwiss = {
  type: "swiss",
  wins: 3,
  losses: 3,
  bestOf: { default: 1, decisive: 3 },
} as const;

describe("Swiss", () => {
  it("finishes with the right record buckets, no rematches and the Bo3 rule", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const outcome = runSwiss(worldsSwiss, "swiss", entrants(teams(16)), context(seed));
        const size = (bucket: string) => outcome.buckets[bucket]?.length;
        expect(outcome.buckets["qualified"]).toHaveLength(8);
        expect([size("qualified:3-0"), size("qualified:3-1"), size("qualified:3-2")]).toEqual([
          2, 3, 3,
        ]);
        expect([size("eliminated:0-3"), size("eliminated:1-3"), size("eliminated:2-3")]).toEqual([
          2, 3, 3,
        ]);
        const keys = outcome.matches.map((m) => pairKey(...m.teams));
        expect(new Set(keys).size).toBe(keys.length);
        expect(outcome.matches).toHaveLength(33);
        expect(outcome.matches.filter((m) => m.bestOf === 1)).toHaveLength(8 + 8 + 4);
      }),
      { numRuns: 50 },
    );
  });

  it("orders qualified teams by record", () => {
    const outcome = runSwiss(worldsSwiss, "swiss", entrants(teams(16)), context(7));
    const losses = outcome.buckets["qualified"]!.map((e) => e.record!.losses);
    expect(losses).toEqual([...losses].sort((a, b) => a - b));
  });

  it("draws rematch-free pairs whenever one exists", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const ids = teams(8);
        // Everyone has played their neighbour; a rematch-free pairing still exists.
        const played = new Set(ids.map((t, i) => pairKey(t, ids[(i + 1) % 8]!)));
        const pairs = drawSwissPairs(createRng(seed), ids, played);
        expect(pairs.every(([a, b]) => !played.has(pairKey(a, b)))).toBe(true);
        expect(new Set(pairs.flat()).size).toBe(8);
      }),
    );
  });
});

describe("GSL group", () => {
  it("plays five matches and qualifies the winners' match and decider winners", () => {
    const outcome = runGsl(
      { type: "gsl", bestOf: 3 },
      "play-in",
      entrants(teams(4)),
      context(1, { model: favourites }),
    );
    expect(outcome.matches).toHaveLength(5);
    // Seeds 1v4 and 2v3 open; with favourites winning, 1 and 2 qualify in that order.
    expect(outcome.buckets["qualified"]!.map((e) => e.team)).toEqual(["team:t01", "team:t02"]);
    expect(outcome.buckets["eliminated:4"]!.map((e) => e.team)).toEqual(["team:t04"]);
  });

  it("merges buckets across parallel groups", () => {
    const outcome = runGroups(
      { type: "groups", count: 2, format: { type: "gsl", bestOf: 3 } },
      "play-in",
      entrants(teams(8)),
      context(3),
    );
    expect(outcome.matches).toHaveLength(10);
    expect(outcome.buckets["qualified:1"]).toHaveLength(2);
    expect(outcome.buckets["eliminated"]).toHaveLength(4);
  });
});

describe("round robin standings", () => {
  const result = (a: string, b: string, score: [number, number]): PlayedMatch => ({
    stage: "groups",
    label: "",
    teams: [a, b],
    bestOf: 3,
    score,
    winner: score[0] > score[1] ? a : b,
    loser: score[0] > score[1] ? b : a,
    source: "actual",
  });
  // First Stand 2025: KC, TES and TL tied 1-3 with a circular head-to-head.
  const matches = [
    result("tl", "kc", [2, 1]),
    result("hle", "tes", [2, 0]),
    result("cfo", "kc", [2, 0]),
    result("tl", "tes", [0, 2]),
    result("cfo", "hle", [0, 2]),
    result("kc", "tes", [2, 0]),
    result("tl", "cfo", [0, 2]),
    result("kc", "hle", [1, 2]),
    result("cfo", "tes", [2, 0]),
    result("tl", "hle", [1, 2]),
  ];
  const ids = ["tl", "kc", "hle", "tes", "cfo"];

  it("breaks a circular tie by game differential, then head-to-head", () => {
    expect(
      rankStandings(
        ids,
        matches,
        ["headToHead", "headToHeadGameDiff", "gameDiff"],
        context(1, { strict: true }),
      ),
    ).toEqual(["hle", "cfo", "kc", "tes", "tl"]);
  });

  it("rejects unresolvable ties in strict mode and draws them otherwise", () => {
    expect(() => rankStandings(ids, matches, [], context(1, { strict: true }))).toThrow(
      SimulationError,
    );
    const drawn = rankStandings(ids, matches, [], context(1));
    expect(drawn.slice(0, 2)).toEqual(["hle", "cfo"]);
    expect(new Set(drawn.slice(2))).toEqual(new Set(["kc", "tes", "tl"]));
  });

  it("plays every pairing once per leg", () => {
    const format: Extract<Format, { type: "roundRobin" }> = {
      type: "roundRobin",
      legs: 2,
      bestOf: 1,
      tiebreakers: [],
      advance: 2,
    };
    const outcome = runRoundRobin(format, "groups", entrants(teams(4)), context(1));
    expect(outcome.matches).toHaveLength(12);
    expect(outcome.buckets["qualified"]).toHaveLength(2);
    expect(outcome.buckets["rank:4"]).toHaveLength(1);
  });
});

describe("elimination brackets", () => {
  it("seeds standard brackets so the top two meet only in the final", () => {
    expect(standardBracket(4)).toEqual([1, 4, 2, 3]);
    expect(standardBracket(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("keeps undefeated Swiss teams apart, facing the worst qualifying record", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const records = [0, 0, 1, 1, 1, 2, 2, 2];
        const field = teams(8).map((team, i) => ({
          team,
          record: { wins: 3, losses: records[i]! },
        }));
        const pairs = seedBracket("swissKnockout", field, createRng(seed));
        const lossesOf = (team: string) => field.find((e) => e.team === team)!.record.losses;
        const topPairs = pairs
          .map((pair, index) => ({ index, losses: pair.map(lossesOf) }))
          .filter((p) => p.losses.includes(0));
        expect(topPairs.map((p) => p.losses.sort())).toEqual([
          [0, 2],
          [0, 2],
        ]);
        // Opposite halves: one in matches 0-1, the other in matches 2-3.
        expect(topPairs.map((p) => Math.floor(p.index / 2)).sort()).toEqual([0, 1]);
      }),
    );
  });

  it("runs a single-elimination bracket", () => {
    const format: Extract<Format, { type: "singleElimination" }> = {
      type: "singleElimination",
      bestOf: [5, 5, 5],
      seeding: "standard",
    };
    const outcome = runSingleElimination(
      format,
      "knockout",
      entrants(teams(8)),
      context(1, { model: favourites }),
    );
    expect(outcome.matches).toHaveLength(7);
    expect(outcome.buckets["champion"]![0]!.team).toBe("team:t01");
    expect(outcome.buckets["eliminated:final"]![0]!.team).toBe("team:t02");
    expect(outcome.buckets["eliminated:quarterfinal"]).toHaveLength(4);
  });

  it("runs an 8-team double elimination with crossover in the lower bracket", () => {
    const format = { type: "doubleElimination", bestOf: 5, seeding: "standard" } as const;
    const outcome = runDoubleElimination(
      format,
      "bracket",
      entrants(teams(8)),
      context(1, { model: favourites }),
    );
    expect(outcome.matches).toHaveLength(14);
    expect(outcome.buckets["champion"]![0]!.team).toBe("team:t01");
    expect(outcome.buckets["eliminated:grand-final"]![0]!.team).toBe("team:t02");
    expect(outcome.buckets["eliminated:lower-round-1"]).toHaveLength(2);
    const lower2 = outcome.matches.filter((m) => m.label === "Lower round 2");
    const upperSemis = outcome.matches.filter((m) => m.label === "Upper semifinal");
    const lower1 = outcome.matches.filter((m) => m.label === "Lower round 1");
    // The loser of the first upper semifinal meets the winner of the *second* lower round 1 match.
    expect(lower2[0]!.teams).toEqual([upperSemis[0]!.loser, lower1[1]!.winner]);
  });
});
