import { expect, test } from "@playwright/test";

import { resetSession } from "./_helpers";

test.beforeEach(async ({ page }) => {
  await resetSession(page);
});

test("lobby renders and starts a new session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Boardgame Timer" })).toBeVisible();
  await page.getByRole("button", { name: "Start new session" }).click();
  await expect(page.getByRole("heading", { name: "Configure Timer" })).toBeVisible();
});
