# 10 — Glossary

Definitions of terms used across the spec set. When a term appears in this glossary, other documents MUST use it consistently and SHOULD NOT redefine it.

| Term | Definition |
| --- | --- |
| **Session** | The entire host-side run of the app from `Lobby` to `Lobby`. A session may contain at most one game at a time. |
| **Game** | One run from `StartGame` through to `EndGame` or `Restart`. A game has exactly one `GameConfig`. |
| **Round** | One pass through `currentOrder`. A round starts when player at index 0 becomes active and ends when player at the last index ends their turn. `roundNumber` is 1-based. |
| **Turn** | The interval during which one player is the active player. Ends with `EndTurn`, `Pause` (suspended turn), `EndGame`, `Restart`, or `Undo`. |
| **Active player** | The player whose clock is currently decreasing (`Running`) or frozen mid-decrease (`Paused`). Identified by `currentOrder[currentPlayerIdx]`. |
| **Host** | The single user operating the app via the host screen. The only persona. |
| **Player** | A participant whose clock the app tracks. Players do not interact with the app directly except by holding an assigned physical device (when `endOfTurnTrigger === 'physical-button'`). |
| **Device** | A physical button (typically Aqara via zigbee2mqtt) registered in `AppSettings.devices`. Has a name, topic, and optional accepted-actions list. |
| **Tick** | One iteration of the server's 100 ms timer loop. Decrements the active player's `remainingMs`. |
| **Push** | One outgoing SSE `tick` event from server to client (every 250 ms while `Running`). Distinct from a "tick" because pushes are coarser. |
| **Alert** | A persistent timeout indicator (`total-out` or `turn-out`) raised when a player's `remainingMs` first crosses zero. Audio + visual until dismissed or auto-cleared. |
| **Snapshot** | A `TurnSnapshot` pushed onto the undo history at `EndTurn` or `ConfirmNextRoundOrder`. Records enough state to revert one step. |
| **Phase** | One of `Lobby`, `Configuring`, `Ready`, `Running`, `Paused`, `BetweenRounds`, `Ended`. Defined exhaustively in `02-session-lifecycle.md`. |
| **Mode** | `config.mode`. Either `total-time` (per-game budget) or `turn-by-turn` (per-turn limit). |
| **Trigger** | `config.endOfTurnTrigger`. Either `screen-tap` (host button) or `physical-button` (MQTT device). |
| **Order mode** | `config.turnOrderMode`. Either `fixed` (same order every round) or `rotating` (host reorders between rounds). |
| **Qualifying message** | An MQTT message whose topic and payload satisfy the rules in `07-mqtt-integration.md#payload-schema-and-qualification` for the device whose topic it arrived on. |
| **Discovery window** | The bounded period (default 15 s) during which the server subscribes to a permissive wildcard to help the host find a new device's topic. See `07-mqtt-integration.md#listen-for-press-discovery-flow-settings`. |
| **Mid-game lock** | The rule that disables Settings and `GameConfig` edits while phase is `Running`, `Paused`, or `BetweenRounds`. See `08-ui-screens.md#mid-game-lock`. |
| **Last-writer-wins** | The concurrency model: any host tab may issue actions; the latest one through the reducer wins. No locking. |
| **Source of truth** | For persistent data (settings, devices), the SQLite database on the server. For runtime data (`GameState`), the in-memory object on the server. |
