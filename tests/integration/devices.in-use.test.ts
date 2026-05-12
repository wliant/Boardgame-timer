import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE as deleteDevice } from "@/app/api/settings/devices/[id]/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";
import { POST as startConfig } from "@/app/api/session/start-config/route";
import { PUT as putConfig } from "@/app/api/session/config/route";
import { POST as confirmConfig } from "@/app/api/session/confirm-config/route";
import { resetGameForTests } from "@/server/game";
import type { AppSettings, GameConfig } from "@/shared/types";

import { waitFor, withTempDb } from "./helpers";

let cleanup = () => {};

beforeEach(() => {
  cleanup = withTempDb().cleanup;
  resetGameForTests();
});

afterEach(() => {
  cleanup();
});

async function configureWithDevices(devices: AppSettings["devices"]): Promise<void> {
  const current = (await (getSettings().json() as Promise<{ data: AppSettings }>)).data;
  const next: AppSettings = {
    mqttBroker: { ...current.mqttBroker, url: "mqtt://127.0.0.1:1883" },
    devices,
  };
  await putSettings(
    new Request("http://test/api/settings", {
      method: "PUT",
      body: JSON.stringify({ data: next }),
    }),
  );
}

describe("device-in-use enforcement", () => {
  it("rejects DELETE of a device that's in the running game's devicesSnapshot", async () => {
    await configureWithDevices([
      { id: "dev-a", name: "Red", topic: "test/red" },
      { id: "dev-b", name: "Blue", topic: "test/blue" },
    ]);

    // Wait for MQTT to connect so ConfirmConfig in physical-button mode passes.
    await waitFor(async () => {
      const r = (await import("@/app/api/session/state/route")).GET();
      const json = (await r.json()) as { data: { mqtt: { connected: boolean } } };
      return json.data.mqtt.connected;
    }, 5_000);

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

    // Now try to delete a device that's snapshotted into the game.
    const res = await deleteDevice(new Request("http://test"), {
      params: Promise.resolve({ id: "dev-a" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("device-in-use");
  });
});
