import { describe, expect, it } from "vitest";
import { eloModel } from "../src/model";
import { runMonteCarlo } from "../src/montecarlo";
import { replayTournament } from "../src/replay";
import { createRng } from "../src/rng";
import { parseRuleset } from "../src/ruleset";
import { type TournamentInput, simulateTournament } from "../src/tournament";
import { coinFlip } from "../src/model";
import { teams } from "./helpers";

const ruleset = parseRuleset({
  id: "mini",
  name: "Mini Cup",
  editions: [],
  stages: [
    {
      id: "groups",
      name: "Groups",
      format: { type: "roundRobin", legs: 1, bestOf: 1, tiebreakers: ["headToHead"], advance: 4 },
      entrants: [{ entry: true }],
    },
    {
      id: "final-four",
      name: "Final four",
      format: { type: "singleElimination", bestOf: [3, 5], seeding: "standard" },
      entrants: [{ stage: "groups", bucket: "qualified" }],
    },
  ],
  placements: [
    { stage: "final-four", bucket: "champion", place: [1, 1] },
    { stage: "final-four", bucket: "eliminated:final", place: [2, 2] },
    { stage: "final-four", bucket: "eliminated:semifinal", place: [3, 4] },
    { stage: "groups", bucket: "eliminated", place: [5, 6] },
  ],
});
const input: TournamentInput = {
  ruleset,
  participants: teams(6).map((team) => ({ team, entryStage: "groups" })),
};

describe("rulesets", () => {
  it("reject stages that take entrants from a later stage", () => {
    expect(() =>
      parseRuleset({
        ...ruleset,
        stages: [...ruleset.stages].reverse(),
      }),
    ).toThrow(/does not run earlier/);
  });

  it("reject even best-of lengths", () => {
    const stages: typeof ruleset.stages = JSON.parse(JSON.stringify(ruleset.stages));
    (stages[0]!.format as { bestOf: number }).bestOf = 2;
    expect(() => parseRuleset({ ...ruleset, stages })).toThrow(/odd/);
  });
});

describe("simulateTournament", () => {
  it("is reproducible from a seed", () => {
    const run = (seed: string) =>
      simulateTournament(input, { rng: createRng(seed), model: coinFlip });
    expect(run("a")).toEqual(run("a"));
    expect(run("a").matches).not.toEqual(run("b").matches);
  });

  it("places every participant exactly once", () => {
    const { placements } = simulateTournament(input, { rng: createRng(1), model: coinFlip });
    expect([...placements.keys()].sort()).toEqual(teams(6));
    expect([...placements.values()].filter(([from]) => from === 1)).toHaveLength(1);
  });

  it("honours locked results and marks their source", () => {
    const resolver = {
      result: (match: { teams: [string, string]; bestOf: number }) =>
        match.teams.includes("team:t06") && match.bestOf === 1
          ? {
              score: (match.teams[0] === "team:t06" ? [1, 0] : [0, 1]) as [number, number],
              source: "picked" as const,
            }
          : undefined,
    };
    const { matches } = simulateTournament(input, { rng: createRng(1), model: coinFlip, resolver });
    const picked = matches.filter((m) => m.source === "picked");
    expect(picked).toHaveLength(5);
    expect(picked.every((m) => m.winner === "team:t06")).toBe(true);
  });
});

describe("replayTournament", () => {
  it("fails when the record is missing a match the ruleset requires", () => {
    expect(() => replayTournament(input, [])).toThrow(/never played/);
  });
});

describe("runMonteCarlo", () => {
  it("returns probabilities that sum to one and favour stronger teams", () => {
    const ratings = new Map(teams(6).map((team, i) => [team, 1700 - i * 60]));
    const result = runMonteCarlo(input, { iterations: 2000, seed: "mc", model: eloModel(ratings) });
    const outlooks = Object.values(result.teams);
    expect(outlooks.reduce((sum, t) => sum + t.champion, 0)).toBeCloseTo(1, 9);
    for (const outlook of outlooks) {
      expect(Object.values(outlook.placements).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(outlook.reached["groups"]).toBe(1);
    }
    expect(result.teams["team:t01"]!.champion).toBeGreaterThan(result.teams["team:t06"]!.champion);
  });

  it("is deterministic for a seed", () => {
    const options = { iterations: 200, seed: 42, model: coinFlip };
    expect(runMonteCarlo(input, options)).toEqual(runMonteCarlo(input, options));
  });
});
