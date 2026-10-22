import { expect, test } from "@playwright/test";

test("stats count titles and compare any two teams head-to-head", async ({ page }) => {
  await page.goto("/stats/#head-to-head");
  const titles = page.getByRole("table", { name: "Titles and finals appearances by organization" });
  await expect(titles.locator("tbody tr").first()).toBeVisible();

  const team = page.getByRole("combobox", { name: /^Team/ });
  const opponent = page.getByRole("combobox", { name: /^Opponent/ });
  await expect(team).not.toHaveValue("");
  // The most-played pairing is shown first, so it has meetings.
  const meetings = page.getByRole("table", { name: /^Every international series between/ });
  await expect(meetings.locator("tbody tr").first()).toBeVisible();

  await opponent.selectOption(await team.inputValue());
  await expect(page.getByText("Pick two different teams.")).toBeVisible();
});

test("the trend chart has a hover readout and a table view", async ({ page }) => {
  await page.goto("/stats/#regions");
  const chart = page.getByRole("img", { name: /Cross-region series win rate per year/ });
  await chart.scrollIntoViewIfNeeded();
  const readout = page.getByTestId("trend-readout");
  // The chart hydrates once it scrolls into view; hover until it responds.
  await expect(async () => {
    const box = await chart.boundingBox();
    if (!box) throw new Error("chart not laid out");
    await chart.hover({ position: { x: box.width * 0.6, y: box.height / 2 } });
    await expect(readout).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(readout).toContainText(/\d{4}/);
  await page.getByText("Show the numbers").click();
  await expect(
    page.getByRole("table", { name: "Cross-region series records by year" }),
  ).toBeVisible();
});
