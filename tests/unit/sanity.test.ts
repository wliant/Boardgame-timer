import { describe, expect, it } from "vitest";

import { initialState } from "@/server/state/initial";

describe("sanity", () => {
  it("initial state is Lobby", () => {
    expect(initialState().phase).toBe("Lobby");
  });
});
