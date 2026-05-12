# server/state

Authoritative reducer for the in-memory `GameState`. Pure functions only:
`(state, event) -> (state, sseEvents[])`. Reads no wall-clock; takes any
needed timestamp as an input parameter. The tick loop in
`server/timer/` is the only place that touches `Clock`.

## Sources
- Transitions: [`specs/02-session-lifecycle.md`](../../specs/02-session-lifecycle.md)
- Runtime rules: [`specs/04-in-game-behavior.md`](../../specs/04-in-game-behavior.md)
- Validation: [`specs/03-timer-config.md`](../../specs/03-timer-config.md)
- Entity shapes: [`specs/05-data-model.md`](../../specs/05-data-model.md)

## Invariants (from specs/05 §Invariants)
1. `Object.keys(state.remainingMs)` equals `state.config.players.map(p => p.id)` whenever `state.config` is non-null and phase is not `Lobby`/`Configuring`.
2. `state.currentOrder` is always a permutation of `state.config.players.map(p => p.id)` while phase is `Running`/`Paused`/`BetweenRounds`.
3. `state.currentPlayerIdx` is in `[0, state.currentOrder.length - 1]` while phase is `Running`/`Paused`.
4. `state.turnStartedAt` is non-null **iff** `state.phase === 'Running'`.
5. `state.alerts` contains at most one entry per `(playerId, kind)` pair.
6. `state.history` is non-empty implies the game has had at least one `EndTurn` or `ConfirmNextRoundOrder` since the last `Restart`/`StartGame`.
7. While `endOfTurnTrigger === 'physical-button'`, every `assignedDeviceId` references a device in `state.devicesSnapshot`.
8. `state.history` items each carry `phase ∈ { 'Running', 'BetweenRounds' }`.
9. `state.turnStartedAt` is reset by `StartGame`, `EndTurn` (staying in `Running`), `ConfirmNextRoundOrder`, and `Undo` landing in `Running`. Set to `null` whenever the phase leaves `Running`.
