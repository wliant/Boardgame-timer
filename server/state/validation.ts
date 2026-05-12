// GameConfig validation rules from specs/03-timer-config.md.

import type { AppSettings, GameConfig } from "@/shared/types";

export type ValidationRule =
  | "invalid-mode"
  | "invalid-trigger"
  | "invalid-order-mode"
  | "player-count"
  | "player-name"
  | "player-budget"
  | "missing-device"
  | "unknown-device"
  | "duplicate-device"
  | "stray-device-assignment"
  | "mqtt-not-connected";

export type ValidationResult =
  | { ok: true }
  | { ok: false; failed: ValidationRule[] };

const VALID_MODES = new Set(["total-time", "turn-by-turn"]);
const VALID_TRIGGERS = new Set(["screen-tap", "physical-button"]);
const VALID_ORDERS = new Set(["fixed", "rotating"]);

export function validateConfig(
  config: GameConfig,
  settings: AppSettings,
  mqttConnected = false,
): ValidationResult {
  const failed = new Set<ValidationRule>();

  if (!VALID_MODES.has(config.mode)) failed.add("invalid-mode");
  if (!VALID_TRIGGERS.has(config.endOfTurnTrigger))
    failed.add("invalid-trigger");
  if (!VALID_ORDERS.has(config.turnOrderMode)) failed.add("invalid-order-mode");

  if (config.players.length < 2 || config.players.length > 8)
    failed.add("player-count");

  for (const p of config.players) {
    const trimmed = p.name.trim();
    if (trimmed.length === 0 || trimmed.length > 24) failed.add("player-name");
    if (!Number.isInteger(p.timeBudgetMs) || p.timeBudgetMs <= 0)
      failed.add("player-budget");
  }

  if (config.endOfTurnTrigger === "physical-button") {
    const seen = new Set<string>();
    for (const p of config.players) {
      if (p.assignedDeviceId == null) {
        failed.add("missing-device");
        continue;
      }
      const exists = settings.devices.some(
        (d) => d.id === p.assignedDeviceId,
      );
      if (!exists) failed.add("unknown-device");
      if (seen.has(p.assignedDeviceId)) failed.add("duplicate-device");
      seen.add(p.assignedDeviceId);
    }
    // Spec 03 §rule 7: MQTT must be configured AND connected.
    if (!settings.mqttBroker.url || !mqttConnected) {
      failed.add("mqtt-not-connected");
    }
  } else {
    for (const p of config.players) {
      if (p.assignedDeviceId !== null) failed.add("stray-device-assignment");
    }
  }

  if (failed.size === 0) return { ok: true };
  return { ok: false, failed: [...failed] };
}
