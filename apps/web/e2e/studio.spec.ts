import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const champion = (page: import("@playwright/test").Page) => page.getByTestId("simulated-champion");

test("picks reshape the bracket and the scenario survives a reload", async ({ page }) => {
  await page.goto("/simulate/#ed=worlds-2024");
  await expect(page.getByRole("note")).toContainText("Simulated");
  const before = await champion(page).textContent();

  const knockout = page.getByRole("region", { name: "Knockout Stage" });
  const final = knockout.getByRole("group").last();
  await final.getByRole("button", { name: new RegExp(`pick (?!${before} to win)`) }).click();
  await expect(champion(page)).not.toHaveText(before!);
  await expect(page.getByText("1 pick applied")).toBeVisible();
  const after = await champion(page).textContent();

  await expect(page).toHaveURL(/#s=/);
  await page.reload();
  await expect(champion(page)).toHaveText(after!);
});

test("10,000 simulations run in a worker without blocking the page", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/simulate/#ed=worlds-2024");
  await expect(champion(page)).toBeVisible();
  await page.getByRole("combobox", { name: /^Simulations/ }).selectOption("10000");

  // Record the longest gap between animation frames.
  await page.evaluate(() => {
    const w = window as unknown as { maxGap: number };
    w.maxGap = 0;
    let last = performance.now();
    const tick = (now: number) => {
      w.maxGap = Math.max(w.maxGap, now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("button", { name: "Run this scenario" }).click();
  const progress = page.getByTestId("progress");
  // Measure only while the batch runs (an idle headless page can skip frames on its own).
  await expect(progress).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { maxGap: number }).maxGap = 0;
  });
  const table = page.getByRole("table", { name: /This scenario, 10,000 simulations/ });
  const seen = new Set<string>();
  while (!(await table.isVisible())) {
    const text = await progress.textContent({ timeout: 500 }).catch(() => null);
    if (text) seen.add(text);
    await page.waitForTimeout(100);
  }
  expect(seen.size).toBeGreaterThan(1);
  const maxGap = await page.evaluate(() => (window as unknown as { maxGap: number }).maxGap);
  expect(maxGap).toBeLessThan(250);
});

test("scenarios export to a file and import back", async ({ page }) => {
  await page.goto("/simulate/#ed=msi-2024");
  await page.getByLabel("Seed").fill("export-test");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const file = await (await download).path();
  const exported = JSON.parse(await readFile(file, "utf8"));
  expect(exported).toMatchObject({ edition: "msi-2024", seed: "export-test" });

  await page.getByLabel("Edition").selectOption("worlds-2024");
  await expect(page.getByLabel("Seed")).toHaveValue("1");
  await page.getByLabel("Import scenario file").setInputFiles(file);
  await expect(page.getByLabel("Edition")).toHaveValue("msi-2024");
  await expect(page.getByLabel("Seed")).toHaveValue("export-test");
});

test("edition pages open the Studio on that edition", async ({ page }) => {
  await page.goto("/tournaments/msi/2024/");
  await page.getByRole("link", { name: "Simulate this edition" }).click();
  await expect(page.getByLabel("Edition")).toHaveValue("msi-2024");
  await expect(champion(page)).toBeVisible();
});

test("the Studio is accessible", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/simulate/#ed=worlds-2024");
  await expect(champion(page)).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
});

test("scenarios can be saved in the browser and opened again", async ({ page }) => {
  await page.goto("/simulate/#ed=msi-2024");
  const seed = page.getByRole("textbox", { name: /^Seed/ });
  await seed.fill("saved-seed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved in this browser.")).toBeVisible();

  await page.getByLabel("Edition").selectOption("worlds-2024");
  await page.reload();
  await page.getByText("Saved in this browser (1)").click();
  await page
    .getByRole("button", { name: /^2024 Mid-Season Invitational .* seed saved-seed$/ })
    .click();
  await expect(page.getByLabel("Edition")).toHaveValue("msi-2024");
  await expect(seed).toHaveValue("saved-seed");

  await page.getByRole("button", { name: /^Remove/ }).click();
  await expect(page.getByText(/Saved in this browser \(/)).toHaveCount(0);
});
