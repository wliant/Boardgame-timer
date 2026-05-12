"use client";

import { api } from "@/client/api";
import { useInterpolatedRemaining } from "@/client/interpolate";
import { formatDuration } from "@/client/time";
import type { Alert, GameState, Id, PlayerConfig } from "@/shared/types";

import { AdjustTimeButton } from "./AdjustTimeButton";

export function PlayerCard({
  player,
  game,
  isActive,
  showAdjust,
  showDismiss,
  isPaused,
}: {
  player: PlayerConfig;
  game: GameState;
  isActive: boolean;
  showAdjust: boolean;
  showDismiss: boolean;
  isPaused: boolean;
}) {
  const remaining = game.remainingMs[player.id] ?? 0;
  const interpolated = useInterpolatedRemaining(
    remaining,
    isActive && game.turnStartedAt != null ? Date.now() : null,
    isActive && game.phase === "Running",
  );
  // Use the interpolated value only for active+running; static otherwise.
  const display =
    isActive && game.phase === "Running"
      ? interpolated < remaining
        ? interpolated
        : remaining
      : remaining;

  const playerAlerts: Alert[] = game.alerts.filter((a) => a.playerId === player.id);
  const negative = display < 0;
  const cardClasses = [
    "player-card",
    isActive ? "player-card-active" : "",
    negative ? "player-card-negative" : "",
    isPaused && isActive ? "player-card-paused" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cardClasses}>
      <div className="player-name">
        {isActive ? "▶ " : ""}
        {player.name}
        {isPaused && isActive ? " (paused)" : ""}
      </div>
      <div className={`player-time ${negative ? "negative" : ""}`}>
        {formatDuration(display)}
      </div>
      {playerAlerts.length > 0 ? (
        <div className="player-alerts">
          🔔 {playerAlerts.map((a) => a.kind).join(", ")}
          {showDismiss ? (
            <button
              type="button"
              onClick={() => void api.dismissAlert(player.id)}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
      {showAdjust ? <AdjustTimeButton playerId={player.id} /> : null}
    </div>
  );
}

export function playerById(game: GameState, id: Id): PlayerConfig | undefined {
  return game.config?.players.find((p) => p.id === id);
}
