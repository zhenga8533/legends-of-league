/** Monte Carlo in chunks, so a worker can report progress; results merge exactly. */
import { type MonteCarloResult, runMonteCarlo } from "@lol/sim";
import type { EditionPayload } from "./payload";
import type { Scenario } from "./scenario";
import { setupScenario } from "./setup";

export const CHUNK = 250;

interface Counts {
  placements: Map<string, number>;
  reached: Map<string, number>;
}

export function runChunked(
  payload: EditionPayload,
  scenario: Scenario,
  iterations: number,
  onProgress: (done: number) => void = () => {},
): MonteCarloResult {
  const { input, model, resolver } = setupScenario(payload, scenario);
  const counts = new Map<string, Counts>();
  const add = (map: Map<string, number>, key: string, n: number) =>
    map.set(key, (map.get(key) ?? 0) + n);
  let done = 0;
  for (let chunk = 0; done < iterations; chunk++) {
    const size = Math.min(CHUNK, iterations - done);
    const result = runMonteCarlo(input, {
      iterations: size,
      seed: `${scenario.seed}#${chunk}`,
      model,
      resolver,
    });
    for (const [team, outlook] of Object.entries(result.teams)) {
      const entry = counts.get(team) ?? { placements: new Map(), reached: new Map() };
      for (const [place, share] of Object.entries(outlook.placements))
        add(entry.placements, place, Math.round(share * size));
      for (const [stage, share] of Object.entries(outlook.reached))
        add(entry.reached, stage, Math.round(share * size));
      counts.set(team, entry);
    }
    done += size;
    onProgress(done);
  }
  const share = (map: Map<string, number>) =>
    Object.fromEntries([...map].map(([key, n]) => [key, n / iterations]));
  return {
    iterations,
    seed: scenario.seed,
    teams: Object.fromEntries(
      [...counts].map(([team, { placements, reached }]) => [
        team,
        {
          champion: (placements.get("1") ?? 0) / iterations,
          placements: share(placements),
          reached: share(reached),
        },
      ]),
    ),
  };
}
