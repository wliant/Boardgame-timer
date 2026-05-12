"use client";

import { useState } from "react";

import { api } from "@/client/api";
import { formatDuration } from "@/client/time";
import type { AppSettings, GameState } from "@/shared/types";

import { AdjustTimeButton } from "./AdjustTimeButton";
import { ConfirmModal } from "./ConfirmModal";

export function ReadyScreen({
  game,
  settings,
}: {
  game: GameState;
  settings: AppSettings | null;
}) {
  const [endConfirm, setEndConfirm] = useState(false);
  if (!game.config) return null;
  const devices = settings?.devices ?? game.devicesSnapshot;
  return (
    <main className="screen screen-ready">
      <header className="screen-header">
        <h1>Game Ready</h1>
        <div className="screen-header-actions">
          <button
            type="button"
            onClick={() => {
              if (game.config) void api.putConfig(game.config);
            }}
          >
            Edit Config
          </button>
          <button type="button" onClick={() => setEndConfirm(true)}>End Game</button>
        </div>
      </header>
      <section className="ready-cards">
        {game.config.players.map((p) => {
          const device = devices.find((d) => d.id === p.assignedDeviceId);
          return (
            <div key={p.id} className="ready-card">
              <div className="player-name">{p.name}</div>
              <div className="player-time">{formatDuration(game.remainingMs[p.id] ?? p.timeBudgetMs)}</div>
              {device ? <div className="player-device">🟢 {device.name}</div> : null}
              <AdjustTimeButton playerId={p.id} />
            </div>
          );
        })}
      </section>
      <section className="ready-summary">
        Mode: {game.config.mode} &nbsp;|&nbsp; Order: {game.config.turnOrderMode}
        &nbsp;|&nbsp; Trigger: {game.config.endOfTurnTrigger}
      </section>
      <div className="ready-start">
        <button type="button" className="primary big" onClick={() => void api.startGame()}>
          Start
        </button>
      </div>
      <ConfirmModal
        open={endConfirm}
        title="End game?"
        body="Discard this configuration and return to lobby?"
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
