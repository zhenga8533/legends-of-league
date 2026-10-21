/** Derived, page-ready views over the archive. Pure functions of loaded data. */
import type { Game, PlayerGameStats, Series } from "@lol/schema";
import {
  type Format,
  type Ruleset,
  type Score,
  type TeamId,
  type WinLoss,
  replayTournament,
} from "@lol/sim";
import { type Entities, loadEntities } from "./entities";
import { DATA_DIR, type EditionBundle, RULESETS_DIR, loadEditions, loadRulesets } from "./load";
import { actualSeries, tournamentInput } from "./sim";

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

export interface MatchView {
  seriesId: string;
  /** Position within the stage as the engine names it, e.g. "Upper semifinal". */
  label: string;
  /** "Group A" for grouped stages. */
  group?: string;
  teams: [TeamId, TeamId];
  score: Score;
  winner: TeamId;
  bestOf: number;
  start?: string;
  /** Swiss only: both teams' records going into the match. */
  records?: [WinLoss, WinLoss];
}

export interface StageView {
  id: string;
  name: string;
  format: Format["type"];
  matches: MatchView[];
}

const pairKey = (teams: readonly TeamId[]): string => [...teams].sort().join("|");

/**
 * Stages as the verified replay sees them. The replay knows each match's real position
 * (bracket slot, Swiss round, group), which Leaguepedia's schedule labels do not encode reliably.
 */
export function editionStages(bundle: EditionBundle, ruleset: Ruleset): StageView[] {
  const { result } = replayTournament(tournamentInput(bundle, ruleset), actualSeries(bundle));
  const remaining = [...bundle.series].sort(
    (a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.number - b.number,
  );
  const take = (stage: string, teams: readonly TeamId[]): Series => {
    const index = remaining.findIndex(
      (s) => s.stage === stage && pairKey(s.teams) === pairKey(teams),
    );
    const [series] = remaining.splice(index, 1);
    if (index === -1 || !series) throw new Error(`${stage}: no series for ${teams.join(" vs ")}`);
    return series;
  };

  return ruleset.stages.map((definition) => {
    const records = new Map<TeamId, WinLoss>();
    const record = (team: TeamId): WinLoss => records.get(team) ?? { wins: 0, losses: 0 };
    const matches = (result.stages[definition.id]?.matches ?? []).map((match): MatchView => {
      const series = take(definition.id, match.teams);
      const group = /^(Group [A-Z]) (.*)$/.exec(match.label);
      const view: MatchView = {
        seriesId: series.id,
        label: group?.[2] ?? match.label,
        teams: match.teams,
        score: match.score,
        winner: match.winner,
        bestOf: match.bestOf,
        ...(series.start ? { start: series.start } : {}),
        ...(group?.[1] ? { group: group[1] } : {}),
      };
      if (definition.format.type === "swiss") {
        view.records = [record(match.teams[0]), record(match.teams[1])];
        const winner = record(match.winner);
        const loser = record(match.loser);
        records.set(match.winner, { wins: winner.wins + 1, losses: winner.losses });
        records.set(match.loser, { wins: loser.wins, losses: loser.losses + 1 });
      }
      return view;
    });
    return { id: definition.id, name: definition.name, format: definition.format.type, matches };
  });
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
export function editionStandings(bundle: EditionBundle): Standing[] {
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
    const roster = bundle.rosters
      .filter((entry) => entry.team === team)
      .map(({ player, role }) => ({ player, role }));
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
    const rows = bundle.playerStats.filter((row) => row.player === player);
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

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
