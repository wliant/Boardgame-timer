"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/client/api";
import { formatDuration, parseDuration } from "@/client/time";
import type {
  AppSettings,
  EndOfTurnTrigger,
  GameConfig,
  GameState,
  PlayerConfig,
  TimerMode,
  TurnOrderMode,
} from "@/shared/types";

import { ConfirmModal } from "./ConfirmModal";

const DEBOUNCE_MS = 200;

function newPlayer(index: number): PlayerConfig {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `player-${String(Date.now())}-${String(index)}`;
  return {
    id,
    name: `Player ${String(index + 1)}`,
    timeBudgetMs: 600_000,
    assignedDeviceId: null,
  };
}

type ValidationIssue =
  | "player-count"
  | "player-name"
  | "player-budget"
  | "missing-device"
  | "duplicate-device"
  | "unknown-device";

function validate(
  config: GameConfig,
  devices: AppSettings["devices"],
): ValidationIssue[] {
  const issues = new Set<ValidationIssue>();
  if (config.players.length < 2 || config.players.length > 8) issues.add("player-count");
  for (const p of config.players) {
    const trimmed = p.name.trim();
    if (trimmed.length === 0 || trimmed.length > 24) issues.add("player-name");
    if (!Number.isInteger(p.timeBudgetMs) || p.timeBudgetMs <= 0) issues.add("player-budget");
  }
  if (config.endOfTurnTrigger === "physical-button") {
    const seen = new Set<string>();
    for (const p of config.players) {
      if (p.assignedDeviceId == null) issues.add("missing-device");
      else {
        const exists = devices.some((d) => d.id === p.assignedDeviceId);
        if (!exists) issues.add("unknown-device");
        if (seen.has(p.assignedDeviceId)) issues.add("duplicate-device");
        seen.add(p.assignedDeviceId);
      }
    }
  }
  return [...issues];
}

export function ConfigScreen({
  game,
  settings,
}: {
  game: GameState;
  settings: AppSettings | null;
}) {
  const [draft, setDraft] = useState<GameConfig>(
    game.config ?? {
      mode: "total-time",
      endOfTurnTrigger: "screen-tap",
      turnOrderMode: "fixed",
      players: [newPlayer(0), newPlayer(1)],
    },
  );
  const [endConfirm, setEndConfirm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  // Push draft to server (debounced).
  const persist = (config: GameConfig) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      void api
        .putConfig(config)
        .catch((err: unknown) => {
          console.error("config persist", err);
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    }, DEBOUNCE_MS);
  };

  const update = (next: GameConfig) => {
    setDraft(next);
    persist(next);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const issues = useMemo(
    () => validate(draft, settings?.devices ?? []),
    [draft, settings?.devices],
  );

  const confirm = async () => {
    if (issues.length > 0) return;
    try {
      await api.confirmConfig();
    } catch (err) {
      alert(`Could not confirm: ${(err as Error).message}`);
    }
  };

  const setMode = (mode: TimerMode) => update({ ...draft, mode });
  const setTrigger = (trigger: EndOfTurnTrigger) => {
    const next: GameConfig =
      trigger === "screen-tap"
        ? {
            ...draft,
            endOfTurnTrigger: trigger,
            players: draft.players.map((p) => ({ ...p, assignedDeviceId: null })),
          }
        : { ...draft, endOfTurnTrigger: trigger };
    update(next);
  };
  const setOrder = (turnOrderMode: TurnOrderMode) =>
    update({ ...draft, turnOrderMode });

  const updatePlayer = (idx: number, patch: Partial<PlayerConfig>) => {
    const updated = draft.players.map((p, i) =>
      i === idx ? { ...p, ...patch } : p,
    );
    update({ ...draft, players: updated });
  };
  const addPlayer = () => {
    if (draft.players.length >= 8) return;
    update({ ...draft, players: [...draft.players, newPlayer(draft.players.length)] });
  };
  const removePlayer = (idx: number) => {
    if (draft.players.length <= 2) return;
    update({
      ...draft,
      players: draft.players.filter((_, i) => i !== idx),
    });
  };

  return (
    <main className="screen screen-config">
      <header className="screen-header">
        <h1>Configure Timer</h1>
        <button type="button" onClick={() => setEndConfirm(true)}>End Game</button>
      </header>

      <section className="config-fields">
        <fieldset>
          <legend>Mode</legend>
          <label>
            <input
              type="radio"
              name="mode"
              checked={draft.mode === "total-time"}
              onChange={() => setMode("total-time")}
            />{" "}
            Total time
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={draft.mode === "turn-by-turn"}
              onChange={() => setMode("turn-by-turn")}
            />{" "}
            Turn by turn
          </label>
        </fieldset>
        <fieldset>
          <legend>Order</legend>
          <label>
            <input
              type="radio"
              name="order"
              checked={draft.turnOrderMode === "fixed"}
              onChange={() => setOrder("fixed")}
            />{" "}
            Fixed
          </label>
          <label>
            <input
              type="radio"
              name="order"
              checked={draft.turnOrderMode === "rotating"}
              onChange={() => setOrder("rotating")}
            />{" "}
            Rotating
          </label>
        </fieldset>
        <fieldset>
          <legend>End of turn</legend>
          <label>
            <input
              type="radio"
              name="trigger"
              checked={draft.endOfTurnTrigger === "screen-tap"}
              onChange={() => setTrigger("screen-tap")}
            />{" "}
            Tap screen
          </label>
          <label>
            <input
              type="radio"
              name="trigger"
              checked={draft.endOfTurnTrigger === "physical-button"}
              onChange={() => setTrigger("physical-button")}
            />{" "}
            Physical button
          </label>
        </fieldset>
      </section>

      <section className="players-section">
        <h2>Players ({draft.players.length}/8)</h2>
        <table className="players-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Budget (m:ss)</th>
              {draft.endOfTurnTrigger === "physical-button" ? <th>Device</th> : null}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draft.players.map((p, idx) => (
              <PlayerRow
                key={p.id}
                idx={idx}
                player={p}
                trigger={draft.endOfTurnTrigger}
                devices={settings?.devices ?? []}
                onChange={(patch) => updatePlayer(idx, patch)}
                onRemove={() => removePlayer(idx)}
                canRemove={draft.players.length > 2}
              />
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addPlayer}
          disabled={draft.players.length >= 8}
        >
          + Add Player
        </button>
      </section>

      <section className="validation-summary">
        {issues.length === 0 ? (
          <span className="ok">✓ All good</span>
        ) : (
          <ul>
            {issues.map((i) => (
              <li key={i} className="error">
                {humanIssue(i)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="config-actions">
        <button
          type="button"
          className="primary big"
          onClick={() => void confirm()}
          disabled={issues.length > 0}
        >
          Confirm Configuration
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

function humanIssue(issue: ValidationIssue): string {
  switch (issue) {
    case "player-count":
      return "Need 2–8 players.";
    case "player-name":
      return "Every player needs a non-empty name (≤24 chars).";
    case "player-budget":
      return "Every budget must be a positive integer.";
    case "missing-device":
      return "Every player needs an assigned device in physical-button mode.";
    case "duplicate-device":
      return "Each device may only be assigned to one player.";
    case "unknown-device":
      return "A player is assigned to a device that no longer exists.";
  }
}

function PlayerRow({
  idx,
  player,
  trigger,
  devices,
  onChange,
  onRemove,
  canRemove,
}: {
  idx: number;
  player: PlayerConfig;
  trigger: EndOfTurnTrigger;
  devices: AppSettings["devices"];
  onChange: (patch: Partial<PlayerConfig>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [budgetText, setBudgetText] = useState(formatDuration(player.timeBudgetMs));
  // Keep input in sync if budget changes externally.
  useEffect(() => {
    setBudgetText(formatDuration(player.timeBudgetMs));
  }, [player.timeBudgetMs]);
  const onBudgetBlur = () => {
    const parsed = parseDuration(budgetText);
    if (parsed != null && parsed > 0) onChange({ timeBudgetMs: parsed });
    else setBudgetText(formatDuration(player.timeBudgetMs));
  };
  return (
    <tr>
      <td>{idx + 1}</td>
      <td>
        <input
          type="text"
          value={player.name}
          maxLength={24}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </td>
      <td>
        <input
          type="text"
          value={budgetText}
          onChange={(e) => setBudgetText(e.target.value)}
          onBlur={onBudgetBlur}
        />
      </td>
      {trigger === "physical-button" ? (
        <td>
          <select
            value={player.assignedDeviceId ?? ""}
            onChange={(e) =>
              onChange({ assignedDeviceId: e.target.value === "" ? null : e.target.value })
            }
          >
            <option value="">(none)</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </td>
      ) : null}
      <td>
        <button type="button" onClick={onRemove} disabled={!canRemove}>
          − Remove
        </button>
      </td>
    </tr>
  );
}
