# 11 — Testing & Local Development

This document specifies how to develop the app locally and how to test it. Stack decisions here are normative for v1.

## Stack

| Concern | Choice |
| --- | --- |
| Package manager | **pnpm** (recommended). `npm` works with no changes — substitute `npm run X` for `pnpm X`. |
| Node version | **20.x LTS** (pinned in `.nvmrc` and `package.json` `engines`). |
| Unit + integration tests | **Vitest** (Vite-native, fast HMR-style test runs, first-class fake-timer support). |
| End-to-end tests | **Playwright** (Chromium only for v1; multi-browser is out of scope). |
| Local + test MQTT broker | **Eclipse Mosquitto** via `docker-compose` (single container, no auth, port 1883). |
| Linter | **ESLint** with `eslint-config-next` + `@typescript-eslint`. |
| Formatter | **Prettier**, default settings, integrated into ESLint via `eslint-config-prettier`. |
| Type checker | `tsc --noEmit` with `strict: true`. |

## Environment variables

The full inventory. All are optional unless marked required.

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Next.js HTTP port. |
| `BGT_DB_PATH` | `./data/settings.db` | SQLite file location (see `09-persistence.md`). |
| `BGT_LOG_LEVEL` | `info` in dev, `warn` in prod (`NODE_ENV=production`) | One of `debug`, `info`, `warn`, `error`. |
| `BGT_MQTT_DEFAULT_URL` | `''` | Seed value written into `app_settings.broker_url` on first DB initialization only. Subsequent runs ignore this var — the SQLite value is authoritative. |
| `BGT_DISCOVERY_MAX_MS` | `60000` | Upper bound for `mqtt-discover` window (see `06-server-api.md`). |
| `NODE_ENV` | `development` | Standard Next.js semantics. |

Tests inject their own values via `vitest.config.ts` and `playwright.config.ts` — see "Test isolation" below.

## Repository layout (expected)

```
/
├── app/                   # Next.js App Router
│   ├── api/...            # route handlers (mirrors 06-server-api.md)
│   ├── (host)/            # host UI routes
│   └── settings/
├── server/                # server-only modules
│   ├── state/             # reducer (pure functions)
│   ├── timer/             # tick loop
│   ├── mqtt/              # mqtt.js wrapper
│   ├── settings/          # better-sqlite3 accessor
│   └── sse/               # SSE channel
├── client/                # browser-only modules (audio, interpolation)
├── shared/                # types from 05-data-model.md (imported by both)
├── tests/
│   ├── unit/              # vitest, no I/O
│   ├── integration/       # vitest, real SQLite + Mosquitto
│   └── e2e/               # playwright
├── scripts/
│   ├── fake-button.ts     # publish a press to whatever broker is configured
│   └── seed-devices.ts    # insert demo devices into SQLite
├── docker-compose.yml     # mosquitto service
├── .env.example
├── .nvmrc
├── vitest.config.ts
├── playwright.config.ts
└── package.json
```

## npm scripts

```jsonc
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "playwright test",
    "mqtt:up": "docker compose up -d mosquitto",
    "mqtt:down": "docker compose down",
    "mqtt:logs": "docker compose logs -f mosquitto",
    "fake-button": "tsx scripts/fake-button.ts",
    "seed:devices": "tsx scripts/seed-devices.ts"
  }
}
```

Implementers MAY add scripts; they MUST NOT rename or remove the above.

## Local development setup

1. **Clone and install**

   ```sh
   pnpm install
   cp .env.example .env.local
   ```

2. **Start Mosquitto** (in another terminal or detached):

   ```sh
   pnpm mqtt:up
   ```

3. **Run the app**:

   ```sh
   pnpm dev
   ```

4. Open `http://localhost:3000`. The Lobby shows "MQTT: not configured" because the SQLite default `broker_url` is empty (see `09-persistence.md`).

5. Navigate to Settings, set broker URL to `mqtt://localhost:1883`, save. Status flips to "connected".

6. To register a fake device for `physical-button` testing without owning real hardware:

   ```sh
   pnpm seed:devices
   ```

   This inserts two demo devices (`fake-red`, `fake-blue`) with topics `boardgame-timer/test/red` and `boardgame-timer/test/blue`.

7. To simulate a button press during a running game:

   ```sh
   pnpm fake-button --topic boardgame-timer/test/red --action single
   ```

### `docker-compose.yml` shape

The compose file MUST contain at minimum a `mosquitto` service. The recommended shape:

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"
    volumes:
      - ./docker/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
```

`docker/mosquitto.conf` enables anonymous access on `1883` (suitable for local dev only; production deployments are out of scope):

```
listener 1883
allow_anonymous true
```

### `.env.example`

```sh
PORT=3000
BGT_DB_PATH=./data/settings.db
BGT_LOG_LEVEL=debug
BGT_MQTT_DEFAULT_URL=
BGT_DISCOVERY_MAX_MS=60000
```

## Test strategy

Three layers, each with a clear ownership boundary.

### Unit tests — `tests/unit/`

- **Runner**: Vitest, no DOM, no I/O.
- **Scope**: pure functions only. The reducer in `server/state/`, time-formatting helpers in `client/`, MQTT payload qualification logic in `server/mqtt/`, validation logic in `server/state/validation.ts`.
- **Time control**: `vi.useFakeTimers()`. The tick loop is tested by constructing a state with `lastTickAt = T0`, advancing time with `vi.advanceTimersByTime(100)`, and asserting the next tick decrements by exactly 100 ms.
- **No SQLite, no MQTT, no Next.js runtime.**
- **Required coverage areas** (this is a contract — the test file MUST exist and cover each):
  - Every event in `02-session-lifecycle.md` transitions table: a test for each `(phase, event)` cell, asserting either the resulting phase + state, or the `invalid-phase` rejection.
  - `ConfirmConfig` validation: one test per rule in `03-timer-config.md` (positive case + negative case).
  - `EndTurn` resolution: round-completion paths in both `fixed` and `rotating` modes.
  - `Undo`: empty history → reject; restore from `EndTurn` snapshot; restore from `ConfirmNextRoundOrder` snapshot; phase-override when current phase is `Paused`.
  - `AdjustTime`: positive delta, negative delta, crossing zero to raise alert, crossing zero to clear alert.
  - Tick model: incremental decrement is stable when `AdjustTime` runs between ticks.
  - MQTT payload qualification: each row of the table in `07-mqtt-integration.md#payload-schema-and-qualification`.

### Integration tests — `tests/integration/`

- **Runner**: Vitest.
- **Scope**: route handlers + reducer + real SQLite + real MQTT broker. SSE channels exercised end-to-end against the route handler.
- **Setup**: `globalSetup` spawns Mosquitto via `docker compose up -d mosquitto`, waits for the broker to accept connections (with a 10-second timeout), and writes a sentinel file. `globalTeardown` runs `docker compose down`. Individual tests connect a second `mqtt.js` client to publish presses and observe reducer behavior.
- **SQLite isolation**: each test file uses a fresh temp DB (`BGT_DB_PATH=$(mktemp -d)/settings.db`). The DB is deleted in `afterAll`.
- **SSE testing**: connect with `fetch('/api/session/stream')` and read the body as a stream. A helper `readSSE(response, { events, timeoutMs })` collects named events into an array; tests assert sequences.
- **Required coverage**:
  - Full session walkthrough: lobby → configure → ready → start → 3× end-turn → pause → resume → end-turn → undo → restart → end-game.
  - MQTT physical-button: subscribe a device, publish to its topic, observe `EndTurn` → `turn-switched` SSE.
  - `press-ignored` cases: each `reason` value in `06-server-api.md`.
  - Mid-game broker disconnect: stop Mosquitto, observe `mqtt-status` SSE; restart, observe reconnect.
  - `device-in-use` rejection: start a game, then attempt to delete an assigned device.

### End-to-end tests — `tests/e2e/`

- **Runner**: Playwright (Chromium only).
- **Scope**: real browser, real Next.js server, real Mosquitto. Hit the UI exactly as a host would.
- **Setup**: Playwright's `webServer` config runs `pnpm dev` against a temp DB and the same Mosquitto container as integration tests.
- **Required coverage** (golden paths only — exhaustive logic is covered by unit/integration):
  - Lobby → configure (total-time / screen-tap / fixed, 3 players) → start → end-turn 3× → restart → end-game.
  - Lobby → configure (turn-by-turn / physical-button / rotating, 3 players, assigned devices) → start → simulate one round of MQTT presses → between-rounds reorder → confirm → end-game.
  - Audio priming: assert the audio-unavailable notice is gone after the first click.

### Coverage target

Aim for **≥ 80% line coverage** on `server/state/` and `server/mqtt/`. Other directories have softer targets (UI components are exercised by Playwright, not unit). Coverage is enforced in CI via `vitest --coverage` with a `coverage.thresholds` block in `vitest.config.ts`.

## Test data factories

`tests/factories.ts` exports the following. They MUST be the only place test data is built — ad-hoc literals in tests lead to drift when types change.

```ts
export function makeDevice(overrides?: Partial<Device>): Device;
export function makePlayerConfig(overrides?: Partial<PlayerConfig>): PlayerConfig;
export function makeGameConfig(overrides?: Partial<GameConfig>): GameConfig;
export function makeAppSettings(overrides?: Partial<AppSettings>): AppSettings;
export function makeGameState(overrides?: Partial<GameState>): GameState;
```

Each factory returns a valid object (passes the validation rules in `03-timer-config.md` and the invariants in `05-data-model.md`) with reasonable defaults. Overrides are shallow-merged.

## Time control in tests

The tick loop's only time source MUST be a single `Clock` interface so tests can substitute a fake.

```ts
// server/timer/clock.ts
export interface Clock {
  now(): number;          // epoch ms
  setInterval(fn: () => void, ms: number): { clear: () => void };
}
export const realClock: Clock = { /* uses Date.now and globalThis.setInterval */ };
```

Production code receives `realClock` from a module-level default; unit tests inject a fake clock. This is the only way to test the tick model without relying on `vi.useFakeTimers()` for SSE-timer interplay (which gets hairy).

## CI

GitHub Actions, single workflow `.github/workflows/ci.yml` triggered on push to any branch and on PR. Jobs:

1. `lint`: `pnpm lint`
2. `typecheck`: `pnpm typecheck`
3. `test-unit`: `pnpm test:unit --coverage`
4. `test-integration`: `pnpm test:integration` with Mosquitto as a service container (`services: mosquitto:` in the job spec)
5. `test-e2e`: `pnpm test:e2e` (Mosquitto service, Playwright browsers cached)

All five jobs MUST pass before merge to `main`. The branch protection rule MUST require them as status checks.

## Lint / format / typecheck rules

- `eslint-config-next` baseline.
- `@typescript-eslint/strict-type-checked` rule set.
- `import/order` enforced; absolute imports via `@/` alias.
- Prettier: default config, no project overrides.
- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

Formatting violations FAIL CI. Type errors FAIL CI. Lint warnings are surfaced but do not fail (lint errors do).

## Manual smoke checklist

Run before tagging a release. Each item MUST pass; failures block release.

1. Fresh boot with empty DB: Lobby shows "MQTT: not configured".
2. Configure broker → status flips to connected within 5 s.
3. Settings → "Listen for press" → publish to a topic from `mosquitto_pub` → topic appears in the buffer within 1 s.
4. Add a device → start a session → assign device to a player → start game → press the device → turn advances.
5. Press a non-current player's device → turn does NOT advance; toast shows "Press from … ignored".
6. Pause → 5 s → Resume: paused player's clock did not move.
7. Undo from `Running`: previous player becomes active, their `remainingMs` restored.
8. Undo from `BetweenRounds`: returns to `Running` with last player of previous round active.
9. Adjust Time: -30 s on a player; clock decreases by 30 s instantly; no error.
10. Total-time mode timeout: clock crosses zero → audio alert audible, banner visible, gameplay continues.
11. Turn-by-turn timeout: alert appears, host advances manually, alert clears.
12. Restart: all clocks back to budget; round 1; config preserved.
13. End Game: returns to Lobby; new session starts fresh.
14. Open two host tabs: action in one tab is visible in the other within 500 ms (SSE fan-out).
15. Stop Mosquitto mid-game: banner appears, on-screen End Turn still works; restart Mosquitto, banner clears.

## Definition of done

A change is "done" when:

- CI is green (all five jobs).
- Any new behavior added to a spec file has at least one test exercising it.
- The manual smoke list passes if the change touches end-to-end behavior.
- Coverage thresholds are met.
- `pnpm typecheck` and `pnpm lint` are clean locally.
