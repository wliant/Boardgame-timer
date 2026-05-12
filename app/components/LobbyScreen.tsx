"use client";

import Link from "next/link";

import { api } from "@/client/api";
import type { AppSettings, GameState } from "@/shared/types";

import { MqttStatusPill } from "./MqttStatusPill";

export function LobbyScreen({
  game,
  settings,
}: {
  game: GameState;
  settings: AppSettings | null;
}) {
  const brokerUrl = settings?.mqttBroker.url ?? "";
  const startSession = async () => {
    try {
      await api.startConfig();
    } catch (err) {
      alert(`Could not start session: ${(err as Error).message}`);
    }
  };
  return (
    <main className="screen screen-lobby">
      <header className="screen-header">
        <h1>Boardgame Timer</h1>
        <Link href="/settings" className="link-button">
          Settings
        </Link>
      </header>
      <section className="lobby-body">
        <button
          type="button"
          className="primary big"
          onClick={() => void startSession()}
        >
          Start new session
        </button>
        <div className="lobby-status">
          <MqttStatusPill game={game} brokerUrl={brokerUrl} />
        </div>
        {!brokerUrl ? (
          <p className="lobby-hint">
            MQTT broker not configured. Physical buttons won&rsquo;t work until you set
            the broker URL in Settings. You can still start a session using screen-tap
            end-of-turn.
          </p>
        ) : null}
      </section>
    </main>
  );
}
