// Reducer event types — specs/02-session-lifecycle.md.

import type { DurationMs, GameConfig, Id } from "@/shared/types";

export type DomainEvent =
  | { type: "StartNewSession"; config: GameConfig }
  | { type: "EditConfig"; config: GameConfig }
  | { type: "ConfirmConfig" }
  | { type: "StartGame" }
  | {
      type: "EndTurn";
      source: "screen-tap" | "physical-button";
      expectedPlayerId?: Id;
    }
  | { type: "ConfirmNextRoundOrder"; playerIds: Id[] }
  | { type: "Pause" }
  | { type: "Resume" }
  | { type: "Undo" }
  | { type: "AdjustTime"; playerId: Id; deltaMs: DurationMs }
  | { type: "DismissAlert"; playerId: Id }
  | { type: "Restart" }
  | { type: "EndGame" };

export type DomainEventType = DomainEvent["type"];
