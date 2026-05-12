# 04 — In-Game Behavior

This document defines the runtime semantics that apply once the phase is `Running`, `Paused`, or `BetweenRounds`. It owns the **authoritative control-button inventory**.

## Timer tick model

The model is **incremental decrement**: on every server tick, the reducer decrements the active player's `remainingMs` by the wall-clock time elapsed since the previous tick. The reducer does NOT compute `remainingMs` from `turnStartedAt`; `turnStartedAt` is bookkeeping for UI ("how long has this turn been going") and the snapshot history, not an authoritative basis for `remainingMs`.

### Internal state for the tick loop

```ts
type TickerState = {
  lastTickAt: EpochMs | null;  // Date.now() of the most recent tick, while Running. Null otherwise.
};
```

`lastTickAt` is module-private (NOT part of `GameState`).

### Tick behavior

| Concern | Value |
| --- | --- |
| Server tick interval | **100 ms** (`setInterval`). |
| What one tick does | If `state.phase === 'Running'`: `delta = Date.now() - lastTickAt; state.remainingMs[activePlayerId] -= delta; lastTickAt = Date.now()`. Then check for zero-crossing (see "Time-out behavior" below). If not Running: no-op. |
| SSE push interval | **250 ms**. A `tick` SSE event is emitted containing only the active player's `remainingMs` and the current `turnStartedAt`. `tick` events are emitted ONLY while `state.phase === 'Running'`. |
| Client render interval | Animation frame (`requestAnimationFrame`). The client interpolates between SSE pushes using its local `performance.now()` clock, anchored to the most recent server-pushed value. |

### State transitions that affect the ticker

| Event | Effect on `lastTickAt` |
| --- | --- |
| Phase becomes `Running` (`StartGame`, `Resume`, `ConfirmNextRoundOrder`, `Undo` landing in `Running`) | `lastTickAt = Date.now()`. Also `state.turnStartedAt = Date.now()` if the active player changed. |
| Phase leaves `Running` (`Pause`, `EndTurn` followed by `BetweenRounds`, `EndGame`, `Restart`, `Undo` landing outside `Running`) | First commit a final partial tick (`delta = now - lastTickAt; remainingMs[active] -= delta`), then `lastTickAt = null`. This ensures the visible value matches what the player will see when paused. |
| `AdjustTime` (any phase) | `lastTickAt` is **not** modified. Because the model is incremental and `lastTickAt` is committed each tick, an adjustment to any player (including the active player) is stable across the next tick. |
| `EndTurn` advancing within `Running` | First commit a final partial tick to the outgoing active player, then advance `currentPlayerIdx`, then set `state.turnStartedAt = Date.now()`, set `lastTickAt = Date.now()`. In `turn-by-turn` mode, also reset the incoming active player's `remainingMs` to `config.players[i].timeBudgetMs` BEFORE setting `lastTickAt`. |

The tick loop MUST run regardless of whether any SSE client is connected. State is authoritative on the server.

### Drift handling

Because both server and client use `Date.now() / performance.now()` they MAY drift relative to each other. Client interpolation is purely cosmetic; the server-pushed value is authoritative and overwrites the interpolated display on every push. The client MUST stop interpolating as soon as it observes a `phase-changed` SSE event to any non-`Running` phase — it snaps the displayed value to the last server-pushed value and freezes. The client SHOULD NOT extrapolate more than 1 second past the last `tick` push (network stall guard).

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

- `EndTurn` — the snapshot's `phase = 'Running'` and captures the state of the player whose turn was about to end (including their committed `remainingMs` after the final partial tick).
- `ConfirmNextRoundOrder` — the snapshot's `phase = 'BetweenRounds'` and captures the state at the start of `BetweenRounds`, so an undo from `Running` after a new round began can return the host to the BetweenRounds prompt.

The canonical `TurnSnapshot` shape is defined in `05-data-model.md`.

The full Undo resolution rules (including the `Paused` phase-override and the "where does Undo from `BetweenRounds` land" cases) are defined in `02-session-lifecycle.md#undo-resolution`. The reducer in this file MUST conform to that resolution.

Undo when `state.history` is empty is rejected with HTTP 409 `nothing-to-undo`. Undo does NOT itself push a snapshot — undo is not redo-able.

## Time adjust

`AdjustTime { playerId, deltaMs }`:

- `deltaMs` is an integer (MUST be a finite integer; non-integers are rejected with `bad-request`). Positive values add time; negative values subtract.
- Applied immediately: `state.remainingMs[playerId] += deltaMs`.
- `lastTickAt` and `state.turnStartedAt` are NOT modified. Because the tick model is incremental (see "Timer tick model" above), adjusting the active player's `remainingMs` is stable — the next tick decrements from the new value, not from a recomputed anchor.
- MAY push a player's `remainingMs` below zero (e.g. host applies a penalty).
- If `state.remainingMs[playerId]` rises strictly above zero AND there is an active `total-out` or `turn-out` alert for that player, the reducer auto-clears that alert (emits `alert-cleared`).
- If `state.remainingMs[playerId]` falls to zero or below AND no alert exists for that player, the reducer raises the appropriate alert kind for the current `config.mode` (emits `alert-raised`).
- `AdjustTime` does NOT push a `TurnSnapshot` — it is not undoable. (If the host fat-fingers a delta, they apply the inverse delta to fix it.)
- `AdjustTime` is allowed in any of `Ready`, `Running`, `Paused`, `BetweenRounds`.

Use `AdjustTime` in `Ready` for one-off corrections to a player's starting clock. Use `EditConfig` (which reverts to `Configuring` and requires re-confirm) for changes to the canonical `timeBudgetMs`.

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
| **End Turn** | `EndTurn { source: 'screen-tap' }` | `Running` | always — the on-screen End Turn button is present in all `Running` states regardless of `endOfTurnTrigger`. When trigger is `physical-button` it serves as the broker-loss fallback. |
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
- The audio cue is shared (one looping oscillator, regardless of how many players are alerting). The visual banner enumerates each alerting player.

### Audio implementation

- Generated via **WebAudio** (`AudioContext` + a single `OscillatorNode`) on the client. No audio asset ships with the app.
- Oscillator parameters: `type = 'sine'`, `frequency = 440 Hz`, gated through a `GainNode` driven by a `setInterval`-based 1 Hz on/off envelope (200 ms on, 800 ms off).
- The `AudioContext` MUST be primed by a user gesture due to browser autoplay policy. The client primes it on the **first click anywhere in the app** after page load (a global one-shot click listener that calls `audioContext.resume()` and then unregisters itself). If priming fails or the browser blocks audio, the client renders a small "🔇 audio unavailable — alerts will be visual only" notice inline below the active-player card while phase is `Running`/`Paused`.
- The looping `setInterval` is started when `state.alerts.length` transitions from `0` to `>= 1`, and cleared when it transitions back to `0`. This holds for any cause of the transition: `alert-raised` SSE, `alert-cleared` SSE, or a `state` event arriving on (re)connect that carries a different `alerts.length`. The client SHOULD derive "alerts active" purely from the latest `state.alerts.length`, not from event sequencing.
- On SSE reconnect, the client receives a `state` event; if `state.alerts` is non-empty, the loop starts (or stays running); otherwise it stops. No "missed event" replay is needed.

## MQTT broker loss during play

`endOfTurnTrigger === 'physical-button'` requires the broker. If the broker disconnects after `ConfirmConfig` (any phase from `Ready` onward), the in-game screen MUST surface a prominent banner: "⚠ MQTT disconnected — physical buttons won't work. Use the on-screen End Turn button."

- The screen-tap "End Turn" button (the large central button described in `08-ui-screens.md`) is **always present** in `Running`, regardless of `endOfTurnTrigger`. This is the fallback.
- The reducer MUST NOT auto-pause on disconnect; gameplay continues.
- Presses received before the disconnect are not buffered; on reconnect, only new presses count (per the non-goal in `01-overview.md`).
- The banner clears automatically when `state.mqtt.connected` transitions to `true`.
