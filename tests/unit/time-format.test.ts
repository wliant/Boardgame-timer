import { describe, expect, it } from "vitest";

import { formatDuration, parseDuration } from "@/client/time";

describe("formatDuration", () => {
  it("formats sub-minute values", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5_000)).toBe("0:05");
    expect(formatDuration(42_000)).toBe("0:42");
  });
  it("formats minute values", () => {
    expect(formatDuration(60_000)).toBe("1:00");
    expect(formatDuration(9 * 60_000)).toBe("9:00");
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59:59");
  });
  it("formats hour values with padded minutes", () => {
    expect(formatDuration(60 * 60_000 + 5_000)).toBe("1:00:05");
    expect(formatDuration(2 * 60 * 60_000 + 34 * 60_000 + 9_000)).toBe("2:34:09");
  });
  it("prefixes negative with minus", () => {
    expect(formatDuration(-12_000)).toBe("-0:12");
    expect(formatDuration(-63_000)).toBe("-1:03");
    expect(formatDuration(-(60 * 60_000 + 5_000))).toBe("-1:00:05");
  });
});

describe("parseDuration", () => {
  it("parses M:SS", () => {
    expect(parseDuration("0:05")).toBe(5_000);
    expect(parseDuration("9:00")).toBe(540_000);
  });
  it("parses H:MM:SS", () => {
    expect(parseDuration("1:00:05")).toBe(60 * 60_000 + 5_000);
  });
  it("parses bare seconds", () => {
    expect(parseDuration("30")).toBe(30_000);
  });
  it("returns null on garbage", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("9:99")).toBeNull();
  });
});
