import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connect, type MqttClient } from "mqtt";

import { PUT as putSettings, GET as getSettings } from "@/app/api/settings/route";
import { POST as startConfig } from "@/app/api/session/start-config/route";
import { PUT as putConfig } from "@/app/api/session/config/route";
import { POST as confirmConfig } from "@/app/api/session/confirm-config/route";
import { POST as startGame } from "@/app/api/session/start-game/route";
import { GET as streamSse } from "@/app/api/session/stream/route";
import { resetGameForTests } from "@/server/game";
import type { AppSettings, GameConfig, GameState } from "@/shared/types";

import { collectSseEvents, expectSseEvent, waitFor, withTempDb } from "./helpers";

let cleanup = () => {};
let pub: MqttClient | null = null;

async function bodyJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function settingsWithDevices(devices: AppSettings["devices"]): Promise<AppSettings> {
  const current = (await bodyJson<{ data: AppSettings }>(getSettings())).data;
  const next: AppSettings = {
    mqttBroker: { ...current.mqttBroker, url: "mqtt://127.0.0.1:1883" },
    devices,
  };
  const res = await putSettings(
    new Request("http://test/api/settings", {
      method: "PUT",
      body: JSON.stringify({ data: next }),
    }),
  );
  const saved = (await bodyJson<{ data: AppSettings }>(res)).data;
  return saved;
}

beforeEach(async () => {
  cleanup = withTempDb().cleanup;
  resetGameForTests();
});

afterEach(async () => {
  if (pub) {
    await new Promise<void>((r) => pub!.end(true, {}, () => r()));
    pub = null;
  }
  cleanup();
});

describe("MQTT physical-button press resolution", () => {
  it("active player's press advances the turn; wrong button is ignored", async () => {
    // 1. Configure broker + register two devices.
    const saved = await settingsWithDevices([
      { id: "dev-a", name: "Red", topic: "test/red" },
      { id: "dev-b", name: "Blue", topic: "test/blue" },
    ]);
    expect(saved.devices.length).toBe(2);

    // 2. Wait until MQTT manager reports connected.
    await waitFor(async () => {
      const r = await bodyJson<{ data: GameState }>(
        (await import("@/app/api/session/state/route")).GET(),
      );
      return r.data.mqtt.connected;
    }, 5_000);

    // 3. Build a config that maps each player to a device, confirm, start.
    await startConfig();
    const config: GameConfig = {
      mode: "total-time",
      endOfTurnTrigger: "physical-button",
      turnOrderMode: "fixed",
      players: [
        { id: "p-1", name: "Alice", timeBudgetMs: 60_000, assignedDeviceId: "dev-a" },
        { id: "p-2", name: "Bob", timeBudgetMs: 60_000, assignedDeviceId: "dev-b" },
      ],
    };
    await putConfig(
      new Request("http://test/api/session/config", {
        method: "PUT",
        body: JSON.stringify({ data: config }),
      }),
    );
    await confirmConfig();
    await startGame();

    // 4. Open SSE collector to observe events.
    const ctrl = new AbortController();
    const sseRes = streamSse(
      new Request("http://test/api/session/stream", { signal: ctrl.signal }),
    );
    const collector = collectSseEvents(sseRes);
    await expectSseEvent(collector, "state");

    // 5. Publish a non-current player's press → press-ignored.
    pub = connect("mqtt://127.0.0.1:1883");
    await new Promise<void>((r) => pub!.once("connect", () => r()));
    pub.publish("test/blue", JSON.stringify({ action: "single" }));

    const ignored = await expectSseEvent(collector, "press-ignored", 3_000);
    expect((ignored.data as { reason: string }).reason).toBe("not-current-player");

    // 6. Publish the active player's press → turn-switched.
    pub.publish("test/red", JSON.stringify({ action: "single" }));
    const turn = await expectSseEvent(collector, "turn-switched", 3_000);
    expect((turn.data as { currentPlayerIdx: number }).currentPlayerIdx).toBe(1);

    collector.stop();
    ctrl.abort();
  });
});
