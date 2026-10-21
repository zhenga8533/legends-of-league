import { ReplayResolver, eloModel, ratingsBefore, runMonteCarlo } from "@lol/sim";
import { describe, expect, it } from "vitest";
import {
  actualPlacements,
  actualSeries,
  loadEditions,
  loadRulesets,
  ratedGames,
  rulesetFor,
  tournamentInput,
} from "../src";

const editions = loadEditions();
const rulesets = loadRulesets();
const games = ratedGames(editions);
const worlds = editions.find((bundle) => bundle.edition.id === "ed:worlds-2024")!;
const input = tournamentInput(worlds, rulesetFor("ed:worlds-2024", rulesets)!);
const preEvent = eloModel(ratingsBefore(games, worlds.edition.dates.start!).ratings);

describe("Monte Carlo on Worlds 2024", () => {
  it("runs 10,000 full-tournament simulations quickly", () => {
    const started = performance.now();
    const result = runMonteCarlo(input, { iterations: 10_000, seed: "bench", model: preEvent });
    const elapsed = performance.now() - started;
    console.log(`10k Worlds 2024 simulations: ${elapsed.toFixed(0)} ms`);

    const champions = Object.values(result.teams).reduce((sum, t) => sum + t.champion, 0);
    expect(champions).toBeCloseTo(1, 9);
    // The plan's target is ~2 s on a developer machine; CI runners get generous headroom.
    expect(elapsed).toBeLessThan(15_000);
  }, 60_000);

  it("is reproducible from its seed", () => {
    const options = { iterations: 300, seed: "worlds-2024", model: preEvent };
    expect(runMonteCarlo(input, options)).toEqual(runMonteCarlo(input, options));
  });

  it("forecasts the rest of the event from the matches already played", () => {
    const played = actualSeries(worlds).filter((series) => series.stage !== "knockout");
    const resolver = new ReplayResolver(played, { lenient: true });
    const result = runMonteCarlo(input, {
      iterations: 2_000,
      seed: "forecast",
      model: preEvent,
      resolver,
    });
    const actual = actualPlacements(worlds);
    const quarterfinalists = [...actual].filter(([, [from]]) => from <= 8).map(([team]) => team);

    for (const [team, outlook] of Object.entries(result.teams)) {
      const [from, to] = actual.get(team)!;
      if (from > 8) {
        // Eliminated before the knockout: the forecast must match history exactly.
        expect(outlook.placements).toEqual({ [from === to ? `${from}` : `${from}-${to}`]: 1 });
      } else {
        expect(outlook.reached["knockout"]).toBe(1);
      }
    }
    const champions = quarterfinalists.reduce((sum, team) => sum + result.teams[team]!.champion, 0);
    expect(champions).toBeCloseTo(1, 9);
  });
});

describe("pre-event ratings", () => {
  it("use only games from before the event", () => {
    const msi = editions.find((bundle) => bundle.edition.id === "ed:msi-2024")!;
    const book = ratingsBefore(games, msi.edition.dates.start!);
    expect(book.ratings.size).toBe(0);
    const afterMsi = ratingsBefore(games, worlds.edition.dates.start!);
    expect(afterMsi.ratings.size).toBe(msi.edition.participants.length);
  });
});
