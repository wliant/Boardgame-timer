# CLAUDE.md

Navigation aid for Claude (and humans) working in this repository. Detailed
behavior is **always** sourced from [`./specs/`](./specs/), not this file.

## What this is

A single-host web app that runs a board-game session: each player gets a
clock, the host advances turns from one screen, and physical Aqara-style
buttons can trigger turn changes over MQTT. Single Node.js process,
in-memory game state, SQLite only for app settings + device registry.
See [`specs/01-overview.md`](./specs/01-overview.md).

## Stack pin

- Next.js 15 (App Router) + React 19 + TypeScript 5.6 strict
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Node 20.18 LTS, pnpm 9
- `better-sqlite3` (settings), `mqtt.js` v5 (broker)
- Vitest, Playwright (Chromium), Eclipse Mosquitto 2 via docker compose
- ESLint (`eslint-config-next` + `@typescript-eslint/strict-type-checked`) + Prettier

## Dev commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Next.js dev server on :3000 |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (`next lint`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` | Prettier write |
| `pnpm test` / `test:watch` | Run all Vitest tests |
| `pnpm test:unit` | Unit tests (pure functions only) |
| `pnpm test:integration` | Integration tests (real SQLite + Mosquitto) |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm mqtt:up` / `mqtt:down` / `mqtt:logs` | Mosquitto via docker compose |
| `pnpm fake-button` | Publish a synthetic MQTT press |
| `pnpm seed:devices` | Insert demo devices into SQLite |

`pnpm mqtt:up` is required before running `test:integration` or `test:e2e`
locally.

## Repository map

```
app/        Next.js App Router (UI routes + REST route handlers under api/)
server/     Server-only modules
  state/    Reducer (pure) — specs/02, 04
  timer/    Tick loop + Clock interface — specs/04, 11
  mqtt/     Singleton mqtt.js wrapper — specs/07
  settings/ better-sqlite3 accessor — specs/09
  sse/      SSE fan-out — specs/06
client/     Browser-only modules (audio, interpolation)
shared/     Types from specs/05 (imported by both server and client)
tests/      unit/ + integration/ + e2e/ + factories.ts + setup/
scripts/    fake-button.ts, seed-devices.ts
docker/     mosquitto.conf
specs/      Authoritative specification (read these first)
```

## Spec map (reading order)

1. [`specs/01-overview.md`](./specs/01-overview.md) — product goals, architecture, stack
2. [`specs/02-session-lifecycle.md`](./specs/02-session-lifecycle.md) — phase state machine
3. [`specs/03-timer-config.md`](./specs/03-timer-config.md) — config validation rules
4. [`specs/04-in-game-behavior.md`](./specs/04-in-game-behavior.md) — tick model, controls, runtime rules
5. [`specs/05-data-model.md`](./specs/05-data-model.md) — entity shapes (lives in `shared/types.ts`)
6. [`specs/06-server-api.md`](./specs/06-server-api.md) — REST + SSE catalog
7. [`specs/07-mqtt-integration.md`](./specs/07-mqtt-integration.md) — topic schema + payload qualification
8. [`specs/08-ui-screens.md`](./specs/08-ui-screens.md) — host screen layouts
9. [`specs/09-persistence.md`](./specs/09-persistence.md) — SQLite schema, browser cache
10. [`specs/10-glossary.md`](./specs/10-glossary.md)
11. [`specs/11-testing-and-dev.md`](./specs/11-testing-and-dev.md) — testing + dev contract

## Key invariants (from specs/05)

1. `remainingMs` keys equal the players' ids whenever a config exists and phase is not `Lobby`/`Configuring`.
2. `currentOrder` is always a permutation of the players' ids while phase is `Running`/`Paused`/`BetweenRounds`.
3. `currentPlayerIdx` ∈ `[0, currentOrder.length - 1]` while phase is `Running`/`Paused`.
4. `turnStartedAt` is non-null **iff** `phase === 'Running'`.
5. At most one alert per `(playerId, kind)`.
6. Non-empty `history` ⇒ at least one `EndTurn`/`ConfirmNextRoundOrder` since the last `Restart`/`StartGame`.
7. In `physical-button` mode, every `assignedDeviceId` references a device in `devicesSnapshot`.
8. Every history snapshot has `phase ∈ { 'Running', 'BetweenRounds' }`.
9. `turnStartedAt` reset on `StartGame`, `EndTurn` (staying `Running`), `ConfirmNextRoundOrder`, `Undo` landing in `Running`; null on any other phase.

## Conventions

- **Imports**: use the `@/` alias for project-internal paths.
- **Types**: import from `shared/`; never re-declare a type defined in `specs/05`.
- **Reducer purity**: `server/state/` is pure. The only wall-clock reader is `server/timer/clock.ts`.
- **Test data**: every test object goes through `tests/factories.ts`. No ad-hoc literals.
- **Time units**: durations in integer ms; user-facing seconds converted at the boundary.
- **Identifiers**: opaque UUID v4 strings unless a spec says otherwise.

## CI

Five jobs in `.github/workflows/ci.yml`: `lint`, `typecheck`, `test-unit`,
`test-integration`, `test-e2e`. All must pass before merging to `main`.
Coverage thresholds (≥80% lines) enforced on `server/state/**` and
`server/mqtt/**` via `vitest --coverage`.

## Out of scope for v1

Auth / accounts, multi-device or remote-viewer UI, persistent game history,
internationalization, offline MQTT buffering, automatic turn advancement on
timeout, "skip player" control. See [`specs/01-overview.md`](./specs/01-overview.md)
§Non-goals.

## Where to put new code

| Concern | Path |
| --- | --- |
| New REST or SSE endpoint | `app/api/...` (mirror `specs/06-server-api.md`) |
| Reducer / phase logic | `server/state/` |
| Tick loop logic | `server/timer/` |
| MQTT subscription / payload qualification | `server/mqtt/` |
| SQLite read/write | `server/settings/` |
| SSE channel internals | `server/sse/` |
| Browser-only utilities | `client/` |
| New entity / shared type | `shared/types.ts` (and trace back to `specs/05`) |
| New SSE event payload | `shared/events.ts` (and `specs/06-server-api.md`) |
| Test data | `tests/factories.ts` |
