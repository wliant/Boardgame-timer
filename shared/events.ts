// SSE event catalog. Payloads match specs/06-server-api.md §"SSE event catalog".

import type {
  Alert,
  AppSettings,
  DurationMs,
  EpochMs,
  GameState,
  Id,
  Phase,
} from "./types";

export type PressIgnoredReason =
  | "no-config"
  | "not-physical-button-mode"
  | "unknown-device"
  | "not-current-player";

export type DiscoveryMessage = {
  topic: string;
  samplePayload: string;
  count: number;
  firstSeenAt: EpochMs;
};

export type SseEvent =
  | { event: "state"; data: GameState }
  | {
      event: "tick";
      data: {
        playerId: Id;
        remainingMs: DurationMs;
        turnStartedAt: EpochMs | null;
      };
    }
  | { event: "phase-changed"; data: { phase: Phase; previous: Phase } }
  | {
      event: "turn-switched";
      data: {
        currentPlayerIdx: number;
        currentOrder: Id[];
        roundNumber: number;
        turnStartedAt: EpochMs | null;
        remainingMs: Record<Id, DurationMs>;
      };
    }
  | {
      event: "round-complete";
      data: { roundNumber: number; nextPhase: Phase };
    }
  | { event: "alert-raised"; data: Alert }
  | { event: "alert-cleared"; data: { playerId: Id; kind: Alert["kind"] } }
  | {
      event: "press-ignored";
      data: { deviceId: Id; deviceName: string; reason: PressIgnoredReason };
    }
  | { event: "settings-changed"; data: AppSettings }
  | {
      event: "mqtt-status";
      data: { connected: boolean; lastError: string | null };
    }
  | { event: "mqtt-discover-message"; data: DiscoveryMessage };

export type SseEventName = SseEvent["event"];
