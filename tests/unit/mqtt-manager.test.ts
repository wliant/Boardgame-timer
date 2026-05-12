import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDevice } from "@/tests/factories";

type FakeClient = EventEmitter & {
  connected: boolean;
  subscribe: (topic: string, cb?: (err: Error | null) => void) => void;
  unsubscribe: (topic: string, cb?: () => void) => void;
  end: (force: boolean) => void;
  subscriptions: string[];
};

const created: FakeClient[] = [];

vi.mock("mqtt", () => {
  return {
    connect: vi.fn((_url: string) => {
      const ee = new EventEmitter() as FakeClient;
      ee.connected = false;
      ee.subscriptions = [];
      ee.subscribe = vi.fn((topic: string, cb?: (err: Error | null) => void) => {
        ee.subscriptions.push(topic);
        cb?.(null);
      });
      ee.unsubscribe = vi.fn((topic: string, cb?: () => void) => {
        ee.subscriptions = ee.subscriptions.filter((t) => t !== topic);
        cb?.();
      });
      ee.end = vi.fn();
      created.push(ee);
      return ee;
    }),
  };
});

import { MqttManager } from "@/server/mqtt/manager";

beforeEach(() => {
  created.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

function flushClient(): FakeClient {
  const c = created[created.length - 1];
  if (!c) throw new Error("no client created");
  return c;
}

describe("MqttManager", () => {
  it("does not connect when broker url is empty", () => {
    const m = new MqttManager();
    let lastStatus: { connected: boolean; lastError: string | null } | null = null;
    m.setHandlers({
      onStatus: (s) => (lastStatus = s),
      onMessage: () => {},
      onDiscover: () => {},
    });
    m.configure({ url: "", clientId: "x" });
    expect(created.length).toBe(0);
    expect(lastStatus).toMatchObject({
      connected: false,
      lastError: "no-broker-configured",
    });
  });

  it("connects and subscribes existing devices after connect", () => {
    const m = new MqttManager();
    const statuses: Array<{ connected: boolean; lastError: string | null }> = [];
    m.setHandlers({
      onStatus: (s) => statuses.push(s),
      onMessage: () => {},
      onDiscover: () => {},
    });
    const dev = makeDevice({ topic: "test/red" });
    m.syncDevices([dev]);
    m.configure({ url: "mqtt://x", clientId: "c" });
    const client = flushClient();
    client.connected = true;
    client.emit("connect");
    expect(statuses.some((s) => s.connected)).toBe(true);
    expect(client.subscriptions).toContain("test/red");
  });

  it("emits press for matching topic, then ignores after device removed", () => {
    const m = new MqttManager();
    const messages: { ids: string[]; topic: string }[] = [];
    m.setHandlers({
      onStatus: () => {},
      onMessage: (ids, topic) => messages.push({ ids, topic }),
      onDiscover: () => {},
    });
    const dev = makeDevice({ topic: "test/red" });
    m.syncDevices([dev]);
    m.configure({ url: "mqtt://x", clientId: "c" });
    const client = flushClient();
    client.connected = true;
    client.emit("connect");
    client.emit("message", "test/red", Buffer.from("single"));
    expect(messages).toEqual([{ ids: [dev.id], topic: "test/red" }]);

    // Remove device → subscription removed.
    m.syncDevices([]);
    expect(client.subscriptions).not.toContain("test/red");
  });

  it("starts and stops discovery; emits onDiscover for unique topics only", () => {
    vi.useFakeTimers();
    const m = new MqttManager();
    const discovered: { topic: string; count: number }[] = [];
    m.setHandlers({
      onStatus: () => {},
      onMessage: () => {},
      onDiscover: (d) => discovered.push({ topic: d.topic, count: d.count }),
    });
    m.configure({ url: "mqtt://x", clientId: "c" });
    const client = flushClient();
    client.connected = true;
    client.emit("connect");

    const handle = m.startDiscovery(15_000);
    expect(handle.windowMs).toBe(15_000);
    expect(client.subscriptions).toContain("#");

    client.emit("message", "found/topic", Buffer.from("hello"));
    client.emit("message", "found/topic", Buffer.from("world"));
    client.emit("message", "another/topic", Buffer.from("hi"));
    expect(discovered.map((d) => d.topic)).toEqual(["found/topic", "another/topic"]);

    const buf = m.getDiscoveryBuffer();
    expect(buf.find((d) => d.topic === "found/topic")?.count).toBe(2);

    m.stopDiscovery();
    expect(client.subscriptions).not.toContain("#");
  });

  it("schedules reconnect after unintended close", () => {
    vi.useFakeTimers();
    const m = new MqttManager();
    const statuses: Array<{ connected: boolean }> = [];
    m.setHandlers({
      onStatus: (s) => statuses.push(s),
      onMessage: () => {},
      onDiscover: () => {},
    });
    m.configure({ url: "mqtt://x", clientId: "c" });
    const client = flushClient();
    client.connected = true;
    client.emit("connect");
    client.connected = false;
    client.emit("close");
    expect(statuses[statuses.length - 1]?.connected).toBe(false);

    vi.advanceTimersByTime(1_500);
    expect(created.length).toBeGreaterThan(1);
  });

  it("syncDevices replaces topics and tracks deviceIds", () => {
    const m = new MqttManager();
    const messages: Array<{ ids: string[]; topic: string }> = [];
    m.setHandlers({
      onStatus: () => {},
      onMessage: (ids, topic) => messages.push({ ids, topic }),
      onDiscover: () => {},
    });
    const a = makeDevice({ topic: "shared" });
    const b = makeDevice({ topic: "shared" });
    m.syncDevices([a, b]);
    m.configure({ url: "mqtt://x", clientId: "c" });
    const client = flushClient();
    client.connected = true;
    client.emit("connect");
    client.emit("message", "shared", Buffer.from("single"));
    expect(messages[0]?.ids.sort()).toEqual([a.id, b.id].sort());
  });
});
