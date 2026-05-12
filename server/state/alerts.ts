// Alert helpers — specs/04-in-game-behavior.md §"Time-out behavior".

import type { SseEvent } from "@/shared/events";
import type {
  Alert,
  AlertKind,
  EpochMs,
  GameState,
  Id,
  TimerMode,
} from "@/shared/types";

export function alertKindForMode(mode: TimerMode): AlertKind {
  return mode === "total-time" ? "total-out" : "turn-out";
}

export function hasAlert(state: GameState, playerId: Id, kind: AlertKind): boolean {
  return state.alerts.some((a) => a.playerId === playerId && a.kind === kind);
}

export function raiseAlert(
  state: GameState,
  playerId: Id,
  kind: AlertKind,
  raisedAt: EpochMs,
): { state: GameState; event: SseEvent | null } {
  if (hasAlert(state, playerId, kind)) return { state, event: null };
  const alert: Alert = { playerId, kind, raisedAt };
  return {
    state: { ...state, alerts: [...state.alerts, alert] },
    event: { event: "alert-raised", data: alert },
  };
}

export function clearAlerts(
  state: GameState,
  predicate: (a: Alert) => boolean,
): { state: GameState; events: SseEvent[] } {
  const removed = state.alerts.filter(predicate);
  if (removed.length === 0) return { state, events: [] };
  const kept = state.alerts.filter((a) => !predicate(a));
  return {
    state: { ...state, alerts: kept },
    events: removed.map<SseEvent>((a) => ({
      event: "alert-cleared",
      data: { playerId: a.playerId, kind: a.kind },
    })),
  };
}

/**
 * Maintain alert state after a player's remainingMs changes.
 *  - If new value > 0 and an alert exists for this player + mode → clear it.
 *  - If new value <= 0 and no alert exists for this player + mode → raise it.
 */
export function reconcileAlertOnChange(
  state: GameState,
  playerId: Id,
  prevMs: number,
  newMs: number,
  mode: TimerMode,
  now: EpochMs,
): { state: GameState; events: SseEvent[] } {
  const kind = alertKindForMode(mode);
  // Rising above zero: clear if alert exists.
  if (prevMs <= 0 && newMs > 0 && hasAlert(state, playerId, kind)) {
    return clearAlerts(state, (a) => a.playerId === playerId && a.kind === kind);
  }
  // Crossing to/below zero: raise if no alert exists.
  if (prevMs > 0 && newMs <= 0 && !hasAlert(state, playerId, kind)) {
    const { state: s2, event } = raiseAlert(state, playerId, kind, now);
    return { state: s2, events: event ? [event] : [] };
  }
  return { state, events: [] };
}
