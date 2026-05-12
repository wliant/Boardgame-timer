# 03 — Timer Configuration

This document defines the `GameConfig` model — every field, its values, and the validation rules that gate the `ConfirmConfig` transition (see `02-session-lifecycle.md`). The canonical TypeScript type lives in `05-data-model.md`.

## Mode

`config.mode` is one of:

- `total-time` — Each player has a single time budget spent across the entire game. The active player's `remainingMs` decreases continuously while phase is `Running`. When it crosses zero, the clock continues to decrease into negative values and a persistent `Alert` of kind `total-out` is raised. The host MAY use `AdjustTime` to grant more time; if the player's `remainingMs` rises above zero the alert is cleared automatically (see `04-in-game-behavior.md`).
- `turn-by-turn` — Each player has a fixed time budget *per turn*. At the moment a player becomes active (via `StartGame`, `EndTurn`, `ConfirmNextRoundOrder`, or `Undo` that lands on them), their `remainingMs` is reset to `player.timeBudgetMs`. When `remainingMs` crosses zero, a persistent `Alert` of kind `turn-out` is raised. The host MUST still advance the turn manually; no automatic advance occurs.

The mode is fixed for the duration of a session. Changing it while in `Configuring` is allowed; changing it after `ConfirmConfig` requires `EditConfig` (which reverts to `Configuring`).

## End-of-turn trigger

`config.endOfTurnTrigger` is one of:

- `screen-tap` — The host taps the End Turn button on the host screen. No physical-device assignments are required.
- `physical-button` — Each player MUST be assigned exactly one configured device. Pressing that device publishes to MQTT, the server resolves the press to a player, and emits an `EndTurn` only if it is currently that player's turn. The screen-tap End Turn button remains available as a fallback (see `04-in-game-behavior.md`).

### Device assignment rules (when `physical-button`)

- Every `PlayerConfig.assignedDeviceId` MUST be set.
- No two players in the same `GameConfig` MAY be assigned the same device.
- The referenced device MUST exist in `AppSettings.devices` at confirmation time. (If a device is later deleted while a game is in progress, the running game MUST continue with the in-memory snapshot it captured at `ConfirmConfig`; the device deletion only affects future games.)

## Turn order

`config.turnOrderMode` is one of:

- `fixed` — The seating order from `config.players` is used for every round.
- `rotating` — The first round uses the order from `config.players`. After each round completes, the phase transitions to `BetweenRounds` and the host MUST issue `ConfirmNextRoundOrder` with a permutation of the same player ids to define the next round's order. There is no automatic rotation algorithm — the host chooses.

A **round** is one cycle through `currentOrder`. When the player at `currentOrder[currentOrder.length - 1]` ends their turn, the round is complete. The reducer handles the transition; see `02-session-lifecycle.md#endturn-resolution`.

## Players

`config.players` is an ordered list. Each entry is a `PlayerConfig` (canonical type in `05-data-model.md`) with:

| Field | Type | Constraint |
| --- | --- | --- |
| `id` | string (UUID v4) | Server-generated when the player row is created. Stable across `EditConfig`. |
| `name` | string | 1–24 characters after trim. MUST be non-empty. Names need not be unique but the UI SHOULD warn on duplicates. |
| `timeBudgetMs` | integer ms > 0 | Entered by host in seconds, converted on save. In `total-time` mode this is the per-game budget; in `turn-by-turn` mode this is the per-turn limit. |
| `assignedDeviceId` | string or `null` | MUST be a valid `Device.id` from `AppSettings.devices` iff `config.endOfTurnTrigger === 'physical-button'`. MUST be `null` otherwise. |

### Player count bounds

- Minimum: **2** players.
- Maximum: **8** players. (Implementer MAY raise this; the spec uses 8 as a soft cap and the UI in `08-ui-screens.md` is designed around it.)

The host may add and remove players freely while phase is `Configuring`. Removing a player removes their `PlayerConfig`; their `id` is not reused.

## Validation

`ConfirmConfig` is rejected unless **all** of the following are true:

1. `config.mode` is one of `total-time`, `turn-by-turn`.
2. `config.endOfTurnTrigger` is one of `screen-tap`, `physical-button`.
3. `config.turnOrderMode` is one of `fixed`, `rotating`.
4. `config.players.length >= 2` and `<= 8`.
5. Every `players[i].name` is a non-empty string of length ≤ 24 after trim.
6. Every `players[i].timeBudgetMs` is a positive integer (>= 1).
7. If `config.endOfTurnTrigger === 'physical-button'`:
   - Every `players[i].assignedDeviceId` references a device in `AppSettings.devices` at confirmation time.
   - The set `{ players[i].assignedDeviceId }` has no duplicates.
   - The MQTT broker connection is in the `connected` state at confirmation time. If not, `ConfirmConfig` MAY be permitted with a warning (implementer choice), but the spec RECOMMENDS rejecting with error code `mqtt-not-connected` to surface the problem early.
8. If `config.endOfTurnTrigger === 'screen-tap'`:
   - Every `players[i].assignedDeviceId` MUST be `null` (the UI MUST clear stale assignments when the trigger is switched away from `physical-button`).

A failed validation returns `400 invalid-config` with a `details` array listing the failing constraint codes (see `06-server-api.md` for the error envelope).

## Editing rules

- `EditConfig` is allowed only while phase is `Configuring` or `Ready` (see `02-session-lifecycle.md`). Editing in `Ready` reverts the phase to `Configuring` and the host MUST re-confirm.
- `EditConfig` is REJECTED while phase is `Running`, `Paused`, or `BetweenRounds`. The host MUST `EndGame` first (which discards the config) or `Restart` (which preserves it but returns to `Ready`).
- `AppSettings.devices` MAY be edited in any phase, but if the running game references a device that gets deleted, the in-memory snapshot taken at `ConfirmConfig` is what the running game uses (see device-assignment rules above).

## Defaults for new configs

When `StartNewSession` is fired, the server creates a draft config with the following defaults:

```json
{
  "mode": "total-time",
  "endOfTurnTrigger": "screen-tap",
  "turnOrderMode": "fixed",
  "players": [
    { "id": "<uuid>", "name": "Player 1", "timeBudgetMs": 600000, "assignedDeviceId": null },
    { "id": "<uuid>", "name": "Player 2", "timeBudgetMs": 600000, "assignedDeviceId": null }
  ]
}
```

The host may modify any field before confirming.
