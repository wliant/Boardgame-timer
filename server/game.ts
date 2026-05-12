// Module-level game singleton. Holds in-memory GameState, wires the reducer,
// timer tick loop, SQLite settings, MQTT integration, and SSE fan-out.
// Persisted across Next.js dev-mode hot reloads via globalThis.

import type { Database as Db } from "better-sqlite3";

import type { SseEvent } from "@/shared/events";
import type {
  AppSettings,
  Device,
  EpochMs,
  GameState,
  Id,
} from "@/shared/types";

import { log } from "./log";
import { MqttManager, PressDebouncer } from "./mqtt";
import { qualifies } from "./mqtt/qualification";
import { resolvePress } from "./mqtt/press";
import { LastSeenThrottle, openDb, SettingsRepo } from "./settings";
import { SseChannel } from "./sse";
import { reduce } from "./state";
import { checkInvariantsInDev } from "./state/invariants";
import { initialState } from "./state/initial";
import { DomainError } from "./state/errors";
import type { DomainEvent } from "./state/events";
import { realClock, startTickLoop, type TickLoop } from "./timer";
import { commitElapsed } from "./state/tickCore";

type GameSingleton = {
  state: GameState;
  lastTickAt: EpochMs | null;
  db: Db;
  repo: SettingsRepo;
  lastSeen: LastSeenThrottle;
  mqtt: MqttManager;
  debouncer: PressDebouncer;
  sse: SseChannel;
  tickLoop: TickLoop;
};

type Globals = typeof globalThis & { __BGT_GAME__?: GameSingleton };

function asGlobals(): Globals {
  return globalThis as Globals;
}

function init(): GameSingleton {
  const db = openDb();
  const repo = new SettingsRepo(db);
  const lastSeen = new LastSeenThrottle(repo);
  const mqtt = new MqttManager();
  const debouncer = new PressDebouncer();
  const sse = new SseChannel();

  const singleton: GameSingleton = {
    state: initialState(),
    lastTickAt: null,
    db,
    repo,
    lastSeen,
    mqtt,
    debouncer,
    sse,
    // tickLoop installed below after handlers wire up
    tickLoop: { stop: () => {} },
  };

  sse.setStateProvider(() => singleton.state);

  mqtt.setHandlers({
    onStatus: (status) => {
      singleton.state = {
        ...singleton.state,
        mqtt: { ...status },
      };
      sse.emit({
        event: "mqtt-status",
        data: { connected: status.connected, lastError: status.lastError },
      });
    },
    onMessage: (deviceIds, topic, payload) => {
      handleMqttMessage(singleton, deviceIds, topic, payload);
    },
    onDiscover: (msg) => {
      sse.emit({ event: "mqtt-discover-message", data: msg });
    },
  });

  // Wire MQTT to current settings + devices.
  const settings = repo.getAppSettings();
  mqtt.syncDevices(settings.devices);
  mqtt.configure(settings.mqttBroker);

  singleton.tickLoop = startTickLoop(
    {
      getState: () => singleton.state,
      getLastTickAt: () => singleton.lastTickAt,
      setLastTickAt: (t) => {
        singleton.lastTickAt = t;
      },
      setState: (s) => {
        singleton.state = s;
      },
      emit: (ev) => sse.emit(ev),
    },
    realClock,
    commitElapsed,
  );

  log.info("game singleton booted");
  return singleton;
}

export function getGame(): GameSingleton {
  const g = asGlobals();
  if (!g.__BGT_GAME__) {
    g.__BGT_GAME__ = init();
  }
  return g.__BGT_GAME__;
}

/**
 * Test-only: tear down the current singleton and create a fresh one. The
 * caller is expected to set `BGT_DB_PATH` and other env vars first.
 */
export function resetGameForTests(): GameSingleton {
  const g = asGlobals();
  const prev = g.__BGT_GAME__;
  if (prev) {
    prev.tickLoop.stop();
    prev.mqtt.shutdown();
    try {
      prev.db.close();
    } catch {
      /* ignore */
    }
  }
  g.__BGT_GAME__ = init();
  return g.__BGT_GAME__;
}

export function getState(): GameState {
  return getGame().state;
}

export function getAppSettings(): AppSettings {
  return getGame().repo.getAppSettings();
}

export function getSseChannel(): SseChannel {
  return getGame().sse;
}

export function getMqtt(): MqttManager {
  return getGame().mqtt;
}

/** Events that mutate fields the SSE delta catalog can't fully describe.
 *  After these the server pushes a fresh `state` snapshot per spec 06. */
const STATE_RESYNC_EVENTS = new Set<DomainEvent["type"]>([
  "StartNewSession",
  "EditConfig",
  "ConfirmConfig",
  "Restart",
  "EndGame",
  "Undo",
]);

export function dispatch(event: DomainEvent, now: EpochMs = Date.now()): GameState {
  const game = getGame();
  const settings = game.repo.getAppSettings();
  const result = reduce(game.state, event, now, game.lastTickAt, settings);
  game.state = result.state;
  game.lastTickAt = result.lastTickAt;
  for (const ev of result.events) game.sse.emit(ev);
  if (STATE_RESYNC_EVENTS.has(event.type)) {
    game.sse.emit({ event: "state", data: game.state });
  }
  checkInvariantsInDev(game.state);
  return game.state;
}

// ----- settings mutations -----

export function lockedDeviceIds(): Set<Id> {
  return new Set(getGame().state.devicesSnapshot.map((d) => d.id));
}

export function applySettingsChange(updated: AppSettings, prev: AppSettings): void {
  const game = getGame();
  // Update MQTT broker if changed.
  const brokerChanged =
    prev.mqttBroker.url !== updated.mqttBroker.url ||
    prev.mqttBroker.username !== updated.mqttBroker.username ||
    prev.mqttBroker.password !== updated.mqttBroker.password ||
    prev.mqttBroker.clientId !== updated.mqttBroker.clientId;
  if (brokerChanged) {
    game.mqtt.configure(updated.mqttBroker);
  }
  game.mqtt.syncDevices(updated.devices);
  // Drop stale debounce state for removed devices.
  const updatedIds = new Set(updated.devices.map((d) => d.id));
  for (const id of prev.devices.map((d) => d.id)) {
    if (!updatedIds.has(id)) game.debouncer.forget(id);
  }
  game.sse.emit({ event: "settings-changed", data: updated });
}

// ----- MQTT incoming -----

function handleMqttMessage(
  game: GameSingleton,
  deviceIds: Id[],
  topic: string,
  payload: Buffer,
): void {
  const settings = game.repo.getAppSettings();
  const devices: Device[] = settings.devices.filter((d) =>
    deviceIds.includes(d.id),
  );
  if (devices.length === 0) return;

  for (const device of devices) {
    if (!qualifies(payload, device.acceptedActions)) {
      log.debug("mqtt non-qualifying message", {
        deviceId: device.id,
        topic,
      });
      continue;
    }
    const now = Date.now();
    if (!game.debouncer.accept(device.id, now)) {
      log.debug("mqtt debounced", { deviceId: device.id, topic });
      continue;
    }
    game.lastSeen.touch(device.id, now);

    const resolution = resolvePress(game.state, device.id);
    if (resolution.type === "ignored") {
      log.info("mqtt press ignored", {
        deviceId: device.id,
        topic,
        reason: resolution.reason,
      });
      game.sse.emit({
        event: "press-ignored",
        data: {
          deviceId: device.id,
          deviceName: device.name,
          reason: resolution.reason,
        },
      });
      continue;
    }
    log.info("mqtt press dispatched", {
      deviceId: device.id,
      playerId: resolution.playerId,
      topic,
    });
    try {
      dispatch({
        type: "EndTurn",
        source: "physical-button",
        expectedPlayerId: resolution.playerId,
      });
    } catch (err) {
      if (err instanceof DomainError) {
        log.warn("mqtt EndTurn rejected", {
          deviceId: device.id,
          code: err.code,
        });
      } else {
        throw err;
      }
    }
  }
}
