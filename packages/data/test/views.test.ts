import { describe, expect, it } from "vitest";
import {
  editionCoverage,
  editionStages,
  editionStandings,
  editionSummary,
  kda,
  loadArchive,
  placeText,
  playerCareer,
  rulesetFor,
  seriesGames,
  TBD,
  teamHistory,
} from "../src";

const archive = loadArchive();
const edition = (id: string) => archive.editions.find((b) => b.edition.id === id)!;
const worlds = edition("ed:worlds-2024");
const msi = edition("ed:msi-2024");

describe("edition views", () => {
  it("maps every replayed match back to exactly one series", () => {
    for (const bundle of archive.editions) {
      const stages = editionStages(bundle, rulesetFor(bundle.edition.id, archive.rulesets)!);
      const ids = stages.flatMap((stage) => stage.matches.flatMap((m) => m.seriesId ?? []));
      expect(ids).toHaveLength(bundle.series.length);
      expect(new Set(ids).size).toBe(bundle.series.length);
    }
  });

  it("labels bracket positions and Swiss records from the replay", () => {
    const [, swiss] = editionStages(worlds, rulesetFor("ed:worlds-2024", archive.rulesets)!);
    const decider = swiss!.matches.find((m) =>
      m.records?.every((r) => r.wins === 2 && r.losses === 2),
    );
    expect(decider?.bestOf).toBe(3);
    const bracket = editionStages(msi, rulesetFor("ed:msi-2024", archive.rulesets)!)[1]!;
    expect(bracket.matches.map((m) => m.label)).toContain("Lower round 2");
    const playIn = editionStages(msi, rulesetFor("ed:msi-2024", archive.rulesets)!)[0]!;
    expect(new Set(playIn.matches.map((m) => m.group))).toEqual(new Set(["Group A", "Group B"]));
  });

  it("shows an event in progress as played so far plus what is scheduled", () => {
    const final = worlds.series.find((s) => s.stage === "knockout" && s.round === "Finals")!;
    const live = {
      ...worlds,
      edition: { ...worlds.edition, status: "live" as const },
      series: worlds.series.map((s) => (s === final ? { ...s, score: null, winner: null } : s)),
      placements: worlds.placements.filter((p) => p.placeFrom > 2),
    };
    const stages = editionStages(live, rulesetFor("ed:worlds-2024", archive.rulesets)!);
    const matches = stages.flatMap((stage) => stage.matches);
    expect(matches).toHaveLength(worlds.series.length);
    const upcoming = matches.filter((m) => m.source !== "actual");
    expect(upcoming).toEqual([
      expect.objectContaining({ seriesId: final.id, label: expect.stringMatching(/final/i) }),
    ]);
    expect(upcoming[0]).not.toHaveProperty("score");
  });

  it("shows an upcoming edition as its first-round schedule, then TBD slots", () => {
    // Before an event, Leaguepedia has each stage's first round and nothing played.
    const scheduled = worlds.series
      .filter((s) => s.round === "Round 1")
      .map((s) => ({ ...s, score: null, winner: null }));
    const upcoming = {
      ...worlds,
      edition: { ...worlds.edition, status: "upcoming" as const },
      series: scheduled,
      games: [],
      playerStats: [],
      placements: [],
    };
    const matches = editionStages(
      upcoming,
      rulesetFor("ed:worlds-2024", archive.rulesets)!,
    ).flatMap((stage) => stage.matches);
    const ids = matches.flatMap((m) => m.seriesId ?? []);
    expect(ids.sort()).toEqual(scheduled.map((s) => s.id).sort());
    expect(matches.every((m) => m.score === undefined)).toBe(true);
    const tbd = matches.filter((m) => !m.seriesId);
    expect(tbd.length).toBeGreaterThan(0);
    expect(tbd.every((m) => m.teams.every((t) => t === TBD))).toBe(true);
  });

  it("shows the slots of a stage not drawn yet as TBD, and nothing simulated", () => {
    const live = {
      ...worlds,
      edition: { ...worlds.edition, status: "live" as const },
      series: worlds.series.filter((s) => s.stage !== "knockout"),
      placements: worlds.placements.filter((p) => p.placeFrom > 8),
    };
    const stages = editionStages(live, rulesetFor("ed:worlds-2024", archive.rulesets)!);
    const knockout = stages.find((stage) => stage.id === "knockout")!;
    expect(knockout.matches).toHaveLength(7);
    expect(knockout.matches.every((m) => m.teams.every((t) => t === TBD) && !m.seriesId)).toBe(
      true,
    );
    const shown = stages.flatMap((stage) => stage.matches);
    expect(shown.filter((m) => m.source === "simulated")).toEqual([]);
  });

  it("summarizes champion, runner-up and the final", () => {
    const summary = editionSummary(worlds);
    expect(summary).toMatchObject({ champion: "team:t1", runnerUp: "team:bilibili-gaming" });
    expect(summary.final?.score).toEqual([2, 3]);
  });

  it("ranks standings by final place with series and game records", () => {
    const [first, second] = editionStandings(worlds);
    expect(first).toMatchObject({ team: "team:t1", place: [1, 1] });
    expect(second?.team).toBe("team:bilibili-gaming");
    const t1 = first!;
    expect(t1.series.wins).toBeGreaterThan(t1.series.losses);
  });
});

describe("team and player views", () => {
  it("collects a team's appearances in date order", () => {
    const history = teamHistory(archive, "team:t1");
    const places = new Map(history.map((a) => [a.bundle.edition.id, placeText(a.standing.place)]));
    expect(places.get("ed:msi-2024")).toBe("3rd");
    expect(places.get("ed:worlds-2024")).toBe("1st");
    const starts = history.map((a) => a.bundle.edition.dates.start ?? "");
    expect(starts).toEqual([...starts].sort());
  });

  it("aggregates a player's games consistently across editions and champions", () => {
    const career = playerCareer(archive, "player:faker");
    const total = career.editions.reduce((sum, e) => sum + e.games, 0);
    expect(total).toBeGreaterThan(0);
    expect(career.champions.reduce((sum, c) => sum + c.games, 0)).toBe(total);
    // Records keep the team identity of the time: SK Telecom T1 until 2019, T1 after.
    const t1 = new Set(["team:sk-telecom-t1", "team:t1"]);
    const editions = new Set(archive.editions.map((b) => b.edition.id));
    const asSkt = career.editions.filter((e) => e.team === "team:sk-telecom-t1");
    expect(career.editions.every((e) => t1.has(e.team) && e.role === "mid")).toBe(true);
    if (editions.has("ed:worlds-2017")) expect(asSkt.length).toBeGreaterThan(0);
  });

  it("splits a game's player stats by side in role order", () => {
    const [game] = seriesGames(worlds, "ser:worlds-2024-knockout-finals-01");
    expect(game!.blue.map((r) => r.role)).toEqual(["top", "jungle", "mid", "bot", "support"]);
    expect(game!.red).toHaveLength(5);
  });

  it("formats KDA and places", () => {
    expect(kda({ kills: 3, deaths: 0, assists: 4 })).toBe("Perfect");
    expect(kda({ kills: 3, deaths: 2, assists: 4 })).toBe("3.50");
    expect(placeText([3, 4])).toBe("3rd–4th");
    expect(placeText([11, 12])).toBe("11th–12th");
    expect(placeText([22, 22])).toBe("22nd");
  });
});

describe("coverage", () => {
  it("counts recorded games, drafts and stats against what the scores imply", () => {
    const coverage = editionCoverage(worlds);
    expect(coverage.series).toBe(worlds.series.length);
    expect(coverage.games).toBe(coverage.expectedGames);
    expect(coverage.gamesWithDraft).toBe(coverage.games);
    expect(coverage.gamesWithStats).toBe(coverage.games);
    expect(coverage.gaps).toBe(0);
  });

  it("shows the known gaps of older editions", () => {
    const old = archive.editions.find((b) => b.edition.id === "ed:worlds-2016");
    if (!old) return;
    const coverage = editionCoverage(old);
    expect(coverage.gamesWithDraft).toBe(0);
    expect(coverage.gaps).toBeGreaterThan(0);
  });
});
