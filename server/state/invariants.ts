// Dev-only invariant checks; the 9 invariants in CLAUDE.md and specs/05.
// Throws if any invariant is violated; caller wraps in an env guard.

import type { GameState } from "@/shared/types";

export class InvariantViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantViolation";
  }
}

export function checkInvariants(state: GameState): void {
  const { phase, config, currentOrder, currentPlayerIdx, remainingMs } = state;

  // 1. remainingMs keys = player ids whenever config exists and phase is not Lobby/Configuring.
  if (config && phase !== "Lobby" && phase !== "Configuring") {
    const playerIds = new Set(config.players.map((p) => p.id));
    const remKeys = new Set(Object.keys(remainingMs));
    if (playerIds.size !== remKeys.size) {
      throw new InvariantViolation(
        `remainingMs keys (${remKeys.size}) ≠ player count (${playerIds.size})`,
      );
    }
    for (const id of playerIds) {
      if (!remKeys.has(id)) {
        throw new InvariantViolation(
          `remainingMs missing key for player ${id}`,
        );
      }
    }
  }

  // 2. currentOrder is a permutation of config player ids while phase is Running/Paused/BetweenRounds.
  if (
    config &&
    (phase === "Running" || phase === "Paused" || phase === "BetweenRounds")
  ) {
    const playerIds = new Set(config.players.map((p) => p.id));
    if (currentOrder.length !== playerIds.size) {
      throw new InvariantViolation(
        `currentOrder length ${currentOrder.length} ≠ player count ${playerIds.size}`,
      );
    }
    for (const id of currentOrder) {
      if (!playerIds.has(id)) {
        throw new InvariantViolation(
          `currentOrder contains unknown id ${id}`,
        );
      }
    }
  }

  // 3. currentPlayerIdx in [0, currentOrder.length - 1] while phase is Running/Paused.
  if (phase === "Running" || phase === "Paused") {
    if (
      currentPlayerIdx == null ||
      currentPlayerIdx < 0 ||
      currentPlayerIdx >= currentOrder.length
    ) {
      throw new InvariantViolation(
        `currentPlayerIdx ${String(currentPlayerIdx)} out of range for phase ${phase}`,
      );
    }
  }

  // 4. turnStartedAt non-null iff phase === Running.
  if (phase === "Running") {
    if (state.turnStartedAt == null) {
      throw new InvariantViolation("turnStartedAt is null while Running");
    }
  } else {
    if (state.turnStartedAt != null) {
      throw new InvariantViolation(
        `turnStartedAt non-null in phase ${phase}`,
      );
    }
  }

  // 5. At most one alert per (playerId, kind).
  const alertKeys = new Set<string>();
  for (const a of state.alerts) {
    const k = `${a.playerId}|${a.kind}`;
    if (alertKeys.has(k)) {
      throw new InvariantViolation(`duplicate alert ${k}`);
    }
    alertKeys.add(k);
  }

  // 6. History snapshots only have phase in { Running, BetweenRounds }.
  for (const s of state.history) {
    if (s.phase !== "Running" && s.phase !== "BetweenRounds") {
      throw new InvariantViolation(
        `history snapshot has invalid phase ${s.phase}`,
      );
    }
  }

  // 7. In physical-button mode, every assignedDeviceId references a device in devicesSnapshot.
  if (config && config.endOfTurnTrigger === "physical-button") {
    const deviceIds = new Set(state.devicesSnapshot.map((d) => d.id));
    for (const p of config.players) {
      if (p.assignedDeviceId == null) {
        throw new InvariantViolation(
          `player ${p.id} missing assignedDeviceId in physical-button mode`,
        );
      }
      if (!deviceIds.has(p.assignedDeviceId)) {
        throw new InvariantViolation(
          `player ${p.id} assignedDeviceId ${p.assignedDeviceId} not in devicesSnapshot`,
        );
      }
    }
  }
}

export function checkInvariantsInDev(state: GameState): void {
  if (process.env.NODE_ENV !== "production") {
    checkInvariants(state);
  }
}
