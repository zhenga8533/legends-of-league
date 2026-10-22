/** Archive-wide statistics for the stats page. Pure functions of loaded data. */
import type { Game, PlayerGameStats, Region } from "@lol/schema";
import type { WinLoss } from "@lol/sim";
import type { Entities } from "./entities";
import type { EditionBundle } from "./load";
import { type Archive, editionSummary } from "./views";

export interface EditionWin {
  edition: string;
  tournament: string;
  year: number;
  /** The team identity at the time, e.g. SK Telecom T1 for an org now called T1. */
  team: string;
}

export interface OrganizationTitles {
  org: string;
  /** Titles per tournament ID. */
  titles: Record<string, number>;
  total: number;
  finals: number;
  wins: EditionWin[];
}

const add = (record: Record<string, number>, key: string, n = 1) => {
  record[key] = (record[key] ?? 0) + n;
};

function finalists(bundle: EditionBundle) {
  const { champion, runnerUp } = editionSummary(bundle);
  return { champion, runnerUp };
}

const win = (bundle: EditionBundle, team: string): EditionWin => ({
  edition: bundle.edition.id,
  tournament: bundle.edition.tournament,
  year: bundle.edition.year,
  team,
});

/** Titles and finals appearances per organization, so rebrands count together. */
export function titlesByOrganization(archive: Archive): OrganizationTitles[] {
  const rows = new Map<string, OrganizationTitles>();
  const row = (team: string): OrganizationTitles => {
    const org = archive.entities.teams.get(team)?.org ?? team;
    let entry = rows.get(org);
    if (!entry) {
      entry = { org, titles: {}, total: 0, finals: 0, wins: [] };
      rows.set(org, entry);
    }
    return entry;
  };
  for (const bundle of archive.editions) {
    const { champion, runnerUp } = finalists(bundle);
    if (champion) {
      const entry = row(champion);
      add(entry.titles, bundle.edition.tournament);
      entry.total++;
      entry.finals++;
      entry.wins.push(win(bundle, champion));
    }
    if (runnerUp) row(runnerUp).finals++;
  }
  return [...rows.values()].sort(
    (a, b) => b.total - a.total || b.finals - a.finals || a.org.localeCompare(b.org),
  );
}

export interface RegionFamily {
  key: string;
  /** The latest abbreviation in the family. */
  label: string;
  /** Every era's abbreviation, oldest first ("EU", "EU LCS", "LEC"). */
  abbreviations: string[];
  regions: string[];
}

/**
 * Regions that are one league across eras: one-to-one renames (EU -> EU LCS -> LEC) and eras
 * sharing an abbreviation (LCS before and after the 2025 LTA). Splits and merges stay apart.
 */
export function regionFamilies(entities: Entities): Map<string, RegionFamily> {
  const regions = [...entities.regions.values()];
  const root = (id: string): string => {
    const region = entities.regions.get(id);
    const [predecessor, ...others] = region?.predecessors ?? [];
    const before = predecessor ? entities.regions.get(predecessor) : undefined;
    if (!before || others.length > 0 || before.successors?.length !== 1) return id;
    return root(before.id);
  };
  const byRoot = new Map<string, Region[]>();
  for (const region of regions)
    byRoot.set(root(region.id), [...(byRoot.get(root(region.id)) ?? []), region]);
  // Oldest era first; eras without a start date are the oldest.
  const chronological = (eras: Region[]) =>
    [...eras].sort((a, b) => (a.active.start ?? "").localeCompare(b.active.start ?? ""));
  const byLabel = new Map<string, Region[]>();
  for (const eras of byRoot.values()) {
    const label = chronological(eras).at(-1)?.abbreviation ?? "";
    byLabel.set(label, [...(byLabel.get(label) ?? []), ...eras]);
  }
  const families = new Map<string, RegionFamily>();
  for (const [label, eras] of byLabel) {
    const ordered = chronological(eras);
    const family = {
      key: ordered.at(-1)?.id ?? "",
      label,
      abbreviations: [...new Set(ordered.map((region) => region.abbreviation))],
      regions: ordered.map((region) => region.id).sort(),
    };
    for (const region of eras) families.set(region.id, family);
  }
  return families;
}

export interface RegionTitles {
  family: RegionFamily;
  titles: Record<string, number>;
  total: number;
  finals: number;
}

/** Titles by the champion's region at the time, grouped into region families. */
export function titlesByRegion(archive: Archive): RegionTitles[] {
  const families = regionFamilies(archive.entities);
  const rows = new Map<string, RegionTitles>();
  for (const bundle of archive.editions) {
    const regionOf = new Map(bundle.edition.participants.map((p) => [p.team, p.region]));
    const { champion, runnerUp } = finalists(bundle);
    for (const team of [champion, runnerUp]) {
      const family = team ? families.get(regionOf.get(team) ?? "") : undefined;
      if (!team || !family) continue;
      const entry = rows.get(family.key) ?? { family, titles: {}, total: 0, finals: 0 };
      entry.finals++;
      if (team === champion) {
        add(entry.titles, bundle.edition.tournament);
        entry.total++;
      }
      rows.set(family.key, entry);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.total - a.total || b.finals - a.finals || a.family.label.localeCompare(b.family.label),
  );
}

export interface CrossRegionRecord {
  family: RegionFamily;
  total: WinLoss;
  byYear: Record<number, WinLoss>;
}

/** Series records against teams from other region families, per year. */
export function crossRegionRecords(archive: Archive): CrossRegionRecord[] {
  const families = regionFamilies(archive.entities);
  const rows = new Map<string, CrossRegionRecord>();
  for (const bundle of archive.editions) {
    const regionOf = new Map(bundle.edition.participants.map((p) => [p.team, p.region]));
    for (const series of bundle.series) {
      if (!series.winner) continue;
      const [first, second] = series.teams;
      const a = families.get(regionOf.get(first) ?? "");
      const b = families.get(regionOf.get(second) ?? "");
      if (!a || !b || a.key === b.key) continue;
      for (const [team, family] of [
        [first, a],
        [second, b],
      ] as const) {
        const entry = rows.get(family.key) ?? {
          family,
          total: { wins: 0, losses: 0 },
          byYear: {},
        };
        const year = (entry.byYear[bundle.edition.year] ??= { wins: 0, losses: 0 });
        const outcome = series.winner === team ? "wins" : "losses";
        year[outcome]++;
        entry.total[outcome]++;
        rows.set(family.key, entry);
      }
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.total.wins + b.total.losses - (a.total.wins + a.total.losses),
  );
}

export interface OrganizationRecord {
  org: string;
  appearances: number;
  series: WinLoss;
  games: WinLoss;
}

/** International series and game records per organization. */
export function organizationRecords(archive: Archive): OrganizationRecord[] {
  const rows = new Map<string, OrganizationRecord>();
  const row = (team: string) => {
    const org = archive.entities.teams.get(team)?.org ?? team;
    let entry = rows.get(org);
    if (!entry) {
      entry = {
        org,
        appearances: 0,
        series: { wins: 0, losses: 0 },
        games: { wins: 0, losses: 0 },
      };
      rows.set(org, entry);
    }
    return entry;
  };
  for (const bundle of archive.editions) {
    for (const { team } of bundle.edition.participants) row(team).appearances++;
    for (const series of bundle.series) {
      const { score, winner } = series;
      if (!score || !winner) continue;
      series.teams.forEach((team, side) => {
        const entry = row(team);
        const [own, other] = side === 0 ? score : [score[1], score[0]];
        entry.series[winner === team ? "wins" : "losses"]++;
        entry.games.wins += own;
        entry.games.losses += other;
      });
    }
  }
  return [...rows.values()];
}

export interface PlayerTitles {
  player: string;
  wins: EditionWin[];
}

/**
 * International titles per player: everyone on the champion's registered roster (coaches
 * excluded) or with recorded games for it, as Leaguepedia credits substitutes too.
 */
export function titlesByPlayer(archive: Archive): PlayerTitles[] {
  const rows = new Map<string, PlayerTitles>();
  for (const bundle of archive.editions) {
    const { champion } = finalists(bundle);
    if (!champion) continue;
    const players = new Set([
      ...bundle.rosters
        .filter((r) => r.team === champion && r.role !== "coach")
        .map((r) => r.player),
      ...bundle.playerStats.filter((s) => s.team === champion).map((s) => s.player),
    ]);
    for (const player of players) {
      const entry = rows.get(player) ?? { player, wins: [] };
      entry.wins.push(win(bundle, champion));
      rows.set(player, entry);
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.wins.length - a.wins.length || a.player.localeCompare(b.player),
  );
}

export interface GameRecord {
  game: Game;
  edition: string;
}

export interface PlayerGameRecord extends GameRecord {
  stats: PlayerGameStats;
}

export interface Records {
  longestGame?: GameRecord;
  shortestGame?: GameRecord;
  mostKills?: PlayerGameRecord;
  mostAssists?: PlayerGameRecord;
  mostDeaths?: PlayerGameRecord;
}

/** Single-game records. Ties go to the earliest game. */
export function gameRecords(archive: Archive): Records {
  const records: Records = {};
  const better = <T>(
    current: T | undefined,
    value: number,
    best: (r: T) => number,
    more: boolean,
  ) => current === undefined || (more ? value > best(current) : value < best(current));
  for (const bundle of archive.editions) {
    const games = new Map(bundle.games.map((g) => [g.id, g]));
    for (const game of bundle.games) {
      const duration = game.durationSeconds;
      if (duration == null) continue;
      const record = { game, edition: bundle.edition.id };
      if (better(records.longestGame, duration, (r) => r.game.durationSeconds ?? 0, true))
        records.longestGame = record;
      if (better(records.shortestGame, duration, (r) => r.game.durationSeconds ?? Infinity, false))
        records.shortestGame = record;
    }
    for (const stats of bundle.playerStats) {
      const game = games.get(stats.game);
      if (!game) continue;
      const record = { game, edition: bundle.edition.id, stats };
      if (better(records.mostKills, stats.kills, (r) => r.stats.kills, true))
        records.mostKills = record;
      if (better(records.mostAssists, stats.assists, (r) => r.stats.assists, true))
        records.mostAssists = record;
      if (better(records.mostDeaths, stats.deaths, (r) => r.stats.deaths, true))
        records.mostDeaths = record;
    }
  }
  return records;
}

/** One played series, compact, for the head-to-head tool. */
export interface MeetingRow {
  series: string;
  edition: string;
  date?: string;
  /** Organizations, then the team identities at the time. */
  orgs: [string, string];
  teams: [string, string];
  score: [number, number];
  winner: 0 | 1;
}

export function meetings(archive: Archive): MeetingRow[] {
  const org = (team: string) => archive.entities.teams.get(team)?.org ?? team;
  return archive.editions.flatMap((bundle) =>
    bundle.series.flatMap((s): MeetingRow[] =>
      s.score && s.winner
        ? [
            {
              series: s.id,
              edition: bundle.edition.id,
              ...(s.start ? { date: s.start.slice(0, 10) } : {}),
              orgs: [org(s.teams[0]), org(s.teams[1])],
              teams: s.teams,
              score: s.score,
              winner: s.winner === s.teams[0] ? 0 : 1,
            },
          ]
        : [],
    ),
  );
}
