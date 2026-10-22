import { createRng, simulateTournament, summarizeStages } from "@lol/sim";
import { describe, expect, it } from "vitest";
import { archive } from "../lib/archive";
import { buildPayload } from "../lib/studio-data";
import { runChunked } from "./montecarlo";
import {
  NOW,
  type Scenario,
  decodeScenario,
  defaultScenario,
  encodeScenario,
  pickKey,
  scenarioFromHash,
} from "./scenario";
import { setupScenario } from "./setup";

const worlds2024 = archive.editions.find((b) => b.edition.id === "ed:worlds-2024")!;
const payload = buildPayload(worlds2024);
const simulate = (scenario: Scenario, from = payload) => {
  const setup = setupScenario(from, scenario);
  const result = simulateTournament(setup.input, {
    rng: createRng(scenario.seed),
    model: setup.model,
    resolver: setup.resolver,
  });
  return { result, stages: summarizeStages(result, from.ruleset) };
};

describe("scenarios", () => {
  it("round-trip through the URL exactly", () => {
    const scenario: Scenario = {
      ...defaultScenario("worlds-2024"),
      seed: "ünïcode seed ✓",
      from: "swiss",
      picks: { "knockout|team:bilibili-gaming|team:t1": "team:bilibili-gaming" },
      ratings: { "team:t1": 1810 },
    };
    const hash = `#s=${encodeScenario(scenario)}`;
    expect(scenarioFromHash(hash)).toEqual(scenario);
    expect(encodeScenario(scenarioFromHash(hash)!)).toBe(encodeScenario(scenario));
  });

  it("accept edition links and reject anything malformed", () => {
    expect(scenarioFromHash("#ed=msi-2024")).toEqual(defaultScenario("msi-2024"));
    expect(scenarioFromHash("#ed=../../etc")).toBeUndefined();
    expect(decodeScenario("not base64 json")).toBeUndefined();
    expect(decodeScenario(encodeScenario({ ...defaultScenario("x"), seed: "" }))).toBeUndefined();
  });
});

describe("scenario setup", () => {
  it("has a pre-event rating for every participant", () => {
    for (const { team } of payload.participants) expect(payload.ratings[team]).toBeGreaterThan(0);
  });

  it("keeps real results for stages before the chosen one", () => {
    const { stages } = simulate({ ...defaultScenario("worlds-2024"), from: "swiss" });
    const playIn = stages.find((s) => s.id === "play-in")!;
    expect(playIn.matches.every((m) => m.source === "actual")).toBe(true);
    expect(playIn.matches).toHaveLength(
      payload.actualSeries.filter((s) => s.stage === "play-in").length,
    );
    const swiss = stages.find((s) => s.id === "swiss")!;
    expect(swiss.matches.every((m) => m.source === "simulated")).toBe(true);
  });

  it("is reproducible from the seed", () => {
    const scenario = defaultScenario("worlds-2024");
    expect(simulate(scenario).result.matches).toEqual(simulate(scenario).result.matches);
  });

  it("applies picks, and later rounds follow them", () => {
    const base = simulate(defaultScenario("worlds-2024"));
    const final = base.stages.find((s) => s.id === "knockout")!.matches.at(-1)!;
    const scenario = {
      ...defaultScenario("worlds-2024"),
      picks: { [pickKey("knockout", final.teams)]: final.loser },
    };
    const picked = simulate(scenario);
    const newFinal = picked.stages.find((s) => s.id === "knockout")!.matches.at(-1)!;
    expect(newFinal.source).toBe("picked");
    expect(newFinal.winner).toBe(final.loser);
    expect([...picked.result.placements].find(([, place]) => place[0] === 1)?.[0]).toBe(
      final.loser,
    );
  });

  it("never lets a pick override a real result", () => {
    const real = payload.actualSeries.find((s) => s.stage === "play-in")!;
    const loser = real.score[0] > real.score[1] ? real.teams[1] : real.teams[0];
    const { stages } = simulate({
      ...defaultScenario("worlds-2024"),
      from: "swiss",
      picks: { [pickKey("play-in", real.teams)]: loser },
    });
    const match = stages[0]!.matches.find(
      (m) => pickKey("play-in", m.teams) === pickKey("play-in", real.teams),
    )!;
    expect(match.source).toBe("actual");
    expect(match.winner).not.toBe(loser);
  });
});

describe("chunked Monte Carlo", () => {
  it("is deterministic and its shares sum to one", () => {
    const scenario = defaultScenario("worlds-2024");
    const progress: number[] = [];
    const first = runChunked(payload, scenario, 600, (done) => progress.push(done));
    expect(progress).toEqual([250, 500, 600]);
    expect(runChunked(payload, scenario, 600)).toEqual(first);
    const champions = Object.values(first.teams).reduce((sum, t) => sum + t.champion, 0);
    expect(champions).toBeCloseTo(1, 9);
  });
});

describe("an event in progress", () => {
  // Worlds 2024 the day before its final: everything played except the final.
  const final = worlds2024.series.find((s) => s.id.includes("knockout") && s.round === "Finals")!;
  const live = buildPayload({
    ...worlds2024,
    edition: { ...worlds2024.edition, status: "live" },
    series: worlds2024.series.map((s) => (s === final ? { ...s, score: null, winner: null } : s)),
    placements: worlds2024.placements.filter((p) => p.placeFrom > 2),
  });

  it("starts from the results so far, with the known pairings kept", () => {
    const scenario = defaultScenario(live.edition.slug, live.edition.live);
    expect(scenario.from).toBe(NOW);
    expect(live.scheduledSeries).toHaveLength(1);
    const { stages } = simulate(scenario, live);
    const matches = stages.flatMap((s) => s.matches);
    expect(matches.filter((m) => m.source === "actual")).toHaveLength(live.actualSeries.length);
    const simulated = matches.filter((m) => m.source !== "actual");
    expect(simulated).toHaveLength(1);
    expect([...simulated[0]!.teams].sort()).toEqual([...final.teams].sort());
  });

  it("lets a pick decide an upcoming match", () => {
    const scenario = {
      ...defaultScenario(live.edition.slug, true),
      picks: { [pickKey("knockout", final.teams)]: final.teams[1] },
    };
    const { result } = simulate(scenario, live);
    expect(result.placements.get(final.teams[1])).toEqual([1, 1]);
  });

  it("precomputes a forecast in which only the finalists can win", () => {
    const champions = Object.entries(live.forecast!.teams).filter(([, t]) => t.champion > 0);
    expect(champions.map(([team]) => team).sort()).toEqual([...final.teams].sort());
    expect(payload.forecast).toBeUndefined();
  });
});
