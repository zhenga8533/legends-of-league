import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng";
import { parseRuleset } from "../src/ruleset";
import { summarizeStages } from "../src/summary";
import { simulateTournament } from "../src/tournament";
import { favourites, teams } from "./helpers";

describe("summarizeStages", () => {
  it("splits group labels and tracks Swiss records going into each match", () => {
    const ruleset = parseRuleset({
      id: "s",
      name: "S",
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
              advance: 2,
              tiebreakerGames: { positions: [2] },
            },
          },
          entrants: [{ entry: true }],
        },
        {
          id: "swiss",
          name: "Swiss",
          format: { type: "swiss", wins: 2, losses: 2, bestOf: { default: 1, decisive: 3 } },
          entrants: [{ stage: "groups", bucket: "qualified" }],
        },
      ],
      placements: [
        { stage: "swiss", bucket: "qualified", place: [1, 2] },
        { stage: "swiss", bucket: "eliminated", place: [3, 4] },
        { stage: "groups", bucket: "eliminated", place: [5, 8] },
      ],
    });
    const input = {
      ruleset,
      participants: teams(8).map((team) => ({ team, entryStage: "groups" })),
    };
    const [groups, swiss] = summarizeStages(
      simulateTournament(input, { rng: createRng(1), model: favourites }),
      ruleset,
    );

    expect(new Set(groups!.matches.map((m) => m.group))).toEqual(new Set(["Group A", "Group B"]));
    expect(groups!.matches.every((m) => m.label === "Round robin")).toBe(true);
    expect(swiss!.matches[0]!.records).toEqual([
      { wins: 0, losses: 0 },
      { wins: 0, losses: 0 },
    ]);
    const decider = swiss!.matches.find(
      (m) => m.records?.[0].wins === 1 && m.records[0].losses === 1,
    );
    expect(decider?.bestOf).toBe(3);
  });
});
