import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/state/errors";
import type { DomainEvent } from "@/server/state/events";
import { initialState } from "@/server/state/initial";
import { reduce } from "@/server/state/reducer";
import { checkInvariants } from "@/server/state/invariants";
import type { AppSettings, GameState } from "@/shared/types";

import {
  makeAppSettings,
  makeDevice,
  makeGameConfig,
  makePlayerConfig,
  makeGameState,
  readyState,
} from "@/tests/factories";

const T0 = 1_000_000;

function step(
  state: GameState,
  event: DomainEvent,
  options: { now?: number; lastTickAt?: number | null; appSettings?: AppSettings } = {},
) {
  const { now = T0, lastTickAt = null, appSettings = makeAppSettings() } = options;
  return reduce(state, event, now, lastTickAt, appSettings);
}

describe("reducer — phase transitions", () => {
  it("Lobby → Configuring via StartNewSession", () => {
    const s = initialState();
    const config = makeGameConfig();
    const r = step(s, { type: "StartNewSession", config });
    expect(r.state.phase).toBe("Configuring");
    expect(r.state.config).not.toBeNull();
    expect(r.state.config?.players.length).toBe(config.players.length);
    checkInvariants(r.state);
  });

  it("Configuring → Ready via valid ConfirmConfig", () => {
    const players = [
      makePlayerConfig({ name: "A" }),
      makePlayerConfig({ name: "B" }),
    ];
    const config = makeGameConfig({ players });
    const state: GameState = makeGameState({
      phase: "Configuring",
      config,
    });
    const r = step(state, { type: "ConfirmConfig" });
    expect(r.state.phase).toBe("Ready");
    expect(r.state.remainingMs[players[0]!.id]).toBe(players[0]!.timeBudgetMs);
    expect(r.state.currentOrder).toEqual([players[0]!.id, players[1]!.id]);
    expect(r.state.roundNumber).toBe(0);
    checkInvariants(r.state);
  });

  it("ConfirmConfig rejects invalid config", () => {
    const config = makeGameConfig({
      players: [makePlayerConfig()], // only 1 player
    });
    const state = makeGameState({ phase: "Configuring", config });
    expect(() => step(state, { type: "ConfirmConfig" })).toThrow(DomainError);
  });

  it("ConfirmConfig in physical-button mode rejects when MQTT not connected", () => {
    const dev = makeDevice();
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [
        makePlayerConfig({ assignedDeviceId: dev.id }),
        makePlayerConfig({ assignedDeviceId: makeDevice().id }),
      ],
    });
    const settings = makeAppSettings({ devices: [dev, makeDevice()] });
    const state = makeGameState({ phase: "Configuring", config });
    expect(() =>
      step(state, { type: "ConfirmConfig" }, { appSettings: settings }),
    ).toThrow(DomainError);
  });

  it("Ready → Running via StartGame sets idx=0, round=1, turnStartedAt=now", () => {
    const s = readyState({ n: 2, budgetMs: 60_000 });
    const r = step(s, { type: "StartGame" }, { now: T0 });
    expect(r.state.phase).toBe("Running");
    expect(r.state.currentPlayerIdx).toBe(0);
    expect(r.state.roundNumber).toBe(1);
    expect(r.state.turnStartedAt).toBe(T0);
    expect(r.lastTickAt).toBe(T0);
    checkInvariants(r.state);
  });

  it("StartGame preserves AdjustTime deltas applied in Ready (turn-by-turn)", () => {
    const s = readyState({ n: 2, budgetMs: 5_000, mode: "turn-by-turn" });
    const p0 = s.config!.players[0]!.id;
    const r1 = step(s, { type: "AdjustTime", playerId: p0, deltaMs: 2_000 });
    expect(r1.state.remainingMs[p0]).toBe(7_000);
    const r2 = step(r1.state, { type: "StartGame" }, { now: T0 });
    // Spec 06: StartGame does NOT re-initialize remainingMs.
    expect(r2.state.remainingMs[p0]).toBe(7_000);
  });

  it("Running → Paused via Pause; commits partial tick", () => {
    const s = readyState({ n: 2, budgetMs: 60_000 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "Pause" }, { now: T0 + 5_000, lastTickAt: T0 });
    expect(r2.state.phase).toBe("Paused");
    const active = r1.state.currentOrder[0]!;
    expect(r2.state.remainingMs[active]).toBe(60_000 - 5_000);
    expect(r2.state.turnStartedAt).toBeNull();
    expect(r2.lastTickAt).toBeNull();
    checkInvariants(r2.state);
  });

  it("Paused → Running via Resume; sets turnStartedAt to now", () => {
    const s = readyState({ n: 2 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "Pause" }, { now: T0 + 1_000, lastTickAt: T0 });
    const r3 = step(r2.state, { type: "Resume" }, { now: T0 + 5_000 });
    expect(r3.state.phase).toBe("Running");
    expect(r3.state.turnStartedAt).toBe(T0 + 5_000);
    expect(r3.lastTickAt).toBe(T0 + 5_000);
  });

  it("EndTurn advances within round", () => {
    const s = readyState({ n: 3, budgetMs: 60_000 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(
      r1.state,
      { type: "EndTurn", source: "screen-tap" },
      { now: T0 + 5_000, lastTickAt: T0 },
    );
    expect(r2.state.currentPlayerIdx).toBe(1);
    expect(r2.state.roundNumber).toBe(1);
    expect(r2.state.phase).toBe("Running");
    expect(r2.state.history.length).toBe(1);
    expect(r2.state.history[0]!.phase).toBe("Running");
    checkInvariants(r2.state);
  });

  it("EndTurn at round end (fixed): increments round, wraps to idx 0", () => {
    const s = readyState({ n: 2, budgetMs: 60_000, orderMode: "fixed" });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 1_000, lastTickAt: T0 });
    const r3 = step(r2.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 2_000, lastTickAt: T0 + 1_000 });
    expect(r3.state.phase).toBe("Running");
    expect(r3.state.currentPlayerIdx).toBe(0);
    expect(r3.state.roundNumber).toBe(2);
  });

  it("EndTurn at round end (rotating): transitions to BetweenRounds", () => {
    const s = readyState({ n: 2, budgetMs: 60_000, orderMode: "rotating" });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 1_000, lastTickAt: T0 });
    const r3 = step(r2.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 2_000, lastTickAt: T0 + 1_000 });
    expect(r3.state.phase).toBe("BetweenRounds");
    expect(r3.state.currentPlayerIdx).toBeNull();
    expect(r3.state.roundNumber).toBe(2);
  });

  it("ConfirmNextRoundOrder validates permutation", () => {
    const s = readyState({ n: 2, orderMode: "rotating" });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const ids = r1.state.currentOrder;
    const r2 = step(r1.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 1_000, lastTickAt: T0 });
    const r3 = step(r2.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 2_000, lastTickAt: T0 + 1_000 });
    expect(() =>
      step(r3.state, { type: "ConfirmNextRoundOrder", playerIds: ["x", "y"] }, { now: T0 + 3_000 }),
    ).toThrow(DomainError);
    const r4 = step(
      r3.state,
      { type: "ConfirmNextRoundOrder", playerIds: [ids[1]!, ids[0]!] },
      { now: T0 + 3_000 },
    );
    expect(r4.state.phase).toBe("Running");
    expect(r4.state.currentOrder).toEqual([ids[1], ids[0]]);
    expect(r4.state.currentPlayerIdx).toBe(0);
  });

  it("Restart resets clocks but preserves config", () => {
    const s = readyState({ n: 2, budgetMs: 60_000 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "Pause" }, { now: T0 + 10_000, lastTickAt: T0 });
    const r3 = step(r2.state, { type: "Restart" });
    expect(r3.state.phase).toBe("Ready");
    for (const p of r3.state.config!.players) {
      expect(r3.state.remainingMs[p.id]).toBe(p.timeBudgetMs);
    }
    expect(r3.state.history.length).toBe(0);
  });

  it("EndGame clears state but preserves mqtt", () => {
    const s = readyState({ n: 2 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "EndGame" });
    expect(r2.state.phase).toBe("Lobby");
    expect(r2.state.config).toBeNull();
    expect(r2.state.remainingMs).toEqual({});
  });
});

describe("reducer — Undo", () => {
  it("nothing-to-undo when history is empty", () => {
    const s = readyState({ n: 2 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    expect(() => step(r1.state, { type: "Undo" })).toThrow(DomainError);
  });

  it("undo from Running restores previous player and remainingMs", () => {
    const s = readyState({ n: 2, budgetMs: 60_000 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 5_000, lastTickAt: T0 });
    expect(r2.state.currentPlayerIdx).toBe(1);
    const r3 = step(r2.state, { type: "Undo" }, { now: T0 + 6_000 });
    expect(r3.state.phase).toBe("Running");
    expect(r3.state.currentPlayerIdx).toBe(0);
    expect(r3.state.history.length).toBe(0);
  });

  it("undo from Paused stays Paused (phase override)", () => {
    const s = readyState({ n: 2, budgetMs: 60_000 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 1_000, lastTickAt: T0 });
    const r3 = step(r2.state, { type: "Pause" }, { now: T0 + 2_000, lastTickAt: T0 + 1_000 });
    const r4 = step(r3.state, { type: "Undo" }, { now: T0 + 3_000 });
    expect(r4.state.phase).toBe("Paused");
    expect(r4.state.turnStartedAt).toBeNull();
    expect(r4.lastTickAt).toBeNull();
  });

  it("undo from BetweenRounds returns to Running with previous player", () => {
    const s = readyState({ n: 2, budgetMs: 60_000, orderMode: "rotating" });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const r2 = step(r1.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 1_000, lastTickAt: T0 });
    const r3 = step(r2.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 2_000, lastTickAt: T0 + 1_000 });
    expect(r3.state.phase).toBe("BetweenRounds");
    const r4 = step(r3.state, { type: "Undo" }, { now: T0 + 3_000 });
    expect(r4.state.phase).toBe("Running");
    expect(r4.state.currentPlayerIdx).toBe(1);
  });
});

describe("reducer — AdjustTime", () => {
  it("applies delta and raises alert on crossing zero", () => {
    const s = readyState({ n: 2, budgetMs: 5_000 });
    const r = step(s, { type: "AdjustTime", playerId: s.config!.players[0]!.id, deltaMs: -10_000 });
    expect(r.state.remainingMs[s.config!.players[0]!.id]).toBe(-5_000);
    expect(r.state.alerts.length).toBe(1);
    expect(r.state.alerts[0]!.kind).toBe("total-out");
  });

  it("auto-clears alert when crossing back above zero", () => {
    const s = readyState({ n: 2, budgetMs: 5_000 });
    const r1 = step(s, { type: "AdjustTime", playerId: s.config!.players[0]!.id, deltaMs: -10_000 });
    const r2 = step(r1.state, { type: "AdjustTime", playerId: s.config!.players[0]!.id, deltaMs: 15_000 });
    expect(r2.state.alerts.length).toBe(0);
  });

  it("rejects non-integer delta", () => {
    const s = readyState({ n: 2 });
    expect(() =>
      step(s, { type: "AdjustTime", playerId: s.config!.players[0]!.id, deltaMs: 1.5 }),
    ).toThrow(DomainError);
  });

  it("rejects unknown player", () => {
    const s = readyState({ n: 2 });
    expect(() =>
      step(s, { type: "AdjustTime", playerId: "bogus", deltaMs: 1000 }),
    ).toThrow(DomainError);
  });
});

describe("reducer — DismissAlert", () => {
  it("clears alerts for a player", () => {
    const s = readyState({ n: 2, budgetMs: 5_000 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const pid = r1.state.currentOrder[0]!;
    const r2 = step(
      r1.state,
      { type: "AdjustTime", playerId: pid, deltaMs: -10_000 },
      { now: T0 + 1_000 },
    );
    expect(r2.state.alerts.length).toBe(1);
    const r3 = step(r2.state, { type: "DismissAlert", playerId: pid }, { now: T0 + 2_000 });
    expect(r3.state.alerts.length).toBe(0);
  });
});

describe("reducer — turn-by-turn mode", () => {
  it("resets new active player's clock on EndTurn", () => {
    const s = readyState({ n: 2, budgetMs: 5_000, mode: "turn-by-turn" });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const p0 = r1.state.currentOrder[0]!;
    const p1 = r1.state.currentOrder[1]!;
    // Spend some of player 0's budget.
    const r2 = step(r1.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 3_000, lastTickAt: T0 });
    // Player 1's clock should be reset to budget when they become active.
    expect(r2.state.remainingMs[p1]).toBe(5_000);
    expect(r2.state.remainingMs[p0]).toBe(2_000); // 5_000 - 3_000 elapsed
  });

  it("EndTurn clears turn-out alert for outgoing player", () => {
    const s = readyState({ n: 2, budgetMs: 5_000, mode: "turn-by-turn" });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    const p0 = r1.state.currentOrder[0]!;
    // Force time-out via AdjustTime.
    const r2 = step(
      r1.state,
      { type: "AdjustTime", playerId: p0, deltaMs: -10_000 },
      { now: T0 + 1_000 },
    );
    expect(r2.state.alerts.length).toBe(1);
    const r3 = step(r2.state, { type: "EndTurn", source: "screen-tap" }, { now: T0 + 2_000, lastTickAt: T0 });
    expect(r3.state.alerts.length).toBe(0);
  });
});

describe("reducer — invalid-phase guards", () => {
  it("StartGame from Lobby throws", () => {
    expect(() => step(initialState(), { type: "StartGame" })).toThrow(DomainError);
  });
  it("Pause from Ready throws", () => {
    const s = readyState({ n: 2 });
    expect(() => step(s, { type: "Pause" })).toThrow(DomainError);
  });
  it("Resume from Running throws", () => {
    const s = readyState({ n: 2 });
    const r1 = step(s, { type: "StartGame" }, { now: T0 });
    expect(() => step(r1.state, { type: "Resume" })).toThrow(DomainError);
  });
});
