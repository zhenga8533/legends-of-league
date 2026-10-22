import { describe, expect, it } from "vitest";
import {
  crossRegionRecords,
  editionSummary,
  gameRecords,
  loadArchive,
  meetings,
  organizationRecords,
  regionFamilies,
  titlesByOrganization,
  titlesByPlayer,
  titlesByRegion,
} from "../src";

const archive = loadArchive();
const decided = archive.editions.filter((b) => editionSummary(b).champion);

describe("titles", () => {
  it("count each decided edition once, by organization and by region", () => {
    const byOrg = titlesByOrganization(archive);
    expect(byOrg.reduce((sum, row) => sum + row.total, 0)).toBe(decided.length);
    expect(byOrg.reduce((sum, row) => sum + row.finals, 0)).toBe(
      decided.filter((b) => editionSummary(b).runnerUp).length + decided.length,
    );
    expect(titlesByRegion(archive).reduce((sum, row) => sum + row.total, 0)).toBe(decided.length);
  });

  it("add up every identity of an organization", () => {
    const teams = new Map(archive.entities.teams);
    teams.set("team:sk-telecom-t1", { ...teams.get("team:sk-telecom-t1")!, org: "org:t1" });
    const merged = { ...archive, entities: { ...archive.entities, teams } };
    const t1 = titlesByOrganization(merged).find((row) => row.org === "org:t1")!;
    const asTeams = (team: string) =>
      decided.filter((b) => editionSummary(b).champion === team).length;
    expect(t1.total).toBe(asTeams("team:t1") + asTeams("team:sk-telecom-t1"));
    expect(new Set(t1.wins.map((w) => w.team))).toEqual(new Set(["team:t1", "team:sk-telecom-t1"]));
  });

  it("credit every rostered player of the champion", () => {
    const worlds = archive.editions.find((b) => b.edition.id === "ed:worlds-2024")!;
    const champion = editionSummary(worlds).champion!;
    const credited = titlesByPlayer(archive)
      .filter((row) => row.wins.some((w) => w.edition === worlds.edition.id))
      .map((row) => row.player);
    const players = worlds.rosters.filter((r) => r.team === champion && r.role !== "coach");
    expect(credited).toEqual(expect.arrayContaining(players.map((r) => r.player)));
  });
});

describe("regions", () => {
  it("group one league across eras but keep splits and merges apart", () => {
    const families = regionFamilies(archive.entities);
    const label = (id: string) => families.get(id)?.label;
    expect(families.get("region:eu")).toBe(families.get("region:lec"));
    expect(families.get("region:na")).toBe(families.get("region:lcs-2026"));
    expect(label("region:lec")).toBe("LEC");
    expect(families.get("region:lta")).not.toBe(families.get("region:lcs"));
    expect(families.get("region:lcp")).not.toBe(families.get("region:pcs"));
  });

  it("records cross-region series from both sides", () => {
    const records = crossRegionRecords(archive);
    const wins = records.reduce((sum, r) => sum + r.total.wins, 0);
    const losses = records.reduce((sum, r) => sum + r.total.losses, 0);
    expect(wins).toBe(losses);
    expect(wins).toBeGreaterThan(0);
  });
});

describe("records", () => {
  it("find the extremes", () => {
    const records = gameRecords(archive);
    const durations = archive.editions.flatMap((b) =>
      b.games.flatMap((g) => (g.durationSeconds == null ? [] : [g.durationSeconds])),
    );
    expect(records.longestGame?.game.durationSeconds).toBe(Math.max(...durations));
    expect(records.shortestGame?.game.durationSeconds).toBe(Math.min(...durations));
    const kills = archive.editions.flatMap((b) => b.playerStats.map((s) => s.kills));
    expect(records.mostKills?.stats.kills).toBe(Math.max(...kills));
  });

  it("keep organization records consistent with the series", () => {
    const rows = organizationRecords(archive);
    const wins = rows.reduce((sum, r) => sum + r.series.wins, 0);
    expect(wins).toBe(rows.reduce((sum, r) => sum + r.series.losses, 0));
    expect(wins).toBe(meetings(archive).length);
  });
});
