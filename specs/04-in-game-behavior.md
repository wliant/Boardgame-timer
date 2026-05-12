# 04 — In-Game Behavior

This document defines the runtime semantics that apply once the phase is `Running`, `Paused`, or `BetweenRounds`. It owns the **authoritative control-button inventory**.

## Timer tick model

The server runs a single tick loop while phase is `Running`.

| Concern | Value | Notes |
| --- | --- | --- |
| Server tick interval | **100 ms** | The reducer decrements the active player's `remainingMs` by the elapsed wall-clock time since the previous tick, computed from `Date.now()`. |
| SSE push interval | **250 ms** | The server fans out a `tick` SSE event containing the active player's `remainingMs` (and only changed fields). Pushing every server tick would be wasteful. |
| Client render interval | **animation frame** | The client interpolates between SSE pushes using its own `performance.now()` clock, anchored to the most recent server-pushed value, so the displayed time stays smooth. |
| Anchor point | `turnStartedAt: epoch ms` | Set in `GameState` whenever the active player changes (`StartGame`, `EndTurn`, `ConfirmNextRoundOrder`, `Resume`, `Undo`). The reducer uses `Date.now() - turnStartedAt` modulo accumulator to compute elapsed; pause adjusts `turnStartedAt` on `Resume`. |

The tick loop MUST run regardless of whether any SSE client is connected. State is authoritative on the server.

### Drift handling

Because both server and client use `Date.now() / performance.now()` they MAY drift relative to each other. The client interpolation is purely cosmetic; the server-pushed value is authoritative and overwrites the interpolated display on every tick. The client SHOULD NOT extrapolate beyond 1 second past the last push (in case of network stall).

## Time-out behavior

A player's clock crosses zero when `remainingMs <= 0` after a tick. The reducer reacts as follows.

### `total-time` mode

- `remainingMs` continues to decrease into negative values. The display format is `-M:SS` (see `08-ui-screens.md`).
- An `Alert { playerId, kind: 'total-out', raisedAt }` is appended to `state.alerts` exactly once when the clock first crosses zero. Re-crossing into negative on subsequent ticks does NOT raise a duplicate alert.
- The alert is **persistent**: a red banner is displayed and an audio cue plays in a loop (1 Hz beep at ~440 Hz) until either:
  - The host explicitly fires `DismissAlert { playerId }`, or
  - `AdjustTime` lifts the player's `remainingMs` strictly above zero (in which case the reducer auto-emits a `DismissAlert` for that player).
- The game continues running normally; the timed-out player is NOT removed from the rotation.

### `turn-by-turn` mode

- `remainingMs` continues to decrease into negative values (so the host can see how much overtime was used).
- An `Alert { playerId, kind: 'turn-out', raisedAt }` is appended to `state.alerts` exactly once when the clock first crosses zero.
- The alert is **persistent** (same audio + visual treatment as above) until either:
  - The host fires `EndTurn` (advancing to the next player); the alert is auto-cleared because the player is no longer active, OR
  - The host fires `DismissAlert { playerId }` manually, OR
  - The host fires `AdjustTime` lifting the player above zero, in which case the alert is auto-cleared.
- **No automatic turn advance.** The host advances manually.

## Pause / Resume

- `Pause` MAY be issued only from `Running`. It snapshots the active player's current `remainingMs` (computed from `Date.now() - turnStartedAt`), writes it to `state.remainingMs[currentPlayerId]`, and sets `turnStartedAt = null`. The tick loop sees `phase !== 'Running'` and stops decrementing.
- `Resume` MAY be issued only from `Paused`. It sets `turnStartedAt = Date.now()` and transitions to `Running`. The accumulated `remainingMs` is unchanged.
- Pause freezes only the active player's clock. Non-active players' clocks are not running anyway, so there is nothing else to freeze. The audio alert (if any) continues during `Paused` — the timeout condition is not erased by pausing.

## Undo (last turn switch)

The reducer maintains an unbounded `history: TurnSnapshot[]` for the duration of the game (cleared on `Restart` or `EndGame`).

A `TurnSnapshot` is pushed onto `history` immediately **before** the state mutates for either of these events:

- `EndTurn` (the snapshot captures the state of the player whose turn was about to end, including their final `remainingMs`).
- `ConfirmNextRoundOrder` (the snapshot captures the state at the start of `BetweenRounds`, so an undo from `Running` after a new round began can return the host to the BetweenRounds prompt).

A `TurnSnapshot` contains:

```ts
type TurnSnapshot = {
  takenAt: number;          // epoch ms
  phase: 'Running' | 'BetweenRounds';
  currentPlayerIdx: number;
  remainingMs: Record<string, number>;  // full map at snapshot
  roundNumber: number;
  currentOrder: string[];   // player ids
};
```

`Undo` pops the most recent snapshot and restores:

- `state.currentPlayerIdx`
- `state.remainingMs` (entire map)
- `state.roundNumber`
- `state.currentOrder`
- `state.phase = snapshot.phase`
- `state.turnStartedAt = Date.now()` if `snapshot.phase === 'Running'`, else `null`
- All alerts whose `raisedAt > snapshot.takenAt` are cleared.

If `history` is empty, `Undo` is rejected with HTTP 409 `nothing-to-undo`. Undo does NOT itself push a snapshot — undo is not redo-able.

## Time adjust

`AdjustTime { playerId, deltaMs }`:

- `deltaMs` is an integer. Positive values add time; negative values subtract.
- Applied immediately: `state.remainingMs[playerId] += deltaMs`.
- MAY push a player's `remainingMs` below zero (e.g. host applies a penalty).
- If `state.remainingMs[playerId]` rises strictly above zero AND there is an active `total-out` or `turn-out` alert for that player, the reducer auto-clears that alert.
- If `state.remainingMs[playerId]` falls to zero or below AND no alert exists for that player, the reducer raises the appropriate alert kind for the current `config.mode`.
- `AdjustTime` does NOT push a `TurnSnapshot` — it is not undoable. (If the host fat-fingers a delta, they apply the inverse delta to fix it.)
- `AdjustTime` is allowed in any of `Ready`, `Running`, `Paused`, `BetweenRounds`.

## Control button inventory

This table is the **authoritative** list of host-screen control buttons. Other documents (UI screens, server API) refer back to these names.

| Button | Issues event | Visible in phases | Enabled when |
| --- | --- | --- | --- |
| **Start new session** | `StartNewSession` | `Lobby` | always |
| **Open Settings** | (navigation) | `Lobby` | always |
| **Add Player** / **Remove Player** | `EditConfig` | `Configuring`, `Ready` | players count constraint (≥2, ≤8) |
| **Edit Player** field (name, time, device) | `EditConfig` | `Configuring`, `Ready` | always while visible |
| **Confirm Config** | `ConfirmConfig` | `Configuring` | validation passes (see `03-timer-config.md`) |
| **Edit Config** | `EditConfig` | `Ready` | always while visible |
| **Start** | `StartGame` | `Ready` | always |
| **End Turn** | `EndTurn { source: 'screen-tap' }` | `Running` | always (also available when `endOfTurnTrigger === 'physical-button'` as a fallback) |
| **Pause** | `Pause` | `Running` | always |
| **Resume** | `Resume` | `Paused` | always |
| **Undo** | `Undo` | `Running`, `Paused`, `BetweenRounds` | `history.length > 0` |
| **Adjust Time** (per player) | `AdjustTime` | `Ready`, `Running`, `Paused`, `BetweenRounds` | always while visible |
| **Dismiss Alert** | `DismissAlert` | `Running`, `Paused` | an alert for the targeted player exists |
| **Confirm Next Round Order** | `ConfirmNextRoundOrder` | `BetweenRounds` | provided list is a permutation of configured player ids |
| **Restart** | `Restart` | `Running`, `Paused`, `BetweenRounds` (UI MAY also offer in `Ready` — implementer's choice) | confirmation modal acknowledged |
| **End Game** | `EndGame` | every non-`Lobby` phase | confirmation modal acknowledged |

Implementations MUST disable rather than hide buttons whose enable-predicate fails, except where the button is not visible in the current phase (in which case it is hidden).

## Alert UI semantics

- Maximum one `total-out` alert per player and one `turn-out` alert per player at a time (in turn-by-turn mode a player is unlikely to have both; in total-time mode `turn-out` is never raised).
- Multiple players MAY have alerts simultaneously (in total-time mode this is common).
- The audio cue is shared (one loop, regardless of how many players are alerting). The visual banner enumerates each alerting player.
- Audio MUST be initiated only after the first user interaction in the host tab (browser autoplay policy). The implementation SHOULD prime the audio context on a benign event such as opening the Settings page or clicking Start new session, and SHOULD show a "audio unavailable" inline notice if priming failed.
