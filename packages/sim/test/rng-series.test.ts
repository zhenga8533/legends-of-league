import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng";
import { playSeries, seriesWinProbability } from "../src/series";

describe("createRng", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const draw = (seed: string | number) => Array.from({ length: 5 }, createRng(seed).next);
    expect(draw("worlds")).toEqual(draw("worlds"));
    expect(draw(2024)).toEqual(draw("2024"));
    expect(draw("a")).not.toEqual(draw("b"));
  });

  it("produces uniform floats in [0, 1)", () => {
    const rng = createRng("uniform");
    const values = Array.from({ length: 100_000 }, rng.next);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeCloseTo(0.5, 2);
    const buckets = Array.from({ length: 10 }, () => 0);
    for (const v of values) buckets[Math.floor(v * 10)]!++;
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });

  it("shuffles into a permutation", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.string(), (items, seed) => {
        const shuffled = createRng(seed).shuffle(items);
        expect([...shuffled].sort()).toEqual([...items].sort());
      }),
    );
  });
});

describe("series", () => {
  it("has exact probabilities for simple cases", () => {
    expect(seriesWinProbability(0.7, 1)).toBeCloseTo(0.7, 12);
    expect(seriesWinProbability(0.5, 3)).toBeCloseTo(0.5, 12);
    expect(seriesWinProbability(0.5, 5)).toBeCloseTo(0.5, 12);
    // Bo3: p^2 + 2p^2(1-p)
    expect(seriesWinProbability(0.6, 3)).toBeCloseTo(0.36 + 2 * 0.36 * 0.4, 12);
  });

  it("is symmetric and favours the stronger team more in longer series", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 0.99, noNaN: true }), (p) => {
        for (const bestOf of [1, 3, 5, 7]) {
          expect(seriesWinProbability(p, bestOf) + seriesWinProbability(1 - p, bestOf)).toBeCloseTo(
            1,
            9,
          );
        }
        if (p > 0.5) {
          expect(seriesWinProbability(p, 5)).toBeGreaterThanOrEqual(seriesWinProbability(p, 3));
          expect(seriesWinProbability(p, 3)).toBeGreaterThanOrEqual(p);
        }
      }),
    );
  });

  it("simulated series match the analytic probability", () => {
    const rng = createRng("series");
    for (const [p, bestOf] of [
      [0.65, 3],
      [0.55, 5],
    ] as const) {
      const runs = 100_000;
      let wins = 0;
      for (let i = 0; i < runs; i++) {
        const [a, b] = playSeries(rng, p, bestOf);
        expect(Math.max(a, b)).toBe(Math.floor(bestOf / 2) + 1);
        if (a > b) wins++;
      }
      // ~4.5 standard errors at n = 100k.
      expect(Math.abs(wins / runs - seriesWinProbability(p, bestOf))).toBeLessThan(0.007);
    }
  });
});
