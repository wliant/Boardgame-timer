# 08 — UI Screens

This document describes the host screens, their layouts, and their interactions. Phase names referenced here are defined in `02-session-lifecycle.md`; control buttons are defined in `04-in-game-behavior.md#control-button-inventory`; data shapes are defined in `05-data-model.md`.

Wireframes are ASCII sketches, not pixel-precise. The visual design is implementer's choice; the spec constrains structure and behavior, not styling.

## Route map

| Route | Screens by phase |
| --- | --- |
| `/` | Lobby (when phase is `Lobby`), Timer Configuration (when phase is `Configuring`), Ready (when phase is `Ready`), In-Game (when phase is `Running` or `Paused`), Between Rounds (when phase is `BetweenRounds`). The route renders the screen for the current phase; navigation is via state changes, not URL changes. |
| `/settings` | Settings (always available except mid-game; see Mid-game lock below). |

The host has exactly two URLs. The "current screen" within `/` is dictated by `GameState.phase`, so opening the URL in a new tab always picks up the live state.

## 8.1 Lobby

Phase: `Lobby`.

```
+----------------------------------------------------+
|  Boardgame Timer                          [Settings]|
+----------------------------------------------------+
|                                                    |
|                                                    |
|             [ Start new session ]                  |
|                                                    |
|         MQTT: connected (mqtt://10.0.0.5)          |
|                                                    |
+----------------------------------------------------+
```

Components:

- **Start new session** button — fires `StartNewSession`. On success the phase becomes `Configuring` and the page swaps to the Timer Configuration screen.
- **Settings** link in the header — navigates to `/settings`.
- **MQTT status line** — shows `connected` (green) or `disconnected: <error>` (red) from `state.mqtt`.

## 8.2 Settings

Route: `/settings`. Reachable from any phase, BUT see Mid-game lock.

```
+----------------------------------------------------+
|  Settings                                    [Back] |
+----------------------------------------------------+
|                                                    |
|  MQTT Broker                                       |
|  +----------------------------------------------+  |
|  | URL:        [mqtt://10.0.0.5:1883        ]   |  |
|  | Username:   [                            ]   |  |
|  | Password:   [                            ]   |  |
|  | Client ID:  [boardgame-timer-7Q3F        ]   |  |
|  |                              [ Save ]        |  |
|  | Status: connected (since 14:23:00)           |  |
|  +----------------------------------------------+  |
|                                                    |
|  Physical Devices                                  |
|  +----------------------------------------------+  |
|  | Red button (kitchen)                          |  |
|  |   topic: zigbee2mqtt/0x...01                  |  |
|  |   actions: single             [Edit] [Delete] |  |
|  |                                                |  |
|  | Blue button                                   |  |
|  |   topic: zigbee2mqtt/0x...02                  |  |
|  |   actions: single, double     [Edit] [Delete] |  |
|  |                                                |  |
|  | [ + Add device ]    [ Listen for press... ]   |  |
|  +----------------------------------------------+  |
+----------------------------------------------------+
```

Components:

- **MQTT broker form** — `PUT /api/settings` on Save. Status pulled from SSE `mqtt-status` event.
- **Device list** — each entry shows `name`, `topic`, `acceptedActions` (or "any" if undefined), `lastSeenAt` if recent (e.g. "seen 12 s ago").
- **Add device** opens a modal with `name`, `topic`, `acceptedActions` (optional, comma-separated). `POST /api/settings/devices`.
- **Edit device** opens the same modal pre-filled. `PATCH /api/settings/devices/:id`.
- **Delete device** confirms first. `DELETE /api/settings/devices/:id`. If the device is in a running game's snapshot, the server returns `409 device-in-use` and the UI surfaces the error.
- **Listen for press** starts the discovery flow (see `07-mqtt-integration.md`):
  - Renders a panel listing each `(topic, samplePayload)` pair seen, with a "Use this topic" button that pre-fills the Add device modal.
  - Has a "Stop listening" button and an automatic 15-second countdown.

### Mid-game lock

While phase is `Running`, `Paused`, or `BetweenRounds`:

- The Settings page IS reachable but ALL form fields are disabled and a banner reads "Game in progress — settings are read-only. End the game to make changes."
- The "Back" link returns to `/`, which shows the in-game screen.

## 8.3 Timer Configuration

Phase: `Configuring`.

```
+------------------------------------------------------------+
|  Configure Timer                                [End Game] |
+------------------------------------------------------------+
|                                                            |
|  Mode:        (•) Total time   ( ) Turn by turn            |
|  Order:       (•) Fixed        ( ) Rotating                |
|  End of turn: (•) Tap screen   ( ) Physical button         |
|                                                            |
|  Players (2/8):                                            |
|  +------------------------------------------------------+  |
|  | 1. Name [Alice         ] Budget [10:00 m:ss] Device  |  |
|  |    [Red button (kitchen) ▾] [ - Remove ]             |  |
|  | 2. Name [Bob           ] Budget [10:00 m:ss] Device  |  |
|  |    [Blue button ▾]            [ - Remove ]           |  |
|  | [ + Add Player ]                                     |  |
|  +------------------------------------------------------+  |
|                                                            |
|  Validation: ✓ all good   /   ✗ device "Blue" used twice   |
|                                                            |
|                                  [ Confirm Configuration ] |
+------------------------------------------------------------+
```

Components:

- **Mode radio** — `total-time` / `turn-by-turn`.
- **Order radio** — `fixed` / `rotating`.
- **End-of-turn radio** — `screen-tap` / `physical-button`. Switching from `physical-button` to `screen-tap` clears all `assignedDeviceId` values to `null`.
- **Players list** — each row has Name (text), Budget (input in `m:ss`, converted to ms on save), Device dropdown (only visible when `endOfTurnTrigger === 'physical-button'`), Remove button. **Add Player** appends a new player with default name `Player N`, default budget 10:00, `assignedDeviceId = null`.
- **Validation summary** — lists which validation rules from `03-timer-config.md` currently fail; updates live as the host types.
- **Confirm Configuration** button — fires `ConfirmConfig`. Disabled while validation fails. On success, transitions to `Ready`.
- **End Game** in header — fires `EndGame`; confirmation modal: "Discard this configuration and return to lobby?"

Each on-screen edit is debounced (200 ms) and persisted via `PUT /api/session/config`. SSE `state-replaced` events update other tabs.

## 8.4 Ready (post-config, pre-start)

Phase: `Ready`.

```
+-----------------------------------------------------------------+
|  Game Ready                            [Edit Config] [End Game] |
+-----------------------------------------------------------------+
|                                                                 |
|     +---------+   +---------+   +---------+                     |
|     | Alice   |   | Bob     |   | Carol   |                     |
|     | 10:00   |   | 10:00   |   | 10:00   |                     |
|     | 🔴 Red  |   | 🔵 Blue |   | ⚪ White|                     |
|     +---------+   +---------+   +---------+                     |
|                                                                 |
|  Mode: Total time   Order: Rotating   Trigger: Physical button  |
|                                                                 |
|                            [ Start ]                            |
+-----------------------------------------------------------------+
```

Components:

- **Player cards** — show name, budget (formatted `M:SS`), assigned device (with a colored swatch matching the device name; if `endOfTurnTrigger === 'screen-tap'`, no device row).
- **Config summary line** — read-only echo of the three top-level config knobs.
- **Edit Config** — fires `EditConfig` with the current draft (no changes); transitions back to `Configuring`.
- **Start** — fires `StartGame`. Page swaps to the In-Game screen.
- **End Game** — same confirm-and-discard flow as in Configuring.
- **Adjust Time** is also available per card on this screen (see control inventory, `04-in-game-behavior.md`). It surfaces as a small `±` button on each card opening a numeric input.

## 8.5 In-Game

Phases: `Running`, `Paused`.

```
+-----------------------------------------------------------------+
|  Round 2   [⏸ Pause]   [End Turn]   [↶ Undo]  [↻ Restart]      |
|                                                  [⏹ End Game]  |
+-----------------------------------------------------------------+
|                                                                 |
|   +-------------------------------------------------+           |
|   |   ▶ ALICE                                       |           |
|   |        09:12  (active)                          |           |
|   +-------------------------------------------------+           |
|                                                                 |
|   +-----------------+   +-----------------+   +---------------+ |
|   | Bob             |   | Carol           |   | Dan           | |
|   |   07:43         |   |  -0:12 🔔       |   |   10:00       | |
|   |                 |   | [Dismiss]       |   |               | |
|   +-----------------+   +-----------------+   +---------------+ |
|                                                                 |
|  MQTT: connected   |   Press from Blue ignored — not Bob's turn |
+-----------------------------------------------------------------+
```

Layout:

- **Top bar** — round number, then the control buttons in this order: `Pause`/`Resume`, `End Turn`, `Undo`, `Restart`, `End Game`. `End Turn` is also rendered as a large central button on touch devices (see "Large End Turn target" below).
- **Active player card** — visually distinct (taller, bordered, prominent timer font). Shows name, current `remainingMs` (interpolated, see `04-in-game-behavior.md#timer-tick-model`), and the active indicator `▶`.
- **Other player cards** — laid out below in a grid. Each shows name and current `remainingMs` (static — non-active players' values don't change unless `AdjustTime` is used).
- **Alert badge** — a small bell icon next to a player whose `remainingMs <= 0` and has an active `Alert`. A `Dismiss` button under the badge fires `DismissAlert { playerId }` (total-time mode primarily; in turn-by-turn mode the badge appears on the active player and clears on `EndTurn`).
- **Footer line** — MQTT connection status; transient toasts (e.g. "Press from Blue ignored — not Bob's turn") appear here for ~3 seconds.

Time formatting:

- Non-negative: `M:SS` for `< 60:00`, `H:MM:SS` for `>= 60:00`.
- Negative: prefix `-`. E.g. `-0:12`, `-1:03`, `-1:00:05`. The negative display is rendered in red.

Per-card actions:

- Each card has a `±` button opening a numeric input ("Adjust time by ± seconds"). Fires `AdjustTime`.

Large End Turn target (touch-friendly):

- Below the active player card, render a full-width "End Turn" button (visible only when `endOfTurnTrigger === 'screen-tap'` OR as an explicit fallback toggle when `physical-button`). This is the primary way to end a turn on a tablet/phone host screen.

`Pause`/`Resume`:

- The button label toggles between `⏸ Pause` (visible in `Running`) and `▶ Resume` (visible in `Paused`).
- While paused, the active player's timer freezes and is rendered with a dimmer color + the badge text `(paused)`.

Confirmation modals:

- `Restart` opens "Restart the game? All current timers will reset to their starting values. The config stays the same." with `[Cancel] [Restart]`.
- `End Game` opens "End the game and return to the lobby? All timers and history will be discarded." with `[Cancel] [End Game]`.

## 8.6 Between Rounds (rotating mode only)

Phase: `BetweenRounds`.

```
+-----------------------------------------------------------------+
|  Round 2 complete — set order for Round 3       [End Game]      |
|                                                  [↻ Restart]    |
|                                                  [↶ Undo]       |
+-----------------------------------------------------------------+
|                                                                 |
|  Drag to reorder:                                               |
|                                                                 |
|   1. ☰ Carol     09:30                                          |
|   2. ☰ Bob       07:43                                          |
|   3. ☰ Dan       10:00                                          |
|   4. ☰ Alice     09:12                                          |
|                                                                 |
|  Adjust time per player (optional):                             |
|   [Carol ±]  [Bob ±]  [Dan ±]  [Alice ±]                        |
|                                                                 |
|                                  [ Confirm Next Round Order ]   |
+-----------------------------------------------------------------+
```

Components:

- **Reorder list** — drag-and-drop ordered list of all configured players. The current default ordering is "same as previous round" but the host can rearrange.
- **Per-player Adjust Time** — same `±` button as in-game (fires `AdjustTime`).
- **Confirm Next Round Order** — calls `POST /api/session/confirm-next-round` with the current `playerIds` order. On success, transitions back to `Running` with `currentPlayerIdx = 0` and the new order.
- **Undo** — pops the snapshot taken at `EndTurn` (the round-completion moment); see `04-in-game-behavior.md#undo-last-turn-switch`. Effectively this returns to `Running` with the last player of the previous round active again.
- **Restart** and **End Game** behave the same as on the In-Game screen.

This screen is only reachable when `config.turnOrderMode === 'rotating'`. In `fixed` mode the reducer skips `BetweenRounds` and goes straight from `Running` → `Running` with `roundNumber++` and `currentPlayerIdx = 0`.

## Cross-cutting UI rules

- All screens display the MQTT connection status in some persistent way (header, footer, or banner).
- All screens display a "stale" indicator if the SSE stream has been disconnected for > 1 second and the client has not yet reconnected.
- Buttons disabled by phase MUST still be visible (greyed out) when they are part of the current screen's chrome — the user should learn what's available. Buttons not relevant to the current screen are simply not rendered.
- Confirmation modals MUST be dismissible by pressing the keyboard `Escape` key (treats it as Cancel).
- The host screen is expected to run at 1024×768 minimum. The layouts above assume a landscape tablet/desktop; mobile portrait is not in scope for v1 (per non-goals in `01-overview.md`).
