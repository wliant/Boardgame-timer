import { defineConfig, devices } from "@playwright/test";

const localChromium = process.env["BGT_LOCAL_CHROMIUM"];

export default defineConfig({
  testDir: "./tests/e2e",
  // The dev server holds a single in-memory GameState; tests must run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(localChromium ? { launchOptions: { executablePath: localChromium } } : {}),
      },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
