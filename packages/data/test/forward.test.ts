import { ReplayResolver, coinFlip, runMonteCarlo } from "@lol/sim";
import { describe, expect, it } from "vitest";
import { actualSeries, loadEditions, loadRulesets, rulesetFor, tournamentInput } from "../src";

const editions = loadEditions();
const rulesets = loadRulesets();

// The Studio simulates every edition from the start and from any later stage with the earlier
// stages' real results kept; every one of those must run (draws, tiebreakers, placements).
describe.each(editions.map((bundle) => [bundle.edition.id, bundle] as const))(
  "%s forward",
  (id, bundle) => {
    const ruleset = rulesetFor(id, rulesets)!;
    const input = tournamentInput(bundle, ruleset);

    it("simulates from every stage", () => {
      ruleset.stages.forEach((stage, index) => {
        const kept = new Set(ruleset.stages.slice(0, index).map((s) => s.id));
        const resolver = new ReplayResolver(
          actualSeries(bundle).filter((s) => kept.has(s.stage)),
          { lenient: true },
        );
        const result = runMonteCarlo(input, {
          iterations: 100,
          seed: `${id}:${stage.id}`,
          model: coinFlip,
          resolver,
        });
        const champions = Object.values(result.teams).reduce((sum, t) => sum + t.champion, 0);
        expect(champions).toBeCloseTo(1, 9);
      });
    });
  },
);
