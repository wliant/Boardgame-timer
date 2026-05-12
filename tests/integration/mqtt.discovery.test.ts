import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connect, type MqttClient } from "mqtt";

import { GET as discoverGet, POST as discoverStart, DELETE as discoverStop } from "@/app/api/settings/mqtt-discover/route";
import { PUT as putSettings, GET as getSettings } from "@/app/api/settings/route";
import { GET as streamSse } from "@/app/api/session/stream/route";
import { resetGameForTests } from "@/server/game";
import type { AppSettings } from "@/shared/types";

import { collectSseEvents, expectSseEvent, waitFor, withTempDb } from "./helpers";

let cleanup = () => {};
let pub: MqttClient | null = null;

beforeEach(() => {
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

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data: T };
  return body.data;
}

describe("mqtt-discover", () => {
  it("rejects when MQTT not connected", async () => {
    const res = await discoverStart(new Request("http://test", { method: "POST" }));
    expect(res.status).toBe(409);
  });

  it("emits mqtt-discover-message once per unique topic", async () => {
    const current = await unwrap<AppSettings>(getSettings());
    await putSettings(
      new Request("http://test/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          data: {
            mqttBroker: { ...current.mqttBroker, url: "mqtt://127.0.0.1:1883" },
            devices: [],
          },
        }),
      }),
    );

    await waitFor(async () => {
      const r = await (await import("@/app/api/session/state/route")).GET();
      const json = (await r.json()) as { data: { mqtt: { connected: boolean } } };
      return json.data.mqtt.connected;
    }, 5_000);

    const ctrl = new AbortController();
    const sseRes = streamSse(new Request("http://test/api/session/stream", { signal: ctrl.signal }));
    const collector = collectSseEvents(sseRes);
    await expectSseEvent(collector, "state");

    const startRes = await discoverStart(new Request("http://test", { method: "POST" }));
    expect(startRes.status).toBe(200);

    pub = connect("mqtt://127.0.0.1:1883");
    await new Promise<void>((r) => pub!.once("connect", () => r()));
    pub.publish("discover/red", "single");
    pub.publish("discover/red", "single"); // duplicate topic, should NOT emit again
    pub.publish("discover/blue", "single");

    await waitFor(() => collector.events.filter((e) => e.event === "mqtt-discover-message").length >= 2, 3_000);

    const discoverEvents = collector.events.filter(
      (e) => e.event === "mqtt-discover-message",
    );
    const topics = discoverEvents.map((e) => (e.data as { topic: string }).topic);
    expect(topics).toContain("discover/red");
    expect(topics).toContain("discover/blue");
    // Each unique topic fires exactly once.
    const redEvents = topics.filter((t) => t === "discover/red");
    expect(redEvents.length).toBe(1);

    const buf = await unwrap<{ topic: string; count: number }[]>(discoverGet());
    const red = buf.find((b) => b.topic === "discover/red");
    expect(red?.count).toBe(2);

    await discoverStop();
    collector.stop();
    ctrl.abort();
  });
});
