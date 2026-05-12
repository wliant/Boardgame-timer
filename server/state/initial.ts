import type { GameState } from "@/shared/types";

export function initialState(): GameState {
  return {
    phase: "Lobby",
    config: null,
    devicesSnapshot: [],
    currentPlayerIdx: null,
    roundNumber: 0,
    currentOrder: [],
    remainingMs: {},
    turnStartedAt: null,
    alerts: [],
    history: [],
    mqtt: {
      connected: false,
      lastError: null,
      lastConnectedAt: null,
    },
  };
}
