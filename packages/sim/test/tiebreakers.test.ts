import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seedBracket } from "../src/formats/elimination";
import { rankWithTiebreakers, runRoundRobin } from "../src/formats/roundRobin";
import { drawHalves } from "../src/formats/series";
import { ReplayResolver } from "../src/replay";
import { createRng } from "../src/rng";
import { parseRuleset, type Format } from "../src/ruleset";
import { simulateTournament } from "../src/tournament";
import type { PlayedMatch } from "../src/types";
import { context, entrants, favourites, teams } from "./helpers";

const result = (a: string, b: string, winner: string): PlayedMatch => ({
  stage: "groups",
  label: "",
  teams: [a, b],
  bestOf: 1,
  score: winner === a ? [1, 0] : [0, 1],
  winner,
  loser: winner === a ? b : a,
  source: "actual",
});

// A circular three-way tie: a beats b, b beats c, c beats a; d loses to everyone.
const circle = [
  result("a", "b", "a"),
  result("b", "c", "b"),
  result("c", "a", "c"),
  result("a", "d", "a"),
  result("b", "d", "b"),
  result("c", "d", "c"),
];
const seeded = (order: string[]) => ({ tiebreakerSeeds: () => order });
const rank = (positions: number[], order: string[]) =>
  rankWithTiebreakers(
    ["a", "b", "c", "d"],
    circle,
    { tiebreakers: [], tiebreakerGames: { positions, bestOf: 1 } },
    context(1, { model: favourites, resolver: seeded(order) }),
    "groups",
  );

describe("tiebreaker games", () => {
  it("play a full bye bracket when the top spot of a three-way tie matters", () => {
    // Seeds [bye, x, y]: b vs c first (b wins), then a (bye) vs b (a wins).
    const { tiers, tiebreakers } = rank([1], ["a", "b", "c"]);
    expect(tiebreakers.map((m) => m.teams)).toEqual([
      ["b", "c"],
      ["a", "b"],
    ]);
    expect(tiers).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("only play for the lower spot when just the lower cut-off matters", () => {
    const { tiers, tiebreakers } = rank([2], ["c", "a", "b"]);
    expect(tiebreakers.map((m) => m.teams)).toEqual([["a", "b"]]);
    expect(tiers).toEqual([["c"], ["a"], ["b"], ["d"]]);
  });

  it("leave ties that span no deciding position shared", () => {
    const { tiers, tiebreakers } = rank([3], ["a", "b", "c"]);
    expect(tiebreakers).toEqual([]);
    expect(tiers).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("settle a four-way tie with two games and a final, losers sharing places", () => {
    // Double round robin where every pair splits 1-1: all four teams finish 3-3.
    const pairs = [
      ["a", "b"],
      ["a", "c"],
      ["a", "d"],
      ["b", "c"],
      ["b", "d"],
      ["c", "d"],
    ] as const;
    const allEven = pairs.flatMap(([x, y]) => [result(x, y, x), result(x, y, y)]);
    const { tiers, tiebreakers } = rankWithTiebreakers(
      ["a", "b", "c", "d"],
      allEven,
      { tiebreakers: [], tiebreakerGames: { positions: [1, 2], bestOf: 1 } },
      context(1, { model: favourites, resolver: seeded(["a", "b", "c", "d"]) }),
      "groups",
    );
    expect(tiebreakers.map((m) => m.teams)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["a", "c"],
    ]);
    expect(tiers).toEqual([["a"], ["c"], ["b", "d"]]);
  });

  it("are rejected in strict replays when the tie has no recorded games", () => {
    expect(() =>
      rankWithTiebreakers(
        ["a", "b", "c", "d"],
        circle,
        { tiebreakers: [], tiebreakerGames: { positions: [1], bestOf: 1 } },
        context(1, { strict: true, resolver: new ReplayResolver([]) }),
        "groups",
      ),
    ).toThrow(/no recorded tiebreaker games/);
  });
});

describe("round-robin groups", () => {
  it("can make smaller groups meet more often", () => {
    const format: Extract<Format, { type: "roundRobin" }> = {
      type: "roundRobin",
      legs: 2,
      legsBySize: { "3": 4 },
      bestOf: 1,
      tiebreakers: [],
      advance: 1,
    };
    expect(runRoundRobin(format, "g", entrants(teams(3)), context(1)).matches).toHaveLength(12);
    expect(runRoundRobin(format, "g", entrants(teams(4)), context(1)).matches).toHaveLength(12);
  });
});

describe("placements by tier", () => {
  const ruleset = parseRuleset({
    id: "tiers",
    name: "Tiers",
    editions: [],
    stages: [
      {
        id: "groups",
        name: "Groups",
        format: {
          type: "groups",
          count: 2,
          format: {
            type: "roundRobin",
            legs: 1,
            bestOf: 1,
            tiebreakers: [],
            advance: 1,
            tiebreakerGames: { positions: [1] },
          },
        },
        entrants: [{ entry: true }],
      },
      {
        id: "final",
        name: "Final",
        format: { type: "series", bestOf: 1 },
        entrants: [{ stage: "groups", bucket: "rank:1" }],
      },
    ],
    placements: [
      { stage: "final", bucket: "winners", place: [1, 1] },
      { stage: "final", bucket: "losers", place: [2, 2] },
      { stage: "groups", bucket: "eliminated", place: [3, 6], split: "rank" },
    ],
  });

  it("give each group position consecutive places, best position first", () => {
    const input = {
      ruleset,
      participants: teams(6).map((team) => ({ team, entryStage: "groups" })),
    };
    const { placements, stages } = simulateTournament(input, {
      rng: createRng(1),
      model: favourites,
    });
    const seconds = stages["groups"]!.buckets["rank:2"]!.map((e) => e.team);
    for (const team of seconds) expect(placements.get(team)).toEqual([3, 4]);
  });
});

describe("draws", () => {
  it("draw halves against each other and keep group mates apart", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const field = ["A", "B", "C", "D", "A", "B", "C", "D"].map((group, i) => ({
          team: `t${i}`,
          group,
        }));
        const pairs = drawHalves(field, createRng(seed));
        const groupOf = (team: string) => field.find((e) => e.team === team)!.group;
        expect(pairs.every(([a, b]) => Number(a.slice(1)) < 4 && Number(b.slice(1)) >= 4)).toBe(
          true,
        );
        expect(pairs.every(([a, b]) => groupOf(a) !== groupOf(b))).toBe(true);
      }),
    );
  });

  it("seed group winners against other groups' runners-up, group mates in opposite halves", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const field = ["A", "B", "C", "D", "A", "B", "C", "D"].map((group, i) => ({
          team: `t${i}`,
          group,
        }));
        const pairs = seedBracket("groupDraw", field, createRng(seed));
        const groupOf = (team: string) => field.find((e) => e.team === team)!.group;
        const halfOf = (team: string) => Math.floor(pairs.findIndex((p) => p.includes(team)) / 2);
        for (const [a, b] of pairs) expect(groupOf(a)).not.toBe(groupOf(b));
        for (const group of ["A", "B", "C", "D"]) {
          const mates = field.filter((e) => e.group === group).map((e) => e.team);
          expect(halfOf(mates[0]!)).not.toBe(halfOf(mates[1]!));
        }
      }),
    );
  });
});

describe("replayed brackets", () => {
  it("recover bracket order from who met whom, not from the schedule", () => {
    const s = (teams: [string, string], score: [number, number], start: string) => ({
      stage: "ko",
      teams,
      score,
      bestOf: 1,
      start,
    });
    // Played in this order, but a/b's winner met e/f's in the semifinal.
    const series = [
      s(["a", "b"], [1, 0], "2024-01-01"),
      s(["c", "d"], [1, 0], "2024-01-02"),
      s(["e", "f"], [1, 0], "2024-01-03"),
      s(["g", "h"], [1, 0], "2024-01-04"),
      s(["a", "e"], [1, 0], "2024-01-05"),
      s(["c", "g"], [1, 0], "2024-01-06"),
      s(["a", "c"], [1, 0], "2024-01-07"),
    ];
    const pairs = new ReplayResolver(series).pairing({
      stage: "ko",
      purpose: "round-1",
      teams: ["a", "b", "c", "d", "e", "f", "g", "h"],
    });
    expect(pairs).toEqual([
      ["a", "b"],
      ["e", "f"],
      ["c", "d"],
      ["g", "h"],
    ]);
  });
});
