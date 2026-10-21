import { replayTournament } from "@lol/sim";
import { describe, expect, it } from "vitest";
import {
  actualPlacements,
  actualSeries,
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

      it("reproduces every recorded series and the final placements", () => {
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
      });
    },
  );
});
