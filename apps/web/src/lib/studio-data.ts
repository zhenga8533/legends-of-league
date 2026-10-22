/** Build-time construction of the Studio's per-edition payloads. */
import {
  type EditionBundle,
  actualPlacements,
  actualSeries,
  idSlug,
  knownSeries,
  ratedGames,
  tournamentInput,
} from "@lol/data";
import { eloModel, ratingsBefore, runMonteCarlo } from "@lol/sim";
import { PRE_EVENT_ITERATIONS } from "../studio/constants";
import { runChunked } from "../studio/montecarlo";
import type { EditionPayload } from "../studio/payload";
import { defaultScenario } from "../studio/scenario";
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
  const live = bundle.edition.status === "live";
  const payload: EditionPayload = {
    edition: {
      id: bundle.edition.id,
      slug: editionSlug(bundle),
      name: bundle.edition.name,
      year: bundle.edition.year,
      tournament: bundle.edition.tournament,
      path: paths.edition(bundle),
      live,
    },
    ruleset: rules,
    participants: input.participants.map((p) => ({ ...p })),
    actualSeries: actualSeries(bundle),
    scheduledSeries: knownSeries(bundle).filter((series) => !series.score),
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
  if (live) {
    // Set up exactly like the Studio's default scenario for a live edition.
    payload.forecast = runChunked(
      payload,
      { ...defaultScenario(payload.edition.slug, true), seed: `forecast:${bundle.edition.id}` },
      PRE_EVENT_ITERATIONS,
    );
  }
  return payload;
}
