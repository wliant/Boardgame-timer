// Test data factories. Every test object goes through here — no ad-hoc literals.
// See specs/11-testing-and-dev.md §"Test factories".

import { randomUUID } from "node:crypto";

import type {
  AppSettings,
  Device,
  GameConfig,
  GameState,
  PlayerConfig,
} from "@/shared/types";

import { initialState } from "@/server/state/initial";

export function makeDevice(overrides: Partial<Device> = {}): Device {
  const base: Device = {
    id: randomUUID(),
    name: "Test Device",
    topic: "test/topic",
  };
  return { ...base, ...overrides };
}

export function makePlayerConfig(
  overrides: Partial<PlayerConfig> = {},
): PlayerConfig {
  const base: PlayerConfig = {
    id: randomUUID(),
    name: "Player",
    timeBudgetMs: 60_000,
    assignedDeviceId: null,
  };
  return { ...base, ...overrides };
}

export function makeGameConfig(
  overrides: Partial<GameConfig> = {},
): GameConfig {
  const players = overrides.players ?? [
    makePlayerConfig({ name: "Alice" }),
    makePlayerConfig({ name: "Bob" }),
  ];
  return {
    mode: "total-time",
    endOfTurnTrigger: "screen-tap",
    turnOrderMode: "fixed",
    ...overrides,
    players,
  };
}

export function makeAppSettings(
  overrides: Partial<AppSettings> = {},
): AppSettings {
  return {
    mqttBroker: {
      url: "",
      clientId: "test-client",
    },
    devices: [],
    ...overrides,
  };
}

export function makeGameState(
  overrides: Partial<GameState> = {},
): GameState {
  return { ...initialState(), ...overrides };
}

/** Build a state in Ready phase with `n` players, all using `budgetMs`. */
export function readyState(
  options: {
    n?: number;
    budgetMs?: number;
    mode?: GameConfig["mode"];
    trigger?: GameConfig["endOfTurnTrigger"];
    orderMode?: GameConfig["turnOrderMode"];
  } = {},
): GameState {
  const { n = 2, budgetMs = 60_000, mode = "total-time", trigger = "screen-tap", orderMode = "fixed" } = options;
  const players = Array.from({ length: n }, (_, i) =>
    makePlayerConfig({ name: `P${i + 1}`, timeBudgetMs: budgetMs }),
  );
  const config = makeGameConfig({
    mode,
    endOfTurnTrigger: trigger,
    turnOrderMode: orderMode,
    players,
  });
  const remainingMs: Record<string, number> = {};
  for (const p of players) remainingMs[p.id] = p.timeBudgetMs;
  return makeGameState({
    phase: "Ready",
    config,
    devicesSnapshot: [],
    currentOrder: players.map((p) => p.id),
    remainingMs,
    currentPlayerIdx: null,
    roundNumber: 0,
    turnStartedAt: null,
  });
}
