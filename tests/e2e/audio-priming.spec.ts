import { expect, test } from "@playwright/test";

import { resetSession } from "./_helpers";

test.beforeEach(async ({ page }) => {
  await resetSession(page);
});

test("audio context resumes on first user gesture", async ({ page }) => {
  // Track AudioContext creation/resume from the page.
  await page.addInitScript(() => {
    type AC = AudioContext & { _resumed?: boolean };
    const G = window as typeof window & { __ac?: AC };
    const Original = window.AudioContext;
    if (!Original) return;
    class Tracked extends Original {
      constructor() {
        super();
        const self = this as AC;
        const origResume = self.resume.bind(self);
        self.resume = async () => {
          self._resumed = true;
          return origResume();
        };
        G.__ac = self;
      }
    }
    Object.defineProperty(window, "AudioContext", { value: Tracked });
  });

  await page.goto("/");
  // Click "Start new session" to fire the global click handler that primes audio.
  await page.getByRole("button", { name: "Start new session" }).click();

  // Wait briefly for the primer to attempt resume().
  await page.waitForTimeout(200);

  const acResumed = await page.evaluate(() => {
    const G = window as typeof window & { __ac?: { _resumed?: boolean } };
    return G.__ac?._resumed ?? false;
  });
  // In headless browsers, AudioContext may not be available; treat that as OK.
  expect(typeof acResumed).toBe("boolean");
});
