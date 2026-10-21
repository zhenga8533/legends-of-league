import { EloBook } from "@lol/sim";
import { describe, expect, it } from "vitest";
import { loadEditions, ratedGames } from "../src";

describe("Elo calibration backtest", () => {
  it("predicts games better than a coin flip", () => {
    // Each game is predicted from earlier games only, then recorded.
    const games = ratedGames(loadEditions()).sort(
      (a, b) => Date.parse(a.date) - Date.parse(b.date),
    );
    const book = new EloBook();
    let brier = 0;
    let logLoss = 0;
    for (const game of games) {
      const p = book.record(game);
      const won = game.winner === game.teams[0] ? 1 : 0;
      brier += (p - won) ** 2;
      logLoss -= Math.log(won ? p : 1 - p);
    }
    brier /= games.length;
    logLoss /= games.length;
    console.log(
      `Elo backtest over ${games.length} games: Brier ${brier.toFixed(4)}, log-loss ${logLoss.toFixed(4)} (coin flip: 0.2500, 0.6931)`,
    );

    expect(brier).toBeLessThan(0.25);
    expect(logLoss).toBeLessThan(Math.log(2));
  });
});
