// Press resolution per specs/07-mqtt-integration.md §"Press resolution".

import type { PressIgnoredReason } from "@/shared/events";
import type { GameState, Id } from "@/shared/types";

export type PressResolution =
  | { type: "dispatch"; playerId: Id }
  | { type: "ignored"; reason: PressIgnoredReason };

export function resolvePress(state: GameState, deviceId: Id): PressResolution {
  if (state.config == null) {
    return { type: "ignored", reason: "no-config" };
  }
  if (state.config.endOfTurnTrigger !== "physical-button") {
    return { type: "ignored", reason: "not-physical-button-mode" };
  }
  const player = state.config.players.find(
    (p) => p.assignedDeviceId === deviceId,
  );
  if (!player) {
    return { type: "ignored", reason: "unknown-device" };
  }
  if (
    state.phase !== "Running" ||
    state.currentPlayerIdx == null ||
    state.currentOrder[state.currentPlayerIdx] !== player.id
  ) {
    return { type: "ignored", reason: "not-current-player" };
  }
  return { type: "dispatch", playerId: player.id };
}
