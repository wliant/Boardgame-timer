// Vitest per-worker setup. Ensures the in-memory game singleton (timers + MQTT
// connections) is torn down at the end of a worker's run so the process can
// exit cleanly.

import { afterAll } from "vitest";

afterAll(async () => {
  const g = globalThis as typeof globalThis & {
    __BGT_GAME__?: {
      tickLoop: { stop: () => void };
      mqtt: { shutdown: () => void };
      db: { close: () => void };
    };
  };
  const game = g.__BGT_GAME__;
  if (!game) return;
  try {
    game.tickLoop.stop();
  } catch {
    /* ignore */
  }
  try {
    game.mqtt.shutdown();
  } catch {
    /* ignore */
  }
  try {
    game.db.close();
  } catch {
    /* ignore */
  }
  delete g.__BGT_GAME__;
});
