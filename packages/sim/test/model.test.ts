import { describe, expect, it } from "vitest";
import { EloBook, eloModel, eloWinProbability, ratingsBefore, type RatedGame } from "../src/model";

const game = (
  date: string,
  a: string,
  b: string,
  winner: string,
  regions = ["lck", "lpl"],
): RatedGame => ({
  date,
  teams: [a, b],
  winner,
  regions: regions as [string, string],
});

describe("Elo", () => {
  it("uses the standard logistic curve", () => {
    expect(eloWinProbability(1500, 1500)).toBe(0.5);
    expect(eloWinProbability(1900, 1500)).toBeCloseTo(10 / 11, 12);
    expect(eloWinProbability(1400, 1600) + eloWinProbability(1600, 1400)).toBeCloseTo(1, 12);
    expect(eloModel(new Map([["a", 1700]])).pGame("a", "unrated")).toBeCloseTo(
      eloWinProbability(1700, 1500),
    );
  });

  it("is zero-sum and rewards the winner", () => {
    const book = new EloBook();
    book.record(game("2024-01-01", "a", "b", "a"));
    expect(book.rating("a")).toBeGreaterThan(1500);
    expect(book.rating("a") + book.rating("b")).toBeCloseTo(3000, 9);
  });

  it("starts unseen teams at their region's mean", () => {
    const book = new EloBook();
    for (let i = 0; i < 5; i++) book.record(game(`2024-01-0${i + 1}`, "lck1", "lpl1", "lck1"));
    book.record(game("2024-01-10", "lck2", "lpl2", "lck2"));
    // lck2 entered at the (raised) LCK mean, so beating a team at the (lowered) LPL mean
    // earned it less than a 1500-vs-1500 win would have.
    expect(book.rating("lck2") - book.regionMean("lpl")).toBeGreaterThan(0);
    expect(book.rating("lck2")).toBeGreaterThan(1500 + 16);
  });

  it("regresses towards the region mean after a long break", () => {
    const book = new EloBook({ initial: 1500, k: 32, carryover: 0.5, breakDays: 60 });
    for (let i = 0; i < 9; i++) book.record(game(`2024-01-0${i + 1}`, "a", "b", "a", ["x", "x"]));
    const before = book.rating("a");
    book.record(game("2024-06-01", "a", "b", "b", ["x", "x"]));
    const mean = 1500;
    // Halved distance to the mean, then lost a game.
    expect(book.rating("a")).toBeLessThan(mean + (before - mean) * 0.5);
  });

  it("only uses games before the cutoff", () => {
    const games = [game("2024-05-01", "a", "b", "a"), game("2024-10-01", "a", "b", "b")];
    expect(ratingsBefore(games, "2024-10-01").rating("a")).toBeGreaterThan(1500);
    expect(ratingsBefore(games, "2024-05-01").ratings.size).toBe(0);
  });
});
