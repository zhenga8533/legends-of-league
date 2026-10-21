import { Context } from "../src/context";
import { coinFlip, type MatchupModel } from "../src/model";
import { createRng } from "../src/rng";
import type { Entrant, Resolver } from "../src/types";

export const teams = (n: number, prefix = "team:t"): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);

export const entrants = (ids: readonly string[]): Entrant[] => ids.map((team) => ({ team }));

export function context(
  seed: string | number = 1,
  options: { model?: MatchupModel; resolver?: Resolver; strict?: boolean } = {},
): Context {
  return new Context({
    rng: createRng(seed),
    model: options.model ?? coinFlip,
    ...(options.resolver ? { resolver: options.resolver } : {}),
    strict: options.strict ?? false,
  });
}

/** A model where the lower-numbered team always wins: makes outcomes predictable. */
export const favourites: MatchupModel = { pGame: (a, b) => (a < b ? 1 : 0) };
