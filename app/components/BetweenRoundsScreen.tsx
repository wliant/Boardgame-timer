"use client";

import { useState } from "react";

import { api } from "@/client/api";
import { formatDuration } from "@/client/time";
import type { GameState, Id, PlayerConfig } from "@/shared/types";

import { AdjustTimeButton } from "./AdjustTimeButton";
import { ConfirmModal } from "./ConfirmModal";

export function BetweenRoundsScreen({ game }: { game: GameState }) {
  const [order, setOrder] = useState<Id[]>([...game.currentOrder]);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  if (!game.config) return null;
  const playerById = new Map<Id, PlayerConfig>(
    game.config.players.map((p) => [p.id, p]),
  );

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const item = next[from];
    if (item === undefined) return;
    next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
  };

  return (
    <main className="screen screen-between">
      <header className="screen-header">
        <h1>Round {game.roundNumber - 1} complete — set order for Round {game.roundNumber}</h1>
        <div className="screen-header-actions">
          <button
            type="button"
            disabled={game.history.length === 0}
            onClick={() => void api.undo()}
          >
            ↶ Undo
          </button>
          <button type="button" onClick={() => setRestartConfirm(true)}>↻ Restart</button>
          <button type="button" onClick={() => setEndConfirm(true)}>End Game</button>
        </div>
      </header>

      <section>
        <h2>Drag to reorder:</h2>
        <ol className="reorder-list">
          {order.map((id, idx) => {
            const p = playerById.get(id);
            if (!p) return null;
            return (
              <li
                key={id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== idx) move(dragIdx, idx);
                  setDragIdx(idx);
                }}
                onDragEnd={() => setDragIdx(null)}
                className={dragIdx === idx ? "dragging" : ""}
              >
                <span className="handle">☰</span>
                <span className="player-name">{p.name}</span>
                <span className="player-time">{formatDuration(game.remainingMs[id] ?? 0)}</span>
                <span className="reorder-buttons">
                  <button type="button" onClick={() => move(idx, Math.max(0, idx - 1))}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, Math.min(order.length - 1, idx + 1))}
                  >
                    ↓
                  </button>
                </span>
                <AdjustTimeButton playerId={id} label={p.name} />
              </li>
            );
          })}
        </ol>
      </section>

      <div className="config-actions">
        <button
          type="button"
          className="primary big"
          onClick={() => void api.confirmNextRound(order)}
        >
          Confirm Next Round Order
        </button>
      </div>

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
