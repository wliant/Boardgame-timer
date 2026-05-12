"use client";

import { useEffect, useState } from "react";

import { api } from "@/client/api";
import {
  installAudioPrimer,
  isAudioUnavailable,
  startAlertLoop,
  stopAlertLoop,
} from "@/client/audio";
import type { AppSettings, GameState } from "@/shared/types";

import { ConfirmModal } from "./ConfirmModal";
import { PlayerCard } from "./PlayerCard";

export function InGameScreen({
  game,
  settings,
}: {
  game: GameState;
  settings: AppSettings | null;
}) {
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);

  useEffect(() => {
    installAudioPrimer();
  }, []);

  useEffect(() => {
    if (game.alerts.length > 0) startAlertLoop();
    else stopAlertLoop();
    return () => stopAlertLoop();
  }, [game.alerts.length]);

  if (!game.config) return null;
  const activeId =
    game.currentPlayerIdx != null ? game.currentOrder[game.currentPlayerIdx] : undefined;
  const activePlayer = activeId ? game.config.players.find((p) => p.id === activeId) : undefined;
  const otherPlayers = game.config.players.filter((p) => p.id !== activeId);
  const isPaused = game.phase === "Paused";
  const audioUnavailable = isAudioUnavailable() && game.alerts.length > 0;
  const showBrokerBanner =
    game.config.endOfTurnTrigger === "physical-button" && !game.mqtt.connected;
  void settings;

  return (
    <main className="screen screen-ingame">
      <header className="ingame-header">
        <div className="round-label">Round {game.roundNumber}</div>
        <div className="ingame-controls">
          {isPaused ? (
            <button type="button" onClick={() => void api.resume()}>▶ Resume</button>
          ) : (
            <button type="button" onClick={() => void api.pause()}>⏸ Pause</button>
          )}
          <button type="button" onClick={() => void api.endTurn()}>End Turn</button>
          <button
            type="button"
            disabled={game.history.length === 0}
            onClick={() => void api.undo()}
          >
            ↶ Undo
          </button>
          <button type="button" onClick={() => setRestartConfirm(true)}>↻ Restart</button>
          <button type="button" onClick={() => setEndConfirm(true)}>⏹ End Game</button>
        </div>
      </header>

      {showBrokerBanner ? (
        <div className="banner banner-warn">
          ⚠ MQTT disconnected — physical buttons won&rsquo;t work. Use the on-screen End
          Turn button.
        </div>
      ) : null}
      {audioUnavailable ? (
        <div className="banner">🔇 audio unavailable — alerts will be visual only</div>
      ) : null}

      {activePlayer ? (
        <section className="active-area">
          <PlayerCard
            player={activePlayer}
            game={game}
            isActive
            showAdjust
            showDismiss={
              game.alerts.some((a) => a.playerId === activePlayer.id) &&
              (game.phase === "Running" || game.phase === "Paused")
            }
            isPaused={isPaused}
          />
          <button
            type="button"
            className="big-end-turn"
            onClick={() => void api.endTurn()}
          >
            End Turn
          </button>
        </section>
      ) : null}

      <section className="other-players">
        {otherPlayers.map((p) => (
          <PlayerCard
            key={p.id}
            player={p}
            game={game}
            isActive={false}
            showAdjust
            showDismiss={
              game.alerts.some((a) => a.playerId === p.id) &&
              (game.phase === "Running" || game.phase === "Paused")
            }
            isPaused={false}
          />
        ))}
      </section>

      <ConfirmModal
        open={restartConfirm}
        title="Restart the game?"
        body="All current timers will reset to their starting values. The config stays the same."
        confirmLabel="Restart"
        onCancel={() => setRestartConfirm(false)}
        onConfirm={() => {
          setRestartConfirm(false);
          void api.restart();
        }}
      />
      <ConfirmModal
        open={endConfirm}
        title="End the game and return to the lobby?"
        body="All timers and history will be discarded."
        confirmLabel="End Game"
        onCancel={() => setEndConfirm(false)}
        onConfirm={() => {
          setEndConfirm(false);
          void api.endGame();
        }}
      />
    </main>
  );
}
