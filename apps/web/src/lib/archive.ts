/** Build-time access to the archive for pages. Loaded once per build. */
import { type EditionBundle, idSlug, loadArchive, playerHandle, rulesetFor } from "@lol/data";
import { withBase } from "./paths";

export const archive = loadArchive({
  dataDir: import.meta.env.LOL_DATA_DIR,
  rulesetsDir: import.meta.env.LOL_RULESETS_DIR,
});
const { entities } = archive;

export const editionsNewestFirst = [...archive.editions].reverse();

export function ruleset(bundle: EditionBundle) {
  const found = rulesetFor(bundle.edition.id, archive.rulesets);
  if (!found) throw new Error(`no ruleset for ${bundle.edition.id}`);
  return found;
}

export function teamName(id: string): string {
  return entities.teams.get(id)?.name ?? idSlug(id);
}

export function teamTag(id: string): string {
  return entities.teams.get(id)?.shortName ?? teamName(id);
}

export function playerName(id: string): string {
  const player = entities.players.get(id);
  return player ? playerHandle(player) : idSlug(id);
}

export function regionAbbr(id: string): string {
  return entities.regions.get(id)?.abbreviation ?? idSlug(id);
}

export function tournamentName(id: string): string {
  return entities.tournaments.get(id)?.name ?? idSlug(id);
}

export function tournamentShortName(id: string): string {
  return entities.tournaments.get(id)?.shortName ?? idSlug(id);
}

export const paths = {
  tournament: (tournamentId: string) => withBase(`/tournaments/${idSlug(tournamentId)}/`),
  edition: (bundle: EditionBundle) =>
    withBase(`/tournaments/${idSlug(bundle.edition.tournament)}/${bundle.edition.year}/`),
  series: (id: string) => withBase(`/matches/${idSlug(id)}/`),
  team: (id: string) => withBase(`/teams/${idSlug(id)}/`),
  player: (id: string) => withBase(`/players/${idSlug(id)}/`),
  region: (id: string) => withBase(`/regions/${idSlug(id)}/`),
};

/** Finds which edition a series belongs to. */
export function editionOfSeries(seriesId: string): EditionBundle {
  const bundle = archive.editions.find((b) => b.series.some((s) => s.id === seriesId));
  if (!bundle) throw new Error(`unknown series ${seriesId}`);
  return bundle;
}

export function stageName(bundle: EditionBundle, stageId: string): string {
  return bundle.edition.stages.find((stage) => stage.id === stageId)?.name ?? stageId;
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export function formatDate(value: string | null | undefined): string {
  return value ? dateFormat.format(new Date(value)) : "—";
}

export function dateRange(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  return end && end !== start ? `${formatDate(start)} – ${formatDate(end)}` : formatDate(start);
}
