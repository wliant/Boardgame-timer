import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getState } from "@/app/api/session/state/route";
import { POST as startConfig } from "@/app/api/session/start-config/route";
import { POST as confirmConfig } from "@/app/api/session/confirm-config/route";
import { POST as startGame } from "@/app/api/session/start-game/route";
import { POST as endTurn } from "@/app/api/session/end-turn/route";
import { POST as pause } from "@/app/api/session/pause/route";
import { POST as resume } from "@/app/api/session/resume/route";
import { POST as undo } from "@/app/api/session/undo/route";
import { POST as restart } from "@/app/api/session/restart/route";
import { POST as endGame } from "@/app/api/session/end-game/route";
import { GET as streamSse } from "@/app/api/session/stream/route";
import { resetGameForTests } from "@/server/game";
import type { GameState } from "@/shared/types";

import {
  collectSseEvents,
  expectSseEvent,
  waitFor,
  withTempDb,
} from "./helpers";

let cleanup = () => {};

beforeEach(() => {
  cleanup = withTempDb().cleanup;
  resetGameForTests();
});

afterEach(() => {
  cleanup();
});

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data: T };
  return body.data;
}

describe("full session walkthrough via REST handlers", () => {
  it("Lobby → Configuring → Ready → Running → EndGame emits the right SSE events", async () => {
    const ctrl = new AbortController();
    const sseReq = new Request("http://test/api/session/stream", { signal: ctrl.signal });
    const sseRes = streamSse(sseReq);
    const collector = collectSseEvents(sseRes);

    // Wait for initial state event.
    await expectSseEvent(collector, "state");

    const state0 = await unwrap<GameState>(getState());
    expect(state0.phase).toBe("Lobby");

    const state1 = await unwrap<GameState>(await startConfig());
    expect(state1.phase).toBe("Configuring");
    expect(state1.config).not.toBeNull();

    // ConfirmConfig should work for default screen-tap config.
    const state2 = await unwrap<GameState>(await confirmConfig());
    expect(state2.phase).toBe("Ready");

    const state3 = await unwrap<GameState>(await startGame());
    expect(state3.phase).toBe("Running");
    expect(state3.currentPlayerIdx).toBe(0);
    expect(state3.roundNumber).toBe(1);

    // Wait for tick events to flow.
    await waitFor(() => collector.events.some((e) => e.event === "tick"), 1_500);

    // End turn — should advance to next player.
    const state4 = await unwrap<GameState>(await endTurn());
    expect(state4.currentPlayerIdx).toBe(1);

    // Pause + resume cycle.
    const state5 = await unwrap<GameState>(await pause());
    expect(state5.phase).toBe("Paused");
    const state6 = await unwrap<GameState>(await resume());
    expect(state6.phase).toBe("Running");

    // Undo back to player 0.
    const state7 = await unwrap<GameState>(await undo());
    expect(state7.currentPlayerIdx).toBe(0);
    expect(state7.history.length).toBe(0);

    // Restart preserves config; clocks reset.
    const state8 = await unwrap<GameState>(await restart());
    expect(state8.phase).toBe("Ready");
    expect(state8.config).not.toBeNull();

    // End game.
    const state9 = await unwrap<GameState>(await endGame());
    expect(state9.phase).toBe("Lobby");
    expect(state9.config).toBeNull();

    // Verify SSE saw the phase transitions.
    const phaseEvents = collector.events.filter((e) => e.event === "phase-changed");
    const phases = phaseEvents.map((e) => (e.data as { phase: string }).phase);
    expect(phases).toEqual(
      expect.arrayContaining(["Configuring", "Ready", "Running", "Paused", "Lobby"]),
    );

    collector.stop();
    ctrl.abort();
  });
});
