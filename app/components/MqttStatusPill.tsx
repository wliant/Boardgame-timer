"use client";

import type { GameState } from "@/shared/types";

export function MqttStatusPill({
  game,
  brokerUrl,
}: {
  game: GameState | null;
  brokerUrl: string;
}) {
  let label: string;
  let kind: "ok" | "warn" | "off";
  if (!brokerUrl) {
    label = "MQTT: not configured";
    kind = "off";
  } else if (game?.mqtt.connected) {
    label = `MQTT: connected (${brokerUrl})`;
    kind = "ok";
  } else {
    label = `MQTT: disconnected${game?.mqtt.lastError ? ` — ${game.mqtt.lastError}` : ""}`;
    kind = "warn";
  }
  return <span className={`pill pill-${kind}`}>{label}</span>;
}
