// Authoritative entity shapes from specs/05-data-model.md.
// MUST be imported (not re-declared) by both server and client code.

// --- Shared scalar types ---

/** UUID v4 string. */
export type Id = string;

/** Wall-clock instant (Date.now() semantics). */
export type EpochMs = number;

/** Duration in milliseconds; integer; MAY be negative for over-time displays. */
export type DurationMs = number;

// --- AppSettings ---

export type MqttBrokerConfig = {
  /** Broker URL. Empty string means "no broker configured". */
  url: string;
  username?: string;
  password?: string;
  clientId: string;
};

export type Device = {
  id: Id;
  name: string;
  topic: string;
  acceptedActions?: string[];
  lastSeenAt?: EpochMs;
};

export type AppSettings = {
  mqttBroker: MqttBrokerConfig;
  devices: Device[];
};

// --- GameConfig ---

export type TimerMode = "total-time" | "turn-by-turn";
export type EndOfTurnTrigger = "screen-tap" | "physical-button";
export type TurnOrderMode = "fixed" | "rotating";

export type PlayerConfig = {
  id: Id;
  name: string;
  timeBudgetMs: DurationMs;
  assignedDeviceId: Id | null;
};

export type GameConfig = {
  mode: TimerMode;
  endOfTurnTrigger: EndOfTurnTrigger;
  turnOrderMode: TurnOrderMode;
  players: PlayerConfig[];
};

// --- GameState ---

export type Phase =
  | "Lobby"
  | "Configuring"
  | "Ready"
  | "Running"
  | "Paused"
  | "BetweenRounds";

export type AlertKind = "total-out" | "turn-out";

export type Alert = {
  playerId: Id;
  kind: AlertKind;
  raisedAt: EpochMs;
};

export type TurnSnapshot = {
  takenAt: EpochMs;
  phase: "Running" | "BetweenRounds";
  /** Null only when `phase === "BetweenRounds"`. */
  currentPlayerIdx: number | null;
  remainingMs: Record<Id, DurationMs>;
  roundNumber: number;
  currentOrder: Id[];
};

export type GameState = {
  phase: Phase;
  config: GameConfig | null;
  devicesSnapshot: Device[];
  currentPlayerIdx: number | null;
  roundNumber: number;
  currentOrder: Id[];
  remainingMs: Record<Id, DurationMs>;
  turnStartedAt: EpochMs | null;
  alerts: Alert[];
  history: TurnSnapshot[];
  mqtt: {
    connected: boolean;
    lastError: string | null;
    lastConnectedAt: EpochMs | null;
  };
};
