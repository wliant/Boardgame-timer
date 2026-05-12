# 05 — Data Model

This document is the **authoritative** source for every entity shape in the system. All TypeScript types here MUST be imported (not re-declared) by both server and client code. JSON examples are illustrative — the TypeScript signatures are normative.

## Shared scalar types

```ts
/** UUID v4 string. */
export type Id = string;

/** Wall-clock instant (Date.now() semantics). */
export type EpochMs = number;

/** Duration in milliseconds; integer; MAY be negative for over-time displays. */
export type DurationMs = number;
```

## `AppSettings`

Persistent application settings. Stored server-side in SQLite (see `09-persistence.md`); a copy is cached in browser `localStorage` for fast first paint.

```ts
export type MqttBrokerConfig = {
  url: string;            // e.g. "mqtt://10.0.0.5:1883" or "mqtts://broker.example:8883"
  username?: string;
  password?: string;
  clientId: string;       // default: "boardgame-timer-<random>"
};

export type Device = {
  id: Id;
  name: string;           // human-readable, 1..40 chars
  topic: string;          // MQTT topic the device publishes on
  /** Optional action set; if present, an incoming payload must contain
   *  one of these strings in its JSON `action` field to qualify. If absent,
   *  any non-empty payload on the topic qualifies. See 07-mqtt-integration.md. */
  acceptedActions?: string[];
  lastSeenAt?: EpochMs;   // updated when a qualifying message arrives on the topic
};

export type AppSettings = {
  mqttBroker: MqttBrokerConfig;
  devices: Device[];
};
```

Example:

```json
{
  "mqttBroker": {
    "url": "mqtt://10.0.0.5:1883",
    "clientId": "boardgame-timer-7Q3F"
  },
  "devices": [
    {
      "id": "d1c9c2c0-0fae-4f9a-89c2-1c6e5b3a9a01",
      "name": "Red button (kitchen table)",
      "topic": "zigbee2mqtt/0x00158d0001abcdef",
      "acceptedActions": ["single"],
      "lastSeenAt": 1715472000000
    }
  ]
}
```

## `GameConfig`

The user-defined parameters for an upcoming or in-progress game. See `03-timer-config.md` for field semantics and validation rules.

```ts
export type TimerMode = 'total-time' | 'turn-by-turn';
export type EndOfTurnTrigger = 'screen-tap' | 'physical-button';
export type TurnOrderMode = 'fixed' | 'rotating';

export type PlayerConfig = {
  id: Id;
  name: string;                       // 1..24 chars after trim
  timeBudgetMs: DurationMs;           // > 0
  assignedDeviceId: Id | null;        // non-null iff endOfTurnTrigger === 'physical-button'
};

export type GameConfig = {
  mode: TimerMode;
  endOfTurnTrigger: EndOfTurnTrigger;
  turnOrderMode: TurnOrderMode;
  players: PlayerConfig[];            // length in [2, 8]
};
```

Example:

```json
{
  "mode": "total-time",
  "endOfTurnTrigger": "physical-button",
  "turnOrderMode": "rotating",
  "players": [
    {
      "id": "p-1",
      "name": "Alice",
      "timeBudgetMs": 600000,
      "assignedDeviceId": "d1c9c2c0-0fae-4f9a-89c2-1c6e5b3a9a01"
    },
    {
      "id": "p-2",
      "name": "Bob",
      "timeBudgetMs": 600000,
      "assignedDeviceId": "d2..."
    }
  ]
}
```

## `GameState`

In-memory runtime state. Reset on `EndGame`, partially reset on `Restart`. See `02-session-lifecycle.md` and `04-in-game-behavior.md` for transitions.

```ts
export type Phase =
  | 'Lobby'
  | 'Configuring'
  | 'Ready'
  | 'Running'
  | 'Paused'
  | 'BetweenRounds'
  | 'Ended';

export type AlertKind = 'total-out' | 'turn-out';

export type Alert = {
  playerId: Id;
  kind: AlertKind;
  raisedAt: EpochMs;
};

export type TurnSnapshot = {
  takenAt: EpochMs;
  phase: 'Running' | 'BetweenRounds';
  currentPlayerIdx: number;
  remainingMs: Record<Id, DurationMs>;   // full map at snapshot
  roundNumber: number;
  currentOrder: Id[];
};

export type GameState = {
  phase: Phase;
  /** The confirmed config; null while phase is 'Lobby'. While 'Configuring', this is the draft being edited. */
  config: GameConfig | null;
  /** Devices captured at ConfirmConfig — frozen snapshot used by the running game even if AppSettings.devices is edited later. */
  devicesSnapshot: Device[];
  /** Index into currentOrder. Undefined when phase is 'Lobby' | 'Configuring' | 'Ready' | 'Ended'. */
  currentPlayerIdx: number | null;
  /** 1-based round counter. 1 at StartGame; incremented when a round completes. */
  roundNumber: number;
  /** Ordered list of player ids defining this round's turn order. */
  currentOrder: Id[];
  /** Per-player remaining time. May be negative. Key is PlayerConfig.id. */
  remainingMs: Record<Id, DurationMs>;
  /** Set when phase is 'Running'; the wall-clock instant at which the current player became active. Null otherwise. */
  turnStartedAt: EpochMs | null;
  /** Active alerts. Cleared by DismissAlert, AdjustTime crossing back above zero, or EndTurn (for turn-out). */
  alerts: Alert[];
  /** Undo stack. Pushed on EndTurn and ConfirmNextRoundOrder. Cleared on Restart and EndGame. */
  history: TurnSnapshot[];
  /** MQTT broker connection state, surfaced to the UI. */
  mqtt: {
    connected: boolean;
    lastError: string | null;
    lastConnectedAt: EpochMs | null;
  };
};
```

### Example: phase `Running`, total-time, fixed order

```json
{
  "phase": "Running",
  "config": { /* GameConfig as above */ },
  "devicesSnapshot": [ /* devices as captured at ConfirmConfig */ ],
  "currentPlayerIdx": 1,
  "roundNumber": 2,
  "currentOrder": ["p-1", "p-2", "p-3"],
  "remainingMs": { "p-1": 542300, "p-2": 281450, "p-3": 600000 },
  "turnStartedAt": 1715472240123,
  "alerts": [],
  "history": [
    {
      "takenAt": 1715472180000,
      "phase": "Running",
      "currentPlayerIdx": 0,
      "remainingMs": { "p-1": 542300, "p-2": 300000, "p-3": 600000 },
      "roundNumber": 2,
      "currentOrder": ["p-1", "p-2", "p-3"]
    }
  ],
  "mqtt": { "connected": true, "lastError": null, "lastConnectedAt": 1715471000000 }
}
```

## Invariants

The reducer MUST maintain these invariants at all times:

1. `Object.keys(state.remainingMs)` equals `state.config.players.map(p => p.id)` whenever `state.config` is non-null and phase is not `Lobby`/`Configuring`.
2. `state.currentOrder` is always a permutation of `state.config.players.map(p => p.id)` while phase is `Running`/`Paused`/`BetweenRounds`.
3. `state.currentPlayerIdx` is in `[0, state.currentOrder.length - 1]` while phase is `Running`/`Paused`.
4. `state.turnStartedAt` is non-null **iff** `state.phase === 'Running'`.
5. `state.alerts` contains at most one entry per `(playerId, kind)` pair.
6. `state.history` is non-empty implies the game has had at least one `EndTurn` or `ConfirmNextRoundOrder` since the last `Restart`/`StartGame`.
7. While `state.config.endOfTurnTrigger === 'physical-button'`, every `PlayerConfig.assignedDeviceId` MUST reference a device id present in `state.devicesSnapshot`.

Any reducer code path that would violate one of these MUST instead reject the event with an appropriate error (see `06-server-api.md`).
