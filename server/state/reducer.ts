// Pure reducer for the session lifecycle. Spec sources:
//   - specs/02-session-lifecycle.md (phase transitions)
//   - specs/03-timer-config.md (validation gated by ConfirmConfig)
//   - specs/04-in-game-behavior.md (runtime rules + tick model)
// This module performs no I/O and reads no clock; `now` is passed by the caller.

import type { SseEvent } from "@/shared/events";
import type {
  AppSettings,
  EpochMs,
  GameConfig,
  GameState,
  Id,
  Phase,
  TurnSnapshot,
} from "@/shared/types";

import { clearAlerts, reconcileAlertOnChange } from "./alerts";
import { DomainError } from "./errors";
import type { DomainEvent } from "./events";
import { initialState } from "./initial";
import { commitElapsed } from "./tickCore";
import { validateConfig } from "./validation";

export type ReduceResult = {
  state: GameState;
  lastTickAt: EpochMs | null;
  events: SseEvent[];
};

function assertPhase(state: GameState, allowed: Phase[]): void {
  if (!allowed.includes(state.phase)) {
    throw new DomainError(
      "invalid-phase",
      `Event not allowed in phase ${state.phase}`,
    );
  }
}

function cloneConfig(config: GameConfig): GameConfig {
  return {
    mode: config.mode,
    endOfTurnTrigger: config.endOfTurnTrigger,
    turnOrderMode: config.turnOrderMode,
    players: config.players.map((p) => ({ ...p })),
  };
}

function emitPhaseChange(
  events: SseEvent[],
  previous: Phase,
  next: Phase,
): void {
  if (previous !== next) {
    events.push({ event: "phase-changed", data: { phase: next, previous } });
  }
}

function pushSnapshot(
  state: GameState,
  phase: TurnSnapshot["phase"],
  takenAt: EpochMs,
): GameState {
  if (state.currentPlayerIdx == null) return state;
  const snapshot: TurnSnapshot = {
    takenAt,
    phase,
    currentPlayerIdx: state.currentPlayerIdx,
    remainingMs: { ...state.remainingMs },
    roundNumber: state.roundNumber,
    currentOrder: [...state.currentOrder],
  };
  return { ...state, history: [...state.history, snapshot] };
}

function advanceToIdx(
  state: GameState,
  idx: number,
  now: EpochMs,
): GameState {
  let remainingMs = state.remainingMs;
  if (state.config?.mode === "turn-by-turn") {
    const playerId = state.currentOrder[idx];
    if (playerId !== undefined) {
      const player = state.config.players.find((p) => p.id === playerId);
      if (player) {
        remainingMs = { ...remainingMs, [playerId]: player.timeBudgetMs };
      }
    }
  }
  return {
    ...state,
    currentPlayerIdx: idx,
    remainingMs,
    turnStartedAt: now,
  };
}

function makeTurnSwitched(state: GameState, now: EpochMs): SseEvent {
  return {
    event: "turn-switched",
    data: {
      currentPlayerIdx: state.currentPlayerIdx ?? 0,
      currentOrder: [...state.currentOrder],
      roundNumber: state.roundNumber,
      turnStartedAt: now,
      remainingMs: { ...state.remainingMs },
    },
  };
}

export function reduce(
  state: GameState,
  event: DomainEvent,
  now: EpochMs,
  lastTickAt: EpochMs | null,
  appSettings: AppSettings,
): ReduceResult {
  switch (event.type) {
    case "StartNewSession":
      return handleStartNewSession(state, event.config, lastTickAt);
    case "EditConfig":
      return handleEditConfig(state, event.config, lastTickAt);
    case "ConfirmConfig":
      return handleConfirmConfig(state, lastTickAt, appSettings);
    case "StartGame":
      return handleStartGame(state, now);
    case "EndTurn":
      return handleEndTurn(state, event, now, lastTickAt);
    case "ConfirmNextRoundOrder":
      return handleConfirmNextRoundOrder(state, event.playerIds, now);
    case "Pause":
      return handlePause(state, now, lastTickAt);
    case "Resume":
      return handleResume(state, now);
    case "Undo":
      return handleUndo(state, now);
    case "AdjustTime":
      return handleAdjustTime(state, event.playerId, event.deltaMs, now, lastTickAt);
    case "DismissAlert":
      return handleDismissAlert(state, event.playerId, lastTickAt);
    case "Restart":
      return handleRestart(state);
    case "EndGame":
      return handleEndGame(state);
  }
}

// ----- handlers -----

function handleStartNewSession(
  state: GameState,
  config: GameConfig,
  lastTickAt: EpochMs | null,
): ReduceResult {
  assertPhase(state, ["Lobby"]);
  const events: SseEvent[] = [];
  emitPhaseChange(events, state.phase, "Configuring");
  return {
    state: { ...state, phase: "Configuring", config: cloneConfig(config) },
    lastTickAt,
    events,
  };
}

function handleEditConfig(
  state: GameState,
  config: GameConfig,
  lastTickAt: EpochMs | null,
): ReduceResult {
  assertPhase(state, ["Configuring", "Ready"]);
  const events: SseEvent[] = [];
  emitPhaseChange(events, state.phase, "Configuring");
  return {
    state: { ...state, phase: "Configuring", config: cloneConfig(config) },
    lastTickAt,
    events,
  };
}

function handleConfirmConfig(
  state: GameState,
  lastTickAt: EpochMs | null,
  appSettings: AppSettings,
): ReduceResult {
  assertPhase(state, ["Configuring"]);
  if (state.config == null) {
    throw new DomainError("invalid-config", "No draft config to confirm", {
      failed: ["missing-config"],
    });
  }
  const result = validateConfig(state.config, appSettings, state.mqtt.connected);
  if (!result.ok) {
    // Surface the MQTT-specific case with its dedicated 409 code; everything
    // else is a 400 invalid-config.
    if (result.failed.length === 1 && result.failed[0] === "mqtt-not-connected") {
      throw new DomainError(
        "mqtt-not-connected",
        "MQTT must be configured and connected for physical-button mode",
      );
    }
    throw new DomainError("invalid-config", "Config validation failed", {
      failed: result.failed,
    });
  }
  const config = cloneConfig(state.config);
  const devicesSnapshot = appSettings.devices.map((d) => ({ ...d }));
  const remainingMs: Record<Id, number> = {};
  for (const p of config.players) {
    remainingMs[p.id] = p.timeBudgetMs;
  }
  const next: GameState = {
    ...state,
    phase: "Ready",
    config,
    devicesSnapshot,
    currentOrder: config.players.map((p) => p.id),
    remainingMs,
    currentPlayerIdx: null,
    roundNumber: 0,
    turnStartedAt: null,
    alerts: [],
    history: [],
  };
  const events: SseEvent[] = [];
  emitPhaseChange(events, state.phase, "Ready");
  return { state: next, lastTickAt, events };
}

function handleStartGame(state: GameState, now: EpochMs): ReduceResult {
  assertPhase(state, ["Ready"]);
  if (state.config == null || state.currentOrder.length === 0) {
    throw new DomainError("invalid-phase", "Ready phase without config");
  }
  const events: SseEvent[] = [];
  emitPhaseChange(events, state.phase, "Running");
  // Per spec 06: StartGame does NOT re-initialize currentOrder or remainingMs.
  // Any AdjustTime deltas applied while in Ready are preserved. Turn-by-turn
  // budget resets happen on EndTurn / ConfirmNextRoundOrder, not here.
  const next: GameState = {
    ...state,
    phase: "Running",
    currentPlayerIdx: 0,
    roundNumber: 1,
    turnStartedAt: now,
  };
  events.push(makeTurnSwitched(next, now));
  return { state: next, lastTickAt: now, events };
}

function handleEndTurn(
  state: GameState,
  event: { source: "screen-tap" | "physical-button"; expectedPlayerId?: Id },
  now: EpochMs,
  lastTickAt: EpochMs | null,
): ReduceResult {
  assertPhase(state, ["Running"]);
  if (
    state.config == null ||
    state.currentPlayerIdx == null ||
    state.currentOrder.length === 0
  ) {
    throw new DomainError("invalid-phase", "Running phase without active player");
  }
  const activeId = state.currentOrder[state.currentPlayerIdx];
  if (activeId === undefined) {
    throw new DomainError("invalid-phase", "currentPlayerIdx out of range");
  }
  if (event.expectedPlayerId != null && event.expectedPlayerId !== activeId) {
    throw new DomainError(
      "invalid-phase",
      "End-turn for a non-current player",
    );
  }

  const events: SseEvent[] = [];

  // 1. Commit final partial tick for the outgoing player.
  const tickResult = commitElapsed(state, now, lastTickAt);
  let s1: GameState = tickResult.state;
  events.push(...tickResult.events);

  // 2. Push snapshot (phase='Running') BEFORE further mutation.
  s1 = pushSnapshot(s1, "Running", now);

  // 3. Clear turn-out alert for outgoing player in turn-by-turn mode.
  if (s1.config?.mode === "turn-by-turn") {
    const cleared = clearAlerts(
      s1,
      (a) => a.playerId === activeId && a.kind === "turn-out",
    );
    s1 = cleared.state;
    events.push(...cleared.events);
  }

  // 4. Decide next idx / phase.
  const currentIdx = s1.currentPlayerIdx ?? 0;
  const nextIdx = currentIdx + 1;
  const orderLen = s1.currentOrder.length;

  if (nextIdx < orderLen) {
    // Advance within the round.
    s1 = advanceToIdx(s1, nextIdx, now);
    events.push(makeTurnSwitched(s1, now));
    return { state: s1, lastTickAt: now, events };
  }

  // Round complete.
  const newRound = s1.roundNumber + 1;
  if (s1.config?.turnOrderMode === "fixed") {
    s1 = { ...s1, roundNumber: newRound };
    s1 = advanceToIdx(s1, 0, now);
    events.push({
      event: "round-complete",
      data: { roundNumber: newRound, nextPhase: "Running" },
    });
    events.push(makeTurnSwitched(s1, now));
    return { state: s1, lastTickAt: now, events };
  }

  // Rotating + round complete → BetweenRounds.
  const previousPhase = s1.phase;
  s1 = {
    ...s1,
    phase: "BetweenRounds",
    roundNumber: newRound,
    currentPlayerIdx: null,
    turnStartedAt: null,
  };
  events.push({
    event: "round-complete",
    data: { roundNumber: newRound, nextPhase: "BetweenRounds" },
  });
  emitPhaseChange(events, previousPhase, "BetweenRounds");
  return { state: s1, lastTickAt: null, events };
}

function handleConfirmNextRoundOrder(
  state: GameState,
  playerIds: Id[],
  now: EpochMs,
): ReduceResult {
  assertPhase(state, ["BetweenRounds"]);
  if (state.config == null) {
    throw new DomainError("invalid-phase", "BetweenRounds without config");
  }
  // Validate permutation of config player ids.
  const configIds = state.config.players.map((p) => p.id);
  const inputSet = new Set(playerIds);
  if (
    playerIds.length !== configIds.length ||
    inputSet.size !== playerIds.length ||
    configIds.some((id) => !inputSet.has(id))
  ) {
    throw new DomainError(
      "invalid-order",
      "playerIds must be a permutation of config players",
    );
  }

  const events: SseEvent[] = [];
  // Push BetweenRounds snapshot (currentPlayerIdx is null in this phase).
  const snapshot: TurnSnapshot = {
    takenAt: now,
    phase: "BetweenRounds",
    currentPlayerIdx: null,
    remainingMs: { ...state.remainingMs },
    roundNumber: state.roundNumber,
    currentOrder: [...state.currentOrder],
  };
  let s1: GameState = {
    ...state,
    history: [...state.history, snapshot],
    currentOrder: [...playerIds],
    phase: "Running",
  };
  s1 = advanceToIdx(s1, 0, now);
  emitPhaseChange(events, state.phase, "Running");
  events.push(makeTurnSwitched(s1, now));
  return { state: s1, lastTickAt: now, events };
}

function handlePause(
  state: GameState,
  now: EpochMs,
  lastTickAt: EpochMs | null,
): ReduceResult {
  assertPhase(state, ["Running"]);
  const events: SseEvent[] = [];
  const tickResult = commitElapsed(state, now, lastTickAt);
  events.push(...tickResult.events);
  emitPhaseChange(events, state.phase, "Paused");
  return {
    state: { ...tickResult.state, phase: "Paused", turnStartedAt: null },
    lastTickAt: null,
    events,
  };
}

function handleResume(state: GameState, now: EpochMs): ReduceResult {
  assertPhase(state, ["Paused"]);
  const events: SseEvent[] = [];
  emitPhaseChange(events, state.phase, "Running");
  return {
    state: { ...state, phase: "Running", turnStartedAt: now },
    lastTickAt: now,
    events,
  };
}

function handleUndo(state: GameState, now: EpochMs): ReduceResult {
  assertPhase(state, ["Running", "Paused", "BetweenRounds"]);
  if (state.history.length === 0) {
    throw new DomainError("nothing-to-undo", "History is empty");
  }
  const events: SseEvent[] = [];

  const snapshot = state.history[state.history.length - 1];
  if (!snapshot) {
    throw new DomainError("nothing-to-undo", "History is empty");
  }
  const newHistory = state.history.slice(0, -1);
  const preUndoPhase = state.phase;
  const restoredPhase: Phase =
    preUndoPhase === "Paused" ? "Paused" : snapshot.phase;

  // Drop alerts raised after the snapshot.
  const alerts = state.alerts.filter((a) => a.raisedAt <= snapshot.takenAt);
  const droppedAlerts = state.alerts.filter((a) => a.raisedAt > snapshot.takenAt);
  for (const a of droppedAlerts) {
    events.push({
      event: "alert-cleared",
      data: { playerId: a.playerId, kind: a.kind },
    });
  }

  const turnStartedAt: EpochMs | null = restoredPhase === "Running" ? now : null;
  const newLastTickAt: EpochMs | null = restoredPhase === "Running" ? now : null;

  const next: GameState = {
    ...state,
    phase: restoredPhase,
    currentPlayerIdx: snapshot.currentPlayerIdx,
    remainingMs: { ...snapshot.remainingMs },
    roundNumber: snapshot.roundNumber,
    currentOrder: [...snapshot.currentOrder],
    turnStartedAt,
    alerts,
    history: newHistory,
  };

  emitPhaseChange(events, preUndoPhase, restoredPhase);
  if (restoredPhase === "Running") {
    events.push(makeTurnSwitched(next, now));
  }
  return { state: next, lastTickAt: newLastTickAt, events };
}

function handleAdjustTime(
  state: GameState,
  playerId: Id,
  deltaMs: number,
  now: EpochMs,
  lastTickAt: EpochMs | null,
): ReduceResult {
  assertPhase(state, ["Ready", "Running", "Paused", "BetweenRounds"]);
  if (!Number.isInteger(deltaMs)) {
    throw new DomainError("bad-request", "deltaMs must be a finite integer");
  }
  if (!(playerId in state.remainingMs)) {
    throw new DomainError("unknown-player", `Unknown player ${playerId}`);
  }
  if (state.config == null) {
    throw new DomainError("invalid-phase", "AdjustTime without config");
  }
  const events: SseEvent[] = [];
  const prevMs = state.remainingMs[playerId] ?? 0;
  const newMs = prevMs + deltaMs;
  let s1: GameState = {
    ...state,
    remainingMs: { ...state.remainingMs, [playerId]: newMs },
  };
  const reconciled = reconcileAlertOnChange(
    s1,
    playerId,
    prevMs,
    newMs,
    state.config.mode,
    now,
  );
  s1 = reconciled.state;
  events.push(...reconciled.events);
  // lastTickAt is NOT modified by AdjustTime (spec 04).
  return { state: s1, lastTickAt, events };
}

function handleDismissAlert(
  state: GameState,
  playerId: Id,
  lastTickAt: EpochMs | null,
): ReduceResult {
  assertPhase(state, ["Running", "Paused"]);
  if (!(playerId in state.remainingMs)) {
    throw new DomainError("unknown-player", `Unknown player ${playerId}`);
  }
  const { state: s1, events } = clearAlerts(
    state,
    (a) => a.playerId === playerId,
  );
  return { state: s1, lastTickAt, events };
}

function handleRestart(state: GameState): ReduceResult {
  assertPhase(state, ["Running", "Paused", "BetweenRounds"]);
  if (state.config == null) {
    throw new DomainError("invalid-phase", "Restart without config");
  }
  const remainingMs: Record<Id, number> = {};
  for (const p of state.config.players) {
    remainingMs[p.id] = p.timeBudgetMs;
  }
  const events: SseEvent[] = [];
  emitPhaseChange(events, state.phase, "Ready");
  for (const a of state.alerts) {
    events.push({
      event: "alert-cleared",
      data: { playerId: a.playerId, kind: a.kind },
    });
  }
  const next: GameState = {
    ...state,
    phase: "Ready",
    currentPlayerIdx: null,
    roundNumber: 0,
    currentOrder: state.config.players.map((p) => p.id),
    remainingMs,
    turnStartedAt: null,
    alerts: [],
    history: [],
  };
  return { state: next, lastTickAt: null, events };
}

function handleEndGame(state: GameState): ReduceResult {
  assertPhase(state, [
    "Configuring",
    "Ready",
    "Running",
    "Paused",
    "BetweenRounds",
  ]);
  const events: SseEvent[] = [];
  emitPhaseChange(events, state.phase, "Lobby");
  for (const a of state.alerts) {
    events.push({
      event: "alert-cleared",
      data: { playerId: a.playerId, kind: a.kind },
    });
  }
  const next: GameState = {
    ...initialState(),
    mqtt: state.mqtt,
  };
  return { state: next, lastTickAt: null, events };
}
