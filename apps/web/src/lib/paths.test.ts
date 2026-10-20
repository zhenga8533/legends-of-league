import { describe, expect, it } from "vitest";
import { joinBase } from "./paths";

describe("joinBase", () => {
  it.each([
    ["/", "/", "/"],
    ["/", "tournaments", "/tournaments"],
    ["/", "/tournaments", "/tournaments"],
    ["/legends-of-league", "tournaments", "/legends-of-league/tournaments"],
    ["/legends-of-league/", "/tournaments", "/legends-of-league/tournaments"],
    ["/legends-of-league/", "", "/legends-of-league/"],
  ])("joinBase(%j, %j) -> %j", (base, path, expected) => {
    expect(joinBase(base, path)).toBe(expected);
  });
});
