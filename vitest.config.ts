import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit and integration runs are dispatched by the npm scripts via path filters:
//   - `pnpm test:unit`         -> vitest run tests/unit
//   - `pnpm test:integration`  -> vitest run tests/integration
// The integration globalSetup spawns Mosquitto (see tests/setup/global-mqtt.ts);
// it's listed unconditionally because the stub is a no-op for unit runs.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./tests/setup/global-mqtt.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["server/**/*.ts"],
      thresholds: {
        "server/state/**": { lines: 80, statements: 80 },
        "server/mqtt/**": { lines: 80, statements: 80 },
      },
    },
  },
});
