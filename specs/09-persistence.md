# 09 — Persistence

## Server (source of truth)

The server persists only **app-level settings** — broker config and the device registry. **No game state is persisted.** A server restart while a game is running loses the session; this is an accepted v1 limitation.

### Engine

`better-sqlite3` over a single file at `./data/settings.db` (configurable via env var `BGT_DB_PATH`). The directory is created at startup if absent.

`better-sqlite3` is chosen for:

- Synchronous API (simpler control flow in a singleton accessor).
- Atomic writes via implicit transactions.
- Zero external dependencies (no separate server process).

### Schema (DDL)

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  broker_url  TEXT    NOT NULL,
  broker_user TEXT,
  broker_pass TEXT,
  client_id   TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL                     -- epoch ms
);

CREATE TABLE IF NOT EXISTS devices (
  id                TEXT    PRIMARY KEY,            -- UUID v4
  name              TEXT    NOT NULL,
  topic             TEXT    NOT NULL,
  accepted_actions  TEXT,                           -- JSON array string, or NULL
  last_seen_at      INTEGER,                        -- epoch ms, nullable
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_topic ON devices(topic);
```

A migration helper at startup ensures the `app_settings` singleton row exists; if not, it is inserted with defaults:

```ts
{ id: 1, broker_url: '', broker_user: null, broker_pass: null,
  client_id: `boardgame-timer-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
  updated_at: Date.now() }
```

`broker_url` defaults to the empty string (not `mqtt://localhost:1883`) so the server does not blindly try to connect to a hypothetical local broker on first boot. The Lobby shows a "MQTT not configured" hint (see `08-ui-screens.md#8-1-lobby`) until the host enters a URL.

### Mapping to `AppSettings`

- `AppSettings.mqttBroker` ← row from `app_settings` (`broker_url`, `broker_user`, `broker_pass`, `client_id`).
- `AppSettings.devices` ← all rows from `devices`, with `accepted_actions` JSON-parsed into `string[] | undefined`.

`updated_at` and `created_at` are server-internal; they are NOT exposed in the API response.

### Write semantics

- `PUT /api/settings` runs in a single transaction:
  1. `UPDATE app_settings SET ... WHERE id = 1`.
  2. For the device list: any device id in the payload that doesn't exist → `INSERT`; existing ids → `UPDATE`; existing ids absent from the payload → `DELETE` (after the device-in-use check below).
- Before any `DELETE`, the server checks whether the running `GameState.devicesSnapshot` references the device id. If so, the entire `PUT` is rejected with `409 device-in-use`.
- Individual `POST/PATCH/DELETE /api/settings/devices/:id` operate on a single row in their own transaction.
- `last_seen_at` updates from MQTT message arrivals are written asynchronously with at-most-one-write-every-5-seconds-per-device throttling (to avoid hammering SQLite on chatty buttons).

### Concurrency

`better-sqlite3` serializes writes implicitly. The server runs single-process, so there is no cross-process locking concern.

## Browser cache

The browser caches `AppSettings` in `localStorage` for fast first paint of the Settings screen and so the device picker on the Configuration screen does not flash empty during initial load.

| Key | Value | Lifecycle |
| --- | --- | --- |
| `bgt.settings` | JSON object `{ schemaVersion: 1, data: <AppSettings> }` | Written by the client every time it receives an `AppSettings` payload (from `GET /api/settings`, `PUT /api/settings`, or SSE `settings-changed`). Read on app boot before the first network call to provide an initial UI. |

Rules:

- The **server is the source of truth**. On every page load, the client SHOULD issue `GET /api/settings` shortly after boot; the response overwrites the cache.
- The cached object embeds a `schemaVersion: 1` field. On read, the client compares it to the constant baked into the client build:
  - Match → use the cached `data`.
  - Mismatch (older or newer than expected) → delete the key and proceed with an empty initial state until `GET /api/settings` returns.
- If `localStorage` parsing fails (corrupt JSON, missing `schemaVersion`, etc.), the client deletes the key and proceeds with an empty initial state.
- Future breaking shape changes increment `schemaVersion`. The key name itself does not change.

The browser does NOT cache `GameState`; live state is always fetched fresh via SSE/REST.

## In-memory game state

`GameState` lives in a single Node.js module-level variable on the server (e.g. `globalThis.__BGT_STATE__` to survive Next.js dev-mode hot reload). It is:

- Initialized to `{ phase: 'Lobby', config: null, ... }` on server boot.
- Mutated only via the reducer.
- Never written to disk.

Implications:

- A server crash, restart, or redeploy mid-game **loses the game**. The next time a client connects, it sees `phase: 'Lobby'`.
- This is an explicit v1 limitation. A future spec revision MAY add a "resume in-progress session" feature; for v1, the UI MAY display a notice on first load if the previous session's last known phase was non-`Lobby` (implementation MAY persist a "last phase" hint to SQLite for this purpose, but the spec does not require it).
