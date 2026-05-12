import { describe, expect, it } from "vitest";

import { PressDebouncer } from "@/server/mqtt/debounce";

describe("PressDebouncer", () => {
  it("accepts first press; suppresses presses within 500 ms; accepts after window", () => {
    const d = new PressDebouncer();
    expect(d.accept("a", 1_000)).toBe(true);
    expect(d.accept("a", 1_100)).toBe(false);
    expect(d.accept("a", 1_499)).toBe(false);
    expect(d.accept("a", 1_500)).toBe(true);
  });

  it("debounce is per device id", () => {
    const d = new PressDebouncer();
    expect(d.accept("a", 1_000)).toBe(true);
    expect(d.accept("b", 1_100)).toBe(true);
    expect(d.accept("a", 1_200)).toBe(false);
  });

  it("forget() clears state for one device", () => {
    const d = new PressDebouncer();
    d.accept("a", 1_000);
    d.forget("a");
    expect(d.accept("a", 1_100)).toBe(true);
  });
});
