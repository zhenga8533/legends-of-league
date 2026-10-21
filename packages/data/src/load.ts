/** Build-time loaders for the canonical dataset and rulesets (Node only). */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Edition,
  Game,
  Placement,
  PlayerGameStats,
  Provenance,
  RosterEntry,
  Series,
} from "@lol/schema";
import { type Ruleset, parseRuleset } from "@lol/sim";

export const DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));
export const RULESETS_DIR = fileURLToPath(new URL("../../../rulesets/", import.meta.url));

export interface EditionBundle {
  edition: Edition;
  series: Series[];
  games: Game[];
  playerStats: PlayerGameStats[];
  rosters: RosterEntry[];
  placements: Placement[];
  provenance: Provenance;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadEdition(directory: string): EditionBundle {
  const file = (name: string) => join(directory, name);
  return {
    edition: readJson(file("edition.json")),
    series: readJson(file("series.json")),
    games: readJson(file("games.json")),
    playerStats: readJson(file("player-stats.json")),
    rosters: readJson(file("rosters.json")),
    placements: readJson(file("results.json")),
    provenance: readJson(file("provenance.json")),
  };
}

export function loadEditions(dataDir: string = DATA_DIR): EditionBundle[] {
  const root = join(dataDir, "tournaments");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((tournament) =>
      readdirSync(join(root, tournament.name), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((year) => join(root, tournament.name, year.name)),
    )
    .filter((directory) => existsSync(join(directory, "edition.json")))
    .map(loadEdition)
    .sort((a, b) => (a.edition.dates.start ?? "").localeCompare(b.edition.dates.start ?? ""));
}

export function loadRulesets(directory: string = RULESETS_DIR): Ruleset[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      try {
        return parseRuleset(readJson(join(directory, name)));
      } catch (error) {
        throw new Error(`invalid ruleset ${name}`, { cause: error });
      }
    });
}

export function rulesetFor(editionId: string, rulesets: readonly Ruleset[]): Ruleset | undefined {
  const matches = rulesets.filter((ruleset) => ruleset.editions.includes(editionId));
  if (matches.length > 1) {
    throw new Error(`${editionId} is claimed by rulesets ${matches.map((r) => r.id).join(", ")}`);
  }
  return matches[0];
}
