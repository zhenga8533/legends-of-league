import AxeBuilder from "@axe-core/playwright";
import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// One directory per imported edition: data/tournaments/<tournament>/<year>/.
const tournamentsDir = new URL("../../../data/tournaments/", import.meta.url);
const importedEditions = readdirSync(tournamentsDir).reduce(
  (sum, tournament) => sum + readdirSync(new URL(`${tournament}/`, tournamentsDir)).length,
  0,
);

test("browses from the home page to a final's drafts and player stats", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Browse tournaments" }).click();
  await page.getByRole("link", { name: "World Championship" }).click();
  await page.getByRole("link", { name: "2024 World Championship" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2024 World Championship");
  await expect(page.getByRole("heading", { name: "Swiss Stage" })).toBeVisible();

  await page
    .getByRole("link", { name: /Bilibili Gaming 2–3 T1/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("2–3");
  await expect(page.getByRole("heading", { name: /Game 5/ })).toBeVisible();
  await expect(page.getByRole("table", { name: /T1 · red side/ }).last()).toBeVisible();
  await expect(page.getByRole("link", { name: "Faker" }).first()).toBeVisible();
});

test("shows a double-elimination bracket and GSL groups", async ({ page }) => {
  await page.goto("/tournaments/msi/2024/");
  await expect(page.getByRole("heading", { name: "Upper bracket" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lower bracket" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Group A" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Final standings" })).toContainText("Gen.G");
});

test("finds a player through search", async ({ page }) => {
  await page.goto("/search/");
  await page.getByRole("search").getByRole("textbox", { name: "Search" }).fill("Faker");
  await page.getByRole("link", { name: "Faker" }).first().click();
  await expect(page).toHaveURL(/\/players\/faker\/$/);
  await expect(page.getByRole("heading", { name: "Champions" })).toBeVisible();
});

test("remembers the chosen theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/teams/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

const auditedPages = [
  "/",
  "/tournaments/",
  "/tournaments/worlds/",
  "/tournaments/worlds/2024/",
  "/tournaments/msi/2024/",
  "/tournaments/first-stand/2025/",
  "/matches/worlds-2024-knockout-finals-01/",
  "/teams/",
  "/teams/t1/",
  "/players/",
  "/players/faker/",
  "/regions/",
  "/regions/lck/",
  "/data/",
  "/stats/",
  "/search/",
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    // Index pages list every player in the archive; auditing hundreds of rows takes a while.
    test.describe.configure({ timeout: 90_000 });
    for (const path of auditedPages) {
      test(path, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
      });
    }
  });
}

test("shows coverage for every edition", async ({ page }) => {
  await page.goto("/data/");
  const rows = page.getByRole("table", { name: "Data coverage by edition" }).locator("tbody tr");
  await expect(rows).toHaveCount(importedEditions);
  await expect(page.getByRole("link", { name: "2011 World Championship" })).toBeVisible();
});
