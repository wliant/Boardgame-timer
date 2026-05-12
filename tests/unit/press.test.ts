import { describe, expect, it } from "vitest";

import { resolvePress } from "@/server/mqtt/press";
import { makeDevice, makeGameConfig, makeGameState, makePlayerConfig, readyState } from "@/tests/factories";

describe("resolvePress", () => {
  it("ignored with no config", () => {
    const state = makeGameState();
    const result = resolvePress(state, "dev-x");
    expect(result).toEqual({ type: "ignored", reason: "no-config" });
  });

  it("ignored when not physical-button mode", () => {
    const dev = makeDevice();
    const state = readyState();
    expect(resolvePress(state, dev.id)).toEqual({
      type: "ignored",
      reason: "not-physical-button-mode",
    });
  });

  it("ignored when device unknown", () => {
    const a = makeDevice();
    const b = makeDevice();
    const p1 = makePlayerConfig({ assignedDeviceId: a.id });
    const p2 = makePlayerConfig({ assignedDeviceId: b.id });
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [p1, p2],
    });
    const state = makeGameState({
      phase: "Running",
      config,
      currentOrder: [p1.id, p2.id],
      currentPlayerIdx: 0,
      turnStartedAt: 1,
      devicesSnapshot: [a, b],
      remainingMs: { [p1.id]: 1000, [p2.id]: 1000 },
    });
    expect(resolvePress(state, "unknown-device-id")).toEqual({
      type: "ignored",
      reason: "unknown-device",
    });
  });

  it("ignored when not the current player", () => {
    const a = makeDevice();
    const b = makeDevice();
    const p1 = makePlayerConfig({ assignedDeviceId: a.id });
    const p2 = makePlayerConfig({ assignedDeviceId: b.id });
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [p1, p2],
    });
    const state = makeGameState({
      phase: "Running",
      config,
      currentOrder: [p1.id, p2.id],
      currentPlayerIdx: 0,
      turnStartedAt: 1,
      devicesSnapshot: [a, b],
      remainingMs: { [p1.id]: 1000, [p2.id]: 1000 },
    });
    expect(resolvePress(state, b.id)).toEqual({
      type: "ignored",
      reason: "not-current-player",
    });
  });

  it("dispatches when active player presses", () => {
    const a = makeDevice();
    const b = makeDevice();
    const p1 = makePlayerConfig({ assignedDeviceId: a.id });
    const p2 = makePlayerConfig({ assignedDeviceId: b.id });
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [p1, p2],
    });
    const state = makeGameState({
      phase: "Running",
      config,
      currentOrder: [p1.id, p2.id],
      currentPlayerIdx: 0,
      turnStartedAt: 1,
      devicesSnapshot: [a, b],
      remainingMs: { [p1.id]: 1000, [p2.id]: 1000 },
    });
    expect(resolvePress(state, a.id)).toEqual({
      type: "dispatch",
      playerId: p1.id,
    });
  });

  it("ignored when not Running", () => {
    const a = makeDevice();
    const p1 = makePlayerConfig({ assignedDeviceId: a.id });
    const p2 = makePlayerConfig({ assignedDeviceId: makeDevice().id });
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [p1, p2],
    });
    const state = makeGameState({
      phase: "Paused",
      config,
      currentOrder: [p1.id, p2.id],
      currentPlayerIdx: 0,
      remainingMs: { [p1.id]: 1000, [p2.id]: 1000 },
    });
    expect(resolvePress(state, a.id)).toEqual({
      type: "ignored",
      reason: "not-current-player",
    });
  });
});
