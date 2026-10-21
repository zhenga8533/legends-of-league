/** Build-time construction of the Studio's per-edition payloads. */
import {
  type EditionBundle,
  actualPlacements,
  actualSeries,
  idSlug,
  ratedGames,
  tournamentInput,
} from "@lol/data";
import { eloModel, ratingsBefore, runMonteCarlo } from "@lol/sim";
import { PRE_EVENT_ITERATIONS } from "../studio/constants";
import type { EditionPayload } from "../studio/payload";
import { archive, paths, regionAbbr, ruleset, teamLabels } from "./archive";

const games = ratedGames(archive.editions);

export function editionSlug(bundle: EditionBundle): string {
  return idSlug(bundle.edition.id);
}

export function buildPayload(bundle: EditionBundle): EditionPayload {
  const rules = ruleset(bundle);
  const input = tournamentInput(bundle, rules);
  const book = ratingsBefore(games, bundle.edition.dates.start ?? "");
  const ratings = Object.fromEntries(
    input.participants.map((p) => [
      p.team,
      Math.round(book.ratings.get(p.team) ?? book.regionMean(p.region ?? "")),
    ]),
  );
  const preEvent = runMonteCarlo(input, {
    iterations: PRE_EVENT_ITERATIONS,
    seed: `pre-event:${bundle.edition.id}`,
    model: eloModel(new Map(Object.entries(ratings))),
  });
  return {
    edition: {
      id: bundle.edition.id,
      slug: editionSlug(bundle),
      name: bundle.edition.name,
      year: bundle.edition.year,
      tournament: bundle.edition.tournament,
      path: paths.edition(bundle),
    },
    ruleset: rules,
    participants: input.participants.map((p) => ({ ...p })),
    actualSeries: actualSeries(bundle),
    actualPlacements: Object.fromEntries(actualPlacements(bundle)),
    teams: Object.fromEntries(
      bundle.edition.participants.map((p) => [
        p.team,
        { ...(teamLabels[p.team] ?? { name: p.team, tag: p.team }), region: p.region },
      ]),
    ),
    regions: Object.fromEntries(
      bundle.edition.participants.map((p) => [p.region, regionAbbr(p.region)]),
    ),
    ratings,
    preEvent,
  };
}
