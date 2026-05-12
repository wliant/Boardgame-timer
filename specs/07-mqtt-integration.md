# 07 — MQTT Integration

This document is the **authoritative** source for the MQTT topic/payload contract and the rules that translate broker messages into reducer events.

## Broker assumptions

- The broker is **external** to the app (Mosquitto, EMQX, Aqara HomeAssistant gateway, etc.). The app does not embed a broker.
- Protocol: MQTT v3.1.1 or v5. The `mqtt.js` client supports both; v5 is preferred when the broker advertises it.
- TLS is OPTIONAL; the `mqtt://` and `mqtts://` schemes in `AppSettings.mqttBroker.url` select it.
- Authentication: optional username/password from `AppSettings.mqttBroker`.

## Connection lifecycle

The server maintains a single `mqtt.js` client.

| Trigger | Action |
| --- | --- |
| Server starts and `AppSettings.mqttBroker.url` is **non-empty** | Connect on boot. |
| Server starts and `AppSettings.mqttBroker.url` is **empty** (first-run default) | Do NOT connect. `state.mqtt = { connected: false, lastError: 'no-broker-configured', lastConnectedAt: null }`. The UI displays "MQTT: not configured" on the Lobby and prompts the host to visit Settings. |
| `PUT /api/settings` changes broker URL/credentials | Disconnect existing client; if new URL is non-empty, connect new one; if empty, stay disconnected. |
| `DELETE /api/settings/devices/:id` | Unsubscribe the topic (after the `device-in-use` check passes). |
| `POST /api/settings/devices` or `PATCH` that changes a topic | Subscribe to the new topic. |

### Reconnect strategy

If the underlying socket closes unexpectedly, the client reconnects with **exponential backoff: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s** (cap). Each retry that fails increments the backoff to the next bucket; a successful reconnect resets it. Connection status is mirrored to `GameState.mqtt` and surfaced via SSE `mqtt-status` events (see `06-server-api.md`).

## Subscription model

For each `Device` in `AppSettings.devices`, the server subscribes to `device.topic`. Wildcards (`+`, `#`) MAY appear in user-entered topics but the spec RECOMMENDS exact topics for game-time devices (so press-resolution is unambiguous).

The same topic MAY appear in multiple devices, but **only one of those devices MAY be assigned to a player in a single `GameConfig`**; the server uses the device id (not the topic) to determine which player to attribute a press to (see "Press resolution" below). This rule is enforced at `ConfirmConfig`.

## Topic schema

There is no spec-mandated topic prefix. Topics are user-entered when adding a device. Typical Aqara-via-zigbee2mqtt topics look like `zigbee2mqtt/0x00158d0001abcdef`; the spec does not constrain the format.

## Payload schema and qualification

When a message arrives on a subscribed topic, the server evaluates whether it qualifies as a **button press** using the following rules:

1. **Empty payload** (zero bytes) → does NOT qualify.
2. **Non-JSON payload** → qualifies iff `device.acceptedActions` is `undefined`. (Some buttons publish plain strings like `"single"`.) If `acceptedActions` is set, the payload string MUST be exactly equal to one of those strings.
3. **JSON payload**:
   - If the JSON is an object with an `action` field of type string:
     - If `device.acceptedActions` is `undefined`, the message qualifies (any non-empty action).
     - If `device.acceptedActions` is set, the message qualifies iff `acceptedActions.includes(payload.action)`.
   - If the JSON is anything else (number, array, object without `action`, ...) → does NOT qualify, unless `device.acceptedActions` is `undefined` in which case it qualifies.

Examples:

| Payload | `acceptedActions` | Qualifies? |
| --- | --- | --- |
| `single` (plain text) | `undefined` | ✓ |
| `single` (plain text) | `["single","double"]` | ✓ |
| `single` (plain text) | `["double"]` | ✗ |
| `{"action":"single","battery":78}` | `undefined` | ✓ |
| `{"action":"single","battery":78}` | `["single"]` | ✓ |
| `{"action":"long","battery":78}` | `["single"]` | ✗ |
| `{"battery":78}` | `undefined` | ✓ (any non-empty) |
| `{"battery":78}` | `["single"]` | ✗ (no action field) |
| `` (empty) | any | ✗ |

A qualifying message updates `device.lastSeenAt = Date.now()` (persisted to SQLite asynchronously) and emits a `settings-changed` SSE event no more often than every 5 seconds per device.

## Debounce

After a qualifying message for a given **device**, further messages on the same device are ignored for **500 ms**. The window is per-device (not per-topic, not global), keyed by `device.id`. The debounce is implemented as a simple "last accepted at" timestamp per device id, cleared whenever the device is deleted or its topic changes.

## Press resolution

When a qualifying, non-debounced message arrives:

1. Look up the device by id (the subscription handler MUST track which device id each subscription belongs to).
2. If the current `GameState.config` is null → emit `press-ignored { deviceId, deviceName, reason: 'no-config' }` SSE event and stop.
3. If `state.config.endOfTurnTrigger !== 'physical-button'` → emit `press-ignored { reason: 'not-physical-button-mode' }` and stop.
4. Find the player in `state.config.players` whose `assignedDeviceId === device.id`. If no such player, emit `press-ignored { reason: 'unknown-device' }` and stop.
5. If `state.phase !== 'Running'` OR that player's id is not `state.currentOrder[state.currentPlayerIdx]` (i.e. it is not their turn) → emit `press-ignored { reason: 'not-current-player' }` and stop. This guards against the "wrong button pressed" case — only the active player's button advances the turn.
6. Otherwise, dispatch `EndTurn { source: 'physical-button', expectedPlayerId: player.id }` to the reducer.

`press-ignored` events MUST be visible in the UI as a brief toast (e.g. "Press from Blue ignored — not Bob's turn"); see `06-server-api.md` for the SSE event shape and `08-ui-screens.md` for the toast presentation.

## Broker loss during play

When the broker disconnects after `ConfirmConfig` and `state.config.endOfTurnTrigger === 'physical-button'`, see `04-in-game-behavior.md#mqtt-broker-loss-during-play`. Summary:

- `state.mqtt.connected` flips to `false`; `mqtt-status` SSE event fires.
- The In-Game screen surfaces a "physical buttons unavailable — use on-screen End Turn" banner.
- The reducer does NOT auto-pause; gameplay continues with the screen-tap fallback.
- Presses received while disconnected are silently lost (no offline buffering — see non-goals in `01-overview.md`).
- When the broker reconnects, the banner clears; presses resume working immediately.

## "Listen for press" discovery flow (Settings)

Used in the Settings screen to help the host register a new physical device without having to know the topic.

1. Host clicks "Listen for press" on the Settings screen.
2. UI calls `POST /api/settings/mqtt-discover` (see `06-server-api.md`). Optional `windowMs` overrides the default 15 s.
3. Server subscribes to the broker's most permissive wildcard (`#`; if the broker rejects `#`, the spec leaves the fallback wildcard to the implementer — common alternatives are `+/+/+/#` or per-broker ACL-friendly paths) for the discovery window.
4. Each newly seen `topic` is streamed once as a `mqtt-discover-message` SSE event at first sighting; the server keeps a running buffer accessible via `GET /api/settings/mqtt-discover` for accumulated counts.
5. Host presses the physical button; its topic appears in the UI within ≤1 second.
6. Host clicks the topic in the UI to pre-fill the "Add device" form.
7. Host clicks "Stop listening" → UI calls `DELETE /api/settings/mqtt-discover`, server unsubscribes from the wildcard, retains its game-time subscriptions.

The discovery window also auto-closes after `windowMs` if not stopped earlier, to avoid leaking permissive subscriptions. While discovery is active, normal game-time subscriptions and press-resolution continue to work (the discovery wildcard is additive).

## Logging

Every dropped press (steps 2–4 above) MUST be logged at `info` level with `{ deviceId, topic, reason }`. Qualifying presses MUST be logged at `info` level with `{ deviceId, playerId, topic }`. Debounce-suppressed presses MAY be logged at `debug`.

The log is server-side only; the spec does not require exposing it to the UI beyond the brief "press ignored" toast described in Press resolution.
