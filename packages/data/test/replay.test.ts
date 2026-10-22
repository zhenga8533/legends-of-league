import { replayTournament } from "@lol/sim";
import { describe, expect, it } from "vitest";
import {
  actualPlacements,
  actualSeries,
  inProgress,
  knownSeries,
  loadEditions,
  loadRulesets,
  rulesetFor,
  tournamentInput,
} from "../src";

const editions = loadEditions();
const rulesets = loadRulesets();

describe("historical replays", () => {
  it("covers every imported edition", () => {
    const missing = editions
      .map((bundle) => bundle.edition.id)
      .filter((id) => !rulesetFor(id, rulesets));
    expect(missing).toEqual([]);
    expect(editions.length).toBeGreaterThan(0);
  });

  describe.each(editions.map((bundle) => [bundle.edition.id, bundle] as const))(
    "%s",
    (id, bundle) => {
      const ruleset = rulesetFor(id, rulesets);

      it.skipIf(inProgress(bundle))(
        "reproduces every recorded series and the final placements",
        () => {
          if (!ruleset) throw new Error(`no ruleset for ${id}`);
          const { result, unused } = replayTournament(
            tournamentInput(bundle, ruleset),
            actualSeries(bundle),
          );

          expect(unused).toEqual([]);
          expect(result.matches).toHaveLength(bundle.series.length);
          expect(Object.fromEntries(result.placements)).toEqual(
            Object.fromEntries(actualPlacements(bundle)),
          );
        },
      );

      // An event in progress: everything played so far fits the ruleset, the scheduled pairings
      // are ones it can produce, and the places decided so far are the ones it gives.
      it.runIf(inProgress(bundle))("fits every series played so far", () => {
        if (!ruleset) throw new Error(`no ruleset for ${id}`);
        const { result, unused } = replayTournament(
          tournamentInput(bundle, ruleset),
          knownSeries(bundle),
          { inProgress: true },
        );

        expect(unused).toEqual([]);
        const played = result.matches.filter((m) => m.source === "actual");
        expect(played).toHaveLength(actualSeries(bundle).length);
        for (const [team, place] of actualPlacements(bundle)) {
          expect(result.placements.get(team), team).toEqual(place);
        }
      });
    },
  );
});
