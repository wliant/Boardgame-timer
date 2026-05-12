# 06 — Server API

Routes are Next.js App Router route handlers under `app/api/...`. All requests and responses are JSON unless stated otherwise.

## Error envelope

All non-2xx responses use this envelope:

```ts
type ApiError = {
  error: {
    code: string;     // machine-readable; see catalog below
    message: string;  // human-readable, intended for host UI
    details?: unknown;
  };
};
```

### Error code catalog

| Code | HTTP | Meaning |
| --- | --- | --- |
| `invalid-phase` | 409 | The action is not legal in the current phase (see `02-session-lifecycle.md` transition table). |
| `invalid-config` | 400 | Config validation failed; `details` is an array of failed-rule codes from `03-timer-config.md`. |
| `mqtt-not-connected` | 409 | Action requires MQTT but the broker is not connected. |
| `nothing-to-undo` | 409 | `Undo` was issued with an empty `history`. |
| `unknown-player` | 404 | A `playerId` does not match any player in the current config. |
| `unknown-device` | 404 | A `deviceId` does not match any device in `AppSettings`. |
| `device-in-use` | 409 | Attempt to delete a device that is referenced by a running game's `devicesSnapshot`. |
| `bad-request` | 400 | Malformed payload. `details` is a Zod-style issue list. |
| `internal-error` | 500 | Unexpected server failure. |

## Settings

All settings endpoints persist to SQLite (see `09-persistence.md`).

### `GET /api/settings`

Response `200`:

```json
{ "data": <AppSettings> }
```

### `PUT /api/settings`

Replace the entire `AppSettings`.

Request:

```json
{ "data": <AppSettings> }
```

Response `200` echoes the saved `AppSettings`. The `devices` array MUST be a permutation/extension of what existed before; deleting a device that is currently in `state.devicesSnapshot` (i.e. referenced by a running game) returns `409 device-in-use`. To enable broker reconnection with new credentials, the server tears down and re-establishes the MQTT connection (see `07-mqtt-integration.md`).

### `GET /api/settings/devices`

Response `200`:

```json
{ "data": <Device[]> }
```

### `POST /api/settings/devices`

Add a new device. Request:

```json
{ "name": "Red button", "topic": "zigbee2mqtt/0x...", "acceptedActions": ["single"] }
```

Response `201`:

```json
{ "data": <Device> }
```

### `PATCH /api/settings/devices/:id`

Partial update of a device. Same fields as `POST`, all optional. `id` is path-only and cannot be changed.

Response `200`: `{ "data": <Device> }`.

### `DELETE /api/settings/devices/:id`

Response `204` on success, `409 device-in-use` if the device is in a running game's `devicesSnapshot`.

### `POST /api/settings/mqtt-discover`

Start a temporary subscription on `#` (or the most permissive wildcard the broker allows) for a short window (15 seconds, configurable). Each unique `(topic, payload-shape)` pair seen during the window is appended to a discovery buffer. The buffer is exposed via SSE events (`mqtt-discover-message`) and via a follow-up read:

`GET /api/settings/mqtt-discover` → `{ "data": Array<{ topic: string, samplePayload: string, count: number, firstSeenAt: EpochMs }> }`

`DELETE /api/settings/mqtt-discover` ends the window early and clears the buffer.

This endpoint is purely a Settings-screen helper and does NOT affect game state. See `07-mqtt-integration.md` for the listen-for-press flow.

## Session

All session endpoints operate on the singleton in-memory `GameState`. Every mutating endpoint returns the new state in its response and ALSO emits SSE events to all connected clients (see SSE section).

### `GET /api/session/state`

Returns the current `GameState` snapshot. Used by a freshly opened host tab to bootstrap before subscribing to SSE.

Response `200`: `{ "data": <GameState> }`.

### `POST /api/session/start-config`

Issues `StartNewSession`. Creates a fresh draft `GameConfig` (see `03-timer-config.md#defaults-for-new-configs`) and transitions `Lobby → Configuring`.

Response `200`: `{ "data": <GameState> }`. Errors: `invalid-phase`.

### `PUT /api/session/config`

Replace the draft `GameConfig` (issues `EditConfig`). Allowed in `Configuring` and `Ready` (in `Ready` it reverts the phase to `Configuring`).

Request: `{ "data": <GameConfig> }`. Response: `{ "data": <GameState> }`. Errors: `invalid-phase`, `bad-request`.

### `POST /api/session/confirm-config`

Issues `ConfirmConfig`. Validates against `03-timer-config.md`; on success, captures `devicesSnapshot` and transitions `Configuring → Ready`.

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`, `invalid-config`, `mqtt-not-connected`.

### `POST /api/session/start-game`

Issues `StartGame`. Transitions `Ready → Running`. Sets `roundNumber=1`, `currentPlayerIdx=0`, `currentOrder = config.players.map(p => p.id)`, `remainingMs[p.id] = p.timeBudgetMs` for all players (and in turn-by-turn mode, this is also the per-turn allowance for player 0), `turnStartedAt = Date.now()`.

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`.

### `POST /api/session/end-turn`

Issues `EndTurn { source: 'screen-tap' }`. See `02-session-lifecycle.md#endturn-resolution`.

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`.

> MQTT-sourced `EndTurn` events are emitted internally by the server (see `07-mqtt-integration.md`); there is no public REST endpoint for them.

### `POST /api/session/confirm-next-round`

Issues `ConfirmNextRoundOrder`. Allowed only in `BetweenRounds`.

Request: `{ "data": { "playerIds": string[] } }`. The provided array MUST be a permutation of `config.players.map(p => p.id)`.

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`, `bad-request`.

### `POST /api/session/pause`

Issues `Pause`. Response/errors as for previous endpoints.

### `POST /api/session/resume`

Issues `Resume`.

### `POST /api/session/undo`

Issues `Undo`. Errors include `nothing-to-undo`.

### `POST /api/session/adjust-time`

Request: `{ "data": { "playerId": string, "deltaMs": number } }`.

Allowed in `Ready`, `Running`, `Paused`, `BetweenRounds`. Errors: `invalid-phase`, `unknown-player`, `bad-request`.

### `POST /api/session/dismiss-alert`

Request: `{ "data": { "playerId": string } }`.

Allowed in `Running`, `Paused`. Errors: `invalid-phase`, `unknown-player`.

### `POST /api/session/restart`

Issues `Restart`. Allowed in `Running`, `Paused`, `BetweenRounds` (per `02-session-lifecycle.md`).

### `POST /api/session/end-game`

Issues `EndGame`. Allowed in `Configuring`, `Ready`, `Running`, `Paused`, `BetweenRounds`.

## SSE channel

### `GET /api/session/stream`

A single Server-Sent Events stream per connection. Authentication: none (per non-goals in `01-overview.md`).

The server sends events as `event: <name>\ndata: <json>\n\n`. The first event after connection is always `state` with the full current `GameState`, so a late-joining tab can render immediately without a separate REST call (though `GET /api/session/state` is still provided for clients that prefer to bootstrap synchronously).

### Event catalog (authoritative)

| `event` name | `data` shape | When emitted |
| --- | --- | --- |
| `state` | `<GameState>` | Once, immediately after the client connects. Also re-sent if the server detects significant divergence (e.g. after a major reducer event for which delta encoding would be lossy). |
| `tick` | `{ remainingMs: Record<Id, DurationMs>, turnStartedAt: EpochMs \| null }` | Every 250 ms while phase is `Running`. Only the active player's `remainingMs` value typically changes; the map MAY be sparse (active player only). |
| `phase-changed` | `{ phase: Phase, previous: Phase }` | Any time the reducer changes phase. |
| `turn-switched` | `{ currentPlayerIdx: number, currentOrder: Id[], roundNumber: number, turnStartedAt: EpochMs, remainingMs: Record<Id, DurationMs> }` | After `EndTurn` (when phase stays `Running`) and after `ConfirmNextRoundOrder`. |
| `round-complete` | `{ roundNumber: number, nextPhase: 'Running' \| 'BetweenRounds' }` | When `EndTurn` triggers the end of a round. Fires *before* `phase-changed`. |
| `alert-raised` | `<Alert>` | When the reducer adds a new `Alert`. |
| `alert-cleared` | `{ playerId: Id, kind: AlertKind }` | When an `Alert` is removed (DismissAlert, EndTurn for turn-out, AdjustTime above zero, Undo, Restart, EndGame). |
| `state-replaced` | `<GameState>` | When `EditConfig`, `Restart`, `EndGame`, or any other event causes a state replacement that is simpler to send wholesale than as a delta. |
| `settings-changed` | `<AppSettings>` | When `AppSettings` is updated via the Settings endpoints (so all tabs refresh). |
| `mqtt-status` | `{ connected: boolean, lastError: string \| null }` | On MQTT connect, disconnect, or error. |
| `mqtt-discover-message` | `{ topic: string, samplePayload: string, count: number, firstSeenAt: EpochMs }` | While an `mqtt-discover` window is active (see Settings section). |

### Concurrency

The server keeps a single `GameState`. Multiple host tabs MAY connect to `/api/session/stream`. All actions go through the same reducer; **last writer wins**. Every SSE client receives every event. A tab that issued an action does NOT receive a special acknowledgement event — it observes the resulting `phase-changed`/`turn-switched`/etc. like any other tab. The REST response also returns the new state for immediate use.

### Reconnection

If the SSE stream drops, the client SHOULD reconnect with exponential backoff (max 5 s) and the server SHOULD send a fresh `state` event on every new connection. Clients MUST treat the `state` event as authoritative and overwrite any local cached state.
