// Singleton MQTT manager. Wraps mqtt.js, owns connection lifecycle,
// per-topic subscriptions, exponential-backoff reconnect, and the
// discovery-window subscription. See specs/07-mqtt-integration.md.

import { connect, type MqttClient } from "mqtt";

import type { DiscoveryMessage } from "@/shared/events";
import type { Device, EpochMs, Id, MqttBrokerConfig } from "@/shared/types";

import { log } from "../log";

const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const DEFAULT_DISCOVERY_MS = 15_000;
const DISCOVERY_WILDCARD = "#";

export type MqttStatus = {
  connected: boolean;
  lastError: string | null;
  lastConnectedAt: EpochMs | null;
};

export type MqttHandlers = {
  onStatus: (status: MqttStatus) => void;
  onMessage: (deviceIds: Id[], topic: string, payload: Buffer) => void;
  onDiscover: (message: DiscoveryMessage) => void;
};

const noopHandlers: MqttHandlers = {
  onStatus: () => {},
  onMessage: () => {},
  onDiscover: () => {},
};

export class MqttManager {
  private client: MqttClient | null = null;
  private broker: MqttBrokerConfig | null = null;
  private failures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: MqttStatus = {
    connected: false,
    lastError: null,
    lastConnectedAt: null,
  };
  private intentionallyClosed = false;
  private handlers: MqttHandlers = noopHandlers;

  private readonly topicToDeviceIds = new Map<string, Set<Id>>();
  private readonly deviceIdToTopic = new Map<Id, string>();

  private discoveryEndsAt: EpochMs | null = null;
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly discoveryBuffer = new Map<string, DiscoveryMessage>();

  setHandlers(handlers: MqttHandlers): void {
    this.handlers = handlers;
  }

  getStatus(): MqttStatus {
    return { ...this.status };
  }

  configure(broker: MqttBrokerConfig): void {
    this.broker = broker;
    this.shutdown();
    this.intentionallyClosed = false;
    if (!broker.url) {
      this.updateStatus({
        connected: false,
        lastError: "no-broker-configured",
        lastConnectedAt: null,
      });
      return;
    }
    this.openConnection();
  }

  shutdown(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this.stopDiscovery();
  }

  /** Reconcile per-device topic subscriptions against the supplied device list. */
  syncDevices(devices: Device[]): void {
    const desiredTopics = new Map<string, Set<Id>>();
    for (const d of devices) {
      const set = desiredTopics.get(d.topic) ?? new Set<Id>();
      set.add(d.id);
      desiredTopics.set(d.topic, set);
    }

    // Unsubscribe topics no longer needed.
    for (const topic of this.topicToDeviceIds.keys()) {
      if (!desiredTopics.has(topic)) {
        this.unsubscribeTopic(topic);
      }
    }
    // Subscribe to new topics; update device→topic maps.
    for (const [topic, ids] of desiredTopics) {
      const existing = this.topicToDeviceIds.get(topic);
      if (!existing) {
        this.topicToDeviceIds.set(topic, ids);
        this.subscribeTopic(topic);
      } else {
        this.topicToDeviceIds.set(topic, ids);
      }
    }
    // Update reverse map.
    this.deviceIdToTopic.clear();
    for (const d of devices) {
      this.deviceIdToTopic.set(d.id, d.topic);
    }
  }

  startDiscovery(windowMs: number): { endsAt: EpochMs; windowMs: number } {
    const max = Number(process.env["BGT_DISCOVERY_MAX_MS"] ?? 60_000);
    const effective = Math.min(Math.max(windowMs, 1_000), max);
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryBuffer.clear();
    this.discoveryEndsAt = Date.now() + effective;
    if (this.client?.connected) {
      this.client.subscribe(DISCOVERY_WILDCARD, (err) => {
        if (err) log.warn("mqtt discovery subscribe failed", { error: err.message });
      });
    }
    this.discoveryTimer = setTimeout(() => {
      this.stopDiscovery();
    }, effective);
    return { endsAt: this.discoveryEndsAt, windowMs: effective };
  }

  stopDiscovery(): void {
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    this.discoveryEndsAt = null;
    if (this.client?.connected) {
      this.client.unsubscribe(DISCOVERY_WILDCARD, () => {});
    }
  }

  isDiscoveryActive(): boolean {
    return this.discoveryEndsAt != null;
  }

  getDiscoveryBuffer(): DiscoveryMessage[] {
    return [...this.discoveryBuffer.values()];
  }

  // ------ private ------

  private openConnection(): void {
    if (!this.broker || !this.broker.url) return;
    try {
      const opts: Record<string, unknown> = {
        clientId: this.broker.clientId,
        reconnectPeriod: 0,
        connectTimeout: 10_000,
      };
      if (this.broker.username !== undefined) opts["username"] = this.broker.username;
      if (this.broker.password !== undefined) opts["password"] = this.broker.password;
      const client = connect(this.broker.url, opts);
      this.client = client;

      client.on("connect", () => {
        this.failures = 0;
        this.updateStatus({
          connected: true,
          lastError: null,
          lastConnectedAt: Date.now(),
        });
        // Re-subscribe everything we know about.
        for (const topic of this.topicToDeviceIds.keys()) {
          client.subscribe(topic, (err) => {
            if (err) log.warn("mqtt subscribe failed", { topic, error: err.message });
          });
        }
        if (this.discoveryEndsAt != null) {
          client.subscribe(DISCOVERY_WILDCARD, () => {});
        }
        log.info("mqtt connected", { url: this.broker?.url });
      });

      client.on("error", (err) => {
        this.updateStatus({
          ...this.status,
          lastError: err.message,
        });
        log.warn("mqtt error", { error: err.message });
      });

      client.on("close", () => {
        if (this.intentionallyClosed) return;
        this.updateStatus({
          connected: false,
          lastError: this.status.lastError,
          lastConnectedAt: this.status.lastConnectedAt,
        });
        this.scheduleReconnect();
      });

      client.on("message", (topic, payload) => {
        this.handleMessage(topic, payload);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateStatus({ ...this.status, lastError: msg });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay =
      BACKOFF_SCHEDULE_MS[Math.min(this.failures, BACKOFF_SCHEDULE_MS.length - 1)] ??
      30_000;
    this.failures += 1;
    log.info("mqtt scheduling reconnect", { failures: this.failures, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionallyClosed && this.broker?.url) {
        this.openConnection();
      }
    }, delay);
  }

  private subscribeTopic(topic: string): void {
    if (this.client?.connected) {
      this.client.subscribe(topic, (err) => {
        if (err) log.warn("mqtt subscribe failed", { topic, error: err.message });
      });
    }
  }

  private unsubscribeTopic(topic: string): void {
    this.topicToDeviceIds.delete(topic);
    if (this.client?.connected) {
      this.client.unsubscribe(topic, () => {});
    }
  }

  private updateStatus(next: MqttStatus): void {
    const changed =
      next.connected !== this.status.connected ||
      next.lastError !== this.status.lastError ||
      next.lastConnectedAt !== this.status.lastConnectedAt;
    this.status = next;
    if (changed) this.handlers.onStatus({ ...next });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    // Discovery window: record first-sighting of each topic.
    if (this.discoveryEndsAt != null) {
      const sample = payload.toString("utf8").slice(0, 256);
      const existing = this.discoveryBuffer.get(topic);
      if (!existing) {
        const msg: DiscoveryMessage = {
          topic,
          samplePayload: sample,
          count: 1,
          firstSeenAt: Date.now(),
        };
        this.discoveryBuffer.set(topic, msg);
        this.handlers.onDiscover(msg);
      } else {
        existing.count += 1;
      }
    }
    // Match the topic to device ids.
    const ids = this.topicToDeviceIds.get(topic);
    if (!ids || ids.size === 0) return;
    this.handlers.onMessage([...ids], topic, payload);
  }
}
