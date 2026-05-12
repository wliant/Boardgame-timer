// 100 ms server tick + 250 ms SSE push scheduler.
// See specs/04-in-game-behavior.md §"Timer tick model".

import type { SseEvent } from "@/shared/events";
import type { EpochMs, GameState, Id } from "@/shared/types";

import type { Clock } from "./clock";

export type TickHandlers = {
  getState: () => GameState;
  getLastTickAt: () => EpochMs | null;
  setLastTickAt: (t: EpochMs | null) => void;
  setState: (state: GameState) => void;
  emit: (event: SseEvent) => void;
};

export type TickLoop = { stop: () => void };

const TICK_INTERVAL_MS = 100;
const PUSH_INTERVAL_MS = 250;

export function startTickLoop(
  handlers: TickHandlers,
  clock: Clock,
  commit: (
    state: GameState,
    now: EpochMs,
    lastTickAt: EpochMs | null,
  ) => { state: GameState; events: SseEvent[]; lastTickAt: EpochMs | null },
): TickLoop {
  const tick = clock.setInterval(() => {
    const now = clock.now();
    const state = handlers.getState();
    const lastTickAt = handlers.getLastTickAt();
    if (state.phase !== "Running" || lastTickAt == null) return;
    const result = commit(state, now, lastTickAt);
    handlers.setState(result.state);
    handlers.setLastTickAt(result.lastTickAt);
    for (const ev of result.events) handlers.emit(ev);
  }, TICK_INTERVAL_MS);

  const push = clock.setInterval(() => {
    const state = handlers.getState();
    if (state.phase !== "Running") return;
    if (state.currentPlayerIdx == null) return;
    const activeId: Id | undefined = state.currentOrder[state.currentPlayerIdx];
    if (activeId === undefined) return;
    const remainingMs = state.remainingMs[activeId] ?? 0;
    handlers.emit({
      event: "tick",
      data: {
        playerId: activeId,
        remainingMs,
        turnStartedAt: state.turnStartedAt,
      },
    });
  }, PUSH_INTERVAL_MS);

  return {
    stop: () => {
      tick.clear();
      push.clear();
    },
  };
}
