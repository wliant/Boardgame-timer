import { describe, expect, it } from "vitest";

import { commitElapsed } from "@/server/state/tickCore";
import { reduce } from "@/server/state/reducer";
import { makeAppSettings, readyState } from "@/tests/factories";

const T0 = 100_000;

describe("commitElapsed", () => {
  it("decrements active player's clock by delta", () => {
    const s = readyState({ n: 2, budgetMs: 60_000 });
    const r1 = reduce(s, { type: "StartGame" }, T0, null, makeAppSettings());
    const lastTickAt = r1.lastTickAt!;
    const r2 = commitElapsed(r1.state, T0 + 250, lastTickAt);
    const active = r1.state.currentOrder[0]!;
    expect(r2.state.remainingMs[active]).toBe(60_000 - 250);
    expect(r2.lastTickAt).toBe(T0 + 250);
  });

  it("no-op when phase is not Running", () => {
    const s = readyState({ n: 2 });
    const r = commitElapsed(s, T0 + 1000, T0);
    expect(r.state).toBe(s);
  });

  it("raises alert when active player crosses zero", () => {
    const s = readyState({ n: 2, budgetMs: 100 });
    const r1 = reduce(s, { type: "StartGame" }, T0, null, makeAppSettings());
    const r2 = commitElapsed(r1.state, T0 + 200, r1.lastTickAt!);
    expect(r2.state.alerts.length).toBe(1);
    expect(r2.events.find((e) => e.event === "alert-raised")).toBeDefined();
  });
});
