import type { Rng } from "./rng";

export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * Probability of winning a best-of-N series when each game is won independently with
 * probability p: the series is won on game n + k for some k losses, k < n.
 */
export function seriesWinProbability(p: number, bestOf: number): number {
  const n = winsNeeded(bestOf);
  let total = 0;
  for (let losses = 0; losses < n; losses++) {
    total += binomial(n - 1 + losses, losses) * p ** n * (1 - p) ** losses;
  }
  return total;
}

/** Plays a series game by game and returns the score as [team A wins, team B wins]. */
export function playSeries(rng: Rng, p: number, bestOf: number): [number, number] {
  const n = winsNeeded(bestOf);
  const score: [number, number] = [0, 0];
  while (score[0] < n && score[1] < n) {
    score[rng.next() < p ? 0 : 1]++;
  }
  return score;
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}
