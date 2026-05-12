// Sketch of the SSE event catalog from specs/06-server-api.md.
// The full payload shapes will be tightened as the SSE channel is implemented.

import type { Alert, DurationMs, GameState, Id } from "./types";

export type SseEvent =
  | { event: "state"; data: GameState }
  | {
      event: "tick";
      data: { playerId: Id; remainingMs: DurationMs; serverNow: number };
    }
  | { event: "phase-changed"; data: { phase: GameState["phase"] } }
  | {
      event: "turn-switched";
      data: { fromPlayerId: Id | null; toPlayerId: Id; roundNumber: number };
    }
  | { event: "round-complete"; data: { roundNumber: number } }
  | { event: "alert-raised"; data: Alert }
  | { event: "alert-cleared"; data: { playerId: Id; kind: Alert["kind"] } }
  | {
      event: "press-ignored";
      data: { topic: string; reason: string; at: number };
    }
  | { event: "settings-changed"; data: Record<string, unknown> }
  | {
      event: "mqtt-status";
      data: {
        connected: boolean;
        lastError: string | null;
        lastConnectedAt: number | null;
      };
    }
  | {
      event: "mqtt-discover-message";
      data: { topic: string; payload: string; at: number };
    };

export type SseEventName = SseEvent["event"];
