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
| `invalid-order` | 400 | `ConfirmNextRoundOrder` received `playerIds` that is not a permutation of `config.players.map(p => p.id)`. |
| `mqtt-not-connected` | 409 | Action requires MQTT but the broker is not connected. |
| `nothing-to-undo` | 409 | `Undo` was issued with an empty `history`. |
| `unknown-player` | 404 | A `playerId` does not match any player in the current config. |
| `unknown-device` | 404 | A `deviceId` does not match any device in `AppSettings`. |
| `device-in-use` | 409 | Attempt to delete or rename-topic-on a device referenced by a running game's `devicesSnapshot`. |
| `bad-request` | 400 | Malformed payload (wrong types, missing required fields). `details` is a Zod-style issue list. |
| `internal-error` | 500 | Unexpected server failure. |

## Settings

All settings endpoints persist to SQLite (see `09-persistence.md`).

### `GET /api/settings`

Response `200`:

```json
{ "data": <AppSettings> }
```

### `PUT /api/settings`

Replace the entire `AppSettings`. The request body's `data` is treated as the full new state: any optional field absent from the request is treated as **cleared** (e.g. omitting `mqttBroker.username` clears the stored username). To make a partial update, callers MUST round-trip via `GET /api/settings` first and resubmit the merged object.

Request:

```json
{ "data": <AppSettings> }
```

Response `200` echoes the saved `AppSettings`. Deleting a device that is currently in `state.devicesSnapshot` (i.e. referenced by a running game) returns `409 device-in-use`. Changing the `topic` of a device that is in `state.devicesSnapshot` also returns `409 device-in-use` — the running game's frozen snapshot would silently desynchronize. To rename the topic of an in-use device, the host must first end the game.

When `mqttBroker` changes, the server tears down and re-establishes the MQTT connection (see `07-mqtt-integration.md`). When `mqttBroker.url` is empty, the server does NOT attempt to connect.

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

Partial update of a device. Same fields as `POST`, all optional. `id` is path-only and cannot be changed. An empty `acceptedActions: []` is rejected with `bad-request` (use `null`/omitted to mean "any non-empty payload qualifies"; see `07-mqtt-integration.md`).

If the device is currently in `state.devicesSnapshot` and the PATCH changes `topic`, the call is rejected with `409 device-in-use`. PATCH that changes only `name` or `acceptedActions` of an in-use device is allowed (the running game's snapshot continues to use the snapshot's values; the live `AppSettings` reflects the new values for future games).

Response `200`: `{ "data": <Device> }`.

### `DELETE /api/settings/devices/:id`

Response `204` on success, `409 device-in-use` if the device is in a running game's `devicesSnapshot`.

### `POST /api/settings/mqtt-discover`

Start a temporary subscription on `#` (or the most permissive wildcard the broker allows) for a bounded window. Each unique `topic` seen during the window appears once in the discovery buffer; subsequent messages on the same topic update its `samplePayload` (most-recent value) and increment its `count`.

Request body (optional): `{ "windowMs": number }`. Default is `15000`. Maximum is `60000`; values above the maximum are clamped. Missing/empty body uses the default.

Response `200`: `{ "data": { "windowMs": number, "endsAt": EpochMs } }`.

`GET /api/settings/mqtt-discover` → `{ "data": Array<{ topic: string, samplePayload: string, count: number, firstSeenAt: EpochMs }> }`

`DELETE /api/settings/mqtt-discover` ends the window early and clears the buffer. Response `204`.

This endpoint is purely a Settings-screen helper and does NOT affect game state. While a discovery window is active, normal game-time subscriptions remain in effect (a player's press is still resolved correctly). See `07-mqtt-integration.md` for the listen-for-press flow.

Errors: `mqtt-not-connected` (no broker configured or not connected).

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

Issues `ConfirmConfig`. Validates against `03-timer-config.md`; on success, performs the full state rebuild described in `02-session-lifecycle.md#confirmconfig-resolution` (captures `devicesSnapshot`, initializes `remainingMs`, resets `history`, `alerts`, `roundNumber`, `currentOrder`, `turnStartedAt`) and transitions `Configuring → Ready`.

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`, `invalid-config`, `mqtt-not-connected`.

### `POST /api/session/start-game`

Issues `StartGame`. Transitions `Ready → Running`. Sets `roundNumber=1`, `currentPlayerIdx=0`, `turnStartedAt = Date.now()`. `currentOrder` and `remainingMs` were already initialized by `ConfirmConfig`; `StartGame` does NOT re-initialize them. (Any `AdjustTime` deltas applied while in `Ready` are therefore preserved into the started game.)

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`.

### `POST /api/session/end-turn`

Issues `EndTurn { source: 'screen-tap' }`. See `02-session-lifecycle.md#endturn-resolution`.

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`.

> MQTT-sourced `EndTurn` events are emitted internally by the server (see `07-mqtt-integration.md`); there is no public REST endpoint for them.

### `POST /api/session/confirm-next-round`

Issues `ConfirmNextRoundOrder`. Allowed only in `BetweenRounds`.

Request: `{ "data": { "playerIds": string[] } }`. The provided array MUST be a permutation of `config.players.map(p => p.id)` (same length, same set of ids, no duplicates).

On success, sets `state.currentOrder = playerIds`, `state.currentPlayerIdx = 0`, increments `state.roundNumber`, sets `state.turnStartedAt = Date.now()`, and in `turn-by-turn` mode resets `state.remainingMs[playerIds[0]] = config.players.find(p => p.id === playerIds[0]).timeBudgetMs`.

Response: `{ "data": <GameState> }`. Errors: `invalid-phase`, `invalid-order`, `bad-request`.

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
| `state` | `<GameState>` | Once, immediately after the client connects, and again any time the server decides to push a full state (after `EditConfig`, `Restart`, `EndGame`, `ConfirmConfig`, or any structural change for which sending deltas would be ambiguous). Clients MUST treat `state` as a full replacement of their local model. |
| `tick` | `{ playerId: Id, remainingMs: DurationMs, turnStartedAt: EpochMs }` | Every 250 ms while `state.phase === 'Running'`. Only carries the active player's id and value — other players' clocks do not change during a tick. **Stops being emitted as soon as phase leaves `Running`;** the immediately preceding `phase-changed` is the client's cue to halt interpolation. |
| `phase-changed` | `{ phase: Phase, previous: Phase }` | Any time the reducer changes phase. |
| `turn-switched` | `{ currentPlayerIdx: number, currentOrder: Id[], roundNumber: number, turnStartedAt: EpochMs, remainingMs: Record<Id, DurationMs> }` | After `EndTurn` (when phase stays `Running`) and after `ConfirmNextRoundOrder`. The `remainingMs` map is **dense** (every player id, every value) so the client can fully reconcile. |
| `round-complete` | `{ roundNumber: number, nextPhase: 'Running' \| 'BetweenRounds' }` | When `EndTurn` triggers the end of a round. Fires *before* `phase-changed`. |
| `alert-raised` | `<Alert>` | When the reducer adds a new `Alert`. |
| `alert-cleared` | `{ playerId: Id, kind: AlertKind }` | When an `Alert` is removed (DismissAlert, EndTurn clearing a turn-out, AdjustTime crossing back above zero, Undo dropping post-snapshot alerts, Restart, EndGame). |
| `press-ignored` | `{ deviceId: Id, deviceName: string, reason: 'not-current-player' \| 'not-physical-button-mode' \| 'unknown-device' \| 'no-config' }` | When an MQTT message qualifies as a button press but does not match the active player. Surfaced as a transient toast in the UI; see `07-mqtt-integration.md#press-resolution`. |
| `settings-changed` | `<AppSettings>` | When `AppSettings` is updated via the Settings endpoints (so all tabs refresh). |
| `mqtt-status` | `{ connected: boolean, lastError: string \| null }` | On MQTT connect, disconnect, error, or "no broker configured" state change. |
| `mqtt-discover-message` | `{ topic: string, samplePayload: string, count: number, firstSeenAt: EpochMs }` | While an `mqtt-discover` window is active. Fires once per **unique topic** at first sighting; subsequent messages on the same topic do NOT re-fire this event — clients poll `GET /api/settings/mqtt-discover` (or display the latest accumulated counts already provided in the first event) if they want to show updated counts. |

### Concurrency

The server keeps a single `GameState`. Multiple host tabs MAY connect to `/api/session/stream`. All actions go through the same reducer; **last writer wins**. Every SSE client receives every event. A tab that issued an action does NOT receive a special acknowledgement event — it observes the resulting `phase-changed`/`turn-switched`/etc. like any other tab. The REST response also returns the new state for immediate use.

### Reconnection

If the SSE stream drops, the client SHOULD reconnect with exponential backoff (1 s, 2 s, 4 s, cap 5 s) and the server SHOULD send a fresh `state` event on every new connection. Clients MUST treat the `state` event as authoritative and overwrite any local cached state.

**Actions during stale SSE.** REST mutating endpoints remain available even when SSE is disconnected. The client MAY issue actions (the response includes the new state so the UI can update). If the action is rejected with `invalid-phase` because local state was stale, the client SHOULD surface the rejection as a toast and proactively reconnect SSE (or call `GET /api/session/state`) to refresh. The UI SHOULD also display a "🔴 disconnected — reconnecting…" indicator after 1 second of SSE downtime (see `08-ui-screens.md`).
