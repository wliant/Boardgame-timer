import { expect, test } from "@playwright/test";

import { resetSession } from "./_helpers";

test.beforeEach(async ({ page }) => {
  await resetSession(page);
});

test("total-time / screen-tap / fixed: configure, play, restart, end", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start new session" }).click();
  await expect(page.getByRole("heading", { name: "Configure Timer" })).toBeVisible();

  // The default config is 2 players, 10 min total-time, screen-tap, fixed —
  // already valid. Confirm immediately.
  await page.getByRole("button", { name: "Confirm Configuration" }).click();
  await expect(page.getByRole("heading", { name: "Game Ready" })).toBeVisible();

  // Start the game.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  // The "End Turn" button (top bar) should appear.
  const endTurnButtons = page.getByRole("button", { name: "End Turn", exact: true });
  await expect(endTurnButtons.first()).toBeVisible();

  // End turn → second player active.
  await endTurnButtons.first().click();
  // End turn again → wraps to player 1, round 2 (fixed mode).
  await endTurnButtons.first().click();
  await expect(page.getByText(/Round 2/)).toBeVisible();

  // Restart → back to Ready.
  await page.getByRole("button", { name: /Restart/ }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restart", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Game Ready" })).toBeVisible();

  // End game → Lobby.
  await page.getByRole("button", { name: /End Game/ }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "End Game", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Boardgame Timer" })).toBeVisible();
});
