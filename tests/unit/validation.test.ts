import { describe, expect, it } from "vitest";

import { validateConfig } from "@/server/state/validation";
import {
  makeAppSettings,
  makeDevice,
  makeGameConfig,
  makePlayerConfig,
} from "@/tests/factories";

describe("validateConfig", () => {
  it("accepts a minimal screen-tap config", () => {
    const config = makeGameConfig();
    const settings = makeAppSettings();
    expect(validateConfig(config, settings)).toEqual({ ok: true });
  });

  it("rejects fewer than 2 players", () => {
    const config = makeGameConfig({ players: [makePlayerConfig()] });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("player-count");
  });

  it("rejects more than 8 players", () => {
    const config = makeGameConfig({
      players: Array.from({ length: 9 }, () => makePlayerConfig()),
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("player-count");
  });

  it("rejects empty name", () => {
    const config = makeGameConfig({
      players: [makePlayerConfig({ name: "  " }), makePlayerConfig()],
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("player-name");
  });

  it("rejects name >24 chars", () => {
    const config = makeGameConfig({
      players: [makePlayerConfig({ name: "x".repeat(25) }), makePlayerConfig()],
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("player-name");
  });

  it("rejects non-positive budget", () => {
    const config = makeGameConfig({
      players: [makePlayerConfig({ timeBudgetMs: 0 }), makePlayerConfig()],
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("player-budget");
  });

  it("rejects non-integer budget", () => {
    const config = makeGameConfig({
      players: [makePlayerConfig({ timeBudgetMs: 0.5 }), makePlayerConfig()],
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("player-budget");
  });

  it("rejects stray device assignment in screen-tap mode", () => {
    const config = makeGameConfig({
      players: [
        makePlayerConfig({ assignedDeviceId: "x" }),
        makePlayerConfig(),
      ],
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("stray-device-assignment");
  });

  it("rejects missing device in physical-button mode", () => {
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [makePlayerConfig(), makePlayerConfig()],
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("missing-device");
  });

  it("rejects unknown device in physical-button mode", () => {
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [
        makePlayerConfig({ assignedDeviceId: "nope" }),
        makePlayerConfig({ assignedDeviceId: "also-nope" }),
      ],
    });
    const r = validateConfig(config, makeAppSettings());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("unknown-device");
  });

  it("rejects duplicate device assignment", () => {
    const dev = makeDevice();
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [
        makePlayerConfig({ assignedDeviceId: dev.id }),
        makePlayerConfig({ assignedDeviceId: dev.id }),
      ],
    });
    const settings = makeAppSettings({ devices: [dev] });
    const r = validateConfig(config, settings);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failed).toContain("duplicate-device");
  });

  it("accepts physical-button with valid distinct devices", () => {
    const a = makeDevice({ name: "A" });
    const b = makeDevice({ name: "B" });
    const config = makeGameConfig({
      endOfTurnTrigger: "physical-button",
      players: [
        makePlayerConfig({ assignedDeviceId: a.id }),
        makePlayerConfig({ assignedDeviceId: b.id }),
      ],
    });
    const settings = makeAppSettings({ devices: [a, b] });
    expect(validateConfig(config, settings)).toEqual({ ok: true });
  });
});
