import { expect, test } from "@playwright/test";

test("lobby placeholder renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Boardgame Timer" })).toBeVisible();
});
