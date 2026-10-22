/** Derived, page-ready views over the archive. Pure functions of loaded data. */
import type { Game, PlayerGameStats, Series } from "@lol/schema";
import {
  type MatchSummary,
  type Ruleset,
  type StageSummary,
  type TeamId,
  type WinLoss,
  replayTournament,
  summarizeStages,
} from "@lol/sim";
import { type Entities, loadEntities } from "./entities";
import { DATA_DIR, type EditionBundle, RULESETS_DIR, loadEditions, loadRulesets } from "./load";
import { inProgress, knownSeries, tournamentInput } from "./sim";

export interface Archive {
  editions: EditionBundle[];
  entities: Entities;
  rulesets: Ruleset[];
}

/**
 * Loads everything. Bundlers move this module, so callers that are bundled (the Astro site)
 * pass the real directories instead of relying on the defaults next to the package.
 */
export function loadArchive(dirs: { dataDir?: string; rulesetsDir?: string } = {}): Archive {
  const dataDir = dirs.dataDir ?? DATA_DIR;
  return {
    editions: loadEditions(dataDir),
    entities: loadEntities(dataDir),
    rulesets: loadRulesets(dirs.rulesetsDir ?? RULESETS_DIR),
  };
}

type Result = "score" | "winner" | "loser" | "source";

/**
 * A match on an edition page. An event in progress also lists its upcoming matches, and slots
 * whose teams aren't decided yet: those have empty team IDs ("TBD") and no series.
 */
export interface MatchView extends Omit<MatchSummary, Result>, Partial<Pick<MatchSummary, Result>> {
  seriesId?: string;
  start?: string;
}

/** The team ID of an undecided slot. */
export const TBD = "";

export interface StageView extends Omit<StageSummary, "matches"> {
  matches: MatchView[];
}

const pairKey = (teams: readonly TeamId[]): string => [...teams].sort().join("|");

/**
 * Stages as the verified replay sees them. The replay knows each match's real position
 * (bracket slot, Swiss round, group), which Leaguepedia's schedule labels do not encode reliably.
 *
 * An event in progress is played out with coin flips past what is recorded, which gives the
 * format's full structure: played matches are real; a simulated match between teams Leaguepedia
 * has scheduled is shown as upcoming; any other simulated match is shown as a slot with both
 * teams TBD. Simulated tiebreakers are dropped (they may never be needed), and no simulated
 * team or result is ever shown.
 */
export function editionStages(bundle: EditionBundle, ruleset: Ruleset): StageView[] {
  const live = inProgress(bundle);
  const { result } = replayTournament(tournamentInput(bundle, ruleset), knownSeries(bundle), {
    inProgress: live,
  });
  const remaining = [...bundle.series].sort(
    (a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.number - b.number,
  );
  const find = (stage: string, teams: readonly TeamId[], played: boolean): Series | undefined => {
    const index = remaining.findIndex(
      (s) => s.stage === stage && pairKey(s.teams) === pairKey(teams) && !!s.score === played,
    );
    return index === -1 ? undefined : remaining.splice(index, 1)[0];
  };
  const linked = (series: Series) => ({
    seriesId: series.id,
    ...(series.start ? { start: series.start } : {}),
  });
  const stages = summarizeStages(result, ruleset).map((stage) => ({
    ...stage,
    matches: stage.matches.flatMap((match): MatchView[] => {
      if (match.source === "actual") {
        const series = find(stage.id, match.teams, true);
        if (!series) throw new Error(`${stage.id}: no series for ${match.teams.join(" vs ")}`);
        return [{ ...match, ...linked(series) }];
      }
      if (/tiebreaker/i.test(match.label)) return [];
      const { label, bestOf, group, records } = match;
      const slot = { label, bestOf, ...(group ? { group } : {}), ...(records ? { records } : {}) };
      const scheduled = find(stage.id, match.teams, false);
      return [
        scheduled
          ? { ...slot, teams: match.teams, ...linked(scheduled) }
          : { ...slot, teams: [TBD, TBD] },
      ];
    }),
  }));
  for (const series of remaining) {
    const stage = stages.find((s) => s.id === series.stage);
    if (!stage || series.score) throw new Error(`${series.id}: not part of the replay`);
    const records = stage.format === "swiss" ? swissRecords(stage.matches) : undefined;
    stage.matches.push({
      label: series.round,
      teams: series.teams,
      bestOf: series.bestOf,
      seriesId: series.id,
      ...(series.start ? { start: series.start } : {}),
      ...(records ? { records: [records(series.teams[0]), records(series.teams[1])] } : {}),
    });
  }
  return stages;
}

function swissRecords(matches: readonly MatchView[]): (team: TeamId) => WinLoss {
  const records = new Map<TeamId, WinLoss>();
  const record = (team: TeamId) => records.get(team) ?? { wins: 0, losses: 0 };
  for (const { winner, loser } of matches) {
    if (!winner || !loser) continue;
    records.set(winner, { ...record(winner), wins: record(winner).wins + 1 });
    records.set(loser, { ...record(loser), losses: record(loser).losses + 1 });
  }
  return record;
}

export interface Standing {
  team: TeamId;
  region: string;
  entryStage: string;
  place?: [number, number];
  series: WinLoss;
  games: WinLoss;
}

function tallyInto(table: Map<TeamId, Standing>, series: readonly Series[]): void {
  for (const s of series) {
    const { score, winner } = s;
    if (!score || !winner) continue;
    s.teams.forEach((team, side) => {
      const row = table.get(team);
      if (!row) return;
      const [own, other] = side === 0 ? score : [score[1], score[0]];
      row.series[winner === team ? "wins" : "losses"]++;
      row.games.wins += own;
      row.games.losses += other;
    });
  }
}

/** Every participant with final place and series/game records, best place first. */
// Pages ask for the same derived views many times (every team page scans every edition), so
// results are cached per loaded edition. Bundles are never mutated after loading.
const standingsCache = new WeakMap<EditionBundle, Standing[]>();
const statsByPlayerCache = new WeakMap<EditionBundle, Map<string, PlayerGameStats[]>>();

function statsByPlayer(bundle: EditionBundle): Map<string, PlayerGameStats[]> {
  let index = statsByPlayerCache.get(bundle);
  if (!index) {
    index = new Map();
    for (const row of bundle.playerStats)
      index.set(row.player, [...(index.get(row.player) ?? []), row]);
    statsByPlayerCache.set(bundle, index);
  }
  return index;
}

export function editionStandings(bundle: EditionBundle): Standing[] {
  const cached = standingsCache.get(bundle);
  if (cached) return cached;
  const standings = computeStandings(bundle);
  standingsCache.set(bundle, standings);
  return standings;
}

function computeStandings(bundle: EditionBundle): Standing[] {
  const places = new Map(
    bundle.placements.map((p) => [p.team, [p.placeFrom, p.placeTo] as [number, number]]),
  );
  const table = new Map<TeamId, Standing>(
    bundle.edition.participants.map((p) => {
      const place = places.get(p.team);
      return [
        p.team,
        {
          team: p.team,
          region: p.region,
          entryStage: p.entryStage,
          ...(place ? { place } : {}),
          series: { wins: 0, losses: 0 },
          games: { wins: 0, losses: 0 },
        },
      ];
    }),
  );
  tallyInto(table, bundle.series);
  return [...table.values()].sort(
    (a, b) =>
      (a.place?.[0] ?? Infinity) - (b.place?.[0] ?? Infinity) ||
      b.series.wins - a.series.wins ||
      a.team.localeCompare(b.team),
  );
}

export interface EditionSummary {
  champion?: TeamId;
  runnerUp?: TeamId;
  final?: Series;
}

export function editionSummary(bundle: EditionBundle): EditionSummary {
  const champion = bundle.placements.find((p) => p.placeFrom === 1)?.team;
  const runnerUp = bundle.placements.find((p) => p.placeFrom === 2 && p.placeTo === 2)?.team;
  const final = [...bundle.series]
    .filter((s) => champion && runnerUp && s.teams.includes(champion) && s.teams.includes(runnerUp))
    .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""))[0];
  return {
    ...(champion ? { champion } : {}),
    ...(runnerUp ? { runnerUp } : {}),
    ...(final ? { final } : {}),
  };
}

export interface TeamAppearance {
  bundle: EditionBundle;
  standing: Standing;
  roster: { player: string; role: string }[];
}

/** A team identity's international appearances, oldest first. */
export function teamHistory(archive: Archive, team: TeamId): TeamAppearance[] {
  return archive.editions.flatMap((bundle) => {
    const standing = editionStandings(bundle).find((s) => s.team === team);
    if (!standing) return [];
    // Players in role order (top to support), then coaches.
    const rank = (role: string) => (ROLE_ORDER.includes(role) ? ROLE_ORDER.indexOf(role) : 5);
    const roster = bundle.rosters
      .filter((entry) => entry.team === team)
      .map(({ player, role }) => ({ player, role }))
      .sort((a, b) => rank(a.role) - rank(b.role));
    return [{ bundle, standing, roster }];
  });
}

export interface ChampionLine {
  champion: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface PlayerEdition {
  bundle: EditionBundle;
  team: TeamId;
  role: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface PlayerCareer {
  editions: PlayerEdition[];
  champions: ChampionLine[];
}

export function playerCareer(archive: Archive, player: string): PlayerCareer {
  const champions = new Map<string, ChampionLine>();
  const editions: PlayerEdition[] = [];
  for (const bundle of archive.editions) {
    const winners = new Map(bundle.games.map((g) => [g.id, g.winner]));
    const rows = statsByPlayer(bundle).get(player) ?? [];
    const rosterEntry = bundle.rosters.find((entry) => entry.player === player);
    const first = rows[0] ?? rosterEntry;
    if (!first) continue;
    const line: PlayerEdition = {
      bundle,
      team: first.team,
      role: first.role,
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    };
    for (const row of rows) {
      const won = winners.get(row.game) === row.team ? 1 : 0;
      const champ = champions.get(row.champion) ?? {
        champion: row.champion,
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
      };
      for (const target of [line, champ]) {
        target.games++;
        target.wins += won;
        target.kills += row.kills;
        target.deaths += row.deaths;
        target.assists += row.assists;
      }
      champions.set(row.champion, champ);
    }
    editions.push(line);
  }
  return {
    editions,
    champions: [...champions.values()].sort(
      (a, b) => b.games - a.games || b.wins - a.wins || a.champion.localeCompare(b.champion),
    ),
  };
}

export interface GameView {
  game: Game;
  blue: PlayerGameStats[];
  red: PlayerGameStats[];
}

const ROLE_ORDER = ["top", "jungle", "mid", "bot", "support"];

export function seriesGames(bundle: EditionBundle, seriesId: string): GameView[] {
  return bundle.games
    .filter((game) => game.series === seriesId)
    .sort((a, b) => a.number - b.number)
    .map((game) => {
      const rows = bundle.playerStats
        .filter((row) => row.game === game.id)
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
      return {
        game,
        blue: rows.filter((row) => row.side === "blue"),
        red: rows.filter((row) => row.side === "red"),
      };
    });
}

export function kda({
  kills,
  deaths,
  assists,
}: {
  kills: number;
  deaths: number;
  assists: number;
}): string {
  return deaths === 0 ? "Perfect" : ((kills + assists) / deaths).toFixed(2);
}

export function placeText(place: readonly [number, number] | undefined): string {
  if (!place) return "—";
  return place[0] === place[1] ? ordinal(place[0]) : `${ordinal(place[0])}–${ordinal(place[1])}`;
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
}

export interface EditionCoverage {
  series: number;
  /** Games implied by the series scores (forfeits excluded). */
  expectedGames: number;
  games: number;
  gamesWithDraft: number;
  gamesWithStats: number;
  rosterEntries: number;
  placements: number;
  participants: number;
  gaps: number;
}

/** How complete an edition's data is, for the coverage page. */
export function editionCoverage(bundle: EditionBundle): EditionCoverage {
  const statsPerGame = new Map<string, number>();
  for (const row of bundle.playerStats)
    statsPerGame.set(row.game, (statsPerGame.get(row.game) ?? 0) + 1);
  return {
    series: bundle.series.length,
    expectedGames: bundle.series.reduce(
      (sum, s) => sum + (s.score && !s.forfeit ? s.score[0] + s.score[1] : 0),
      0,
    ),
    games: bundle.games.length,
    gamesWithDraft: bundle.games.filter((g) => g.draft).length,
    gamesWithStats: bundle.games.filter((g) => statsPerGame.get(g.id) === 10).length,
    rosterEntries: bundle.rosters.length,
    placements: bundle.placements.length,
    participants: bundle.edition.participants.length,
    gaps: (bundle.provenance.gaps ?? []).length,
  };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
