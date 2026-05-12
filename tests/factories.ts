// Test data factories. Per specs/11-testing-and-dev.md these MUST be the only
// place test data is built — ad-hoc literals in tests lead to drift.
// Implementations are intentionally stubbed at scaffolding time.

import type {
  AppSettings,
  Device,
  GameConfig,
  GameState,
  PlayerConfig,
} from "@/shared/types";

export function makeDevice(_overrides?: Partial<Device>): Device {
  throw new Error("not implemented");
}

export function makePlayerConfig(
  _overrides?: Partial<PlayerConfig>,
): PlayerConfig {
  throw new Error("not implemented");
}

export function makeGameConfig(_overrides?: Partial<GameConfig>): GameConfig {
  throw new Error("not implemented");
}

export function makeAppSettings(
  _overrides?: Partial<AppSettings>,
): AppSettings {
  throw new Error("not implemented");
}

export function makeGameState(_overrides?: Partial<GameState>): GameState {
  throw new Error("not implemented");
}
