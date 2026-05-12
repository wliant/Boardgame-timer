import { randomUUID } from "node:crypto";

import type { GameConfig, PlayerConfig } from "@/shared/types";

const DEFAULT_BUDGET_MS = 600_000;

export function defaultPlayer(name: string): PlayerConfig {
  return {
    id: randomUUID(),
    name,
    timeBudgetMs: DEFAULT_BUDGET_MS,
    assignedDeviceId: null,
  };
}

export function defaultConfig(): GameConfig {
  return {
    mode: "total-time",
    endOfTurnTrigger: "screen-tap",
    turnOrderMode: "fixed",
    players: [defaultPlayer("Player 1"), defaultPlayer("Player 2")],
  };
}
