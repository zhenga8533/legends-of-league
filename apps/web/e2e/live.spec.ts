import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Runs against whichever edition is live in the dataset, if any.
test("a live edition shows its results so far and forecasts the rest", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const live = page.getByRole("region", { name: "Happening now" });
  test.skip((await live.count()) === 0, "no live edition in the dataset");

  await live.getByRole("link", { name: "Results and upcoming matches" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Live");
  await expect(page.getByText("In progress.")).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);

  await page.getByRole("link", { name: "Forecast the rest" }).click();
  await expect(page.getByLabel("Simulate from")).toHaveValue("now");
  await expect(page.getByRole("table", { name: /^Live forecast/ })).toBeVisible();
  await expect(page.getByTestId("simulated-champion")).toBeVisible();
});
