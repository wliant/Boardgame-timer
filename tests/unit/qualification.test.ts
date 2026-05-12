import { describe, expect, it } from "vitest";

import { qualifies } from "@/server/mqtt/qualification";

function buf(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

describe("qualifies (spec 07 table)", () => {
  it("empty payload never qualifies", () => {
    expect(qualifies(buf(""), undefined)).toBe(false);
    expect(qualifies(buf(""), ["single"])).toBe(false);
  });

  it("plain string + undefined acceptedActions qualifies", () => {
    expect(qualifies(buf("single"), undefined)).toBe(true);
  });

  it("plain string is matched against acceptedActions exactly", () => {
    expect(qualifies(buf("single"), ["single", "double"])).toBe(true);
    expect(qualifies(buf("single"), ["double"])).toBe(false);
  });

  it("JSON object with matching action qualifies", () => {
    const payload = buf(JSON.stringify({ action: "single", battery: 78 }));
    expect(qualifies(payload, undefined)).toBe(true);
    expect(qualifies(payload, ["single"])).toBe(true);
    expect(qualifies(payload, ["double"])).toBe(false);
  });

  it("JSON object without action: qualifies iff acceptedActions undefined", () => {
    const payload = buf(JSON.stringify({ battery: 78 }));
    expect(qualifies(payload, undefined)).toBe(true);
    expect(qualifies(payload, ["single"])).toBe(false);
  });

  it("JSON action with mismatched type does not qualify when acceptedActions set", () => {
    const payload = buf(JSON.stringify({ action: 42 }));
    expect(qualifies(payload, ["single"])).toBe(false);
    expect(qualifies(payload, undefined)).toBe(true);
  });

  it("JSON array / number / null: qualifies iff acceptedActions undefined", () => {
    expect(qualifies(buf("[1,2]"), undefined)).toBe(true);
    expect(qualifies(buf("[1,2]"), ["single"])).toBe(false);
    expect(qualifies(buf("42"), undefined)).toBe(true);
    expect(qualifies(buf("42"), ["single"])).toBe(false);
    expect(qualifies(buf("null"), undefined)).toBe(true);
  });
});
