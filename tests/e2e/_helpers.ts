// Shared e2e helpers. Imported by spec files; not a spec itself.

import type { Page } from "@playwright/test";

/** Reset the in-memory game back to Lobby before each test. */
export async function resetSession(page: Page): Promise<void> {
  await page.request.post("/api/session/end-game").catch(() => undefined);
}
